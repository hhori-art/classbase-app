'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, IconButton, SectionTitle } from '@/app/components/ui';
import { formatDate, jstDateKey, toDate } from '@/lib/format';
import { cn } from '@/lib/cn';

type CalendarEvent = {
  id: string;
  type: string;
  title: string;
  start_at: string;
  end_at?: string | null;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 予定の日（日本時間の YYYY-MM-DD）。読めない値は先頭10文字をそのまま使う。 */
const eventDateKey = (value: string) => {
  const date = toDate(value);
  return date ? jstDateKey(date) : String(value || '').slice(0, 10);
};

const monthKey = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

export default function EikenCalendar({ events = [] }: { events?: CalendarEvent[] }) {
  const todayKey = jstDateKey();
  // 表示中の月（日本時間の今日の月から始める）。
  const [view, setView] = useState(() => ({ year: Number(todayKey.slice(0, 4)), monthIndex: Number(todayKey.slice(5, 7)) - 1 }));
  const { year, monthIndex } = view;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const cells: Array<number | null> = Array.from({ length: firstDay + days }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1
  );
  while (cells.length % 7 !== 0) cells.push(null);

  const moveMonth = (delta: number) => setView(current => {
    const next = new Date(Date.UTC(current.year, current.monthIndex + delta, 1));
    return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() };
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(event => {
      const key = eventDateKey(event.start_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    });
    return map;
  }, [events]);

  const currentMonthKey = monthKey(year, monthIndex);
  const monthEventCount = useMemo(
    () => events.filter(event => eventDateKey(event.start_at).startsWith(currentMonthKey)).length,
    [events, currentMonthKey],
  );

  return (
    <Card className="w-full min-w-0 overflow-hidden" as="section">
      <SectionTitle
        icon={CalendarDays}
        title="Boosterカレンダー"
        description="LIVE授業と課題の締切を表示します。"
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="前の月を見る" variant="secondary" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={18} aria-hidden />
          </IconButton>
          <p className="min-w-28 text-center text-base font-bold text-fg" aria-live="polite">{year}年{monthIndex + 1}月</p>
          <IconButton label="次の月を見る" variant="secondary" onClick={() => moveMonth(1)}>
            <ChevronRight size={18} aria-hidden />
          </IconButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-fg-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-success-soft ring-1 ring-success/40" aria-hidden />LIVE授業</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-warning-soft ring-1 ring-warning/40" aria-hidden />課題の締切</span>
        </div>
      </div>

      {monthEventCount === 0 && (
        <p className="mb-3 rounded-btn bg-canvas px-3 py-2 text-sm text-fg-muted">この月の予定はありません。</p>
      )}

      <div className="grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] overflow-hidden rounded-btn border-l border-t border-line text-center text-xs font-bold text-fg-muted">
        {WEEKDAYS.map((day, index) => (
          <div
            key={day}
            className={cn(
              'min-w-0 border-b border-r border-line bg-canvas py-2',
              index === 0 && 'text-rose-600',
              index === 6 && 'text-sky-700',
            )}
          >
            {day}
          </div>
        ))}
        {cells.map((day, index) => {
          const key = day ? `${currentMonthKey}-${String(day).padStart(2, '0')}` : '';
          const dayEvents = day ? eventsByDate.get(key) || [] : [];
          const isToday = key === todayKey;
          return (
            <div
              key={`${day}-${index}`}
              className={cn('min-h-16 min-w-0 overflow-hidden border-b border-r border-line p-0.5 text-left sm:min-h-24 sm:p-1.5', !day && 'bg-canvas/60')}
              aria-label={day ? `${formatDate(key)}${isToday ? '（今日）' : ''}${dayEvents.length ? `、予定${dayEvents.length}件：${dayEvents.map(event => event.title).join('、')}` : ''}` : undefined}
            >
              {day && (
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold',
                    isToday ? 'bg-accent text-accent-ink' : 'text-fg',
                  )}
                  aria-hidden
                >
                  {day}
                </span>
              )}
              <div className="mt-0.5 min-w-0 space-y-0.5" aria-hidden>
                {dayEvents.slice(0, 2).map(event => (
                  <div
                    key={`${event.type}-${event.id}`}
                    className={cn(
                      'min-w-0 truncate rounded-input px-1 py-0.5 text-[11px] font-bold leading-tight sm:px-1.5 sm:py-1',
                      event.type === 'live_lesson' ? 'bg-success-soft text-emerald-800' : 'bg-warning-soft text-amber-900',
                    )}
                    title={event.title}
                  >
                    {event.title}
                  </div>
                ))}
                {dayEvents.length > 2 && <p className="truncate text-[11px] font-bold text-fg-muted">ほか{dayEvents.length - 2}件</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
