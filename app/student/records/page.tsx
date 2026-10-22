'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Award, BarChart3, BookOpen, CalendarDays, Coins, Flame, Swords, Trophy, Video, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Skeleton } from '@/app/components/ui';
import { formatDate, formatShortDate } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { BADGE_RARITY_LABELS, type BadgeRarity } from '@/lib/gamification';
import type { NextBadgeTarget } from '@/lib/student-records';
import WeeklyBars, { type WeeklyBarPoint } from './WeeklyBars';

type RecordsResponse = {
  ok: true;
  today: string;
  month_start: string;
  zoom: { month_days: number | null; total_days: number | null };
  recordings: { month_completed: number | null; total_completed: number };
  homework: { measured: boolean; month_count: number | null; total_count: number | null; last_snapshot_date: string | null } | null;
  quests: { month_cleared: number | null; month_capped: boolean; total_cleared: number };
  coins: { balance: number; total_earned: number; month_earned: number | null; month_capped: boolean };
  streak: { zoom_weeks: { weeks: number; capped: boolean } | null; login_days: number };
  weekly: { key: string; start_date: string; end_date: string; is_current: boolean; zoom_days: number | null; homework_gained: number | null }[];
  badges: {
    earned: { id: string; name: string; icon: string; description: string; rarity: BadgeRarity }[];
    next: NextBadgeTarget[];
  };
  errors: Record<string, boolean>;
};

const LOAD_FAILED = '読み込めませんでした';

/** 生徒の「自分の記録」。今月とこれまでのがんばり・週ごとのグラフ・バッジを1画面で見られる。 */
export default function StudentRecordsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setError(false);
    (async () => {
      try {
        const res = await fetch('/api/student/records', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'records-failed');
        if (active) setData(body as RecordsResponse);
      } catch (loadError) {
        console.warn('records load failed:', loadError);
        if (active) setError(true);
      }
    })();
    return () => { active = false; };
  }, [user, reload]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        tone="hero"
        title="自分の記録"
        description="これまでのがんばりが、ひと目でわかるよ。"
        icon={BarChart3}
        backHref="/student"
      />
      {error ? (
        <ErrorState title="記録を読み込めませんでした" onRetry={() => { setData(null); setReload(value => value + 1); }} />
      ) : !data ? (
        <RecordsSkeleton />
      ) : (
        <RecordsView data={data} />
      )}
    </div>
  );
}

