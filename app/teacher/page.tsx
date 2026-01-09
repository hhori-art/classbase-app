'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

// 表示用コンポーネント
import TeacherDashboard from '@/app/components/TeacherDashboard';

export default function TeacherPage() {
  const { user, profile, loading } = useAuth();
  const [mainShifts, setMainShifts] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  // データ取得ロジック
  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 1. 今日のシフト取得 (shift_assignments)
        // role_typeが 'main' のものを取得
        const shiftsQuery = query(
          collection(db, 'shift_assignments'),
          where('target_date', '==', todayStr),
          where('role_type', '==', 'main')
        );
        const shiftsSnap = await getDocs(shiftsQuery);
        const shifts = shiftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMainShifts(shifts);

        // 2. 未チェック宿題数取得 (submissions where status == pending)
        const pendingQuery = query(
          collection(db, 'submissions'),
          where('status', '==', 'pending')
        );
        const pendingSnap = await getDocs(pendingQuery);
        setPendingCount(pendingSnap.size);

      } catch (e) {
        console.error('Teacher Data Fetch Error:', e);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user]);

  // 権限チェック (講師以外はリダイレクト)
  useEffect(() => {
    if (!loading && profile) {
      if (profile.role === 'student') window.location.href = '/student';
      if (profile.role === 'master') window.location.href = '/master';
    }
  }, [loading, profile]);

  // ローディング
  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  // 未ログイン
  if (!user) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  // 表示
  return (
    <TeacherDashboard 
      profile={profile}
      mainShifts={mainShifts}
      pendingCount={pendingCount}
    />
  );
}