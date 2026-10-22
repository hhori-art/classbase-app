'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Download, Package, X } from 'lucide-react';
import { GACHA_RATE_SCALE, type PublicGacha } from '@/lib/rewards';
import type { SoundEffectType } from '@/lib/sound';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import { findRewardPreset } from '@/lib/reward-presets';
import { Button } from '@/app/components/ui';

export type GachaDrawResult = {
  result: 'win' | 'miss';
  reward: { id: string; name: string; image_url: string; kind: 'digital' | 'physical' | 'cosmetic'; preset_id?: string } | null;
  refund: number;
  new_badges: string[];
};

type Tier = 'miss' | 'normal' | 'rare' | 'legendary';
type Stage = 'spin' | 'drop' | 'ready' | 'open' | 'reveal';

type Props = {
  gacha: PublicGacha;
  /** API の結果。null の間はマシンを回し続ける。 */
  result: GachaDrawResult | null;
  badgeText: string;
  play: (type: SoundEffectType) => void;
  onClose: () => void;
};

const TIER_LABEL: Record<Tier, string> = { miss: 'はずれ', normal: 'あたり！', rare: 'レア！', legendary: '超レア！！' };

/** 当たった景品の排出率から演出の豪華さを決める（5%以下は超レア、20%以下はレア）。 */
function tierOf(gacha: PublicGacha, result: GachaDrawResult): Tier {
  if (result.result !== 'win' || !result.reward) return 'miss';
  const weight = gacha.items.find(item => item.reward_id === result.reward!.id)?.weight ?? GACHA_RATE_SCALE;
  const rate = weight / GACHA_RATE_SCALE;
  if (rate <= 0.05) return 'legendary';
  if (rate <= 0.2) return 'rare';
  return 'normal';
}

const CAPSULE_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308'];

