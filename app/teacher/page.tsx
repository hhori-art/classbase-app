'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import TeacherDashboard from '@/app/components/TeacherDashboard';

export default function TeacherPage() {
  const { user, profile, loading } = useAuth();
  
  // 表示モード (日次/週次)
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  // ★追加: 拡大状態をここで管理
  const [isExpanded, setIsExpanded] = useState(false);
  
  // データ
  const [allAssignments, setAllAssignments] = useState<any[]>([]); 
  const [pendingCount, setPendingCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  // 基準日（デフォルトは今日）
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setDataLoading(true);
      try {
        // 1. 取得対象の日付リストを作成
        const targetDates = [currentDate];
        if (viewMode === 'week') {
          for (let i = 1; i < 7; i++) {
            const d = new Date(currentDate);
            d.setDate(d.getDate() + i);
            targetDates.push(d.toISOString().split('T')[0]);
          }
        }

        // 2. シフトデータ取得
        // Firestoreの 'in' クエリは最大10件までなので、1週間分(7日)ならOK
        const shiftsQuery = query(
          collection(db, 'shift_assignments'),
          where('target_date', 'in', targetDates)
        );
        
        const shiftsSnap = await getDocs(shiftsQuery);
        const fetchedAssignments = shiftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // ソート
        fetchedAssignments.sort((a: any, b: any) => {
           if (a.target_date !== b.target_date) return a.target_date.localeCompare(b.target_date);
           return (a.note || '').localeCompare(b.note || '');
        });

        setAllAssignments(fetchedAssignments);

        // 3. 未チェック宿題（全件）
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
  }, [user, profile, currentDate, viewMode]);

  // 権限チェック
  useEffect(() => {
    if (!loading && profile) {
      if (profile.role === 'student') window.location.href = '/student';
      if (profile.role === 'master') window.location.href = '/master';
    }
  }, [loading, profile]);

  // ローディング中
  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
          <p className="text-slate-400 text-sm font-bold">データを読み込んでいます...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <TeacherDashboard 
      profile={profile}
      allAssignments={allAssignments}
      pendingCount={pendingCount}
      currentDate={currentDate}
      onDateChange={setCurrentDate}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      // ★追加: 状態と更新関数を渡す
      isExpanded={isExpanded}
      onExpandChange={setIsExpanded}
    />
  );
}