'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import {
  AlertTriangle, CheckCircle, Search, RefreshCw
} from 'lucide-react';
import {
  Button, Card, PageHeader, useToast, useConfirm,
  ListSkeleton, EmptyState, ErrorState,
} from '@/app/components/ui';

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
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  
  // フィルター
  const [filterStatus, setFilterStatus] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());

  // データ取得関数
  const fetchData = async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentYear]);

  // AI分析の実行
  const runAiAnalysis = async () => {
    if (!(await confirm({
      title: '未分析または更新が必要な生徒のデータをAI分析しますか？',
      message: '処理に時間がかかる場合があります。',
      confirmLabel: '分析する',
    }))) return;
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
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { toast.error('分析の実行回数が上限に達しました。しばらくしてからお試しください。'); return; }
      if (!res.ok) throw new Error(data.error || 'analyze-failed');
      toast.success(`分析完了: ${data.processed}人を更新しました（内、詳細AI分析: ${data.ai_analyzed}人）`);
      fetchData(); // 画面更新
    } catch (e) {
      console.error(e);
      toast.error('分析中にエラーが発生しました');
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
      toast.error('更新できませんでした');
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

  const tabClass = (active: boolean, activeText: string) =>
    `min-h-9 rounded-input px-4 py-2 text-xs font-bold transition-colors ${active ? `bg-surface ${activeText} shadow-sm` : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">

        {/* ヘッダー */}
        <PageHeader
          tone="plain"
          title="退塾アラート管理"
          icon={AlertTriangle}
          description={`出席・提出状況・AIチャット分析 (${currentYear}年度)`}
          backHref="/teacher/work"
          actions={(
            <Button onClick={runAiAnalysis} loading={analyzing} icon={<RefreshCw size={16} aria-hidden />}>
              データ更新・分析
            </Button>
          )}
        />

        {/* フィルターエリア */}
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex rounded-btn bg-slate-100 p-1" role="group" aria-label="対応状況">
            <button
              type="button"
              aria-pressed={filterStatus === 'unresolved'}
              onClick={() => setFilterStatus('unresolved')}
              className={tabClass(filterStatus === 'unresolved', 'text-danger')}
            >
              未対応 ({risks.filter(r => !r.isResolved).length})
            </button>
            <button
              type="button"
              aria-pressed={filterStatus === 'resolved'}
              onClick={() => setFilterStatus('resolved')}
              className={tabClass(filterStatus === 'resolved', 'text-success')}
            >
              対応済
            </button>
            <button
              type="button"
              aria-pressed={filterStatus === 'all'}
              onClick={() => setFilterStatus('all')}
              className={tabClass(filterStatus === 'all', 'text-slate-700')}
            >
              全て
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} aria-hidden />
            <input
              type="text"
              placeholder="生徒名検索..."
              aria-label="生徒名検索"
              className="min-h-11 w-48 rounded-input border border-line bg-surface py-2 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </Card>

        {/* リスト表示 */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState onRetry={fetchData} />
        ) : displayRisks.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="該当するアラートはありません"
            description="現在、リスクの高い生徒は検知されていません"
          />
        ) : (
          <div className="grid gap-4">
            {displayRisks.map((data, idx) => (
              <Card
                key={idx}
                className={`transition-colors ${
                  data.isResolved ? 'opacity-70' : 'border-rose-100 hover:border-rose-300 hover:shadow-md'
                }`}
              >
                <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">

                  {/* 左側: 生徒情報 & リスク詳細 */}
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-bold text-fg">{data.student.student_name}</h2>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{data.student.grade}</span>
                      {data.student.classroom && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{data.student.classroom}</span>}
                    </div>

                    {/* リスクタグ */}
                    <div className="mb-3 flex flex-wrap gap-2">
                      {data.reasons.map((reason, i) => (
                        <span key={i} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold ${reason.includes('AI') ? 'border-violet-100 bg-violet-50 text-violet-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>
                          <AlertTriangle size={12} aria-hidden /> {reason}
                        </span>
                      ))}
                    </div>

                    {/* AI分析詳細 (あれば表示) */}
                    {data.aiReason && (
                      <div className="mt-3 rounded-btn border border-violet-100 bg-violet-50/50 p-3">
                        <p className="mb-1 flex items-center gap-1 text-xs font-bold text-violet-800">🤖 AI分析レポート</p>
                        <p className="mb-2 text-xs leading-relaxed text-slate-600"><span className="font-bold">理由:</span> {data.aiReason}</p>
                        {data.aiAction && <p className="text-xs leading-relaxed text-sky-700"><span className="font-bold">推奨対応:</span> {data.aiAction}</p>}
                      </div>
                    )}
                  </div>

                  {/* 右側: 数値データ & アクションボタン */}
                  <div className="flex shrink-0 items-center gap-6 border-line md:border-l md:pl-6">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-center">
                      <div>
                        <div className="text-xs font-bold text-slate-400">欠席</div>
                        <div className="text-lg font-bold text-fg">{data.absentCount}回</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-400">提出率</div>
                        <div className={`text-lg font-bold ${data.hwRate < 50 ? 'text-danger' : 'text-fg'}`}>{data.hwRate}%</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-pressed={data.isResolved}
                      onClick={() => toggleResolution(data.student.id, data.isResolved)}
                      className={`flex h-16 w-20 flex-col items-center justify-center rounded-btn border-2 transition-colors ${
                        data.isResolved
                          ? 'border-emerald-200 bg-success-soft text-success'
                          : 'border-line bg-surface text-slate-400 hover:border-emerald-400 hover:text-success hover:shadow-sm'
                      }`}
                    >
                      <CheckCircle size={24} className={data.isResolved ? 'fill-current' : ''} aria-hidden />
                      <span className="mt-1 text-xs font-bold">{data.isResolved ? '対応済' : '対応する'}</span>
                    </button>
                  </div>

                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
