'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle, Loader2, Plus, Train, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { TRANSPORT_TYPE_OPTIONS } from '@/lib/transport-fares';
import TransportLineSelect from '@/app/components/TransportLineSelect';
import TransportStationSearchInput from '@/app/components/TransportStationSearchInput';

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

const emptyForm = {
  transport_type: '',
  route_line: '',
  from: '',
  to: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
};

const todayKey = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addMonths = (dateKey: string, months: number) => {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
};

export default function TeacherCommuterPassPanel() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const attentionPass = useMemo(
    () => passes.find(pass => pass.active && pass.needs_confirmation),
    [passes],
  );

  const load = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/teacher/commuter-passes', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) setPasses(Array.isArray(data.passes) ? data.passes : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!form.transport_type || !form.from || !form.to || !form.end_date) {
      alert('交通機関・区間・有効期限を入力してください。');
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
      setForm(emptyForm);
      setOpen(false);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : '定期券の登録に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const confirmPass = async (pass: Pass, action: 'renewed' | 'not_purchased') => {
    const nextEndDate = action === 'renewed' ? prompt('新しい有効期限を入力してください。', addMonths(pass.end_date || todayKey(), 1)) : '';
    if (action === 'renewed' && !nextEndDate) return;
    const token = await auth.currentUser?.getIdToken();
    await fetch('/api/teacher/commuter-passes', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ id: pass.id, action, end_date: nextEndDate }),
    });
    setNoticeDismissed(true);
    await load();
  };

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
      {attentionPass && !noticeDismissed && (
        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-amber-900">定期券の期限確認</p>
              <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
                {attentionPass.from} から {attentionPass.to} の定期券が {attentionPass.end_date} までです。更新済みか、購入していないかを選んでください。
              </p>
            </div>
            <button type="button" onClick={() => setNoticeDismissed(true)} className="rounded-full p-1 text-amber-500 hover:bg-amber-100">
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => confirmPass(attentionPass, 'renewed')} className="min-h-[40px] rounded-xl bg-emerald-600 px-3 text-xs font-black text-white">
              更新した
            </button>
            <button type="button" onClick={() => confirmPass(attentionPass, 'not_purchased')} className="min-h-[40px] rounded-xl bg-white px-3 text-xs font-black text-amber-800 ring-1 ring-amber-200">
              買っていない
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h5 className="flex items-center gap-2 text-sm font-black text-slate-800">
            <Train size={16} className="text-emerald-600" /> 購入済み定期券
          </h5>
          <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-500">
            登録した定期区間は、交通費の自動入力時に控除されます。
          </p>
        </div>
        <button type="button" onClick={() => setOpen(value => !value)} className="flex min-h-[40px] items-center justify-center gap-1 rounded-xl bg-white px-3 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
          <Plus size={14} /> 定期券を登録
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> 読み込み中</div>
        ) : passes.filter(pass => pass.active).length > 0 ? (
          passes.filter(pass => pass.active).map(pass => (
            <div key={pass.id} className="rounded-xl bg-white p-3 ring-1 ring-emerald-100">
              <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-800">
                <span>{pass.from} → {pass.to}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">{pass.end_date}まで</span>
                {pass.source && <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">{pass.source}</span>}
              </div>
              {pass.display_route && <p className="mt-1 text-[10px] font-bold text-slate-400">{pass.display_route}</p>}
            </div>
          ))
        ) : (
          <p className="text-xs font-bold text-slate-400">登録中の定期券はありません。</p>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-emerald-100">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={form.transport_type}
              onChange={(event) => setForm({ ...form, transport_type: event.target.value, route_line: '', from: '', to: '' })}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
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
            <label className="text-[11px] font-black text-slate-500">
              開始日
              <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700" />
            </label>
            <label className="text-[11px] font-black text-slate-500">
              有効期限
              <input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700" />
            </label>
          </div>
          <button type="button" onClick={save} disabled={saving} className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white disabled:bg-slate-300">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            定期券を保存
          </button>
        </div>
      )}
    </div>
  );
}
