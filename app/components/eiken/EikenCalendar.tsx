'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type CalendarEvent = {
  id: string;
  type: string;
  title: string;
  start_at: string;
  end_at?: string | null;
};

const dateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

export default function EikenCalendar({ events = [] }: { events?: CalendarEvent[] }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const cells = Array.from({ length: firstDay + days }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1
  );
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(event => {
      const key = dateKey(event.start_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    });
    return map;
  }, [events]);

  return (
    <section className="w-full min-w-0 overflow-hidden border-y border-slate-200 bg-white py-5" aria-labelledby="eiken-calendar-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="eiken-calendar-heading" className="font-black text-slate-900">Boosterカレンダー</h2>
          <p className="mt-1 text-xs text-slate-500">LIVE授業と課題締切だけを表示します。</p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-1 sm:justify-start">
          <button
            type="button"
            onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
            aria-label="前の月"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-24 text-center text-sm font-black">{year}年{monthIndex + 1}月</span>
          <button
            type="button"
            onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
            aria-label="次の月"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] border-l border-t border-slate-200 text-center text-[11px] font-bold text-slate-500">
        {['日', '月', '火', '水', '木', '金', '土'].map(day => (
          <div key={day} className="min-w-0 border-b border-r border-slate-200 py-2">{day}</div>
        ))}
        {cells.map((day, index) => {
          const key = day ? `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
          const dayEvents = day ? eventsByDate.get(key) || [] : [];
          return (
            <div key={`${day}-${index}`} className="min-h-16 min-w-0 overflow-hidden border-b border-r border-slate-200 p-0.5 text-left sm:min-h-24 sm:p-1.5">
              {day && <span className="text-xs font-bold text-slate-600">{day}</span>}
              <div className="mt-1 min-w-0 space-y-1">
                {dayEvents.slice(0, 2).map(event => (
                  <div
                    key={`${event.type}-${event.id}`}
                    className={`min-w-0 truncate rounded px-1 py-1 text-[9px] font-bold sm:px-1.5 sm:text-[10px] ${
                      event.type === 'live_lesson'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                    title={event.title}
                  >
                    {event.title}
                  </div>
                ))}
                {dayEvents.length > 2 && <p className="text-[10px] font-bold text-slate-400">ほか{dayEvents.length - 2}件</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
