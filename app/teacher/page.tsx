'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

// 表示用コンポーネント
import TeacherDashboard from '@/app/components/TeacherDashboard';

export default function TeacherPage() {
  const { user, profile, loading } = useAuth();
  
  // Dashboard内でデータ取得するようになったため、ここでは単純に権限チェックのみでもOKですが、
  // 必要に応じて他のデータを取得します。今回はエラー解消のため、Propsとして渡すデータを用意します。
  const [mainShifts, setMainShifts] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];

        // メインシフト (Dashboard内でも取得しているが、Propsとして渡すために取得)
        const shiftsQuery = query(
          collection(db, 'shift_assignments'),
          where('target_date', '==', todayStr),
          where('role_type', '==', 'main')
        );
        const shiftsSnap = await getDocs(shiftsQuery);
        setMainShifts(shiftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        // 未チェック宿題
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

  // 権限チェック
  useEffect(() => {
    if (!loading && profile) {
      if (profile.role === 'student') window.location.href = '/student';
      if (profile.role === 'master') window.location.href = '/master';
    }
  }, [loading, profile]);

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  if (!user) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  return (
    <TeacherDashboard 
      profile={profile}
      mainShifts={mainShifts}
      pendingCount={pendingCount}
    />
  );
}