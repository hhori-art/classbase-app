'use client';

import { useEffect, useState } from 'react';
import { BookOpenCheck, CalendarDays } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { useAuth } from '@/app/context/AuthContext';
import ReviewPeriodsPanel from '@/app/components/master/test-prep/ReviewPeriodsPanel';
import TestPrepCoursesPanel from '@/app/components/master/test-prep/TestPrepCoursesPanel';

type Tab = 'periods' | 'courses';

const TABS: { key: Tab; label: string; description: string; icon: typeof CalendarDays }[] = [
  { key: 'periods', label: '期間と実施単元', description: '復習期間・日ごとの単元', icon: CalendarDays },
  { key: 'courses', label: '対策講座の受講登録', description: '講座・受付期間・対象学年', icon: BookOpenCheck },
];

/** テスト対策と復習期間は同じものなので、期間・単元と受講登録の設定を1画面にまとめる。 */
export default function TestPrepAdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('periods');
  // 対策講座の設定APIはマスター専用なので、マスター以外にはタブを出さない（権限は広げない）。
  const canManageCourses = profile?.role === 'master';
  const visibleTabs = TABS.filter(item => item.key !== 'courses' || canManageCourses);
  const activeTab: Tab = tab === 'courses' && !canManageCourses ? 'periods' : tab;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested === 'courses' || requested === 'periods') setTab(requested);
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="space-y-5 pb-16">
      <AdminPageHeader description="テスト対策の期間と実施単元、生徒が受講登録する対策講座をまとめて設定します。" />
      {visibleTabs.length > 1 && (
        <AdminTabs
          tabs={visibleTabs.map(item => ({ id: item.key, label: item.label, icon: item.icon }))}
          value={activeTab}
          onChange={selectTab}
          ariaLabel="テスト対策の設定"
        />
      )}
      {activeTab === 'periods' ? <ReviewPeriodsPanel /> : <TestPrepCoursesPanel />}
    </div>
  );
}