export default function GachaPerformance({ gacha, result, badgeText, play, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('spin');
  const [minSpinDone, setMinSpinDone] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const tier = result ? tierOf(gacha, result) : 'normal';
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // マシンを回す（最低1.8秒）。回転中はハンドル音を鳴らし続ける。
  useEffect(() => {
    if (reducedMotion) { setMinSpinDone(true); return; }
    play('gacha_spin');
    const interval = setInterval(() => play('gacha_spin'), 450);
    const timer = setTimeout(() => setMinSpinDone(true), 1800);
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [play, reducedMotion]);

  // 結果が届き最低回転時間を過ぎたら、カプセルを落とす。
  useEffect(() => {
    if (stage !== 'spin' || !result || !minSpinDone) return;
    if (reducedMotion) { setStage('reveal'); return; }
    setStage('drop');
    play('gacha_drop');
    // レア以上は落下後にカプセルが「昇格」して色が変わる。
    if (tier === 'rare' || tier === 'legendary') later(() => { setPromoted(true); play('gacha_open'); }, 900);
    later(() => setStage('ready'), tier === 'rare' || tier === 'legendary' ? 1700 : 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, result, minSpinDone]);

  // タップされなくても数秒で自動的に開ける。
  useEffect(() => {
    if (stage !== 'ready') return;
    const timer = setTimeout(() => openCapsule(), 4500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // 演出が終わってから結果の音を鳴らす。
  useEffect(() => {
    if (stage !== 'reveal' || !result) return;
    play(tier === 'legendary' ? 'gacha_legendary' : tier === 'rare' ? 'gacha_rare' : tier === 'normal' ? 'quest_cleared' : 'answer_incorrect');
    if (result.refund > 0) later(() => play('coin_acquired'), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const openCapsule = () => {
    if (stage !== 'ready') return;
    setStage('open');
    play('gacha_open');
    later(() => setStage('reveal'), tier === 'legendary' ? 1500 : tier === 'miss' ? 700 : 1100);
  };

  const skip = () => {
    if (!result) return;
    timers.current.forEach(clearTimeout);
    setPromoted(true);
    setStage('reveal');
  };

  const capsuleTier = stage === 'drop' && !promoted && (tier === 'rare' || tier === 'legendary') ? 'normal' : tier;

  const confetti = useMemo(() => Array.from({ length: tier === 'legendary' ? 90 : tier === 'rare' ? 60 : 36 }, (_, index) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2.2 + Math.random() * 1.8,
    color: CAPSULE_COLORS[index % CAPSULE_COLORS.length],
    size: 6 + Math.random() * 8,
    rotate: Math.random() * 360,
    round: Math.random() > 0.6,
  })), [tier]);

  const bouncingCapsules = useMemo(() => Array.from({ length: 14 }, (_, index) => ({
    left: 8 + ((index * 37) % 80),
    top: 30 + ((index * 53) % 55),
    color: CAPSULE_COLORS[index % CAPSULE_COLORS.length],
    delay: (index % 7) * 0.08,
  })), []);

  return (
    <div className={`gx-root gx-tier-${stage === 'reveal' || stage === 'open' ? tier : 'none'}`} role="dialog" aria-modal="true" aria-label={`${gacha.name}の結果`}>
      <style>{GACHA_CSS}</style>
      <div className="gx-backdrop" />
      {(stage === 'open' || stage === 'reveal') && tier !== 'miss' && <div className="gx-rays" />}
      {stage === 'open' && <div className="gx-flash" />}

      {result && stage !== 'reveal' && (
        <button type="button" onClick={skip} className="gx-skip">スキップ</button>
      )}

      {(stage === 'spin' || stage === 'drop' || stage === 'ready' || stage === 'open') && (
        <div className="gx-stage">
          <div className={`gx-machine ${stage === 'spin' ? 'gx-shake' : ''}`}>
            <div className="gx-dome">
              {bouncingCapsules.map((capsule, index) => (
                <span key={index} className={`gx-mini ${stage === 'spin' ? 'gx-mini-bounce' : ''}`}
                  style={{ left: `${capsule.left}%`, top: `${capsule.top}%`, background: capsule.color, animationDelay: `${capsule.delay}s` }} />
              ))}
              <div className="gx-shine" />
            </div>
            <div className="gx-body">
              <div className={`gx-handle ${stage === 'spin' ? 'gx-handle-turn' : ''}`}><span /></div>
              <div className="gx-outlet" />
              <p className="gx-name">{gacha.name}</p>
            </div>
          </div>

          {stage !== 'spin' && (
            <button type="button" onClick={openCapsule} disabled={stage !== 'ready'} aria-label="カプセルを開ける"
              className={`gx-capsule gx-capsule-${capsuleTier} ${stage === 'drop' ? 'gx-drop' : ''} ${stage === 'ready' ? 'gx-wobble' : ''} ${stage === 'open' ? 'gx-opening' : ''} ${promoted ? 'gx-promote' : ''}`}>
              <span className="gx-capsule-top" />
              <span className="gx-capsule-bottom" />
              <span className="gx-capsule-glow" />
            </button>
          )}

          <p className="gx-caption">
            {stage === 'spin' && 'ガチャガチャ…'}
            {stage === 'drop' && (promoted ? (tier === 'legendary' ? '虹色に光った…！？' : '金色に光った…！') : 'カプセルが出てきた！')}
            {stage === 'ready' && 'タップして開けよう！'}
            {stage === 'open' && (tier === 'miss' ? '…' : '！！')}
          </p>
        </div>
      )}

      {stage === 'reveal' && result && (
        <>
          {tier !== 'miss' && (
            <div className="gx-confetti" aria-hidden="true">
              {confetti.map((piece, index) => (
                <span key={index} style={{
                  left: `${piece.left}%`, width: piece.size, height: piece.round ? piece.size : piece.size * 0.45,
                  background: piece.color, borderRadius: piece.round ? '9999px' : '2px',
                  animationDelay: `${piece.delay}s`, animationDuration: `${piece.duration}s`, transform: `rotate(${piece.rotate}deg)`,
                }} />
              ))}
            </div>
          )}
          <div className={`gx-card gx-card-${tier}`}>
            <button type="button" onClick={onClose} className="gx-close" aria-label="閉じる" title="閉じる"><X size={18} aria-hidden /></button>
            <p className={`gx-tier-label gx-tier-label-${tier}`}>{TIER_LABEL[tier]}</p>
            {result.result === 'win' && result.reward ? (
              <>
                <div className="gx-prize">
                  {result.reward.preset_id ? (
                    <RewardVisual presetId={result.reward.preset_id} className="h-full w-full overflow-hidden rounded-hero" />
                  ) : result.reward.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.reward.image_url} alt="" />
                  ) : <Package size={64} className="text-slate-300" />}
                  {tier !== 'normal' && <span className="gx-sparkle gx-sparkle-1">✦</span>}
                  {tier !== 'normal' && <span className="gx-sparkle gx-sparkle-2">✦</span>}
                  {tier === 'legendary' && <span className="gx-sparkle gx-sparkle-3">✦</span>}
                </div>
                <h2 className="text-2xl font-black text-fg">{result.reward.name}</h2>
                <p className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-fg-muted">
                  {result.reward.kind === 'digital' ? <><Download size={13} aria-hidden />「もらった景品」からダウンロードできます</>
                    : result.reward.kind === 'cosmetic' ? (findRewardPreset(result.reward.preset_id)?.category === 'badge' ? 'トロフィーの「バッジ」から装備できます' : '設定画面の「見た目」から使えます')
                    : '先生からのお渡しを待ってね。「もらった景品」で状況を確認できます'}
                </p>
              </>
            ) : (
              <>
                <div className="my-4 text-6xl gx-float">🥚</div>
                <h2 className="text-xl font-black text-fg">ざんねん…また挑戦してね！</h2>
                {result.refund > 0 && (
                  <p className="gx-refund"><Coins size={16} aria-hidden />{result.refund}コインが戻ってきた！</p>
                )}
              </>
            )}
            {badgeText && <p className="mt-3 rounded-btn bg-accent-soft p-2 text-xs font-bold text-accent whitespace-pre-line">{badgeText}</p>}
            <Button onClick={onClose} size="lg" fullWidth className="mt-6 active:scale-95">閉じる</Button>
          </div>
        </>
      )}
    </div>
  );
}

const GACHA_CSS = `
.gx-root { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; overflow: hidden; }
.gx-backdrop { position: absolute; inset: 0; background: radial-gradient(circle at 50% 40%, #312e81 0%, #0f172a 70%); }
.gx-tier-rare .gx-backdrop { background: radial-gradient(circle at 50% 40%, #92400e 0%, #1c1917 70%); }
.gx-tier-legendary .gx-backdrop { background: radial-gradient(circle at 50% 40%, #7e22ce 0%, #0f172a 75%); animation: gx-hue 3s linear infinite; }
.gx-tier-miss .gx-backdrop { background: radial-gradient(circle at 50% 40%, #334155 0%, #0f172a 70%); }
.gx-skip { position: absolute; top: calc(16px + env(safe-area-inset-top, 0px)); right: 16px; z-index: 5; min-height: 44px; border-radius: 9999px; background: rgba(255,255,255,.15); color: #fff; font-weight: 700; font-size: 13px; padding: 8px 16px; }
.gx-stage { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; }
.gx-machine { width: 220px; display: flex; flex-direction: column; align-items: center; }
.gx-dome { position: relative; width: 200px; height: 170px; border-radius: 100px 100px 24px 24px; background: rgba(255,255,255,.12); border: 6px solid rgba(255,255,255,.55); overflow: hidden; box-shadow: inset 0 -20px 40px rgba(0,0,0,.25); }
.gx-shine { position: absolute; left: 22px; top: 18px; width: 34px; height: 70px; border-radius: 9999px; background: rgba(255,255,255,.35); transform: rotate(18deg); }
.gx-mini { position: absolute; width: 30px; height: 30px; border-radius: 9999px; box-shadow: inset -4px -6px 0 rgba(0,0,0,.18), inset 4px 4px 0 rgba(255,255,255,.35); }
.gx-mini::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: rgba(255,255,255,.7); }
.gx-mini-bounce { animation: gx-bounce .38s ease-in-out infinite alternate; }
.gx-body { position: relative; margin-top: -6px; width: 220px; height: 120px; border-radius: 18px 18px 28px 28px; background: linear-gradient(180deg, #ef4444, #b91c1c); box-shadow: 0 16px 40px rgba(0,0,0,.4), inset 0 -10px 0 rgba(0,0,0,.18); }
.gx-handle { position: absolute; left: 24px; top: 24px; width: 54px; height: 54px; border-radius: 9999px; background: #fde68a; border: 5px solid #f59e0b; }
.gx-handle span { position: absolute; left: 50%; top: 4px; width: 10px; height: 36px; margin-left: -5px; border-radius: 6px; background: #f59e0b; }
.gx-handle-turn { animation: gx-turn .9s cubic-bezier(.5,.1,.3,1) infinite; }
.gx-outlet { position: absolute; right: 26px; top: 30px; width: 64px; height: 46px; border-radius: 12px; background: #450a0a; box-shadow: inset 0 6px 10px rgba(0,0,0,.6); }
.gx-name { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; color: #fff; font-weight: 900; font-size: 13px; letter-spacing: .05em; }
.gx-shake { animation: gx-shake .18s linear infinite; }
.gx-caption { margin-top: 24px; min-height: 28px; color: #fff; font-size: 20px; font-weight: 900; text-shadow: 0 2px 12px rgba(0,0,0,.5); animation: gx-pulse 1s ease-in-out infinite; }
.gx-capsule { position: relative; margin-top: 18px; width: 112px; height: 112px; border-radius: 9999px; transition: transform .2s; cursor: pointer; filter: drop-shadow(0 12px 18px rgba(0,0,0,.45)); }
.gx-capsule:disabled { cursor: default; }
.gx-capsule-top, .gx-capsule-bottom { position: absolute; left: 0; right: 0; height: 50%; transition: transform .6s cubic-bezier(.2,.9,.3,1.3), opacity .6s; }
.gx-capsule-top { top: 0; border-radius: 9999px 9999px 0 0; background: var(--gx-top); box-shadow: inset 8px 10px 0 rgba(255,255,255,.35); }
.gx-capsule-bottom { bottom: 0; border-radius: 0 0 9999px 9999px; background: #f8fafc; box-shadow: inset -6px -10px 0 rgba(0,0,0,.12); border-top: 4px solid rgba(0,0,0,.12); }
.gx-capsule-glow { position: absolute; inset: -46px; z-index: -1; border-radius: 9999px; opacity: 0; pointer-events: none; }
.gx-capsule-miss { --gx-top: linear-gradient(135deg, #94a3b8, #64748b); }
.gx-capsule-normal { --gx-top: linear-gradient(135deg, #60a5fa, #2563eb); }
.gx-capsule-rare { --gx-top: linear-gradient(135deg, #fde047, #f59e0b 60%, #b45309); }
.gx-capsule-rare .gx-capsule-glow { opacity: 1; background: radial-gradient(circle, rgba(250,204,21,.85) 0%, rgba(250,204,21,.35) 45%, transparent 70%); animation: gx-pulse 1s ease-in-out infinite; }
.gx-capsule-legendary { --gx-top: linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e); }
.gx-capsule-legendary .gx-capsule-top { background-size: 300% 100%; animation: gx-rainbow 1.2s linear infinite; }
.gx-capsule-legendary .gx-capsule-glow { opacity: 1; background: radial-gradient(circle, rgba(250,204,21,.7) 0%, rgba(217,70,239,.6) 40%, transparent 70%); animation: gx-pulse .7s ease-in-out infinite; }
.gx-drop { animation: gx-drop .9s cubic-bezier(.3,.7,.4,1.4) both; }
.gx-promote { animation: gx-promote .6s ease-out; }
.gx-wobble { animation: gx-wobble .9s ease-in-out infinite; }
.gx-wobble:hover { transform: scale(1.06); }
.gx-opening .gx-capsule-top { transform: translateY(-70px) rotate(-28deg); opacity: 0; }
.gx-opening .gx-capsule-bottom { transform: translateY(60px) rotate(18deg); opacity: 0; }
.gx-flash { position: absolute; inset: 0; z-index: 3; background: #fff; animation: gx-flash .8s ease-out forwards; pointer-events: none; }
.gx-tier-miss .gx-flash { background: #cbd5e1; }
.gx-rays { position: absolute; left: 50%; top: 50%; width: 160vmax; height: 160vmax; margin: -80vmax 0 0 -80vmax; z-index: 1; opacity: .35; background: repeating-conic-gradient(rgba(255,255,255,.9) 0deg 8deg, transparent 8deg 22deg); animation: gx-spin 14s linear infinite; pointer-events: none; }
.gx-tier-rare .gx-rays { background: repeating-conic-gradient(rgba(253,224,71,.95) 0deg 8deg, transparent 8deg 22deg); opacity: .45; }
.gx-tier-legendary .gx-rays { background: repeating-conic-gradient(#f43f5e 0deg 6deg, transparent 6deg 15deg, #f59e0b 15deg 21deg, transparent 21deg 30deg, #22c55e 30deg 36deg, transparent 36deg 45deg, #3b82f6 45deg 51deg, transparent 51deg 60deg, #a855f7 60deg 66deg, transparent 66deg 75deg); opacity: .5; animation-duration: 8s; }
.gx-confetti { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
.gx-confetti span { position: absolute; top: -20px; animation-name: gx-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
.gx-card { position: relative; z-index: 4; width: 100%; max-width: 360px; border-radius: 32px; background: #fff; padding: 28px 24px 24px; text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,.5); animation: gx-pop .6s cubic-bezier(.2,.9,.3,1.4) both; }
.gx-card-rare { box-shadow: 0 0 0 4px #facc15, 0 0 60px rgba(250,204,21,.6), 0 30px 80px rgba(0,0,0,.5); }
.gx-card-legendary { box-shadow: 0 0 0 4px #e879f9, 0 0 80px rgba(217,70,239,.7), 0 30px 80px rgba(0,0,0,.5); }
.gx-close { position: absolute; right: 10px; top: 10px; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 9999px; color: #94a3b8; }
.gx-close:hover { background: #f1f5f9; color: #475569; }
.gx-tier-label { display: inline-block; border-radius: 9999px; padding: 4px 14px; font-weight: 900; font-size: 15px; letter-spacing: .08em; }
.gx-tier-label-miss { background: #f1f5f9; color: #64748b; }
.gx-tier-label-normal { background: #dbeafe; color: #1d4ed8; }
.gx-tier-label-rare { background: linear-gradient(90deg, #fde047, #f59e0b); color: #78350f; animation: gx-pulse 1.2s ease-in-out infinite; }
.gx-tier-label-legendary { background: linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7); background-size: 300% 100%; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.4); animation: gx-rainbow 1.5s linear infinite; font-size: 18px; }
.gx-prize { position: relative; margin: 18px auto; width: 168px; height: 168px; display: flex; align-items: center; justify-content: center; border-radius: 28px; background: #f8fafc; animation: gx-float 2.4s ease-in-out infinite; }
.gx-prize img { width: 100%; height: 100%; object-fit: cover; border-radius: 28px; box-shadow: 0 12px 30px rgba(15,23,42,.25); }
.gx-card-legendary .gx-prize img { animation: gx-glow 1.6s ease-in-out infinite; }
.gx-sparkle { position: absolute; color: #facc15; font-size: 26px; animation: gx-twinkle 1.2s ease-in-out infinite; text-shadow: 0 0 10px rgba(250,204,21,.9); }
.gx-sparkle-1 { left: -14px; top: 6px; }
.gx-sparkle-2 { right: -12px; top: 40px; animation-delay: .4s; }
.gx-sparkle-3 { left: 40px; bottom: -16px; animation-delay: .8s; color: #e879f9; }
.gx-float { animation: gx-float 2.4s ease-in-out infinite; }
.gx-refund { margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 9999px; background: #fef3c7; padding: 6px 14px; color: #b45309; font-size: 14px; font-weight: 900; animation: gx-pop .5s .5s cubic-bezier(.2,.9,.3,1.4) both; }
@keyframes gx-bounce { from { transform: translateY(0) rotate(0); } to { transform: translateY(-26px) rotate(40deg); } }
@keyframes gx-turn { from { transform: rotate(0); } to { transform: rotate(360deg); } }
@keyframes gx-shake { 0%,100% { transform: translateX(0) rotate(0); } 25% { transform: translateX(-3px) rotate(-1deg); } 75% { transform: translateX(3px) rotate(1deg); } }
@keyframes gx-drop { 0% { transform: translateY(-120px) scale(.5); opacity: 0; } 55% { transform: translateY(40px) scale(1); opacity: 1; } 75% { transform: translateY(-14px); } 100% { transform: translateY(0); } }
@keyframes gx-promote { 0% { transform: scale(1); filter: brightness(1); } 40% { transform: scale(1.3); filter: brightness(2.2); } 100% { transform: scale(1); filter: brightness(1); } }
@keyframes gx-wobble { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-9deg); } 40% { transform: rotate(8deg); } 60% { transform: rotate(-5deg); } 80% { transform: rotate(3deg); } }
@keyframes gx-flash { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
@keyframes gx-spin { to { transform: rotate(360deg); } }
@keyframes gx-fall { 0% { transform: translateY(-20px) rotate(0); opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: .9; } }
@keyframes gx-pop { 0% { transform: scale(.3) translateY(40px); opacity: 0; } 100% { transform: scale(1) translateY(0); opacity: 1; } }
@keyframes gx-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .75; transform: scale(1.04); } }
@keyframes gx-rainbow { to { background-position: 300% 0; } }
@keyframes gx-hue { to { filter: hue-rotate(360deg); } }
@keyframes gx-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes gx-glow { 0%,100% { box-shadow: 0 0 20px 4px rgba(232,121,249,.6); } 50% { box-shadow: 0 0 44px 14px rgba(250,204,21,.8); } }
@keyframes gx-twinkle { 0%,100% { transform: scale(.6) rotate(0); opacity: .4; } 50% { transform: scale(1.3) rotate(45deg); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .gx-root *, .gx-root *::before, .gx-root *::after { animation: none !important; transition: none !important; }
}
`;
