'use client';

import Link from 'next/link';
import { BellRing, CalendarClock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { lessonCountdownLabel, shortDateWithWeekday, type TimetableLesson } from '@/lib/timetable';

/**
 * 生徒ホームの「次の授業」。参加はこれまでどおり授業ボタン（SmartClassButton）から行い、
 * このカードは時間割へのリンクだけを持つ。prominent は開始10分前から目立たせる表示。
 */
export default function NextLessonCard({ lesson, now, prominent = false, className }: {
  lesson: TimetableLesson;
  now: Date;
  prominent?: boolean;
  className?: string;
}) {
  const countdown = lessonCountdownLabel(lesson, now);
  const when = `${shortDateWithWeekday(lesson.date, lesson.weekday)} ${lesson.start}`;
  const label = lesson.label || '授業';
  return (
    <Link
      href="/student/timetable"
      aria-label={`次の授業 ${when} ${label} ${countdown}。時間割を見る`}
      className={cn(
        'group flex items-center justify-between gap-3 rounded-card p-4 no-underline shadow-card transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        prominent ? 'bg-accent text-accent-ink' : 'cb-card',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-btn', prominent ? 'bg-white/20' : 'bg-accent-soft text-accent')}>
          {prominent ? <BellRing size={22} aria-hidden className="motion-safe:animate-pulse" /> : <CalendarClock size={22} aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className={cn('text-xs font-bold', prominent ? 'text-accent-ink/85' : 'text-accent')}>
            {prominent ? 'もうすぐ授業が始まります' : '次の授業'}
          </p>
          <p className={cn('truncate text-base font-bold', prominent ? 'text-accent-ink' : 'text-fg')}>
            {when} {label}
          </p>
          {prominent && <p className="mt-0.5 text-xs font-medium text-accent-ink/85">授業ボタンから参加してね</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={cn('whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold', prominent ? 'bg-white/20 text-accent-ink' : 'bg-accent-soft text-accent')}>
          {countdown}
        </span>
        <ChevronRight size={18} aria-hidden className={cn('transition-transform group-hover:translate-x-0.5', prominent ? 'text-accent-ink/70' : 'text-fg-muted')} />
      </div>
    </Link>
  );
}
