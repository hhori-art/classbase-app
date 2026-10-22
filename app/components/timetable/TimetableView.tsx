'use client';

import { CalendarClock, CalendarDays, CalendarX2, ChevronRight, Clock, Repeat } from 'lucide-react';
import { ButtonLink, Card, EmptyState, SectionTitle, StatusPill } from '@/app/components/ui';
import { cn } from '@/lib/cn';
import {
  TIMETABLE_WEEKDAYS,
  lessonTimeMs,
  shortDateWithWeekday,
  type StudentTimetable,
  type TimetableLesson,
  type TimetablePeriod,
} from '@/lib/timetable';

type Audience = 'student' | 'parent';

const PERIODS: TimetablePeriod[] = [1, 2];

const WORDS = {
  student: {
    weeklyTitle: '毎週の時間割',
    weeklyDescription: '登録している講座です。曜日と時間を確認しよう',
    upcomingTitle: 'これから2週間の授業',
    upcomingDescription: '休講の日は赤で出ます',
    emptyTitle: '受講講座がまだ登録されていません',
    emptyDescription: '受講講座を登録すると、ここに時間割が出ます。',
    changeLabel: '受講講座の変更',
    noLessons: 'この2週間に予定されている授業はありません',
  },
  parent: {
    weeklyTitle: '毎週の時間割',
    weeklyDescription: '登録している講座の曜日と時間です',
    upcomingTitle: '今後2週間の授業予定',
    upcomingDescription: '休講日は赤で表示します',
    emptyTitle: '受講講座が登録されていません',
    emptyDescription: '受講講座を登録すると、時間割が表示されます。',
    changeLabel: '受講講座の登録・変更',
    noLessons: 'この2週間に予定されている授業はありません',
  },
} as const;

function LessonStatus({ lesson, now }: { lesson: TimetableLesson; now: Date }) {
  if (lesson.status === 'cancelled') return <StatusPill tone="danger" icon={<CalendarX2 size={12} aria-hidden />}>休講</StatusPill>;
  if (lesson.status === 'tentative') return <StatusPill tone="neutral">予定を準備中</StatusPill>;
  if (lesson.status === 'absent') return <StatusPill tone="warning">欠席（振替あり）</StatusPill>;
  const endMs = lessonTimeMs(lesson.date, lesson.end);
  const startMs = lessonTimeMs(lesson.date, lesson.start);
  if (Number.isFinite(endMs) && endMs <= now.getTime()) return <StatusPill tone="neutral">終了</StatusPill>;
  if (Number.isFinite(startMs) && startMs <= now.getTime()) return <StatusPill tone="success">授業中</StatusPill>;
  if (lesson.kind === 'transfer') return <StatusPill tone="info" icon={<Repeat size={12} aria-hidden />}>振替</StatusPill>;
  return lesson.kind === 'test_prep'
    ? <StatusPill tone="warning">テスト対策</StatusPill>
    : <StatusPill tone="accent">授業あり</StatusPill>;
}

