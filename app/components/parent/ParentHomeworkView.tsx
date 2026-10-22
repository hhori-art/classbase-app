'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarCheck, ChevronLeft, ChevronRight, ClipboardCheck, PencilLine, Users } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { jstTodayKey } from '@/lib/lesson-deadline';
import { formatDate, formatShortDate } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';
import { ErrorState, IconButton, ListSkeleton } from '@/app/components/ui';
import { ParentCard, ParentEmpty, ParentPageHeader, ParentSectionTitle } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';

// 保護者向けの「宿題・小テストの状況」。管理画面の表（PfProgressDashboard）とは分けて、
// お子さまごとのカードで、出席・宿題（Monoxer の学習回数）・小テストをやさしい言葉で表示する。
// データは /api/pf/dashboard（保護者は紐づくお子さまだけが返る）をそのまま使う。

type Period = 'week' | 'month';

type ChildMetric = {
  id: string;
  student_name: string;
  grade: string;
  attendance_present: number;
  attendance_absent: number;
  attendance_late: number;
  attendance_total: number;
  attendance_rate: number | null;
  homework_completed: number;
  homework_total: number;
  homework_rate: number | null;
  quiz_completed: number;
  quiz_total: number;
  quiz_rate: number | null;
  quiz_average_score: number | null;
  study?: {
    measured: boolean;
    period_count: number | null;
    total_count: number | null;
    last_snapshot_date: string | null;
    previous_snapshot_date: string | null;
    books?: Array<{ book_id: string; name: string; count: number; gained: number | null }>;
  };
};

type ApiData = { range: { start: string; end: string; label: string }; students: ChildMetric[] };

const parseKey = (key: string) => new Date(`${key}T12:00:00`);
const toKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shortDate = (key: string | null | undefined) => key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? formatShortDate(key) : '';
const dayLabel = (key: string) => formatDate(key);

/** 週・月の表示名（例：10月13日（月）〜10月19日（日）／2026年10月） */
const rangeLabel = (period: Period, range: ApiData['range'] | undefined) => {
  if (!range) return '';
  if (period === 'month') return range.label;
  return `${dayLabel(range.start)} 〜 ${dayLabel(range.end)}`;
};

const shiftAnchor = (anchor: string, period: Period, diff: number) => {
  const date = parseKey(anchor);
  if (period === 'month') return toKey(new Date(date.getFullYear(), date.getMonth() + diff, 1));
  date.setDate(date.getDate() + diff * 7);
  return toKey(date);
};