function RecordsSkeleton() {
  return (
    <div role="status" aria-label="読み込み中" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

const monthLabel = (monthStart: string) => `${Number(monthStart.slice(5, 7))}月`;

function cheerMessage(data: RecordsResponse) {
  const streak = data.streak.zoom_weeks;
  if (streak && streak.weeks >= 2) return `${streak.capped ? `${streak.weeks}週以上` : `${streak.weeks}週`}つづけてZoomで参加中！この調子でいこう。`;
  if ((data.zoom.month_days || 0) > 0) return `今月はもう${data.zoom.month_days}日、Zoomで参加したよ。ナイス！`;
  if ((data.recordings.month_completed || 0) > 0) return '録画でしっかり復習できてるね。次はZoomでも会おう！';
  return '今月の記録はこれから。まずは1回、Zoomで参加してみよう！';
}

function RecordsView({ data }: { data: RecordsResponse }) {
  const month = monthLabel(data.month_start);
  const zoomStreak = data.streak.zoom_weeks;
  const weekPoints = (pick: (week: RecordsResponse['weekly'][number]) => number | null): WeeklyBarPoint[] => data.weekly.map(week => ({
    key: week.key,
    label: week.is_current ? '今週' : formatShortDate(week.start_date),
    description: week.is_current ? '今週' : `${formatDate(week.start_date, { withWeekday: false })}からの週`,
    value: pick(week),
    current: week.is_current,
  }));
  const homeworkWeeks = weekPoints(week => week.homework_gained);
  const homeworkHasData = homeworkWeeks.some(point => point.value !== null);

  return (
    <>
      <p className="rounded-card bg-accent-soft px-4 py-3 text-sm font-bold text-fg" aria-live="polite">
        <Flame size={16} className="mr-1 inline text-accent" aria-hidden />
        {cheerMessage(data)}
      </p>

      <section aria-labelledby="records-summary">
        <h2 id="records-summary" className="mb-3 text-base font-bold text-fg">{month}とこれまで</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            icon={Video}
            label="Zoomで参加"
            unit="日"
            month={data.errors.zoom ? null : data.zoom.month_days}
            total={data.errors.zoom_total ? null : data.zoom.total_days}
            monthLabel={month}
          />
          <StatTile
            icon={Video}
            label={`${TERMS.recording}を見た`}
            unit="本"
            month={data.errors.recordings ? null : data.recordings.month_completed}
            total={data.recordings.total_completed}
            monthLabel={month}
          />
          <StatTile
            icon={BookOpen}
            label={`${TERMS.homework}（Monoxer）`}
            unit="回"
            month={data.errors.homework ? null : data.homework?.month_count ?? null}
            total={data.errors.homework ? null : data.homework?.total_count ?? null}
            monthLabel={month}
            monthEmpty={!data.errors.homework && !data.homework?.measured ? 'まだ集計なし' : undefined}
            note={data.homework?.last_snapshot_date ? `${formatDate(data.homework.last_snapshot_date, { withWeekday: false })}時点` : undefined}
          />
          <StatTile
            icon={Swords}
            label="AIクエストをクリア"
            unit="回"
            month={data.errors.quests ? null : data.quests.month_cleared}
            monthSuffix={data.quests.month_capped ? '以上' : ''}
            total={data.quests.total_cleared}
            monthLabel={month}
          />
          <StatTile
            icon={Coins}
            label={`もらった${TERMS.coin}`}
            unit="枚"
            month={data.errors.coins ? null : data.coins.month_earned}
            monthSuffix={data.coins.month_capped ? '以上' : ''}
            total={data.coins.total_earned}
            monthLabel={month}
            note={`いま持っている${TERMS.coin}：${data.coins.balance.toLocaleString('ja-JP')}枚`}
          />
          <div className="cb-card p-card flex flex-col">
            <p className="flex items-center gap-1.5 text-xs font-bold text-fg-muted"><Flame size={14} className="text-accent" aria-hidden />連続記録</p>
            {zoomStreak ? (
              <p className="mt-2 text-fg">
                <span className="text-3xl font-black">{zoomStreak.weeks}</span>
                <span className="ml-1 text-sm font-bold">週{zoomStreak.capped && zoomStreak.weeks > 0 ? '以上' : ''}</span>
              </p>
            ) : (
              <p className="mt-2 text-sm font-bold text-danger">{LOAD_FAILED}</p>
            )}
            <p className="mt-1 text-xs text-fg-muted">Zoomで参加した週の連続</p>
            <p className="mt-auto pt-2 text-xs text-fg-muted">ログインは{data.streak.login_days}日連続</p>
          </div>
        </div>
      </section>

      <Card>
        <SectionTitle icon={BarChart3} title="週ごとの記録" description="この8週間の、Zoom参加と宿題の回数だよ。" />
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-bold text-fg">Zoomで参加した日</h3>
            {data.errors.zoom
              ? <p className="text-sm font-bold text-danger">{LOAD_FAILED}</p>
              : <WeeklyBars title="週ごとのZoomで参加した日数" unit="日" points={weekPoints(week => week.zoom_days)} />}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-bold text-fg">{TERMS.homework}（Monoxer）の学習回数</h3>
            {data.errors.homework ? (
              <p className="text-sm font-bold text-danger">{LOAD_FAILED}</p>
            ) : homeworkHasData ? (
              <>
                <WeeklyBars title="週ごとの宿題（Monoxer）の学習回数" unit="回" points={homeworkWeeks} />
                <p className="mt-1 text-xs text-fg-muted">「—」は、その週の集計がまだないところ。</p>
              </>
            ) : (
              <p className="rounded-btn bg-canvas px-3 py-6 text-center text-sm text-fg-muted">集計が届くと、ここにグラフが出るよ。</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Trophy} title="バッジ" description={`集めたバッジ：${data.badges.earned.length}個`} />
        {data.badges.next.length > 0 && (
          <ul className="mb-5 grid gap-3 sm:grid-cols-3">
            {data.badges.next.map(item => <NextBadge key={item.metric} item={item} />)}
          </ul>
        )}
        {data.badges.earned.length === 0 ? (
          <EmptyState icon={Award} title="まだバッジはないよ" description="ログインや録画、クエストでバッジがもらえるよ。" />
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {data.badges.earned.map(item => (
              <li key={item.id} className="flex flex-col items-center rounded-btn border border-line bg-surface p-2 text-center" title={item.description}>
                <span className="text-3xl" aria-hidden>{item.icon}</span>
                <span className="mt-1 text-xs font-bold text-fg">{item.name}</span>
                <span className="text-[11px] text-fg-muted">{BADGE_RARITY_LABELS[item.rarity]}</span>
                <span className="sr-only">{item.description}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <nav aria-label="関連するページ" className="grid gap-3 sm:grid-cols-3">
        <ButtonLink href="/student/recordings" variant="secondary" icon={<Video size={18} aria-hidden />} fullWidth>{TERMS.recording}を見る</ButtonLink>
        <ButtonLink href="/student/homework" variant="secondary" icon={<BookOpen size={18} aria-hidden />} fullWidth>{TERMS.homework}をする</ButtonLink>
        <ButtonLink href="/student/timetable" variant="secondary" icon={<CalendarDays size={18} aria-hidden />} fullWidth>時間割を見る</ButtonLink>
      </nav>
    </>
  );
}

function StatTile({ icon: Icon, label, unit, month, total, monthLabel, monthSuffix = '', monthEmpty, note }: {
  icon: LucideIcon;
  label: string;
  unit: string;
  month: number | null;
  total: number | null;
  monthLabel: string;
  monthSuffix?: string;
  monthEmpty?: string;
  note?: ReactNode;
}) {
  return (
    <div className="cb-card p-card flex flex-col">
      <p className="flex items-center gap-1.5 text-xs font-bold text-fg-muted"><Icon size={14} className="text-accent" aria-hidden />{label}</p>
      <p className="mt-2 text-fg">
        <span className="sr-only">{monthLabel}は</span>
        {monthEmpty ? (
          <span className="text-sm font-bold text-fg-muted">{monthEmpty}</span>
        ) : month === null ? (
          <span className="text-sm font-bold text-danger">{LOAD_FAILED}</span>
        ) : (
          <>
            <span className="text-3xl font-black">{month.toLocaleString('ja-JP')}</span>
            <span className="ml-1 text-sm font-bold">{unit}{monthSuffix}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-fg-muted" aria-hidden>{monthLabel}</p>
      <p className="mt-auto pt-2 text-xs text-fg-muted">
        これまで：{total === null ? LOAD_FAILED : `${total.toLocaleString('ja-JP')}${unit}`}
      </p>
      {note && <p className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function NextBadge({ item }: { item: NextBadgeTarget }) {
  const rate = Math.min(1, item.current / Math.max(1, item.target));
  return (
    <li className="rounded-btn border border-line bg-canvas p-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>{item.icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-fg">{item.label}まであと{item.remaining}{item.unit}</p>
          <p className="truncate text-xs text-fg-muted">次は「{item.name}」</p>
        </div>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-accent-soft"
        role="progressbar"
        aria-label={`${item.label}「${item.name}」まで`}
        aria-valuemin={0}
        aria-valuemax={item.target}
        aria-valuenow={item.current}
      >
        <div className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-fg-muted">{item.current} / {item.target}{item.unit}</p>
    </li>
  );
}
