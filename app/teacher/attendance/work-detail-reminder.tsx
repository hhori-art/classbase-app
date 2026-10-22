'use client';

// 直近14日で「勤務の詳細」が未入力の勤務記録を知らせるカード（勤怠打刻ページと講師ホームで使う）。

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { ChevronRight, LayoutTemplate } from 'lucide-react';
import { db } from '@/lib/firebase';
import { ErrorState } from '@/app/components/ui';
import { formatDate, formatTime, jstDateKey } from '@/lib/format';
import { recordsMissingWorkDetails, workDetailReminderRange, WORK_DETAIL_REMINDER_DAYS } from '@/lib/attendance-work-draft';

export type ReminderWorkRecord = {
  id: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  status?: string;
  work_segments?: unknown[];
  [key: string]: unknown;
};

export function useWorkDetailReminders(uid: string | null | undefined, enabled = true) {
  const [records, setRecords] = useState<ReminderWorkRecord[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!uid || !enabled) return;
    setError(false);
    const today = jstDateKey();
    const { start, end } = workDetailReminderRange(today);
    try {
      let docs: ReminderWorkRecord[];
      try {
        // 勤務履歴と同じ形のクエリ（teacher_id, date, created_at の複合インデックスを使う）。
        const snap = await getDocs(query(
          collection(db, 'work_records'),
          where('teacher_id', '==', uid),
          where('date', '>=', start),
          where('date', '<=', end),
          orderBy('date', 'desc'),
          orderBy('created_at', 'desc'),
        ));
        docs = snap.docs.map(item => ({ id: item.id, ...item.data() } as ReminderWorkRecord));
      } catch (queryError: unknown) {
        if (String((queryError as { code?: string })?.code || '') !== 'failed-precondition') throw queryError;
        const snap = await getDocs(query(collection(db, 'work_records'), where('teacher_id', '==', uid)));
        docs = snap.docs.map(item => ({ id: item.id, ...item.data() } as ReminderWorkRecord));
      }
      setRecords(recordsMissingWorkDetails(docs, today));
    } catch (loadError) {
      console.warn('勤務詳細リマインド取得エラー:', loadError);
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [enabled, uid]);

  useEffect(() => { reload(); }, [reload]);
  return { records, error, loaded, reload };
}

export function WorkDetailReminderCard({ records, error, onRetry, onSelect, className = '' }: {
  records: ReminderWorkRecord[];
  error: boolean;
  onRetry: () => void;
  /** 指定するとその場で入力画面を開く。省略時は勤怠打刻ページへのリンクになる。 */
  onSelect?: (record: ReminderWorkRecord) => void;
  className?: string;
}) {
  if (error) return <ErrorState className={className} title="勤務詳細の入力状況を確認できませんでした" onRetry={onRetry} />;
  if (records.length === 0) return null;
  const rowClass = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-input bg-surface px-3 py-2 text-left text-sm font-bold text-fg shadow-sm ring-1 ring-amber-100 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <section className={`rounded-card border border-amber-200 bg-warning-soft p-4 shadow-card ${className}`} aria-labelledby="work-detail-reminder-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="work-detail-reminder-title" className="flex items-center gap-2 text-base font-bold text-amber-900">
            <LayoutTemplate size={18} aria-hidden /> 勤務の詳細が未入力の日があります
          </h2>
          <p className="mt-1 text-xs font-medium text-amber-700">直近{WORK_DETAIL_REMINDER_DAYS}日の勤務です。日付を押すと入力画面が開きます。</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">{records.length}件</span>
      </div>
      <ul className="space-y-2">
        {records.slice(0, 5).map(record => {
          const label = (
            <>
              <span>{formatDate(record.date, { withWeekday: true })}</span>
              <span className="flex items-center gap-1 font-mono text-xs text-fg-muted">
                {formatTime(record.start_time) || '-'}〜{formatTime(record.end_time) || '-'}
                <ChevronRight size={14} aria-hidden />
              </span>
            </>
          );
          return (
            <li key={record.id}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(record)} className={rowClass}>{label}</button>
              ) : (
                <Link href={`/teacher/attendance?detail=${encodeURIComponent(record.date)}`} className={rowClass}>{label}</Link>
              )}
            </li>
          );
        })}
      </ul>
      {records.length > 5 && <p className="mt-2 text-xs font-bold text-amber-700">ほか{records.length - 5}件あります。</p>}
    </section>
  );
}