export default function ParentHomeworkView() {
  const { user, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(() => jstTodayKey());
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [childId, setChildId] = useState('');

  const load = useCallback(async () => {
    if (!user) {
      if (!authLoading) { setError('ログイン情報を確認できませんでした。もう一度ログインしてください。'); setLoading(false); }
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period, anchor });
      const response = await fetch(`/api/pf/dashboard?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error('failed');
      setData({ range: payload.range, students: Array.isArray(payload.students) ? payload.students : [] });
    } catch {
      setData(null);
      setError('宿題・小テストの状況を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
    // reload は「もう一度読み込む」ボタン用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, period, anchor, reload]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (data?.students.length) setChildId(current => pickChildId(user?.uid, data.students.map(child => child.id), current));
  }, [data, user?.uid]);

  const today = jstTodayKey();
  const visibleChildren = data ? (data.students.length > 1 ? data.students.filter(child => child.id === childId) : data.students) : [];
  const isLatest = Boolean(data?.range) && data!.range.end >= today;

  return (
    <div className="space-y-5">
      <ParentPageHeader
        eyebrow="学習状況"
        title="宿題・小テストの状況"
        description="お子さまごとに、授業への出席・宿題（Monoxer）の取り組み・小テストの結果をまとめています。"
        icon={ClipboardCheck}
        backHref="/parent/pf"
      />

      {data && (
        <ChildSwitcher options={data.students.map(child => ({ id: child.id, name: child.student_name, grade: child.grade }))} value={childId} onChange={setChildId} />
      )}

      <ParentCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex rounded-btn bg-canvas p-1" role="tablist" aria-label="集計の単位">
            {(['week', 'month'] as const).map(value => (
              <button key={value} type="button" role="tab" aria-selected={period === value} onClick={() => { setPeriod(value); setAnchor(today); }}
                className={cn('min-h-10 flex-1 rounded-btn px-5 text-sm font-bold transition-colors sm:flex-none', period === value ? 'bg-accent text-accent-ink shadow-sm' : 'text-fg-muted hover:text-fg')}>
                {value === 'week' ? '週ごと' : '月ごと'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <IconButton label={period === 'week' ? '前の週' : '前の月'} variant="secondary" onClick={() => setAnchor(shiftAnchor(anchor, period, -1))}><ChevronLeft size={18} aria-hidden /></IconButton>
            <p className="min-w-[11rem] text-center text-sm font-bold text-fg">{data?.range ? rangeLabel(period, data.range) : '…'}</p>
            <IconButton label={period === 'week' ? '次の週' : '次の月'} variant="secondary" onClick={() => setAnchor(shiftAnchor(anchor, period, 1))} disabled={isLatest}><ChevronRight size={18} aria-hidden /></IconButton>
          </div>
        </div>
      </ParentCard>

      {error ? (
        <ErrorState message={error} onRetry={() => setReload(value => value + 1)} />
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.students.length === 0 ? (
        <ParentCard><ParentEmpty icon={Users} title="表示できるお子さまがいません" description="お子さまのアカウントとの紐づけが済むと、ここに表示されます。" /></ParentCard>
      ) : (
        visibleChildren.map(child => <ChildCard key={child.id} child={child} period={period} />)
      )}

      <p className="px-2 text-center text-xs leading-relaxed text-fg-muted">
        宿題の学習回数は、教室が Monoxer の記録を更新したときに反映されます。気になる点は<Link href="/parent/contact" className="mx-0.5 font-bold text-accent underline">{TERMS.parentContact}</Link>からお問い合わせください。
      </p>
    </div>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: number | string; unit?: string; tone: string }) {
  return (
    <div className="rounded-btn bg-canvas p-3 text-center">
      <p className="text-xs font-bold text-fg-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-black tabular-nums ${tone}`}>{value}{unit && <span className="ml-0.5 text-xs font-bold text-fg-muted">{unit}</span>}</p>
    </div>
  );
}

function ChildCard({ child, period }: { child: ChildMetric; period: Period }) {
  const periodWord = period === 'week' ? 'この週' : 'この月';
  const study = child.study;
  const hasStudy = Boolean(study && study.total_count !== null);
  const books = study?.books || [];
  const since = shortDate(study?.previous_snapshot_date);
  const asOf = shortDate(study?.last_snapshot_date);

  return (
    <ParentCard>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-lg font-bold text-accent" aria-hidden>{(child.student_name || '生').slice(0, 1)}</div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-fg">{child.student_name}<span className="ml-1 text-sm font-medium text-fg-muted">さん</span></p>
          {child.grade && <p className="text-xs text-fg-muted">{child.grade}</p>}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <ParentSectionTitle icon={CalendarCheck} tone="sky" title="授業への出席" description="遅刻も「参加」として数えています。" />
          {child.attendance_total > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="参加" value={child.attendance_present} unit="回" tone="text-success" />
                <Stat label="遅刻" value={child.attendance_late} unit="回" tone="text-warning" />
                <Stat label="欠席" value={child.attendance_absent} unit="回" tone="text-danger" />
              </div>
              {child.attendance_rate !== null && <p className="mt-2 text-sm text-fg-muted">{periodWord}の出席率 <span className="font-bold text-fg">{child.attendance_rate}%</span>（{child.attendance_present + child.attendance_late}/{child.attendance_total}回）</p>}
            </>
          ) : (
            <p className="rounded-btn bg-canvas px-4 py-4 text-center text-sm text-fg-muted">{periodWord}の授業の記録はありません。</p>
          )}
        </div>

        <div>
          <ParentSectionTitle icon={BookOpen} tone="emerald" title="宿題（Monoxer）" description="Monoxer で宿題に取り組んだ回数です。" />
          {hasStudy && study ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-btn bg-success-soft p-3 text-center">
                  <p className="text-xs font-bold text-success">{periodWord}に増えた回数</p>
                  {study.measured
                    ? <p className={`mt-0.5 text-xl font-black tabular-nums ${study.period_count ? 'text-success' : 'text-fg-muted'}`}>+{study.period_count ?? 0}<span className="ml-0.5 text-xs font-bold text-fg-muted">回</span></p>
                    : <p className="mt-1.5 text-sm font-bold text-fg-muted">集計準備中です</p>}
                </div>
                <Stat label={asOf ? `これまでの合計（${asOf}時点）` : 'これまでの合計'} value={study.total_count ?? 0} unit="回" tone="text-fg" />
              </div>
              {!study.measured && <p className="mt-2 text-xs leading-relaxed text-fg-muted">{periodWord}の増えた回数は、教室で記録が更新されると表示されます。</p>}
              {study.measured && study.period_count === 0 && <p className="mt-2 text-xs font-medium leading-relaxed text-warning">{periodWord}は宿題の取り組みが記録されていません。ご家庭でも声をかけてみてください。</p>}
              {books.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-bold text-fg">教材（Book）ごとの回数</p>
                  {since && <p className="mt-0.5 text-xs text-fg-muted">「＋」は{since}からの増えた回数です。</p>}
                  <ul className="mt-2 divide-y divide-line rounded-btn border border-line">
                    {books.map(book => (
                      <li key={book.book_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className="min-w-0 break-words text-sm text-fg">{book.name}</span>
                        <span className="shrink-0 text-right text-xs font-bold">
                          {book.gained !== null && <span className={book.gained > 0 ? 'mr-2 text-success' : 'mr-2 text-fg-muted/60'}>+{book.gained}回</span>}
                          <span className="text-fg-muted">合計 {book.count}回</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : child.homework_total > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="提出した宿題" value={`${child.homework_completed}/${child.homework_total}`} unit="件" tone="text-success" />
              <Stat label="提出率" value={child.homework_rate ?? '―'} unit={child.homework_rate === null ? '' : '%'} tone="text-fg" />
            </div>
          ) : (
            <p className="rounded-btn bg-canvas px-4 py-4 text-center text-sm text-fg-muted">宿題の記録はまだありません。集計準備中です。</p>
          )}
        </div>

        {child.quiz_total > 0 && (
          <div>
            <ParentSectionTitle icon={PencilLine} tone="violet" title="小テスト" />
            <div className="grid grid-cols-3 gap-2">
              <Stat label="受けた回数" value={`${child.quiz_completed}/${child.quiz_total}`} unit="回" tone="text-accent" />
              <Stat label="実施率" value={child.quiz_rate ?? '―'} unit={child.quiz_rate === null ? '' : '%'} tone="text-fg" />
              <Stat label="平均点" value={child.quiz_average_score ?? '―'} unit={child.quiz_average_score === null ? '' : '点'} tone="text-fg" />
            </div>
          </div>
        )}
      </div>
    </ParentCard>
  );
}