/** 生徒・保護者共通の時間割。差し色は各レイアウトの data-portal に従う。 */
export default function TimetableView({ data, audience, changeHref, now = new Date() }: {
  data: StudentTimetable;
  audience: Audience;
  /** 受講講座の変更画面。無ければリンクを出さない。 */
  changeHref?: string;
  now?: Date;
}) {
  const words = WORDS[audience];
  const days = TIMETABLE_WEEKDAYS.filter(day => data.weekly.some(slot => slot.day === day));
  const slotOf = (day: string, period: TimetablePeriod) => data.weekly.find(slot => slot.day === day && slot.period === period);
  const lessonsByDate = data.lessons.reduce((map, lesson) => {
    if (!map.has(lesson.date)) map.set(lesson.date, []);
    map.get(lesson.date)!.push(lesson);
    return map;
  }, new Map<string, TimetableLesson[]>());

  const changeLink = changeHref ? (
    <ButtonLink href={changeHref} variant="secondary" size="sm" className="no-underline" icon={<ChevronRight size={14} aria-hidden />}>
      {words.changeLabel}
    </ButtonLink>
  ) : null;

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={CalendarDays} title={words.weeklyTitle} description={words.weeklyDescription} trailing={days.length > 0 ? changeLink : undefined} />
        {days.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={words.emptyTitle}
            description={words.emptyDescription}
            action={changeHref ? <ButtonLink href={changeHref} className="no-underline">{words.changeLabel}</ButtonLink> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px] border-separate border-spacing-1.5 text-sm">
              <caption className="sr-only">{words.weeklyTitle}（曜日と時限）</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-20 text-left text-xs font-bold text-fg-muted"><span className="sr-only">時限</span></th>
                  {days.map(day => (
                    <th key={day} scope="col" className="rounded-input bg-accent-soft px-2 py-2 text-center text-sm font-bold text-accent">{day}曜日</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map(period => (
                  <tr key={period}>
                    <th scope="row" className="align-top text-left">
                      <span className="block text-sm font-bold text-fg">{period}限</span>
                      <span className="block text-xs font-medium text-fg-muted">{data.periods[period].start}〜{data.periods[period].end}</span>
                    </th>
                    {days.map(day => {
                      const slot = slotOf(day, period);
                      return (
                        <td key={day} className={cn('rounded-input border px-2 py-2 align-top', slot ? 'border-accent/30 bg-surface' : 'border-dashed border-line bg-canvas')}>
                          {slot ? (
                            <ul className="space-y-1">
                              {slot.courses.map(course => <li key={course.key} className="font-bold leading-snug text-fg">{course.label}</li>)}
                            </ul>
                          ) : (
                            <span className="text-xs text-fg-muted">なし</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle icon={CalendarClock} title={words.upcomingTitle} description={`${shortDateWithWeekday(data.range.start, '')}〜${shortDateWithWeekday(data.range.end, '')}・${words.upcomingDescription}`} />
        {data.lessons.length === 0 ? (
          <EmptyState icon={CalendarClock} title={words.noLessons} />
        ) : (
          <ol className="space-y-3">
            {Array.from(lessonsByDate.entries()).map(([date, lessons]) => (
              <li key={date} className="rounded-card border border-line bg-surface p-3">
                <p className={cn('mb-2 text-sm font-bold', date === data.today ? 'text-accent' : 'text-fg')}>
                  {shortDateWithWeekday(date, lessons[0]?.weekday || '')}{date === data.today ? '（今日）' : ''}
                </p>
                <ul className="space-y-2">
                  {lessons.map(lesson => (
                    <li
                      key={lesson.id}
                      className={cn(
                        'flex items-start justify-between gap-3 rounded-btn px-3 py-2',
                        lesson.status === 'cancelled' ? 'bg-danger-soft'
                          : lesson.status === 'absent' ? 'bg-warning-soft'
                          : lesson.kind === 'transfer' ? 'bg-info-soft'
                          : 'bg-canvas',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 text-xs font-bold text-fg-muted">
                          <Clock size={12} aria-hidden /> {lesson.period}限 {lesson.start}〜{lesson.end}
                        </p>
                        <p className={cn('mt-0.5 font-bold leading-snug', lesson.status === 'cancelled' ? 'text-danger line-through decoration-1' : lesson.status === 'absent' ? 'text-fg-muted line-through decoration-1' : 'text-fg')}>
                          {lesson.label || '授業'}
                        </p>
                        {lesson.unit && <p className="mt-0.5 text-xs text-fg-muted">{lesson.unit}</p>}
                        {lesson.status === 'cancelled' && lesson.note && <p className="mt-0.5 text-xs font-bold text-danger">{lesson.note}</p>}
                        {lesson.kind === 'transfer' && lesson.note && <p className="mt-0.5 text-xs font-bold text-info">{lesson.note}</p>}
                      </div>
                      <div className="shrink-0 pt-0.5"><LessonStatus lesson={lesson} now={now} /></div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
