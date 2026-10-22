'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarX2, ChevronLeft, ChevronRight, ClipboardCheck, FileText, MonitorPlay, Users, Video } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ParentCard, ParentEmpty, ParentPageHeader } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { ErrorState, IconButton, ListSkeleton } from '@/app/components/ui';
import LessonDayList, { summarizeLessonDays, type LessonDay } from '@/app/components/parent/LessonDayList';

type Student = { id: string; student_name?: string };

const monthKeyOf = (date: string) => date.slice(0, 7);
const currentMonthKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const shiftMonth = (key: string, diff: number) => {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + diff, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月`;

/** 保護者向けの学習状況：いつ・どの教科を、Zoomで受けたか録画で見たかを授業日ごとに表示する。 */
export default function ParentLearningPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [days, setDays] = useState<LessonDay[]>([]);
  const [month, setMonth] = useState(currentMonthKey);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentsError, setStudentsError] = useState('');
  const [studentsReload, setStudentsReload] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setStudentsError('');
    (async () => {
      try {
        const response = await fetch('/api/parent/dashboard', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        if (!active) return;
        const list: Student[] = Array.isArray(data.students) ? data.students : [];
        setStudents(list);
        setStudentId(current => pickChildId(user.uid, list.map(student => student.id), current));
        if (list.length === 0) setLoading(false);
      } catch {
        if (active) { setStudentsError('お子さまの情報を読み込めませんでした。通信状態を確認して、もう一度お試しください。'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [user, studentsReload]);

  useEffect(() => {
    if (!user || !studentId) return;
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const response = await fetch(`/api/parent/learning-history?student_id=${encodeURIComponent(studentId)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        if (active) setDays(Array.isArray(data.days) ? data.days : []);
      } catch {
        if (active) setError('授業の記録を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user, studentId, reload]);

  const monthDays = useMemo(() => days.filter(day => monthKeyOf(day.date) === month), [days, month]);
  const summary = useMemo(() => summarizeLessonDays(monthDays), [monthDays]);
  const oldestMonth = days.length ? monthKeyOf(days[days.length - 1].date) : month;
  const thisMonth = currentMonthKey();
  const studentName = students.find(student => student.id === studentId)?.student_name || 'お子さま';

  const stats = [
    { label: 'Zoomで参加', value: summary.liveDays, unit: '日', icon: Video, tone: 'bg-success-soft text-success' },
    { label: '録画で視聴', value: summary.recordingCount, unit: '本', sub: summary.recordingMinutes ? `合計 ${summary.recordingMinutes}分` : '', icon: MonitorPlay, tone: 'bg-info-soft text-info' },
    { label: '欠席', value: summary.absentDays, unit: '日', sub: summary.absentDays ? `うち録画で受講 ${summary.coveredAbsences}日` : '', icon: CalendarX2, tone: 'bg-warning-soft text-warning' },
  ];

  const header = (
    <ParentPageHeader
      eyebrow="学習のようす"
      title="学習状況"
      description="いつ・どの教科の授業を受けたかを、授業日ごとに表示します。Zoomで参加できなかった日も、録画で見ていればわかります。"
      icon={BarChart3}
    />
  );

  if (studentsError) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState message={studentsError} onRetry={() => { setLoading(true); setStudentsReload(value => value + 1); }} />
      </div>
    );
  }

  if (!loading && students.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <ParentCard><ParentEmpty icon={Users} title="紐づくお子さまがまだ登録されていません" description="お手数ですが、通塾中の校舎へ保護者アカウントの紐づけをご依頼ください。" /></ParentCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      <ChildSwitcher options={students.map(student => ({ id: student.id, name: student.student_name }))} value={studentId} onChange={setStudentId} />

      <ParentCard>
        <div className="mb-4 flex items-center justify-between gap-3">
          <IconButton label="前の月" variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= oldestMonth}><ChevronLeft size={18} aria-hidden /></IconButton>
          <div className="text-center">
            <p className="text-xs text-fg-muted">{studentName}さん</p>
            <p className="text-lg font-bold text-fg">{monthLabel(month)}</p>
          </div>
          <IconButton label="次の月" variant="secondary" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}><ChevronRight size={18} aria-hidden /></IconButton>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-btn bg-canvas p-3">
                <span className={`inline-flex rounded-input p-1.5 ${stat.tone}`}><Icon size={14} aria-hidden /></span>
                <p className="mt-1.5 text-xs font-bold text-fg-muted">{stat.label}</p>
                <p className="text-2xl font-black tabular-nums text-fg">{stat.value}<span className="ml-0.5 text-xs font-bold text-fg-muted">{stat.unit}</span></p>
                {stat.sub && <p className="text-xs text-fg-muted">{stat.sub}</p>}
              </div>
            );
          })}
        </div>

        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 rounded-btn bg-canvas px-4 py-3 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><Video size={13} className="text-success" aria-hidden />Zoomで参加：授業の時間に参加ボタンから入った記録</span>
          <span className="flex items-center gap-1"><MonitorPlay size={13} className="text-info" aria-hidden />録画で視聴：あとから授業の録画を見た日時と時間</span>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={() => setReload(value => value + 1)} />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <LessonDayList days={monthDays} emptyText={`${monthLabel(month)}の授業の記録はまだありません。`} />
        )}
      </ParentCard>

      <Link href="/parent/pf/homework" className="cb-card flex min-h-16 items-center gap-4 p-card transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-success-soft text-success"><ClipboardCheck size={22} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-fg">宿題・小テストの状況</span>
          <span className="block text-xs text-fg-muted">宿題の提出や小テストの結果を確認できます</span>
        </span>
        <ChevronRight size={18} className="text-fg-muted" aria-hidden />
      </Link>

      <Link href="/parent/report" className="cb-card flex min-h-16 items-center gap-4 p-card transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent"><FileText size={22} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-fg">月のレポート</span>
          <span className="block text-xs text-fg-muted">1か月の学習をまとめて確認・印刷できます</span>
        </span>
        <ChevronRight size={18} className="text-fg-muted" aria-hidden />
      </Link>
    </div>
  );
}
