'use client';

import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';
import TimetableView from '@/app/components/timetable/TimetableView';
import type { StudentTimetable } from '@/lib/timetable';

/** 生徒の「受講講座・時間割」。毎週の曜日×時限と、これから2週間の授業（休講つき）。 */
export default function StudentTimetablePage() {
  const { user } = useAuth();
  const [data, setData] = useState<StudentTimetable | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setError(false);
    (async () => {
      try {
        const res = await fetch('/api/student/timetable', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'timetable-failed');
        if (active) setData(body as StudentTimetable);
      } catch (loadError) {
        console.warn('timetable load failed:', loadError);
        if (active) setError(true);
      }
    })();
    return () => { active = false; };
  }, [user, reload]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader tone="hero" title="受講講座・時間割" description="毎週の授業と、これから2週間の予定が見られます。" icon={CalendarDays} backHref="/student" />
      {error ? (
        <ErrorState title="時間割を読み込めませんでした" onRetry={() => { setData(null); setReload(value => value + 1); }} />
      ) : !data ? (
        <ListSkeleton rows={4} />
      ) : (
        <TimetableView data={data} audience="student" changeHref="/student/change-request" />
      )}
    </div>
  );
}
