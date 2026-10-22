'use client';

// 打刻修正依頼・打刻忘れ申請の共通部品（準専任の勤怠打刻と専任勤怠の両方で使う）。
// 送信先はどちらも /api/attendance-corrections。承認されるまで勤務記録は変わらない。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { MessageSquareWarning, Send } from 'lucide-react';
import { Button, EmptyState, ErrorState, ListSkeleton, Modal, StatusPill, useToast, type StatusTone } from '@/app/components/ui';
import FiveMinuteTimePicker from '@/app/components/FiveMinuteTimePicker';
import { formatDateTime } from '@/lib/format';
import {
  ATTENDANCE_SCHOOL_OPTION_GROUPS,
  SCIENCE_SOCIAL_WORKPLACE_ID,
  SCIENCE_SOCIAL_WORKPLACE_LABEL,
} from '@/lib/attendance-schools';

export type CorrectionRequest = {
  id: string;
  work_record_id?: string | null;
  school_id?: string | null;
  request_type?: string;
  target_date?: string | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  reason?: string;
  status: string;
  created_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string;
  revision_number?: number;
  superseded_by?: string;
};

export type CorrectionTargetRecord = {
  id: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  status?: string;
};

export type CorrectionForm = { requested_start_time: string; requested_end_time: string; reason: string };
export type MissingClockForm = CorrectionForm & { target_date: string; school_id: string };

const fieldLabelClass = 'mb-2 block text-xs font-bold text-fg-muted';
const formInputClass = 'min-h-[52px] w-full rounded-input border border-line bg-surface px-4 py-3 text-sm font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const schoolSelectClass = 'min-h-[52px] w-full rounded-input border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

const formatDateTimeLabel = (value?: string | null) => formatDateTime(value) || '-';

const toLocalInputValue = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 打刻時刻を5分単位に丸めて、時刻入力の初期値にする。 */
export const toFiveMinuteLocalInputValue = (value?: string | null) => {
  if (!value) return '';
  const rounded = new Date(value);
  if (Number.isNaN(rounded.getTime())) return '';
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.round(rounded.getMinutes() / 5) * 5);
  return toLocalInputValue(rounded.toISOString());
};

export const correctionFormForRecord = (record: CorrectionTargetRecord, request?: CorrectionRequest | null): CorrectionForm => ({
  requested_start_time: toFiveMinuteLocalInputValue(request?.requested_start_time || record.start_time),
  requested_end_time: toFiveMinuteLocalInputValue(request?.requested_end_time || record.end_time),
  reason: '',
});

export const missingClockFormForDate = (targetDate: string, schoolId: string, request?: CorrectionRequest | null): MissingClockForm => ({
  target_date: targetDate,
  school_id: request?.school_id || schoolId,
  requested_start_time: toFiveMinuteLocalInputValue(request?.requested_start_time) || `${targetDate}T19:20`,
  requested_end_time: toFiveMinuteLocalInputValue(request?.requested_end_time) || `${targetDate}T21:40`,
  reason: '',
});

const CORRECTION_ERROR_MESSAGES: Record<string, string> = {
  'approved work records cannot be changed by teacher': '承認済みの勤怠記録は講師側から修正できません。管理者へ連絡してください。',
  'requested end time must be after start time': '退勤時刻は出勤時刻より後にしてください。',
  'invalid requested time': '出勤時刻または退勤時刻の形式を確認してください。',
  'requested time must be in 5 minute increments': '出勤・退勤時刻は5分単位で選択してください。',
  'work record already exists for target_date': 'この日はすでに勤務記録があります。該当日の勤務記録から打刻修正依頼を送ってください。',
  'work school is required': '勤務した校舎を選択してください。',
  'target_date is required': '申請する日付を選択してください。',
  'requested time is required': '修正後の出勤時刻または退勤時刻を入力してください。',
  'work record not found': '勤務記録が見つかりません。画面を再読み込みしてください。',
  forbidden: 'この操作を行う権限がありません。',
};

/** /api/attendance-corrections へ申請を送る。失敗時は日本語のメッセージで例外を投げる。 */
export async function submitCorrectionRequest(user: User, payload: Record<string, unknown>) {
  let token = '';
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new Error('ログイン情報の有効期限が切れています。一度ログアウトして、再度ログインしてください。');
  }
  const response = await fetch('/api/attendance-corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'request', ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const code = String(data.error || '');
    if (code === 'missing-token' || response.status === 401) throw new Error('ログイン情報の有効期限が切れています。画面を再読み込みして、もう一度お試しください。');
    throw new Error(CORRECTION_ERROR_MESSAGES[code] || code || '申請を送信できませんでした。');
  }
  return data as { ok: true; request_id: string };
}

