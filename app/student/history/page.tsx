'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, History, Calendar, CheckCircle, XCircle, Trophy } from 'lucide-react';

export default function StudentHistoryPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
      const snap = await getDocs(q);
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
                      <Calendar size={10}/> {new Date(log.created_at?.toDate()).toLocaleDateString()}
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