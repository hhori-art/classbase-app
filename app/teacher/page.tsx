'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import TeacherDashboard from '@/app/components/TeacherDashboard';
import { jstDateKey } from '@/lib/date-key';
import { selectDisplayShiftAssignments } from '@/lib/shift-assignment-display';
import { ErrorState, ListSkeleton, Skeleton } from '@/app/components/ui';

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
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 基準日（デフォルトは今日）
  const [currentDate, setCurrentDate] = useState(jstDateKey());

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setDataLoading(true);
      setLoadError(false);
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
        const fetchedAssignments = selectDisplayShiftAssignments(
          shiftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        );
        
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
        const pendingSnap = await getCountFromServer(pendingQuery);
        setPendingCount(pendingSnap.data().count);

      } catch (e) {
        console.error('Teacher Data Fetch Error:', e);
        setLoadError(true);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user, profile, currentDate, viewMode, reloadKey]);

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
      <div className="space-y-4 px-4 py-5 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-card" />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (!user) return null;

  if (loadError) {
    return (
      <div className="px-4 py-5 sm:px-6">
        <ErrorState title="授業予定を読み込めませんでした" onRetry={() => setReloadKey(key => key + 1)} />
      </div>
    );
  }

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
