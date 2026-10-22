'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight, Repeat } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { formatDate } from '@/lib/format';
import { AbsenceRequestError, isTransferOptionError } from '@/lib/absence-request-errors';
import { Button, EmptyState, ErrorState, ListSkeleton, Modal, Phrase, useToast } from '@/app/components/ui';

type Candidate = {
  id: string;
  subject: string;
  course_name: string;
  unit: string;
  period: number;
  start_time: string;
  end_time: string;
  teacher_name: string | null;
};

type OpenAbsence = { id: string; target_date: string };

type CandidateData = {
  date: string;
  candidates: Candidate[];
  absences: OpenAbsence[];
  min_date: string;
  max_date: string;
};

const OTHER_DAY = 'other';

const authedFetch = async (url: string, init: RequestInit = {}) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new AbsenceRequestError({ error: 'ログイン情報が失効しています。再度ログインしてください。' });
  const token = await currentUser.getIdToken();
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new AbsenceRequestError(data);
  return data;
};

/**
 * 生徒ホーム：参加ボタンが出ていない時限に、今日の同じ学年の授業から振替先を選ぶ。
 * 1. 授業を選ぶ → 2. どの日の授業の振替にするか選ぶ → 署名をもらって振替を確定する。
 */
export default function TodayTransferModal({ open, onClose, period, onRegistered }: {
  open: boolean;
  onClose: () => void;
  period: 1 | 2;
  onRegistered: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<CandidateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [dayChoice, setDayChoice] = useState('');
  const [otherDate, setOtherDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await authedFetch(`/api/student/transfer-options?scope=today_grade&period=${period}`);
      setData({
        date: String(result.date || ''),
        candidates: Array.isArray(result.candidates) ? result.candidates : [],
        absences: Array.isArray(result.absences) ? result.absences : [],
        min_date: String(result.min_date || ''),
        max_date: String(result.max_date || ''),
      });
    } catch (error) {
      console.error('TodayTransferModal load failed', error);
      setData(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setDayChoice('');
    setOtherDate('');
    load();
  }, [open, load]);

  const chooseCandidate = (candidate: Candidate) => {
    setSelected(candidate);
    setDayChoice(data?.absences[0]?.target_date || OTHER_DAY);
    setOtherDate('');
  };

  const originalDate = dayChoice === OTHER_DAY ? otherDate : dayChoice;
  const otherDateInvalid = dayChoice === OTHER_DAY && Boolean(otherDate) && (
    otherDate === data?.date ||
    (Boolean(data?.min_date) && otherDate < String(data?.min_date)) ||
    (Boolean(data?.max_date) && otherDate > String(data?.max_date))
  );

  const submit = async () => {
    if (!selected || !originalDate || otherDateInvalid) return;
    setSubmitting(true);
    try {
      const grant = await authedFetch('/api/student/transfer-options', {
        method: 'POST',
        body: JSON.stringify({ scope: 'today_grade', shift_id: selected.id, absence_date: originalDate }),
      });
      await authedFetch('/api/parent/absence-requests', {
        method: 'POST',
        body: JSON.stringify({
          student_id: auth.currentUser?.uid || '',
          type: 'transfer',
          target_date: originalDate,
          transfer_shift_id: selected.id,
          transfer_token: grant.transfer_token,
        }),
      });
      toast.success('振替を登録しました。参加ボタンを表示します');
      onClose();
      onRegistered();
    } catch (error) {
      const message = error instanceof Error ? error.message : '振替を登録できませんでした。';
      toast.error(message || '振替を登録できませんでした。');
      if (error instanceof AbsenceRequestError && isTransferOptionError(error.code)) {
        setSelected(null);
        load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title = selected ? 'どの日の授業の振替にしますか？' : `${period}限目の振替先を選ぶ`;
  const description = selected
    ? `${selected.period}限 ${selected.course_name || selected.subject}（今日 ${selected.start_time}〜${selected.end_time}）`
    : '今日の同じ学年の授業から選べます。';

  return (
    <Modal
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      title={title}
      description={description}
      closeOnBackdrop={!selected}
      footer={selected ? (
        <>
          <Button variant="secondary" onClick={() => setSelected(null)} disabled={submitting}>戻る</Button>
          <Button
            onClick={submit}
            loading={submitting}
            disabled={!originalDate || otherDateInvalid}
            icon={<Repeat size={16} aria-hidden />}
          >
            この授業に振替する
          </Button>
        </>
      ) : undefined}
    >
      {!selected && (
        <div className="space-y-3">
          {loading && <ListSkeleton rows={3} />}
          {!loading && loadError && (
            <ErrorState title="振替できる授業を読み込めませんでした" onRetry={load} />
          )}
          {!loading && !loadError && data && data.candidates.length === 0 && (
            <EmptyState
              icon={CalendarDays}
              title="今は振替できる授業がありません"
              description="この時間の同じ学年の授業がないか、もう終わっています。"
            />
          )}
          {!loading && !loadError && data && data.candidates.length > 0 && (
            <ul className="space-y-2">
              {data.candidates.map(candidate => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => chooseCandidate(candidate)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-btn border border-line bg-surface px-4 py-3 text-left hover:border-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-fg">
                        <Phrase>{`${candidate.period}限 ${candidate.course_name || candidate.subject}`}</Phrase>
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {[`${candidate.start_time}〜${candidate.end_time}`, candidate.unit, candidate.teacher_name ? `${candidate.teacher_name}先生` : '']
                          .filter(Boolean).join(' ・ ')}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-fg-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1 text-xs text-fg-muted">
            <Link href="/student/absence?mode=transfer" className="font-bold text-accent underline underline-offset-2">
              ほかの日の授業へ振替する場合は、振替のページへ
            </Link>
          </p>
        </div>
      )}

      {selected && (
        <fieldset className="space-y-2" disabled={submitting}>
          <legend className="sr-only">振替のもとになる授業の日</legend>
          {data?.absences.map(absence => (
            <label key={absence.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-btn border border-line px-4 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input
                type="radio"
                name="transfer-original-day"
                value={absence.target_date}
                checked={dayChoice === absence.target_date}
                onChange={() => setDayChoice(absence.target_date)}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-sm font-bold text-fg">{formatDate(absence.target_date)}</span>
              <span className="text-xs text-fg-muted">欠席の連絡ずみ</span>
            </label>
          ))}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-btn border border-line px-4 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input
              type="radio"
              name="transfer-original-day"
              value={OTHER_DAY}
              checked={dayChoice === OTHER_DAY}
              onChange={() => setDayChoice(OTHER_DAY)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm font-bold text-fg">別の日を選ぶ</span>
          </label>
          {dayChoice === OTHER_DAY && (
            <div className="space-y-1 pl-1">
              <input
                type="date"
                aria-label="休む（休んだ）授業の日"
                value={otherDate}
                min={data?.min_date || undefined}
                max={data?.max_date || undefined}
                onChange={event => setOtherDate(event.target.value)}
                className="min-h-11 w-full rounded-input border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {otherDateInvalid ? (
                <p className="text-xs font-bold text-danger" role="alert">
                  {otherDate === data?.date ? '今日の授業の振替は選べません。別の日を選んでください。' : '選べる日の範囲をこえています。'}
                </p>
              ) : (
                <p className="text-xs text-fg-muted">休む（休んだ）授業の日を選んでください。今日以外で、60日前から30日後まで選べます。</p>
              )}
            </div>
          )}
          <p className="pt-1 text-xs text-fg-muted">選んだ日は「欠席」として記録され、今日のこの授業に参加できるようになります。</p>
        </fieldset>
      )}
    </Modal>
  );
}
