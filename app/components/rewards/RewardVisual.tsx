'use client';

import { useEffect, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import { findRewardPreset, presetTitleText } from '@/lib/reward-presets';
import { VirtualBackgroundArt, isVirtualBackgroundId } from '@/lib/virtual-backgrounds';
import { findBadge } from '@/lib/gamification';

const ART_WIDTH = 480;
const ART_HEIGHT = 270;

/** バーチャル背景を枠の幅に合わせて縮小表示する。 */
function ScaledBackground({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / ART_WIDTH || 0.5);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!isVirtualBackgroundId(id)) return null;
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg shadow-md" style={{ aspectRatio: '16 / 9' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }}>
        <VirtualBackgroundArt id={id} width={ART_WIDTH} height={ART_HEIGHT} />
      </div>
    </div>
  );
}

type Props = {
  presetId?: string | null;
  imageUrl?: string | null;
  alt?: string;
  /** 外枠（正方形などのサイズ指定）。 */
  className?: string;
  /** 小さい表示（リスト用）では文字を省く。 */
  compact?: boolean;
};

/** 景品の見た目。プリセット景品はアプリ内で描画し、それ以外は登録画像を表示する。 */
export default function RewardVisual({ presetId, imageUrl, alt = '', className = '', compact = false }: Props) {
  const preset = findRewardPreset(presetId);
  if (!preset) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-slate-50 ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imageUrl ? <img src={imageUrl} alt={alt} className="h-full w-full object-cover" /> : <Package className="text-slate-300" size={compact ? 18 : 36} />}
      </div>
    );
  }

  if (preset.category === 'virtual_background') {
    return (
      <div className={`flex items-center justify-center bg-slate-800 ${compact ? 'p-1' : 'p-3'} ${className}`}>
        <ScaledBackground id={preset.id} />
      </div>
    );
  }

  if (preset.category === 'theme') {
    return (
      <div className={`flex flex-col justify-end overflow-hidden ${className}`} style={{ background: preset.swatch }}>
        {!compact && (
          <div className="m-3 rounded-xl bg-white/85 p-2 shadow-sm">
            <div className="mb-1 h-1.5 w-2/3 rounded-full bg-slate-200" />
            <div className="h-1.5 w-1/2 rounded-full bg-slate-200" />
          </div>
        )}
      </div>
    );
  }

  if (preset.category === 'pattern') {
    return <div className={`border border-slate-100 ${className}`} style={{ background: preset.swatch }} />;
  }

  if (preset.category === 'frame') {
    return (
      <div className={`flex items-center justify-center bg-slate-50 ${className}`}>
        <div className="rounded-2xl" style={{ background: preset.swatch, padding: compact ? 2 : 4 }}>
          <div className={`flex items-center justify-center rounded-[14px] bg-white ${compact ? 'h-7 w-7 text-base' : 'h-16 w-16 text-4xl'}`}>🎓</div>
        </div>
      </div>
    );
  }

  if (preset.category === 'title') {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 ${className}`}>
        <span className={`rounded-full bg-white/90 font-bold text-indigo-700 shadow ${compact ? 'px-1.5 text-[8px]' : 'px-3 py-1 text-sm'}`}>
          {compact ? '称号' : presetTitleText(preset.id)}
        </span>
      </div>
    );
  }

  const badge = findBadge(preset.id);
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-amber-50 to-violet-100 ${className}`}>
      <span className={compact ? 'text-xl' : 'text-6xl drop-shadow'}>{badge?.icon || preset.emoji}</span>
    </div>
  );
}
