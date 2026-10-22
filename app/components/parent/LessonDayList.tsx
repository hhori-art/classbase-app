'use client';

import { CalendarX2, CheckCircle2, Clock, MonitorPlay, Repeat, Video } from 'lucide-react';
import { EmptyState, StatusPill } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';

/** /api/parent/learning-history・/api/parent/dashboard が返す授業日ごとの記録 */
export type LessonRecordingWatch = {
  recording_id: string;
  first_watched_at_ms: number;
  last_watched_at_ms: number;
  watched_seconds: number;
  duration_seconds: number;
  completed: boolean;
};
export type LessonEntry = {
  key: string;
  subject: string;
  detail_subject: string;
  course_name: string;
  unit: string;
  title: string;
  period: number;
  live: boolean;
  recording: LessonRecordingWatch | null;
};
export type LessonDay = {
  date: string;
  classes: LessonEntry[];
  absence: { kind: 'absent' | 'late'; reason: string; status: string; by: string } | null;
  transfer: { title: string; status: string } | null;
};

export const lessonDateLabel = (date: string) => formatDate(date);

export const jstDateTimeLabel = (ms: number) => (ms ? formatDateTime(ms) : '');

const minutesLabel = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))}分`;

const SENDER_LABEL: Record<string, string> = { parent: '保護者から', student: 'お子さまから', school: '教室で記録' };

/** 1日の授業の受け方をまとめた集計（画面上部の数字に使う） */
export function summarizeLessonDays(days: LessonDay[]) {
  const liveDays = days.filter(day => day.classes.some(entry => entry.live)).length;
  const recordings = days.flatMap(day => day.classes.filter(entry => entry.recording));
  const absentDays = days.filter(day => day.absence?.kind === 'absent');
  const coveredAbsences = absentDays.filter(day => day.classes.some(entry => entry.recording)).length;
  return {
    liveDays,
    liveClasses: days.reduce((sum, day) => sum + day.classes.filter(entry => entry.live).length, 0),
    recordingCount: recordings.length,
    recordingMinutes: Math.round(recordings.reduce((sum, entry) => sum + (entry.recording?.watched_seconds || 0), 0) / 60),
    absentDays: absentDays.length,
    coveredAbsences,
  };
}

export default function LessonDayList({ days, emptyText = 'この期間の授業の記録はありません。' }: { days: LessonDay[]; emptyText?: string }) {
  if (days.length === 0) {
    return <EmptyState icon={Video} title={emptyText} />;
  }
  return (
    <ol className="space-y-3">
      {days.map(day => {
        const absent = day.absence?.kind === 'absent';
        const watchedAfterAbsence = absent && day.classes.some(entry => entry.recording);
        return (
          <li key={day.date} className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-bold text-fg">{lessonDateLabel(day.date)}</p>
              {absent && (
                <StatusPill tone={watchedAfterAbsence ? 'info' : 'warning'}>
                  {watchedAfterAbsence ? '欠席 → 録画で受講済み' : '欠席（録画はまだ見ていません）'}
                </StatusPill>
              )}
            </div>

            {day.absence && (
              <div className="mt-2 flex items-start gap-2 rounded-btn bg-canvas px-3 py-2 text-sm text-fg">
                {day.absence.kind === 'late' ? <Clock size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden /> : <CalendarX2 size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
                <span>
                  {day.absence.kind === 'late' ? '遅刻' : '欠席'}の連絡（{SENDER_LABEL[day.absence.by] || '連絡あり'}）
                  {day.absence.reason && <span className="block text-fg-muted">理由：{day.absence.reason}</span>}
                </span>
              </div>
            )}
            {day.transfer && (
              <p className="mt-2 flex items-center gap-2 rounded-btn bg-info-soft px-3 py-2 text-sm text-info"><Repeat size={15} aria-hidden />振替：{day.transfer.title}</p>
            )}

            {day.classes.length > 0 && (
              <ul className="mt-3 divide-y divide-line">
                {day.classes.map(entry => {
                  const name = [entry.detail_subject && entry.detail_subject !== entry.subject ? `${entry.subject}（${entry.detail_subject}）` : entry.subject, entry.period ? `${entry.period}時間目` : ''].filter(Boolean).join(' ・ ');
                  const topic = entry.unit || (entry.title && entry.title !== entry.subject ? entry.title : '') || entry.course_name;
                  return (
                    <li key={entry.key} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-fg">{name}</p>
                        {topic && <p className="truncate text-xs text-fg-muted">{topic}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 sm:justify-end">
                        {entry.live && <StatusPill tone="success" icon={<Video size={12} aria-hidden />}>Zoomで参加</StatusPill>}
                        {entry.recording && (
                          <span className="inline-flex flex-wrap items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-bold text-info">
                            <MonitorPlay size={12} aria-hidden />
                            録画で視聴 {jstDateTimeLabel(entry.recording.first_watched_at_ms)}
                            {entry.recording.watched_seconds > 0 && ` ・ ${minutesLabel(entry.recording.watched_seconds)}`}
                            {entry.recording.completed ? <CheckCircle2 size={12} className="ml-0.5" aria-label="最後まで視聴" /> : <span className="ml-0.5 font-medium">（途中まで）</span>}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
