'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import { REWARD_PRESET_CATEGORY_LABELS, REWARD_PRESETS, type RewardPreset, type RewardPresetCategory } from '@/lib/reward-presets';
import { adminApi, inputClass, type AdminReward } from './api';

type Props = { rewards: AdminReward[]; onChanged: () => Promise<void> };

const CATEGORY_ORDER: RewardPresetCategory[] = ['virtual_background', 'theme', 'pattern', 'title', 'frame', 'badge'];

/** 追加費用なしで用意できるデジタル景品を、ワンクリックで景品に登録する。 */
export default function PresetRewardAdder({ rewards, onChanged }: Props) {
  const [open, setOpen] = useState(rewards.every(reward => !reward.preset_id));
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const registered = new Set(rewards.map(reward => reward.preset_id).filter(Boolean));

  const add = async (presets: RewardPreset[]) => {
    const targets = presets.filter(preset => !registered.has(preset.id));
    if (targets.length === 0) return;
    setBusy(targets.length === 1 ? targets[0].id : targets[0].category);
    setMessage('');
    try {
      for (const preset of targets) {
        const body = new FormData();
        body.set('preset_id', preset.id);
        body.set('required_coins', costs[preset.id] || String(preset.defaultCost));
        body.set('exchangeable', 'true');
        await adminApi('/api/admin/rewards', { body });
      }
      setMessage(`${targets.length}件の景品を追加しました。交換所に並びます（ガチャの景品にも設定できます）。`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '追加できませんでした');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="mb-6 rounded-[28px] border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="flex items-center gap-2 font-black text-violet-900"><Sparkles size={18} />費用ゼロで出せるデジタル景品</span>
          <span className="mt-1 block text-xs font-bold text-violet-700/80">バーチャル背景・ホーム画面のきせかえ・称号・限定バッジを、画像の用意なしで追加できます。</span>
        </span>
        <ChevronDown className={`shrink-0 text-violet-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          {message && <p className="rounded-xl bg-white p-3 text-xs font-bold text-slate-600">{message}</p>}
          {CATEGORY_ORDER.map(category => {
            const presets = REWARD_PRESETS.filter(preset => preset.category === category);
            const remaining = presets.filter(preset => !registered.has(preset.id));
            return (
              <div key={category}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-slate-700">{REWARD_PRESET_CATEGORY_LABELS[category]}</h3>
                  <button type="button" disabled={remaining.length === 0 || Boolean(busy)} onClick={() => void add(presets)}
                    className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-black text-white disabled:opacity-40">
                    {busy === category ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />}未登録をまとめて追加（{remaining.length}）
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {presets.map(preset => {
                    const done = registered.has(preset.id);
                    return (
                      <div key={preset.id} className={`flex items-center gap-3 rounded-2xl border bg-white p-2 ${done ? 'border-slate-100 opacity-60' : 'border-violet-100'}`}>
                        <RewardVisual presetId={preset.id} compact className="h-12 w-12 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black text-slate-800">{preset.name}</p>
                          <p className="truncate text-[10px] font-bold text-slate-400">{preset.description}</p>
                        </div>
                        {done ? (
                          <span className="shrink-0 text-[10px] font-black text-slate-400">登録済み</span>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            <input type="number" min={1} aria-label={`${preset.name}の必要コイン`} className={`${inputClass} w-20 px-2 py-1.5 text-xs`}
                              value={costs[preset.id] ?? String(preset.defaultCost)} onChange={e => setCosts({ ...costs, [preset.id]: e.target.value })} />
                            <button type="button" disabled={Boolean(busy)} onClick={() => void add([preset])} className="rounded-lg bg-slate-900 p-2 text-white disabled:opacity-40" aria-label={`${preset.name}を追加`}>
                              {busy === preset.id ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
