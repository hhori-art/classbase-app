'use client';

import { useState, useEffect } from 'react';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { auth } from '@/lib/firebase';
import { AlertTriangle, RefreshCw, CheckCircle, TrendingUp, Play } from 'lucide-react';
import { formatDate } from '@/lib/format';

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
    setStatusMsg('分析中…');
    
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
    <div className="relative overflow-hidden rounded-card border border-rose-100 bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 p-4">
        <h3 className="flex items-center gap-2 font-bold text-rose-800">
          <TrendingUp size={20} aria-hidden /> 退塾アラート（AI予測）
        </h3>
        <div className="flex flex-col items-end">
            <button 
              onClick={runBatchAnalysis} 
              disabled={analyzing}
              className="flex min-h-9 items-center gap-1 rounded-btn border border-rose-200 bg-surface px-3 py-1 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50"
            >
              {analyzing ? <RefreshCw size={12} className="animate-spin" aria-hidden /> : <Play size={12} aria-hidden />}
              {analyzing ? '分析中…' : 'データ更新'}
            </button>
                    </div>
      </div>

      <div className="relative divide-y divide-slate-100">
        {statusMsg && <div role="status" className="absolute top-0 w-full bg-amber-100 py-1 text-center text-xs font-bold text-amber-800 animate-in fade-in">{statusMsg}</div>}
        
        {riskyStudents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" aria-hidden />
            現在、高リスク（30%以上）の生徒はいません
          </div>
        ) : (
          riskyStudents.map((st) => (
            <div key={st.id} className="p-4 transition-colors hover:bg-rose-50/30">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">{st.student_name}</span>
                  <span className="text-xs text-slate-500">（{st.grade}）</span>
                </div>
                <div className={`rounded-btn px-2 py-0.5 text-sm font-bold ${
                  st.churn_risk >= 80 ? 'bg-rose-600 text-white' :
                  st.churn_risk >= 50 ? 'bg-amber-500 text-white' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  危険度 {st.churn_risk}%
                </div>
              </div>
              <p className="mb-1 flex items-start gap-1 text-xs font-bold text-rose-600"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />{st.risk_reason}</p>
              <div className="rounded-btn border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                <span className="font-bold text-sky-700">推奨対応：</span> {st.risk_action}
              </div>
              <div className="mt-1 text-right text-xs text-slate-400">
                最終分析：{(st.risk_analyzed_at && formatDate(st.risk_analyzed_at, { withYear: true })) || '未'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
