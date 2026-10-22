'use client';

import { useEffect, useState } from 'react';

export type WeeklyBarPoint = {
  key: string;
  /** 軸に出す短いラベル（例：10/13、今週） */
  label: string;
  /** 読み上げ用の週の説明（例：10月13日からの週） */
  description: string;
  /** null は「記録がない週」（0 とは区別する） */
  value: number | null;
  current?: boolean;
};

const WIDTH = 320;
const HEIGHT = 150;
const TOP = 18;
const BOTTOM = 26;
const CHART_HEIGHT = HEIGHT - TOP - BOTTOM;

/**
 * 週ごとの小さな棒グラフ（グラフ用ライブラリは使わない）。
 * 色は生徒のテーマの差し色（text-accent → currentColor）。動きを減らす設定のときは伸びるアニメーションを止める。
 */
export default function WeeklyBars({ title, unit, points }: { title: string; unit: string; points: WeeklyBarPoint[] }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const max = Math.max(1, ...points.map(point => point.value || 0));
  const slot = WIDTH / Math.max(1, points.length);
  const barWidth = Math.min(26, slot * 0.6);
  const summary = points
    .map(point => `${point.description}：${point.value === null ? '記録なし' : `${point.value}${unit}`}`)
    .join('、');

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}。${summary}`}
      >
        <line x1={0} x2={WIDTH} y1={TOP + CHART_HEIGHT} y2={TOP + CHART_HEIGHT} className="stroke-line" strokeWidth={1} />
        {points.map((point, index) => {
          const center = slot * index + slot / 2;
          const value = point.value || 0;
          const height = point.value === null ? 0 : Math.max(value > 0 ? 4 : 0, (value / max) * CHART_HEIGHT);
          const y = TOP + CHART_HEIGHT - height;
          return (
            <g key={point.key}>
              {height > 0 && (
                <rect
                  x={center - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={5}
                  className={`text-accent motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out ${point.current ? '' : 'opacity-70'}`}
                  fill="currentColor"
                  style={{ transform: grown ? 'scaleY(1)' : 'scaleY(0)', transformBox: 'fill-box', transformOrigin: 'bottom' }}
                />
              )}
              <text
                x={center}
                y={(point.value === null || height === 0 ? TOP + CHART_HEIGHT : y) - 5}
                textAnchor="middle"
                className={point.value === null ? 'fill-fg-muted' : 'fill-fg'}
                fontSize={11}
                fontWeight={700}
              >
                {point.value === null ? '—' : point.value}
              </text>
              <text
                x={center}
                y={HEIGHT - 8}
                textAnchor="middle"
                className={point.current ? 'fill-accent' : 'fill-fg-muted'}
                fontSize={11}
                fontWeight={point.current ? 700 : 400}
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
