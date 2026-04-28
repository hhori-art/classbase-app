'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, History, Calendar, Trophy, Coins } from 'lucide-react';

export default function StudentHistoryPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [coinLogs, setCoinLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const formatDate = (value: any) => {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '日付なし';
  };

  useEffect(() => {
    if (user) fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student/homework/adaptive" className="bg-white p-3 rounded-full shadow text-gray-500">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <History className="text-indigo-500"/> 学習履歴
          </h1>
        </div>

        {coinLogs.length > 0 && (
          <section className="mb-8 rounded-3xl bg-white p-5 shadow-sm border border-yellow-100">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-black text-yellow-700">
              <Coins size={18} /> コイン獲得履歴
            </h2>
            <div className="space-y-2">
              {coinLogs.slice(0, 5).map(log => (
                <div key={log.id} className="flex items-center justify-between rounded-2xl bg-yellow-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-black text-slate-800">{log.reason || 'コイン獲得'}</p>
                    <p className="text-[11px] font-bold text-slate-400">{formatDate(log.created_at)}</p>
                  </div>
                  <span className={`text-lg font-black ${Number(log.amount) >= 0 ? 'text-yellow-700' : 'text-rose-600'}`}>
                    {Number(log.amount) >= 0 ? '+' : ''}{log.amount}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-center py-10 text-gray-400">読み込み中...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl text-gray-400">
            履歴はまだありません
          </div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
              <div key={log.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">{log.grade}</span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold">{log.subject}</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Calendar size={10}/> {formatDate(log.created_at)}
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-800">{log.unit_name}</h3>
                </div>
                
                <div className="text-right">
                  {log.is_passed ? (
                    <div className="flex flex-col items-end text-green-500">
                      <span className="flex items-center gap-1 text-sm font-black bg-green-50 px-2 py-1 rounded-lg">
                        <Trophy size={14}/> 合格
                      </span>
                      <span className="text-xs font-bold mt-1">{log.score}%</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end text-gray-400">
                      <span className="text-sm font-bold">不合格</span>
                      <span className="text-xs mt-1">{log.score}%</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
