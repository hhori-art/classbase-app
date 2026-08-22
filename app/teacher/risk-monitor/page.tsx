'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { 
  ArrowLeft, AlertTriangle, CheckCircle, Loader2, Search, RefreshCw
} from 'lucide-react';
import Link from 'next/link';

// データ型定義
interface Student {
  id: string;
  student_name: string;
  grade: string;
  classroom: string;
  [key: string]: any;
}

interface RiskData {
  student: Student;
  absentCount: number; // 欠席数
  hwRate: number;      // 宿題提出率
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  reasons: string[];   // リスク理由
  isResolved: boolean; // 対応済みか
  aiRiskScore?: number; // AI分析スコア
  aiReason?: string;    // AI分析理由
  aiAction?: string;    // AI推奨アクション
}

// リスク判定基準
const RISK_THRESHOLDS = {
  absent: { high: 3, medium: 1 }, // 欠席回数
  hwRate: { high: 30, medium: 60 } // 提出率(%)以下
};

export default function RiskMonitorPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [risks, setRisks] = useState<RiskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  
  // フィルター
  const [filterStatus, setFilterStatus] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());

  // データ取得関数
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 設定から年度取得
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      let targetYear = currentYear;
      if (settingsSnap.exists()) {
        targetYear = settingsSnap.data().current_year || currentYear;
        setCurrentYear(targetYear);
      }

      // 2. 生徒全取得
      const studentList = await fetchTeacherStudents() as Student[];
      setStudents(studentList);

      // 3. PFレコード取得
      const qRecords = query(collection(db, 'pf_records'), where('year', '==', targetYear));
      const snapRecords = await getDocs(qRecords);
      const recordMap: {[key: string]: any[]} = {};
      snapRecords.forEach(d => {
        const data = d.data();
        if (!recordMap[data.student_id]) recordMap[data.student_id] = [];
        recordMap[data.student_id].push(data);
      });

      // 4. 対応状況取得
      const qRes = query(collection(db, 'pf_resolutions'), where('year', '==', targetYear));
      const snapRes = await getDocs(qRes);
      const resMap: {[key: string]: any} = {};
      snapRes.forEach(d => {
        const data = d.data();
        resMap[data.student_id] = (data.att && data.hw);
      });

      // 5. リスク計算
      const computedRisks: RiskData[] = [];

      studentList.forEach(s => {
        const recs = recordMap[s.id] || [];
        let absents = 0;
        let hwTotal = 0;
        let hwSubmitted = 0;

        recs.forEach(r => {
          if (r.attendance_status === '欠') absents++;
          if (r.social_hw || r.science_hw) {
            hwTotal++;
            if ((r.social_hw && r.social_hw !== '未') || (r.science_hw && r.science_hw !== '未')) {
              hwSubmitted++;
            }
          }
        });

        const hwRate = hwTotal > 0 ? Math.round((hwSubmitted / hwTotal) * 100) : 100;
        
        let level: RiskData['riskLevel'] = 'none';
        const reasons: string[] = [];

        // ルールベース判定
        if (absents >= RISK_THRESHOLDS.absent.high) {
          level = 'high';
          reasons.push(`欠席過多 (${absents}回)`);
        } else if (absents >= RISK_THRESHOLDS.absent.medium) {
          level = 'medium';
          reasons.push(`欠席気味 (${absents}回)`);
        }

        if (hwRate <= RISK_THRESHOLDS.hwRate.high) {
          level = 'high';
          reasons.push(`宿題未提出深刻 (${hwRate}%)`);
        } else if (hwRate <= RISK_THRESHOLDS.hwRate.medium) {
          if (level !== 'high') level = 'medium';
          reasons.push(`宿題提出率低下 (${hwRate}%)`);
        }

        // AI分析結果があれば加味する
        if (s.churn_risk >= 80) {
          level = 'high';
          reasons.push(`AI予測: 退塾危険高 (${s.churn_risk}%)`);
        } else if (s.churn_risk >= 50) {
          if (level !== 'high') level = 'medium';
          reasons.push(`AI予測: 要注意 (${s.churn_risk}%)`);
        }

        if (level !== 'none') {
          computedRisks.push({
            student: s,
            absentCount: absents,
            hwRate,
            riskLevel: level,
            reasons,
            isResolved: !!resMap[s.id],
            aiRiskScore: s.churn_risk,
            aiReason: s.risk_reason,
            aiAction: s.risk_action
          });
        }
      });

      // リスクが高い順にソート
      computedRisks.sort((a, b) => {
        const score = (l: string) => l === 'high' ? 2 : 1;
        return score(b.riskLevel) - score(a.riskLevel);
      });

      setRisks(computedRisks);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentYear]);

  // AI分析の実行
  const runAiAnalysis = async () => {
    if (!confirm('未分析または更新が必要な生徒のデータをAI分析しますか？\n(処理に時間がかかる場合があります)')) return;
    setAnalyzing(true);
    try {
      // API呼び出し (実装されている前提)
      const token = await user?.getIdToken();
      if (!token) throw new Error('not-authenticated');
      const res = await fetch('/api/teacher/analyze-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batchSize: 50 }), 
      });
      const data = await res.json();
      
      alert(`分析完了: ${data.processed}人を更新しました。\n(内、詳細AI分析: ${data.ai_analyzed}人)`);
      fetchData(); // 画面更新
    } catch (e) {
      console.error(e);
      alert('分析中にエラーが発生しました');
    } finally {
      setAnalyzing(false);
    }
  };

  // 対応状況の切り替え
  const toggleResolution = async (studentId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus;

      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/risk-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ student_id: studentId, year: currentYear, resolved: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'risk-resolution-failed');

      setRisks(prev => prev.map(r => 
        r.student.id === studentId ? { ...r, isResolved: newStatus } : r
      ));

    } catch (e) {
      alert('更新エラー');
      console.error(e);
    }
  };

  // 表示フィルタリング
  const displayRisks = useMemo(() => {
    return risks.filter(r => {
      if (filterStatus === 'unresolved' && r.isResolved) return false;
      if (filterStatus === 'resolved' && !r.isResolved) return false;
      
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return r.student.student_name.includes(q) || r.student.grade.includes(q);
      }
      return true;
    });
  }, [risks, filterStatus, searchQuery]);

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-32 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            {/* ★修正: リンク先を /teacher から /teacher/work に変更 */}
            <Link href="/teacher/work" className="bg-white p-3 rounded-full shadow-sm hover:bg-gray-50 text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
                <AlertTriangle className="text-red-500" /> 退塾アラート管理
              </h1>
              <p className="text-xs text-gray-500 font-bold mt-1">
                出席・提出状況・AIチャット分析 ({currentYear}年度)
              </p>
            </div>
          </div>
          <button 
            onClick={runAiAnalysis}
            disabled={analyzing}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 transition-all"
          >
            {analyzing ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>}
            データ更新・分析
          </button>
        </div>

        {/* フィルターエリア */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => setFilterStatus('unresolved')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterStatus === 'unresolved' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              未対応 ({risks.filter(r => !r.isResolved).length})
            </button>
            <button 
              onClick={() => setFilterStatus('resolved')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterStatus === 'resolved' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              対応済
            </button>
            <button 
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterStatus === 'all' ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              全て
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input 
              type="text" 
              placeholder="生徒名検索..." 
              className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-100 w-48"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* リスト表示 */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-400"/></div>
        ) : displayRisks.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
            <CheckCircle className="mx-auto text-green-200 mb-4" size={48}/>
            <p className="text-gray-400 font-bold">該当するアラートはありません</p>
            <p className="text-xs text-gray-300 mt-2">現在、リスクの高い生徒は検知されていません</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {displayRisks.map((data, idx) => (
              <div 
                key={idx} 
                className={`bg-white p-6 rounded-2xl shadow-sm border transition-all ${
                  data.isResolved ? 'border-gray-100 opacity-70' : 'border-red-100 hover:border-red-300 hover:shadow-md'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                  
                  {/* 左側: 生徒情報 & リスク詳細 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-extrabold text-gray-800">{data.student.student_name}</h2>
                      <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{data.student.grade}</span>
                      {data.student.classroom && <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{data.student.classroom}</span>}
                    </div>
                    
                    {/* リスクタグ */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {data.reasons.map((reason, i) => (
                        <span key={i} className={`text-xs font-bold px-2 py-1 rounded border flex items-center gap-1 ${reason.includes('AI') ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                          <AlertTriangle size={10}/> {reason}
                        </span>
                      ))}
                    </div>

                    {/* AI分析詳細 (あれば表示) */}
                    {data.aiReason && (
                      <div className="mt-3 bg-purple-50/50 rounded-xl p-3 border border-purple-100">
                        <p className="text-xs font-bold text-purple-800 mb-1 flex items-center gap-1">🤖 AI分析レポート</p>
                        <p className="text-xs text-gray-600 mb-2 leading-relaxed"><span className="font-bold">理由:</span> {data.aiReason}</p>
                        {data.aiAction && <p className="text-xs text-blue-600 leading-relaxed"><span className="font-bold">推奨対応:</span> {data.aiAction}</p>}
                      </div>
                    )}
                  </div>

                  {/* 右側: 数値データ & アクションボタン */}
                  <div className="flex items-center gap-6 md:border-l md:pl-6 border-gray-100 shrink-0">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-center">
                      <div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">欠席</div>
                        <div className="text-lg font-black text-gray-800">{data.absentCount}回</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">提出率</div>
                        <div className={`text-lg font-black ${data.hwRate < 50 ? 'text-red-500' : 'text-gray-800'}`}>{data.hwRate}%</div>
                      </div>
                    </div>

                    <button 
                      onClick={() => toggleResolution(data.student.id, data.isResolved)}
                      className={`flex flex-col items-center justify-center w-20 h-16 rounded-xl border-2 transition-all ${
                        data.isResolved 
                          ? 'bg-green-50 border-green-200 text-green-600' 
                          : 'bg-white border-gray-200 text-gray-300 hover:border-green-400 hover:text-green-500 hover:shadow-sm'
                      }`}
                    >
                      <CheckCircle size={24} className={data.isResolved ? 'fill-current' : ''}/>
                      <span className="text-[10px] font-bold mt-1">{data.isResolved ? '対応済' : '対応する'}</span>
                    </button>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
