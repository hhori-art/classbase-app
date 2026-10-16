'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Truck } from 'lucide-react';
import { SHIPMENT_STATUS_LABELS, SHIPMENT_TRANSITIONS, type ShipmentStatus } from '@/lib/rewards';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { adminApi, inputClass } from './api';

type Shipment = {
  id: string;
  student_name: string;
  school: string;
  grade: string;
  reward_name: string;
  reward_image_url: string;
  origin: 'shop' | 'gacha';
  gacha_name: string | null;
  cost: number;
  status: ShipmentStatus;
  shipping_note: string;
  student_note: string;
  created_at: string | null;
};

const STATUS_STYLES: Record<ShipmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  preparing: 'bg-sky-100 text-sky-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-200 text-slate-600',
};

const FILTERS: { id: 'open' | ShipmentStatus | 'all'; label: string }[] = [
  { id: 'open', label: '対応が必要' },
  { id: 'pending', label: '受付' },
  { id: 'preparing', label: '準備中' },
  { id: 'shipped', label: '発送・お渡し済み' },
  { id: 'completed', label: '受け取り完了' },
  { id: 'rejected', label: '取り消し' },
  { id: 'all', label: 'すべて' },
];

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

export default function ShipmentPanel() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [keyword, setKeyword] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, { shipping_note: string; student_note: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi<{ shipments: Shipment[] }>('/api/admin/reward-shipments');
      setShipments(data.shipments || []);
    } catch (error) {
      alert(error instanceof Error ? error.message : '発送状況を取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => shipments.filter(item => {
    if (filter === 'open' && !['pending', 'preparing', 'shipped'].includes(item.status)) return false;
    if (filter !== 'open' && filter !== 'all' && item.status !== filter) return false;
    const text = `${item.student_name} ${item.reward_name} ${attendanceSchoolName(item.school) || item.school}`;
    return !keyword.trim() || text.includes(keyword.trim());
  }), [shipments, filter, keyword]);

  const counts = useMemo(() => shipments.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {}), [shipments]);

  const update = async (item: Shipment, status: ShipmentStatus) => {
    const note = notes[item.id] || { shipping_note: item.shipping_note, student_note: item.student_note };
    if (status === 'rejected' && !confirm(`「${item.reward_name}」を取り消しますか？${item.cost > 0 ? `\n${item.cost}コインを生徒に返金します。` : '\nガチャの景品のため返金はありません。'}`)) return;
    setBusyId(item.id);
    try {
      await adminApi('/api/admin/reward-shipments', { body: { request_id: item.id, status, ...note } });
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(item => {
          const count = item.id === 'open' ? (counts.pending || 0) + (counts.preparing || 0) + (counts.shipped || 0) : item.id === 'all' ? shipments.length : counts[item.id] || 0;
          return (
            <button key={item.id} onClick={() => setFilter(item.id)} className={`rounded-full px-3 py-1.5 text-xs font-black ${filter === item.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 shadow-sm'}`}>
              {item.label} <span className="opacity-70">{count}</span>
            </button>
          );
        })}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={15} />
          <input className={`${inputClass} pl-9`} placeholder="生徒名・景品名・校舎" value={keyword} onChange={e => setKeyword(e.target.value)} />
        </div>
        <button onClick={() => void load()} className="rounded-xl bg-white p-2.5 text-slate-500 shadow-sm" aria-label="再読み込み"><RefreshCw size={16} /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-amber-500" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-[28px] border-4 border-dashed border-slate-100 bg-white py-16 text-center font-bold text-slate-300"><Truck className="mx-auto mb-2" size={36} />該当する景品はありません</div>
      ) : (
        <div className="space-y-3">
          {visible.map(item => {
            const note = notes[item.id] || { shipping_note: item.shipping_note, student_note: item.student_note };
            const nextStatuses = SHIPMENT_TRANSITIONS[item.status];
            return (
              <article key={item.id} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {item.reward_image_url ? <img src={item.reward_image_url} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="h-14 w-14 rounded-xl bg-slate-100" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS_STYLES[item.status]}`}>{SHIPMENT_STATUS_LABELS[item.status]}</span>
                      <span className="text-[11px] font-bold text-slate-400">{formatDate(item.created_at)}・{item.origin === 'gacha' ? `ガチャ「${item.gacha_name || ''}」で当選` : `${item.cost.toLocaleString()}コインで交換`}</span>
                    </div>
                    <p className="mt-1 font-black text-slate-800">{item.reward_name}</p>
                    <p className="text-xs font-bold text-slate-500">{item.student_name}（{attendanceSchoolName(item.school) || item.school || '校舎未設定'}{item.grade ? `・${item.grade}` : ''}）</p>
                  </div>
                </div>
                {nextStatuses.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input className={inputClass} placeholder="管理メモ（生徒には表示されません）" value={note.shipping_note} maxLength={500}
                      onChange={e => setNotes({ ...notes, [item.id]: { ...note, shipping_note: e.target.value } })} />
                    <input className={inputClass} placeholder="生徒へのお知らせ（例：次回の授業でお渡しします）" value={note.student_note} maxLength={300}
                      onChange={e => setNotes({ ...notes, [item.id]: { ...note, student_note: e.target.value } })} />
                  </div>
                )}
                {nextStatuses.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {nextStatuses.map(status => (
                      <button key={status} disabled={busyId === item.id} onClick={() => update(item, status)}
                        className={`rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50 ${status === 'rejected' ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-slate-900 text-white hover:bg-slate-700'}`}>
                        {busyId === item.id ? <Loader2 className="animate-spin" size={14} /> : status === 'rejected' ? '取り消して返金' : `「${SHIPMENT_STATUS_LABELS[status]}」にする`}
                      </button>
                    ))}
                  </div>
                )}
                {nextStatuses.length === 0 && (item.shipping_note || item.student_note) && (
                  <p className="mt-2 text-xs font-bold text-slate-400">{[item.student_note && `生徒へ：${item.student_note}`, item.shipping_note && `メモ：${item.shipping_note}`].filter(Boolean).join('　')}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
