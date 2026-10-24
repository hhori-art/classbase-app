'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Plus, Train, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { TRANSPORT_TYPE_OPTIONS } from '@/lib/transport-fares';
import { jstDateKey } from '@/lib/date-key';
import TransportLineSelect from '@/app/components/TransportLineSelect';
import TransportStationSearchInput from '@/app/components/TransportStationSearchInput';
import { Button, IconButton, ErrorState, Spinner, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

type Pass = {
  id: string;
  transport_type: string;
  route_line?: string;
  from: string;
  to: string;
  start_date: string;
  end_date: string;
  status: string;
  source?: string;
  display_route?: string;
  active?: boolean;
  needs_confirmation?: boolean;
};

const todayKey = () => jstDateKey();
// 開始日は日本時間の今日で初期化する（UTCだと朝9時前に前日になるため）
const createEmptyForm = () => ({
  transport_type: '',
  route_line: '',
  from: '',
  to: '',
  start_date: todayKey(),
  end_date: '',
});
// 日付キーをUTC基準で月加算する（タイムゾーンで日付がずれないように）
const addMonths = (dateKey: string, months: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return todayKey();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

export default function TeacherCommuterPassPanel() {
  const toast = useToast();
  const [loadError, setLoadError] = useState(false);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [form, setForm] = useState(createEmptyForm);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const attentionPass = useMemo(
    () => passes.find(pass => pass.active && pass.needs_confirmation),
    [passes],
  );

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/teacher/commuter-passes', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) setPasses(Array.isArray(data.passes) ? data.passes : []);
      else setLoadError(true);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!form.transport_type || !form.from || !form.to || !form.end_date) {
      toast.error('交通機関・区間・有効期限を入力してください。');
      return;
    }
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/teacher/commuter-passes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || '定期券の登録に失敗しました。');
      setForm(createEmptyForm());
      setOpen(false);
      toast.success('定期券を登録しました。');
      await load();
    } catch (error) {
      toast.error(userErrorMessage(error, '定期券の登録に失敗しました。'));
    } finally {
      setSaving(false);
    }
  };

  const startRenew = (pass: Pass) => {
    setConfirmError('');
    setRenewEndDate(addMonths(pass.end_date || todayKey(), 1));
    setRenewing(true);
  };

  const confirmPass = async (pass: Pass, action: 'renewed' | 'not_purchased') => {
    if (confirming) return;
    const nextEndDate = action === 'renewed' ? renewEndDate : '';
    if (action === 'renewed' && !/^\d{4}-\d{2}-\d{2}$/.test(nextEndDate)) {
      setConfirmError('新しい有効期限を入力してください。');
      return;
    }
    setConfirming(true);
    setConfirmError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/teacher/commuter-passes', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: pass.id, action, end_date: nextEndDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error === 'invalid-request' || !data.error ? '定期券の確認を保存できませんでした。' : data.error);
      }
      setRenewing(false);
      setNoticeDismissed(true);
      await load();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '定期券の確認を保存できませんでした。');
    } finally {
      setConfirming(false);
    }
  };

  const inputClass = 'mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const activePasses = passes.filter(pass => pass.active);

  return (
    <div className="rounded-card border border-emerald-100 bg-emerald-50/70 p-4">
      {attentionPass && !noticeDismissed && (
        <div className="mb-3 rounded-card border border-amber-200 bg-warning-soft p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-900">定期券の期限確認</p>
              <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
                {attentionPass.from} から {attentionPass.to} の定期券が {formatDate(attentionPass.end_date) || attentionPass.end_date} までです。更新済みか、購入していないかを選んでください。
              </p>
            </div>
            <IconButton label="お知らせを閉じる" size="sm" onClick={() => setNoticeDismissed(true)} className="text-amber-600 hover:bg-amber-100 hover:text-amber-700">
              <X size={16} aria-hidden />
            </IconButton>
          </div>
          {renewing ? (
            <div className="mt-3 rounded-input bg-surface p-3 ring-1 ring-amber-200">
              <label className="block text-xs font-bold text-fg-muted">
                新しい有効期限
                <input
                  type="date"
                  value={renewEndDate}
                  min={attentionPass.end_date || undefined}
                  onChange={(event) => setRenewEndDate(event.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setRenewing(false); setConfirmError(''); }} disabled={confirming}>
                  戻る
                </Button>
                <Button size="sm" onClick={() => confirmPass(attentionPass, 'renewed')} loading={confirming} disabled={!renewEndDate}>
                  この期限で更新
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => startRenew(attentionPass)} disabled={confirming}>
                更新した
              </Button>
              <Button variant="secondary" size="sm" onClick={() => confirmPass(attentionPass, 'not_purchased')} disabled={confirming}>
                買っていない
              </Button>
            </div>
          )}
          {confirmError && <p role="alert" className="mt-2 text-xs font-bold text-danger">{confirmError}</p>}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h5 className="flex items-center gap-2 text-sm font-bold text-fg">
            <Train size={16} className="text-emerald-600" aria-hidden /> 購入済み定期券
          </h5>
          <p className="mt-1 text-xs font-medium leading-relaxed text-fg-muted">
            登録した定期区間は、交通費の自動入力時に控除されます。
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setOpen(value => !value)} aria-expanded={open}>
          定期券を登録
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <Spinner size={16} label="定期券を読み込み中" />
        ) : loadError ? (
          <ErrorState title="定期券を読み込めませんでした" onRetry={load} className="py-5" />
        ) : activePasses.length > 0 ? (
          activePasses.map(pass => (
            <div key={pass.id} className="rounded-input bg-surface p-3 ring-1 ring-emerald-100">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-fg">
                <span>{pass.from} → {pass.to}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{formatDate(pass.end_date) || pass.end_date}まで</span>
                {pass.source && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">{pass.source}</span>}
              </div>
              {pass.display_route && <p className="mt-1 text-xs font-medium text-fg-muted">{pass.display_route}</p>}
            </div>
          ))
        ) : (
          <p className="text-xs font-bold text-fg-muted">登録中の定期券はありません。</p>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-card bg-surface p-3 ring-1 ring-emerald-100">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={form.transport_type}
              onChange={(event) => setForm({ ...form, transport_type: event.target.value, route_line: '', from: '', to: '' })}
              aria-label="交通機関"
              className="min-h-11 rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              <option value="">交通機関</option>
              {TRANSPORT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <TransportLineSelect
              transportType={form.transport_type}
              value={form.route_line}
              onChange={(value) => setForm({ ...form, route_line: value, from: '', to: '' })}
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <TransportStationSearchInput
              transportType={form.transport_type}
              line={form.route_line}
              value={form.from}
              placeholder="定期の開始駅"
              onChange={(value) => setForm({ ...form, from: value })}
              onSelect={(value) => setForm({ ...form, from: value })}
            />
            <TransportStationSearchInput
              transportType={form.transport_type}
              line={form.route_line}
              value={form.to}
              placeholder="定期の終了駅"
              onChange={(value) => setForm({ ...form, to: value })}
              onSelect={(value) => setForm({ ...form, to: value })}
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold text-fg-muted">
              開始日
              <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-bold text-fg-muted">
              有効期限
              <input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className={inputClass} />
            </label>
          </div>
          <Button onClick={save} loading={saving} icon={<CheckCircle size={16} aria-hidden />} fullWidth className="mt-3">
            定期券を保存
          </Button>
        </div>
      )}
    </div>
  );
}
