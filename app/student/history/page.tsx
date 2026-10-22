'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { History, Calendar, Trophy, Coins } from 'lucide-react';
import { Card, EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';
import { formatDate as formatJstDate } from '@/lib/format';

export default function StudentHistoryPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [coinLogs, setCoinLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const formatDate = (value: any) => formatJstDate(value, { withYear: true }) || '日付なし';

  useEffect(() => {
    if (user) fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // 直近50件の履歴を取得
      const q = query(
        collection(db, 'quest_results'),
        where('student_id', '==', user?.uid),
        orderBy('created_at', 'desc'),
        limit(50)
      );
      const coinQ = query(
        collection(db, 'coin_transactions'),
        where('user_id', '==', user?.uid),
        orderBy('created_at', 'desc'),
        limit(30)
      );
      const [snap, coinSnap] = await Promise.all([getDocs(q), getDocs(coinQ)]);
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCoinLogs(coinSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <PageHeader tone="hero" title="学習履歴" description="これまでのクエストの結果とコインの記録です。" icon={History} backHref="/student/homework/adaptive" />

      {coinLogs.length > 0 && (
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-amber-700">
            <Coins size={18} aria-hidden /> コイン獲得履歴
          </h2>
          <div className="space-y-2">
            {coinLogs.slice(0, 5).map(log => (
              <div key={log.id} className="flex items-center justify-between rounded-btn bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-fg">{log.reason || 'コイン獲得'}</p>
                  <p className="text-xs text-fg-muted">{formatDate(log.created_at)}</p>
                </div>
                <span className={`text-lg font-bold ${Number(log.amount) >= 0 ? 'text-amber-700' : 'text-danger'}`}>
                  {Number(log.amount) >= 0 ? '+' : ''}{log.amount}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <ListSkeleton rows={4} />
      ) : loadError ? (
        <ErrorState title="学習履歴を読み込めませんでした" onRetry={() => void fetchHistory()} />
      ) : logs.length === 0 ? (
        <EmptyState icon={History} title="履歴はまだありません" />
      ) : (
        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.id} className="cb-card flex items-center justify-between gap-3 p-card">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{log.grade}</span>
                  <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">{log.subject}</span>
                  <span className="flex items-center gap-1 text-xs text-fg-muted">
                    <Calendar size={12} aria-hidden /> {formatDate(log.created_at)}
                  </span>
                </div>
                <h3 className="font-bold text-fg">{log.unit_name}</h3>
                {log.unit_stage_label && (
                  <p className="mt-1 text-xs font-bold text-accent">
                    到達段階: {log.unit_stage_label}
                    {Number(log.target_question_count || 0) > 0 && (
                      <span className="ml-2 font-medium text-fg-muted">
                        {log.mastered_question_count || 0}/{log.target_question_count}問 定着
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                {log.is_passed ? (
                  <div className="flex flex-col items-end text-success">
                    <span className="flex items-center gap-1 rounded-lg bg-success-soft px-2 py-1 text-sm font-bold">
                      <Trophy size={14} aria-hidden /> 合格
                    </span>
                    <span className="mt-1 text-xs font-bold">{log.score}%</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-end text-fg-muted">
                    <span className="text-sm font-bold">不合格</span>
                    <span className="mt-1 text-xs">{log.score}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
