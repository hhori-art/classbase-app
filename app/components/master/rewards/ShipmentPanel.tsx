'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Truck } from 'lucide-react';
import { Button, EmptyState, ErrorState, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import AdminTabs from '@/app/components/master/AdminTabs';
import { formatDateTime } from '@/lib/format';
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
  shipped: 'bg-accent-soft text-accent',
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

const formatDate = (value: string | null) => (value && formatDateTime(value)) || '-';

export default function ShipmentPanel() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [keyword, setKeyword] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, { shipping_note: string; student_note: string }>>({});
  const [loadError, setLoadError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await adminApi<{ shipments: Shipment[] }>('/api/admin/reward-shipments');
      setShipments(data.shipments || []);
    } catch (error) {
      console.error(error);
      setLoadError(error instanceof Error ? error.message : '発送状況を取得できませんでした');
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
    if (status === 'rejected' && !(await confirm({
      title: `${item.student_name} さんの「${item.reward_name}」を取り消しますか？`,
      message: item.cost > 0 ? `${item.cost}コインを生徒に返金します。` : 'ガチャの景品のため返金はありません。',
      confirmLabel: '取り消す',
      tone: 'danger',
    }))) return;
    setBusyId(item.id);
    try {
      await adminApi('/api/admin/reward-shipments', { body: { request_id: item.id, status, ...note } });
      await load();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminTabs
          size="sm"
          ariaLabel="発送の状態で絞り込み"
          value={filter}
          onChange={setFilter}
          tabs={FILTERS.map(item => ({
            id: item.id,
            label: item.label,
            badge: item.id === 'open' ? (counts.pending || 0) + (counts.preparing || 0) + (counts.shipped || 0) : item.id === 'all' ? shipments.length : counts[item.id] || 0,
          }))}
        />
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} aria-hidden />
          <input className={`${inputClass} pl-9`} aria-label="生徒名・景品名・校舎で検索" placeholder="生徒名・景品名・校舎" value={keyword} onChange={e => setKeyword(e.target.value)} />
        </div>
        <Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshCw size={16} aria-hidden />}>再読み込み</Button>
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Truck} title="該当する景品はありません" description={filter === 'open' ? '対応が必要な景品はありません。' : '絞り込みや検索の条件を変えてみてください。'} />
      ) : (
        <div className="space-y-3">
          {visible.map(item => {
            const note = notes[item.id] || { shipping_note: item.shipping_note, student_note: item.student_note };
            const nextStatuses = SHIPMENT_TRANSITIONS[item.status];
            return (
              <article key={item.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {item.reward_image_url ? <img src={item.reward_image_url} alt="" className="h-14 w-14 rounded-btn object-cover" /> : <div className="h-14 w-14 rounded-btn bg-slate-100" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[item.status]}`}>{SHIPMENT_STATUS_LABELS[item.status]}</span>
                      <span className="text-xs font-medium text-slate-400">{formatDate(item.created_at)}・{item.origin === 'gacha' ? `ガチャ「${item.gacha_name || ''}」で当選` : `${item.cost.toLocaleString()}コインで交換`}</span>
                    </div>
                    <p className="mt-1 font-bold text-slate-800">{item.reward_name}</p>
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
                      <Button key={status} size="sm" variant={status === 'rejected' ? 'danger' : 'primary'} loading={busyId === item.id} onClick={() => update(item, status)}>
                        {status === 'rejected' ? '取り消して返金' : `「${SHIPMENT_STATUS_LABELS[status]}」にする`}
                      </Button>
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
