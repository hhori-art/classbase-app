'use client';

import { useState, useEffect } from 'react';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { auth } from '@/lib/firebase';
import { AlertTriangle, RefreshCw, CheckCircle, TrendingUp, Play } from 'lucide-react';

export default function RiskMonitorWidget() {
  const [riskyStudents, setRiskyStudents] = useState<any[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchRiskyStudents = async () => {
    try {
      // 既に分析済みの生徒の中からリスク高い順に表示
      const students = await fetchTeacherStudents();
      const list = students
        .filter((d: any) => (d.churn_risk || 0) >= 30) // リスク30%以上のみ表示
        .sort((a: any, b: any) => b.churn_risk - a.churn_risk)
        .slice(0, 5);
      setRiskyStudents(list);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchRiskyStudents(); }, []);

  const runBatchAnalysis = async () => {
    setAnalyzing(true);
    setStatusMsg('分析中...');
    
    try {
      // 5人ずつ分析 APIを呼ぶ
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('not-authenticated');
      const res = await fetch('/api/teacher/analyze-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batchSize: 5 }), 
      });
      const data = await res.json();
      
      if (data.processed === 0) {
        setStatusMsg('全生徒の分析は最新です');
      } else {
        setStatusMsg(`${data.processed}人を更新 (残り要更新: ${data.remaining}人)`);
        fetchRiskyStudents(); // リスト更新
      }
    } catch (e) {
      console.error(e);
      setStatusMsg('エラーが発生しました');
    } finally {
      setAnalyzing(false);
      // 3秒後にメッセージを消す
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden">
      <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
        <h3 className="font-bold text-red-800 flex items-center gap-2">
          <TrendingUp size={20}/> 退塾アラート (AI予測)
        </h3>
        <div className="flex flex-col items-end">
            <button 
              onClick={runBatchAnalysis} 
              disabled={analyzing}
              className="text-xs bg-white border border-red-200 text-red-600 px-3 py-1 rounded-full flex items-center gap-1 hover:bg-red-100 disabled:opacity-50 font-bold"
            >
              {analyzing ? <RefreshCw size={12} className="animate-spin"/> : <Play size={12}/>}
              {analyzing ? '分析中...' : 'データ更新'}
            </button>
            {statusMsg && <span className="text-[10px] text-red-500 mt-1 absolute -bottom-5 right-4">{statusMsg}</span>}
        </div>
      </div>

      <div className="divide-y divide-gray-100 relative">
        {statusMsg && <div className="absolute top-0 w-full bg-yellow-100 text-yellow-800 text-xs py-1 text-center font-bold animate-in fade-in">{statusMsg}</div>}
        
        {riskyStudents.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <CheckCircle size={32} className="mx-auto mb-2 text-green-400"/>
            現在、高リスク(30%以上)の生徒はいません
          </div>
        ) : (
          riskyStudents.map((st) => (
            <div key={st.id} className="p-4 hover:bg-red-50/30 transition-colors">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-800">{st.student_name}</span>
                  <span className="text-xs text-gray-500">({st.grade})</span>
                </div>
                <div className={`text-sm font-bold px-2 py-0.5 rounded ${
                  st.churn_risk >= 80 ? 'bg-red-600 text-white' : 
                  st.churn_risk >= 50 ? 'bg-orange-500 text-white' : 
                  'bg-yellow-400 text-white'
                }`}>
                  危険度 {st.churn_risk}%
                </div>
              </div>
              <p className="text-xs text-red-600 font-bold mb-1">⚠ {st.risk_reason}</p>
              <div className="bg-gray-50 p-2 rounded text-xs text-gray-600 border border-gray-100">
                <span className="font-bold text-blue-600">推奨対応:</span> {st.risk_action}
              </div>
              <div className="text-[10px] text-gray-300 text-right mt-1">
                最終分析: {st.risk_analyzed_at ? new Date(st.risk_analyzed_at).toLocaleDateString() : '未'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
