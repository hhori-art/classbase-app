'use client';

import { useMemo, useRef, useState } from 'react';
import { Archive, Check, Coins, Image as ImageIcon, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { Button, EmptyState, IconButton, useConfirm, useToast } from '@/app/components/ui';
import { formatPercent, GACHA_RATE_SCALE, percentToRate, rateToPercent } from '@/lib/rewards';
import { adminApi, inputClass, labelClass, type AdminGacha, type AdminReward } from './api';
import { userErrorMessage } from '@/lib/user-error';

type Props = { gachas: AdminGacha[]; rewards: AdminReward[]; onChanged: () => Promise<void> };
type ItemRow = { reward_id: string; percent: string };

const emptyForm = { id: '', name: '', description: '', cost: '', miss_refund_coins: '0', sort_order: '0' };

export default function GachaPanel({ gachas, rewards, onChanged }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<ItemRow[]>([{ reward_id: '', percent: '' }]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const imageInput = useRef<HTMLInputElement>(null);
  const rewardById = useMemo(() => new Map(rewards.map(reward => [reward.id, reward])), [rewards]);

  const itemTotal = items.reduce((sum, item) => sum + percentToRate(item.percent), 0);
  const missWeight = GACHA_RATE_SCALE - itemTotal;

  const reset = () => {
    setForm(emptyForm);
    setItems([{ reward_id: '', percent: '' }]);
    setImageFile(null);
    setPreviewUrl('');
    if (imageInput.current) imageInput.current.value = '';
  };

  const startEdit = (gacha: AdminGacha) => {
    setForm({
      id: gacha.id, name: gacha.name, description: gacha.description, cost: String(gacha.cost),
      miss_refund_coins: String(gacha.miss_refund_coins), sort_order: String(gacha.sort_order),
    });
    setItems(gacha.items.map(item => ({ reward_id: item.reward_id, percent: String(rateToPercent(item.weight)) })));
    setImageFile(null);
    setPreviewUrl(gacha.image_url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rows = items.filter(item => item.reward_id);
    if (rows.length === 0) return toast.error('景品を1つ以上設定してください');
    if (rows.some(item => percentToRate(item.percent) <= 0)) return toast.error('各景品の排出率は0.01%以上にしてください');
    if (missWeight < 0) return toast.error('景品の排出率の合計が100%を超えています');
    setSubmitting(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      body.set('miss_weight', String(missWeight));
      body.set('items', JSON.stringify(rows.map(item => ({ reward_id: item.reward_id, weight: percentToRate(item.percent) }))));
      if (imageFile) body.set('image', imageFile);
      await adminApi('/api/admin/gachas', { body });
      toast.success(form.id ? 'ガチャを更新しました' : 'ガチャを作成しました');
      reset();
      await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '保存できませんでした'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (gacha: AdminGacha) => {
    const ok = await confirm(gacha.active
      ? { title: `「${gacha.name}」を停止しますか？`, message: '生徒の画面に表示されなくなります。', confirmLabel: '停止する', tone: 'danger' }
      : { title: `「${gacha.name}」を再公開しますか？`, confirmLabel: '再公開する' });
    if (!ok) return;
    try {
      await adminApi('/api/admin/gachas', { method: 'PATCH', body: { id: gacha.id, active: !gacha.active } });
      await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '更新できませんでした'));
    }
  };

  const selectableRewards = rewards.filter(reward => reward.active);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{form.id ? 'ガチャを編集' : 'ガチャを作成'}</h2>
          {form.id && <Button variant="ghost" size="sm" onClick={reset} icon={<X size={14} aria-hidden />}>編集をやめる</Button>}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => imageInput.current?.click()} aria-label="ガチャの画像を選ぶ" className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-btn border-2 border-dashed border-slate-200 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="text-slate-300" />}
          </button>
          <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
            const file = event.target.files?.[0] || null;
            setImageFile(file);
            if (file) setPreviewUrl(URL.createObjectURL(file));
          }} />
          <div className="flex-1 space-y-3">
            <label className="block"><span className={labelClass}>ガチャ名</span><input className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={80} required /></label>
            <p className="text-xs font-bold text-slate-400">画像は任意（JPEG・PNG・WebP）</p>
          </div>
        </div>
        <label className="block"><span className={labelClass}>説明（生徒に表示）</span><textarea className={`${inputClass} min-h-16`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={1000} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className={labelClass}>1回のコイン</span><input type="number" min={1} className={inputClass} value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} required /></label>
          <label className="block"><span className={labelClass}>はずれ時に戻すコイン</span><input type="number" min={0} className={inputClass} value={form.miss_refund_coins} onChange={e => setForm({ ...form, miss_refund_coins: e.target.value })} /></label>
          <label className="block"><span className={labelClass}>表示順</span><input type="number" className={inputClass} value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} /></label>
        </div>

        <div className="space-y-2 rounded-btn bg-accent-soft p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-accent">景品と排出率（0.01%単位）</span>
            <Button variant="secondary" size="sm" onClick={() => setItems([...items, { reward_id: '', percent: '' }])} icon={<Plus size={12} aria-hidden />}>追加</Button>
          </div>
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <select className={`${inputClass} flex-1`} value={item.reward_id} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, reward_id: e.target.value } : row))}>
                <option value="">景品を選択</option>
                {selectableRewards.map(reward => (
                  <option key={reward.id} value={reward.id}>{reward.name}{reward.kind === 'digital' ? '（DL）' : ''}{reward.stock !== null ? `（在庫${reward.stock}）` : ''}</option>
                ))}
              </select>
              <div className="relative w-28">
                <input type="number" min={0.01} max={100} step={0.01} className={`${inputClass} pr-7`} value={item.percent} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, percent: e.target.value } : row))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
              </div>
              <IconButton size="sm" label="この景品の行を削除" onClick={() => setItems(items.filter((_, i) => i !== index))} className="hover:text-rose-600"><Trash2 size={15} aria-hidden /></IconButton>
            </div>
          ))}
          <div className={`flex items-center justify-between rounded-btn px-3 py-2 text-xs font-bold ${missWeight < 0 ? 'bg-rose-100 text-rose-700' : 'bg-surface text-slate-600'}`}>
            <span>はずれ（自動計算）</span>
            <span>{missWeight < 0 ? `合計が${formatPercent(-missWeight)}超過しています` : formatPercent(missWeight)}</span>
          </div>
          <p className="text-xs font-medium text-slate-600">在庫切れ・停止中の景品が当たった場合は「はずれ」になります。生徒画面には排出率を表示します。</p>
        </div>

        <Button type="submit" fullWidth disabled={missWeight < 0} loading={submitting} icon={<Check size={16} aria-hidden />}>
          {form.id ? '更新する' : '作成する'}
        </Button>
      </form>

      <div className="space-y-4 lg:col-span-7">
        {gachas.length === 0 && <EmptyState icon={Sparkles} title="まだガチャがありません" description="左のフォームから作成すると、ここに一覧で表示されます。" />}
        {gachas.map(gacha => (
          <article key={gacha.id} className={`rounded-card border bg-surface p-4 shadow-card ${gacha.active ? 'border-line' : 'border-slate-200 opacity-60'}`}>
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {gacha.image_url ? <img src={gacha.image_url} alt="" className="h-16 w-16 rounded-btn object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-btn bg-accent-soft text-accent"><Sparkles size={24} aria-hidden /></div>}
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-800">{gacha.name}{!gacha.active && <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-white">停止中</span>}</h3>
                <p className="flex items-center gap-1 text-xs font-bold text-amber-600"><Coins size={13} />1回 {gacha.cost.toLocaleString()} コイン{gacha.miss_refund_coins > 0 && <span className="text-slate-400">（はずれ時 {gacha.miss_refund_coins} 返却）</span>}</p>
                <p className="mt-1 text-xs font-medium text-slate-400">直近の実績：{gacha.recent_stats.draws}回中 {gacha.recent_stats.wins}回当たり</p>
              </div>
              <div className="flex gap-1">
                <IconButton variant="secondary" size="sm" label={`「${gacha.name}」を編集`} onClick={() => startEdit(gacha)}><Pencil size={15} aria-hidden /></IconButton>
                <IconButton variant="secondary" size="sm" label={gacha.active ? `「${gacha.name}」を停止` : `「${gacha.name}」を再公開`} onClick={() => toggleActive(gacha)}>{gacha.active ? <Archive size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}</IconButton>
              </div>
            </div>
            <table className="mt-3 w-full text-left text-xs">
              <thead><tr className="text-slate-400"><th className="py-1 font-bold">景品</th><th className="py-1 text-right font-bold">設定</th><th className="py-1 text-right font-bold">実績</th></tr></thead>
              <tbody className="font-bold text-slate-600">
                {gacha.items.map(item => {
                  const reward = rewardById.get(item.reward_id);
                  const unavailable = !reward || !reward.active || (reward.stock !== null && reward.stock <= 0);
                  const hits = gacha.recent_stats.byReward[item.reward_id] || 0;
                  return (
                    <tr key={item.reward_id} className="border-t border-slate-50">
                      <td className="py-1">{reward?.name || '削除された景品'}{unavailable && <span className="ml-1 text-rose-500">（在庫切れ・停止中→はずれ扱い）</span>}</td>
                      <td className="py-1 text-right">{formatPercent(item.weight)}</td>
                      <td className="py-1 text-right text-slate-400">{gacha.recent_stats.draws ? `${hits}回` : '-'}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-50 text-slate-400"><td className="py-1">はずれ</td><td className="py-1 text-right">{formatPercent(gacha.miss_weight)}</td><td className="py-1 text-right">{gacha.recent_stats.draws ? `${gacha.recent_stats.draws - gacha.recent_stats.wins}回` : '-'}</td></tr>
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </div>
  );
}
