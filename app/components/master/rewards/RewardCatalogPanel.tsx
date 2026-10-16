'use client';

import { useRef, useState } from 'react';
import { Archive, Check, Coins, Download, Image as ImageIcon, Loader2, Package, Pencil, RotateCcw, X } from 'lucide-react';
import { DIGITAL_FILE_MAX_BYTES, MANUAL_REWARD_KINDS, REWARD_KIND_LABELS, type RewardKind } from '@/lib/rewards';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import PresetRewardAdder from './PresetRewardAdder';
import { adminApi, inputClass, labelClass, type AdminReward } from './api';

type Props = { rewards: AdminReward[]; onChanged: () => Promise<void> };

const emptyForm = { id: '', name: '', description: '', required_coins: '', kind: 'physical' as RewardKind, stock: '', exchangeable: true, preset_id: '' };

export default function RewardCatalogPanel({ rewards, onChanged }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setForm(emptyForm);
    setImageFile(null);
    setPreviewUrl('');
    setDigitalFile(null);
    setCurrentFileName('');
    if (imageInput.current) imageInput.current.value = '';
    if (fileInput.current) fileInput.current.value = '';
  };

  const startEdit = (reward: AdminReward) => {
    setForm({
      id: reward.id, name: reward.name, description: reward.description, required_coins: String(reward.required_coins),
      kind: reward.kind, stock: reward.stock === null ? '' : String(reward.stock), exchangeable: reward.exchangeable,
      preset_id: reward.preset_id,
    });
    setImageFile(null);
    setPreviewUrl(reward.image_url);
    setDigitalFile(null);
    setCurrentFileName(reward.digital_file_name);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (digitalFile && digitalFile.size > DIGITAL_FILE_MAX_BYTES) return setMessage('ダウンロードファイルは4MB以内にしてください');
    setSubmitting(true);
    setMessage('');
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.set(key, String(value)));
      if (imageFile) body.set('image', imageFile);
      if (digitalFile) body.set('digital_file', digitalFile);
      await adminApi('/api/admin/rewards', { body });
      setMessage(form.id ? '景品を更新しました' : '景品を登録しました');
      reset();
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存できませんでした');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (reward: AdminReward) => {
    if (!confirm(reward.active ? 'この景品の公開を停止しますか？（交換済みの記録は残ります）' : 'この景品を再公開しますか？')) return;
    try {
      await adminApi('/api/admin/rewards', { method: 'PATCH', body: { id: reward.id, active: !reward.active } });
      await onChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新できませんでした');
    }
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <form onSubmit={submit} className="space-y-4 rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm lg:col-span-4">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-slate-800">{form.id ? '景品を編集' : '景品を登録'}</h2>
          {form.id && <button type="button" onClick={reset} className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-700"><X size={14} />編集をやめる</button>}
        </div>

        <div hidden={Boolean(form.preset_id)}>
          <span className={labelClass}>画像{form.id ? '（変更する時だけ選択）' : ''}</span>
          <button type="button" onClick={() => imageInput.current?.click()} className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-center text-xs font-bold text-slate-400"><ImageIcon className="mx-auto mb-1" />JPEG・PNG・WebP（4MBまで）</span>}
          </button>
          <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
            const file = event.target.files?.[0] || null;
            setImageFile(file);
            if (file) setPreviewUrl(URL.createObjectURL(file));
          }} />
        </div>

        <label className="block"><span className={labelClass}>景品名</span><input className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} required /></label>
        <label className="block"><span className={labelClass}>説明（生徒に表示）</span><textarea className={`${inputClass} min-h-20`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={1000} /></label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={labelClass}>交換に必要なコイン</span><input type="number" min={1} className={inputClass} value={form.required_coins} onChange={e => setForm({ ...form, required_coins: e.target.value })} required /></label>
          <label className="block"><span className={labelClass}>在庫（空欄で無制限）</span><input type="number" min={0} className={inputClass} value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} placeholder="無制限" /></label>
        </div>

        <div>
          <span className={labelClass}>種類</span>
          <div className="grid grid-cols-2 gap-2">
            {(form.preset_id ? [form.kind] : MANUAL_REWARD_KINDS).map(kind => (
              <button type="button" key={kind} onClick={() => setForm({ ...form, kind })} className={`rounded-xl border-2 px-2 py-2 text-xs font-black ${form.kind === kind ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-100 text-slate-500'}`}>{REWARD_KIND_LABELS[kind]}</button>
            ))}
          </div>
        </div>

        {form.preset_id && <p className="rounded-2xl bg-violet-50 p-3 text-[11px] font-bold text-violet-700">アプリ内で描画する景品です（画像・ファイルの登録は不要）。名前・説明・コイン・在庫・交換所への表示を変更できます。</p>}
        {form.kind === 'digital' && !form.preset_id && (
          <div className="rounded-2xl bg-sky-50 p-3">
            <span className={labelClass}>ダウンロードさせるファイル（PDF・画像・ZIP・MP3、4MBまで）</span>
            {currentFileName && !digitalFile && <p className="mb-2 text-xs font-bold text-sky-700">登録済み：{currentFileName}</p>}
            <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.mp3" className="block w-full text-xs font-bold" onChange={e => setDigitalFile(e.target.files?.[0] || null)} />
            <p className="mt-2 text-[11px] font-bold text-sky-700">受け取った生徒だけが、5分間有効なリンクからダウンロードできます。</p>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" checked={form.exchangeable} onChange={e => setForm({ ...form, exchangeable: e.target.checked })} />
          交換所に並べる（外すとガチャ専用の景品になります）
        </label>

        {message && <p className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">{message}</p>}
        <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-50">
          {submitting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}{form.id ? '更新する' : '登録する'}
        </button>
      </form>

      <div className="lg:col-span-8">
        <PresetRewardAdder rewards={rewards} onChanged={onChanged} />
        {rewards.length === 0 ? (
          <div className="rounded-[28px] border-4 border-dashed border-slate-100 bg-white py-20 text-center font-bold text-slate-300"><Package className="mx-auto mb-2" size={40} />まだ景品がありません</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rewards.map(reward => (
              <article key={reward.id} className={`flex flex-col overflow-hidden rounded-[24px] border bg-white shadow-sm ${reward.active ? 'border-slate-100' : 'border-slate-200 opacity-60'}`}>
                <div className="relative aspect-[4/3] bg-slate-50">
                  <RewardVisual presetId={reward.preset_id} imageUrl={reward.image_url} className="h-full w-full" />
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    {reward.kind === 'cosmetic' && <span className="rounded-full bg-fuchsia-600 px-2 py-0.5 text-[10px] font-black text-white">きせかえ</span>}
                    {reward.kind === 'digital' && <span className="flex items-center gap-1 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white"><Download size={10} />DL</span>}
                    {!reward.exchangeable && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black text-white">ガチャ専用</span>}
                    {!reward.active && <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-black text-white">停止中</span>}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h3 className="line-clamp-2 font-black text-slate-800">{reward.name}</h3>
                  {reward.description && <p className="line-clamp-2 text-xs font-bold text-slate-400">{reward.description}</p>}
                  <div className="mt-auto flex items-center justify-between text-xs font-black">
                    <span className="flex items-center gap-1 text-amber-600"><Coins size={14} />{reward.required_coins.toLocaleString()}</span>
                    <span className={reward.stock !== null && reward.stock <= 0 ? 'text-rose-600' : 'text-slate-500'}>在庫 {reward.stock === null ? '無制限' : reward.stock}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => startEdit(reward)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 py-2 text-xs font-black text-slate-600 hover:bg-slate-200"><Pencil size={13} />編集</button>
                    <button onClick={() => toggleActive(reward)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 py-2 text-xs font-black text-slate-600 hover:bg-slate-200">{reward.active ? <><Archive size={13} />停止</> : <><RotateCcw size={13} />再公開</>}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