/** 指定月の自分の申請一覧。month は YYYY-MM。 */
export function useCorrectionRequests(user: User | null | undefined, month: string) {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    if (!user || !/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    setError(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/attendance-corrections?month=${month}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'failed');
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (loadError) {
      console.warn('打刻修正依頼取得エラー:', loadError);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [month, user]);
  useEffect(() => { reload(); }, [reload]);
  return { requests, loading, error, reload };
}

const createdMillis = (request: CorrectionRequest) => {
  const parsed = Date.parse(String(request.created_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 日付ごとの最新の申請が「承認待ち」か「却下」のもの。再申請済みの古い却下は含めない。 */
export function correctionRequestsNeedingAttention(requests: CorrectionRequest[]) {
  const latestByDate = new Map<string, CorrectionRequest>();
  for (const request of requests) {
    if (request.status === 'superseded') continue;
    const key = String(request.target_date || request.id);
    const current = latestByDate.get(key);
    if (!current || createdMillis(request) > createdMillis(current)) latestByDate.set(key, request);
  }
  return Array.from(latestByDate.values()).filter(request => request.status === 'pending' || request.status === 'rejected');
}

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  approved: { label: '承認済み', tone: 'success' },
  rejected: { label: '却下', tone: 'danger' },
  superseded: { label: '再申請に更新済み', tone: 'neutral' },
  pending: { label: '承認待ち', tone: 'warning' },
};

export function CorrectionRequestList({ requests, loading, error, onRetry, onReopen, emptyTitle = 'この月の打刻修正依頼はありません' }: {
  requests: CorrectionRequest[];
  loading?: boolean;
  error: boolean;
  onRetry: () => void;
  onReopen?: (request: CorrectionRequest) => void;
  emptyTitle?: string;
}) {
  const attentionIds = useMemo(() => new Set(correctionRequestsNeedingAttention(requests).map(item => item.id)), [requests]);
  if (error) return <ErrorState title="打刻修正依頼を読み込めませんでした" onRetry={onRetry} />;
  if (loading && requests.length === 0) return <ListSkeleton rows={2} />;
  if (requests.length === 0) return <EmptyState icon={Send} title={emptyTitle} />;
  return (
    <div className="space-y-3">
      {requests.map(request => {
        const meta = STATUS_META[request.status] || STATUS_META.pending;
        const isMissing = request.request_type === 'missing_clock' || !request.work_record_id;
        const canReopen = Boolean(onReopen) && attentionIds.has(request.id);
        return (
          <article key={request.id} className="rounded-card border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-fg">{isMissing ? '打刻忘れ申請' : '打刻修正依頼'}</p>
                <p className="mt-1 text-xs font-medium text-fg-muted">
                  {request.target_date || '日付未設定'} / 申請: {formatDateTimeLabel(request.created_at)}
                </p>
              </div>
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-input bg-surface p-3">
                <p className="text-xs font-bold text-fg-muted">申請出勤</p>
                <p className="mt-1 text-xs font-bold text-fg">{formatDateTimeLabel(request.requested_start_time)}</p>
              </div>
              <div className="rounded-input bg-surface p-3">
                <p className="text-xs font-bold text-fg-muted">申請退勤</p>
                <p className="mt-1 text-xs font-bold text-fg">{formatDateTimeLabel(request.requested_end_time)}</p>
              </div>
            </div>
            {request.reason && <p className="mt-3 text-xs font-medium leading-relaxed text-fg-muted">理由: {request.reason}</p>}
            {request.review_note ? (
              <div className={`mt-2 rounded-input p-3 text-xs font-bold leading-relaxed ${request.status === 'rejected' ? 'bg-danger-soft text-rose-700' : 'bg-surface text-fg'}`}>
                <p className="mb-1 flex items-center gap-1 text-xs font-bold"><MessageSquareWarning size={13} aria-hidden /> 管理者からのコメント</p>
                <p className="whitespace-pre-line">{request.review_note}</p>
              </div>
            ) : request.status === 'rejected' ? (
              <p className="mt-2 rounded-input bg-danger-soft p-3 text-xs font-bold text-rose-700">却下されました。内容を確認して、必要なら再申請してください。</p>
            ) : null}
            {canReopen && (
              <Button variant="secondary" fullWidth onClick={() => onReopen?.(request)} icon={<Send size={14} aria-hidden />} className="mt-3 text-xs text-amber-700">
                内容を変更して再申請
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function TimeCorrectionModal({ open, record, initialForm, user, onClose, onSubmitted }: {
  open: boolean;
  record: CorrectionTargetRecord | null;
  initialForm: CorrectionForm;
  user: User | null | undefined;
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState(initialForm);
  const [sending, setSending] = useState(false);
  const wasOpen = useRef(false);
  // 開いた瞬間だけ初期値を入れる（親の再描画で入力途中の内容を消さない）。
  useEffect(() => {
    if (open && !wasOpen.current) setForm(initialForm);
    wasOpen.current = open;
  }, [open, initialForm]);
  const targetDate = String(record?.date || '').slice(0, 10);

  const submit = async () => {
    if (!record || !user || sending) return;
    if (!form.reason.trim()) return toast.error('修正理由を入力してください。');
    if (!form.requested_start_time && !form.requested_end_time) return toast.error('修正後の出勤時刻または退勤時刻を入力してください。');
    if ([form.requested_start_time, form.requested_end_time].filter(Boolean).some(value => value.slice(0, 10) !== targetDate)) {
      return toast.error('出勤・退勤時刻は勤務日と同じ日付で入力してください。');
    }
    if (form.requested_start_time && form.requested_end_time && new Date(form.requested_start_time) >= new Date(form.requested_end_time)) {
      return toast.error('退勤時刻は出勤時刻より後にしてください。');
    }
    setSending(true);
    try {
      await submitCorrectionRequest(user, {
        work_record_id: record.id,
        requested_start_time: form.requested_start_time ? new Date(form.requested_start_time).toISOString() : null,
        requested_end_time: form.requested_end_time ? new Date(form.requested_end_time).toISOString() : null,
        reason: form.reason,
      });
      toast.success('勤怠修正依頼を送信しました。管理者の承認後に反映されます。');
      await onSubmitted();
    } catch (error) {
      toast.error(`修正依頼の送信に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={Boolean(open && record)}
      onClose={onClose}
      title="打刻修正依頼"
      description={record ? `${record.date} の出退勤時刻を管理者へ申請します` : undefined}
      footer={<>
        <Button variant="secondary" onClick={onClose}>キャンセル</Button>
        <Button onClick={submit} loading={sending} icon={<Send size={18} aria-hidden />}>依頼を送信</Button>
      </>}
    >
      {record && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-card bg-canvas p-4">
              <p className="text-xs font-bold text-fg-muted">現在の出勤</p>
              <p className="mt-1 text-sm font-bold text-fg">{formatDateTimeLabel(record.start_time)}</p>
            </div>
            <div className="rounded-card bg-canvas p-4">
              <p className="text-xs font-bold text-fg-muted">現在の退勤</p>
              <p className="mt-1 text-sm font-bold text-fg">{formatDateTimeLabel(record.end_time)}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={fieldLabelClass}>修正後の出勤時刻</span>
              <FiveMinuteTimePicker
                label="修正後の出勤時刻"
                value={form.requested_start_time.slice(11, 16)}
                onChange={value => setForm(prev => ({ ...prev, requested_start_time: value ? `${targetDate}T${value}` : '' }))}
                className={formInputClass}
              />
            </label>
            <label>
              <span className={fieldLabelClass}>修正後の退勤時刻</span>
              <FiveMinuteTimePicker
                label="修正後の退勤時刻"
                value={form.requested_end_time.slice(11, 16)}
                onChange={value => setForm(prev => ({ ...prev, requested_end_time: value ? `${targetDate}T${value}` : '' }))}
                className={formInputClass}
              />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelClass}>修正理由</span>
            <textarea
              value={form.reason}
              onChange={event => setForm(prev => ({ ...prev, reason: event.target.value }))}
              placeholder="例: 退勤ボタンを押し忘れたため、22:10退勤へ修正をお願いします。"
              className={`${formInputClass} min-h-[110px]`}
            />
          </label>
          <div className="rounded-card border border-amber-100 bg-warning-soft p-4 text-xs font-bold leading-relaxed text-amber-800">
            送信後は管理者の承認が必要です。承認されるまで、元の打刻時間は変更されません。
          </div>
        </div>
      )}
    </Modal>
  );
}

export function MissingClockModal({ open, initialForm, user, hasRecordOnDate, onClose, onSubmitted }: {
  open: boolean;
  initialForm: MissingClockForm;
  user: User | null | undefined;
  /** その日に勤務記録がすでにあるか（あれば打刻修正依頼へ誘導する）。 */
  hasRecordOnDate: (date: string) => boolean;
  onClose: () => void;
  onSubmitted: (targetDate: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState(initialForm);
  const [sending, setSending] = useState(false);
  const wasOpen = useRef(false);
  // 開いた瞬間だけ初期値を入れる（親の再描画で入力途中の内容を消さない）。
  useEffect(() => {
    if (open && !wasOpen.current) setForm(initialForm);
    wasOpen.current = open;
  }, [open, initialForm]);

  const updateTargetDate = (targetDate: string) => setForm(prev => ({
    ...prev,
    target_date: targetDate,
    requested_start_time: prev.requested_start_time ? `${targetDate}T${prev.requested_start_time.slice(11, 16)}` : '',
    requested_end_time: prev.requested_end_time ? `${targetDate}T${prev.requested_end_time.slice(11, 16)}` : '',
  }));

  const submit = async () => {
    if (!user || sending) return;
    if (!form.target_date) return toast.error('申請する日付を選択してください。');
    if (!form.requested_start_time || !form.requested_end_time) return toast.error('出勤時刻と退勤時刻を入力してください。');
    if (!form.school_id) return toast.error('勤務校舎を選択してください。');
    if (!form.reason.trim()) return toast.error('申請理由を入力してください。');
    if (form.requested_start_time.slice(0, 10) !== form.target_date || form.requested_end_time.slice(0, 10) !== form.target_date) {
      return toast.error('出勤・退勤時刻は申請日と同じ日付で入力してください。');
    }
    if (new Date(form.requested_start_time) >= new Date(form.requested_end_time)) return toast.error('退勤時刻は出勤時刻より後にしてください。');
    if (hasRecordOnDate(form.target_date)) {
      return toast.error('この日はすでに勤務記録があります。1日に同じ講師の勤怠は1件のみ作成できます。既存の記録から「打刻修正依頼」を送ってください。');
    }
    setSending(true);
    try {
      await submitCorrectionRequest(user, {
        target_date: form.target_date,
        school_id: form.school_id,
        requested_start_time: new Date(form.requested_start_time).toISOString(),
        requested_end_time: new Date(form.requested_end_time).toISOString(),
        reason: form.reason,
      });
      toast.success('打刻忘れの申請を送信しました。管理者の承認後に勤務記録が作成されます。');
      await onSubmitted(form.target_date);
    } catch (error) {
      toast.error(`申請の送信に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="打刻忘れ申請"
      description="打刻をしていない日も、任意の日付を選んで管理者へ申請できます。"
      footer={<>
        <Button variant="secondary" onClick={onClose}>キャンセル</Button>
        <Button onClick={submit} loading={sending} icon={<Send size={18} aria-hidden />}>申請を送信</Button>
      </>}
    >
      <div className="space-y-5">
        <label className="block">
          <span className={fieldLabelClass}>申請する日付</span>
          <input type="date" value={form.target_date} onChange={event => updateTargetDate(event.target.value)} className={formInputClass} />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>勤務した校舎</span>
          <select value={form.school_id} onChange={event => setForm(prev => ({ ...prev, school_id: event.target.value }))} className={schoolSelectClass}>
            <option value="">勤務校舎を選択</option>
            <option value={SCIENCE_SOCIAL_WORKPLACE_ID}>★ {SCIENCE_SOCIAL_WORKPLACE_LABEL}</option>
            {ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.schools.map(school => <option key={school.code} value={school.code}>{school.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className={fieldLabelClass}>申請する出勤時刻</span>
            <FiveMinuteTimePicker
              label="申請する出勤時刻"
              value={form.requested_start_time.slice(11, 16)}
              onChange={value => setForm(prev => ({ ...prev, requested_start_time: value ? `${prev.target_date}T${value}` : '' }))}
              className={formInputClass}
            />
          </label>
          <label>
            <span className={fieldLabelClass}>申請する退勤時刻</span>
            <FiveMinuteTimePicker
              label="申請する退勤時刻"
              value={form.requested_end_time.slice(11, 16)}
              onChange={value => setForm(prev => ({ ...prev, requested_end_time: value ? `${prev.target_date}T${value}` : '' }))}
              className={formInputClass}
            />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelClass}>申請理由</span>
          <textarea
            value={form.reason}
            onChange={event => setForm(prev => ({ ...prev, reason: event.target.value }))}
            placeholder="例: 出勤・退勤の打刻を忘れたため、勤務実績の作成をお願いします。"
            className={`${formInputClass} min-h-[110px]`}
          />
        </label>
        <div className="rounded-card border border-amber-100 bg-warning-soft p-4 text-xs font-bold leading-relaxed text-amber-800">
          承認されると、指定した日付・時刻で勤務記録が新規作成されます。
        </div>
      </div>
    </Modal>
  );
}
