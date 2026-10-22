'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { CalendarCheck, Clock, AlertTriangle, Send, CheckCircle, CalendarDays, MessageSquare, Repeat, Loader2 } from 'lucide-react';
import { ButtonLink, EmptyState, ErrorState, PageHeader, Spinner, useToast } from '@/app/components/ui';
import { jstTodayKey } from '@/lib/lesson-deadline';
import { formatDate } from '@/lib/format';
import { AbsenceRequestError, isTransferOptionError } from '@/lib/absence-request-errors';

type TransferOption = {
  id: string;
  title: string;
  target_date: string;
  subject: string;
  course_name: string;
  unit: string;
  period: number;
  transfer_token: string;
};

export default function StudentAbsencePage() {
  const { user, profile } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<'absence' | 'transfer'>('absence');
  const [type, setType] = useState<'absent' | 'late'>('absent');
  const [date, setDate] = useState(() => jstTodayKey());
  const [reason, setReason] = useState('');
  const [absences, setAbsences] = useState<any[]>([]);
  const [selectedAbsenceId, setSelectedAbsenceId] = useState('');
  const [manualTransferDate, setManualTransferDate] = useState('');
  // 候補の取得条件（利用者が選んだ欠席ID・日付）。応答で選ばれた欠席IDは表示用で、再取得のきっかけにしない。
  const [transferSource, setTransferSource] = useState<{ kind: 'auto' } | { kind: 'absence'; id: string } | { kind: 'date'; date: string }>({ kind: 'auto' });
  const [transferReload, setTransferReload] = useState(0);
  const [transferOptions, setTransferOptions] = useState<TransferOption[]>([]);
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transferError, setTransferError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [transferEnabled, setTransferEnabled] = useState(true);
  const [directTransferEntry, setDirectTransferEntry] = useState(false);
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  // 送った内容。完了画面に出して、子どもが読んでから自分でホームへ戻れるようにする。
  const [submitted, setSubmitted] = useState<null | { kind: 'absence' | 'transfer'; label: string; date: string; transferTitle?: string; reason: string }>(null);

  useEffect(() => {
    const isDirectTransfer = new URLSearchParams(window.location.search).get('mode') === 'transfer';
    setDirectTransferEntry(isDirectTransfer);
    if (isDirectTransfer) setMode('transfer');
  }, []);

  useEffect(() => {
    const loadVisibility = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'portal_visibility'));
        if (snap.exists()) {
          setFeatureEnabled(snap.data().student?.absence !== false);
          setTransferEnabled(snap.data().student?.transfer !== false);
        }
      } catch (error) {
        console.warn('Absence visibility read failed:', error);
      } finally {
        setVisibilityLoading(false);
      }
    };
    loadVisibility();
  }, []);

  useEffect(() => {
    const loadTransferOptions = async () => {
      if (!user || mode !== 'transfer') return;
      setLoadingTransfers(true);
      setSelectedTransferId('');
      setTransferError(false);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams();
        if (transferSource.kind === 'date') params.set('absence_date', transferSource.date);
        else if (transferSource.kind === 'absence') params.set('absence_id', transferSource.id);
        const query = params.toString();
        const res = await fetch(`/api/student/transfer-options${query ? `?${query}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new AbsenceRequestError(data, '振替候補を読み込めませんでした。');
        setAbsences(data.absences || []);
        setSelectedAbsenceId(data.selected_absence?.id || data.absences?.[0]?.id || '');
        setTransferOptions(data.options || []);
      } catch (error) {
        console.error(error);
        setTransferOptions([]);
        setTransferError(true);
      } finally {
        setLoadingTransfers(false);
      }
    };
    loadTransferOptions();
  }, [user, mode, transferSource, transferReload]);

  const chooseAbsence = (id: string) => {
    setManualTransferDate('');
    setSelectedAbsenceId(id);
    setTransferSource({ kind: 'absence', id });
  };
  const chooseManualDate = (value: string) => {
    setManualTransferDate(value);
    setSelectedAbsenceId('');
    setSelectedTransferId('');
    setTransferSource(value ? { kind: 'date', date: value } : { kind: 'auto' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (mode === 'transfer' && (!selectedAbsenceId || !selectedTransferId)) {
      toast.error('振替元の授業日と振替先を選択してください。');
      return;
    }
    
    setLoading(true);

    try {
      const token = await user.getIdToken();
      const selectedTransfer = transferOptions.find(option => option.id === selectedTransferId);
      const directTransferWithoutAbsence = mode === 'transfer' && selectedAbsenceId.startsWith('pending:');
      const res = mode === 'transfer'
        ? await fetch(directTransferWithoutAbsence ? '/api/parent/absence-requests' : '/api/student/transfers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(directTransferWithoutAbsence ? {
              student_id: user.uid,
              type: 'transfer',
              target_date: manualTransferDate || selectedAbsenceId.split(':').at(-1) || '',
              transfer_shift_id: selectedTransferId,
              transfer_token: selectedTransfer?.transfer_token || '',
              reason,
            } : {
              absence_id: selectedAbsenceId,
              transfer_shift_id: selectedTransferId,
              transfer_token: selectedTransfer?.transfer_token || '',
              note: reason,
            }),
          })
        : await fetch('/api/parent/absence-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              student_id: user.uid,
              type: 'absence',
              absence_type: type,
              target_date: date,
              reason,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new AbsenceRequestError(data);

      setSubmitted(mode === 'transfer'
        ? {
            kind: 'transfer',
            label: '振替登録',
            date: manualTransferDate || absences.find(absence => absence.id === selectedAbsenceId)?.target_date || selectedAbsenceId.split(':').at(-1) || '',
            transferTitle: selectedTransfer?.title || '',
            reason,
          }
        : { kind: 'absence', label: type === 'absent' ? 'お休み' : '遅刻', date, reason });
      setLoading(false);

    } catch (error) {
      console.error(error);
      // 候補の期限切れ・変更のときは、最新の候補を読み込み直す。
      if (mode === 'transfer' && error instanceof AbsenceRequestError && isTransferOptionError(error.code)) {
        setTransferReload(value => value + 1);
      }
      toast.error(error instanceof Error ? error.message : '送信できませんでした。もう一度お試しください。');
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-10">
        <div className="cb-card w-full max-w-sm p-8 text-center" role="status">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle size={44} strokeWidth={3} aria-hidden />
          </div>
          <h2 className="mb-2 text-2xl font-black text-fg">送信しました</h2>
          <p className="mb-6 font-medium leading-relaxed text-fg-muted">
            {submitted.kind === 'transfer' ? '振替を登録しました。' : '先生にお知らせしました。'}
          </p>
          <dl className="mb-8 space-y-3 rounded-btn bg-canvas p-4 text-left text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 font-bold text-fg-muted">内容</dt>
              <dd className="text-right font-bold text-fg">{submitted.label}</dd>
            </div>
            {submitted.date && (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 font-bold text-fg-muted">{submitted.kind === 'transfer' ? '振替元の日' : '日にち'}</dt>
                <dd className="text-right font-bold text-fg">{formatDate(submitted.date) || submitted.date}</dd>
              </div>
            )}
            {submitted.transferTitle && (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 font-bold text-fg-muted">振替先</dt>
                <dd className="text-right font-bold text-fg">{submitted.transferTitle}</dd>
              </div>
            )}
            {submitted.reason.trim() && (
              <div>
                <dt className="font-bold text-fg-muted">{submitted.kind === 'transfer' ? '補足' : '理由'}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-fg">{submitted.reason}</dd>
              </div>
            )}
          </dl>
          <ButtonLink href="/student" size="lg" fullWidth>
            ホームへ
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (visibilityLoading) {
    return <div className="flex items-center justify-center px-4 py-20"><Spinner size={32} /></div>;
  }

  if ((directTransferEntry && !transferEnabled) || (!directTransferEntry && !featureEnabled)) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-10">
        <div className="cb-card max-w-sm p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 text-fg-muted" size={36} aria-hidden />
          <h1 className="text-xl font-black text-fg">{directTransferEntry ? '振替登録' : '欠席連絡'}は現在利用できません</h1>
          <p className="mt-2 text-sm font-medium text-fg-muted">管理者設定で非表示になっています。</p>
          <ButtonLink href="/student" className="mt-6">ホームへ戻る</ButtonLink>
        </div>
      </div>
    );
  }

  const sectionLabel = 'mb-4 flex items-center gap-2 text-sm font-bold text-fg';
  const labelIcon = 'rounded-input bg-accent-soft p-1.5 text-accent';
  const choiceIdle = 'border-line bg-canvas text-fg-muted hover:border-accent/30';

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <PageHeader
        tone="hero"
        title={directTransferEntry ? '振替先を選択' : '欠席・遅刻の連絡'}
        description={directTransferEntry ? '欠席登録がなくても、元の授業日から候補を確認できます' : '先生にメッセージを送ります'}
        icon={directTransferEntry ? Repeat : CalendarCheck}
        backHref="/student"
      />

      {/* スマホは縦積み、PC/タブレットは2カラム */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 md:gap-6">

        {/* 左カラム: 選択系 */}
        <div className="space-y-5">
          {!directTransferEntry && <div className="cb-card p-card">
            <p className={sectionLabel}>
              <span className={labelIcon}><Repeat size={18} strokeWidth={3} aria-hidden /></span>
              登録する内容
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setMode('absence')} aria-pressed={mode === 'absence'} className={`min-h-12 rounded-btn border-2 p-4 font-bold transition-colors ${mode === 'absence' ? 'border-accent bg-accent-soft text-accent' : choiceIdle}`}>
                欠席・遅刻
              </button>
              <button type="button" onClick={() => transferEnabled && setMode('transfer')} disabled={!transferEnabled} aria-pressed={mode === 'transfer'} className={`min-h-12 rounded-btn border-2 p-4 font-bold transition-colors ${mode === 'transfer' ? 'border-accent bg-accent-soft text-accent' : choiceIdle} ${!transferEnabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                振替登録
              </button>
            </div>
            {!transferEnabled && (
              <p className="mt-3 rounded-btn bg-canvas p-3 text-xs font-medium text-fg-muted">
                通常の振替登録は現在非表示です。保護者から「お子様が選択する」で届いた振替はホーム画面に表示されます。
              </p>
            )}
          </div>}

          {/* 1. 種類の選択 */}
          {mode === 'absence' && <div className="cb-card p-card">
            <p className={sectionLabel}>
              <span className={labelIcon}><CalendarCheck size={18} strokeWidth={3} aria-hidden /></span>
              どうしましたか？
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('absent')}
                aria-pressed={type === 'absent'}
                className={`rounded-btn border-2 p-5 transition-colors ${
                  type === 'absent' ? 'border-danger bg-danger text-white shadow-card' : choiceIdle
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <AlertTriangle size={32} strokeWidth={3} aria-hidden />
                  <span className="text-lg font-bold">お休み</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('late')}
                aria-pressed={type === 'late'}
                className={`rounded-btn border-2 p-5 transition-colors ${
                  type === 'late' ? 'border-warning bg-warning text-white shadow-card' : choiceIdle
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <Clock size={32} strokeWidth={3} aria-hidden />
                  <span className="text-lg font-bold">遅刻</span>
                </div>
              </button>
            </div>
          </div>}

          {/* 2. 日付の選択 */}
          {mode === 'absence' ? <div className="cb-card p-card">
            <label htmlFor="absence-date" className={sectionLabel}>
              <span className={labelIcon}><CalendarDays size={18} strokeWidth={3} aria-hidden /></span>
              いつのことですか？
            </label>
            <input
              id="absence-date"
              type="date"
              required
              min={jstTodayKey()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-input border-2 border-line bg-canvas p-4 text-center text-xl font-bold text-fg outline-none transition-colors focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15"
            />
          </div> : <div className="cb-card p-card">
            <p className={sectionLabel}>
              <span className={labelIcon}><CalendarDays size={18} strokeWidth={3} aria-hidden /></span>
              振替元の授業
            </p>
            {loadingTransfers ? (
              <div className="flex items-center gap-2 rounded-btn bg-accent-soft p-4 text-sm font-bold text-accent">
                <Spinner size={18} /> 候補を読み込み中
              </div>
            ) : (
              <div className="space-y-3">
                {absences.length > 0 && (
                  <select aria-label="欠席連絡から選ぶ" value={absences.some(absence => absence.id === selectedAbsenceId) ? selectedAbsenceId : ''} onChange={e => e.target.value && chooseAbsence(e.target.value)} className="min-h-12 w-full rounded-input border-2 border-line bg-canvas p-3 text-sm font-bold text-fg outline-none focus:border-accent">
                    <option value="" disabled>欠席連絡から選ぶ</option>
                    {absences.map(absence => (
                      <option key={absence.id} value={absence.id}>{absence.target_date || '-'} {absence.reason || absence.content || ''}</option>
                    ))}
                  </select>
                )}
                <p className="rounded-btn bg-accent-soft p-4 text-sm font-medium leading-relaxed text-accent">
                  {absences.length > 0 ? '欠席連絡のない日を振替元にする場合は、授業日を選んでください。' : '欠席連絡を登録していなくても振替できます。振替元となる授業日を選んでください。'}
                </p>
                <input
                  type="date"
                  aria-label="振替元の授業日"
                  required={absences.length === 0}
                  value={manualTransferDate}
                  onChange={e => chooseManualDate(e.target.value)}
                  className="min-h-12 w-full rounded-input border-2 border-line bg-canvas p-3 text-center text-base font-bold text-fg outline-none focus:border-accent"
                />
              </div>
            )}
          </div>}

        </div>

        {/* 右カラム: 入力・送信系 */}
        <div className="flex h-full flex-col gap-5">

          {/* 3. 理由の入力 (PCでは高さを伸ばす) */}
          <div className="cb-card flex flex-1 flex-col p-card">
            <label htmlFor="absence-reason" className={sectionLabel}>
              <span className={labelIcon}><MessageSquare size={18} strokeWidth={3} aria-hidden /></span>
              {mode === 'transfer' ? '振替候補を選んでください' : '理由をおしえてください'}
            </label>
            {mode === 'transfer' && (
              <div className="mb-4 space-y-3">
                {transferError && !loadingTransfers ? (
                  <ErrorState title="振替候補を読み込めませんでした" onRetry={() => setTransferReload(value => value + 1)} />
                ) : transferOptions.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title={absences.length === 0 && !manualTransferDate ? '振替元の授業日を選ぶと候補が表示されます' : '同じ単元の振替候補がありません'}
                    className="py-6"
                  />
                ) : transferOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedTransferId(option.id)}
                    aria-pressed={selectedTransferId === option.id}
                    className={`w-full rounded-btn border-2 p-4 text-left transition-colors ${selectedTransferId === option.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-canvas text-fg hover:border-accent/30'}`}
                  >
                    <p className="font-bold">{option.title}</p>
                    <p className="mt-1 text-xs font-medium text-fg-muted">{option.unit || '単元名未設定'} / {option.period ? `${option.period}限` : '時限未設定'}</p>
                  </button>
                ))}
              </div>
            )}
            <textarea
              id="absence-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={mode === 'absence'}
              placeholder={mode === 'transfer' ? "補足があれば入力してください。" : type === 'absent' ? "（例）熱があるので病院に行きます。" : "（例）部活が長引いたため15分ほど遅れます。"}
              className="min-h-[120px] w-full flex-1 resize-none rounded-input border-2 border-line bg-canvas p-4 font-medium text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 md:min-h-0"
            />
          </div>

          {/* 送信ボタン */}
          <button
            type="submit"
            disabled={loading || (mode === 'transfer' && (!selectedAbsenceId || !selectedTransferId))}
            aria-busy={loading || undefined}
            className={`flex min-h-14 w-full items-center justify-center gap-3 rounded-btn text-lg font-bold shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50 ${
              mode === 'transfer'
                ? 'bg-accent text-accent-ink hover:bg-accent-hover'
                : type === 'absent'
                ? 'bg-danger text-white hover:bg-danger/90'
                : 'bg-warning text-white hover:bg-warning/90'
            }`}
          >
            {loading ? (
              <><Loader2 size={20} className="animate-spin" aria-hidden />送信中...</>
            ) : (
              <>
                <Send size={22} strokeWidth={3} aria-hidden />
                {mode === 'transfer' ? '振替を確定する' : '連絡する'}
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
