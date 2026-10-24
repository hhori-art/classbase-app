'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react';
import { Button, buttonClass, useToast } from '@/app/components/ui';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import { REWARD_PRESET_CATEGORY_LABELS, REWARD_PRESETS, type RewardPreset, type RewardPresetCategory } from '@/lib/reward-presets';
import { adminApi, inputClass, type AdminReward } from './api';
import { userErrorMessage } from '@/lib/user-error';

type Props = { rewards: AdminReward[]; onChanged: () => Promise<void> };

const CATEGORY_ORDER: RewardPresetCategory[] = ['virtual_background', 'theme', 'pattern', 'title', 'frame', 'badge'];

/** 追加費用なしで用意できるデジタル景品を、ワンクリックで景品に登録する。 */
export default function PresetRewardAdder({ rewards, onChanged }: Props) {
  const [open, setOpen] = useState(rewards.every(reward => !reward.preset_id));
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const registered = new Set(rewards.map(reward => reward.preset_id).filter(Boolean));

  const add = async (presets: RewardPreset[]) => {
    const targets = presets.filter(preset => !registered.has(preset.id));
    if (targets.length === 0) return;
    setBusy(targets.length === 1 ? targets[0].id : targets[0].category);
    try {
      for (const preset of targets) {
        const body = new FormData();
        body.set('preset_id', preset.id);
        body.set('required_coins', costs[preset.id] || String(preset.defaultCost));
        body.set('exchangeable', 'true');
        await adminApi('/api/admin/rewards', { body });
      }
      toast.success(`${targets.length}件の景品を追加しました。交換所に並びます（ガチャの景品にも設定できます）。`);
      await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '追加できませんでした'));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="mb-6 rounded-card border border-line bg-surface p-5 shadow-card">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="flex items-center gap-2 font-bold text-slate-800"><Sparkles size={18} className="text-accent" aria-hidden />費用ゼロで出せるデジタル景品</span>
          <span className="mt-1 block text-xs font-medium text-slate-500">バーチャル背景・ホーム画面のきせかえ・称号・限定バッジを、画像の用意なしで追加できます。</span>
        </span>
        <ChevronDown className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          {CATEGORY_ORDER.map(category => {
            const presets = REWARD_PRESETS.filter(preset => preset.category === category);
            const remaining = presets.filter(preset => !registered.has(preset.id));
            return (
              <div key={category}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-700">{REWARD_PRESET_CATEGORY_LABELS[category]}</h3>
                  <Button variant="secondary" size="sm" disabled={remaining.length === 0 || Boolean(busy)} loading={busy === category} onClick={() => void add(presets)}
                    icon={<Plus size={12} aria-hidden />}>
                    未登録をまとめて追加（{remaining.length}）
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {presets.map(preset => {
                    const done = registered.has(preset.id);
                    return (
                      <div key={preset.id} className={`flex items-center gap-3 rounded-btn border bg-surface p-2 ${done ? 'border-line opacity-60' : 'border-accent/20'}`}>
                        <RewardVisual presetId={preset.id} compact className="h-12 w-12 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-800">{preset.name}</p>
                          <p className="truncate text-xs text-slate-400">{preset.description}</p>
                        </div>
                        {done ? (
                          <span className="shrink-0 text-xs font-bold text-slate-400">登録済み</span>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            <input type="number" min={1} aria-label={`${preset.name}の必要コイン`} className={`${inputClass} w-20 px-2 py-1.5 text-xs`}
                              value={costs[preset.id] ?? String(preset.defaultCost)} onChange={e => setCosts({ ...costs, [preset.id]: e.target.value })} />
                            <button type="button" disabled={Boolean(busy)} onClick={() => void add([preset])} className={buttonClass('primary', 'sm', 'w-9 px-0')} aria-label={`${preset.name}を追加`}>
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
