import type { CSSProperties, ReactElement } from 'react';

// オンライン授業（Zoom等）用のバーチャル背景。
// 画像ファイルを持たず、div とグラデーションだけで描く。同じ部品を
// ブラウザのプレビューと、サーバーの PNG 生成（next/og）の両方で使うため、
// 子要素を複数持つ要素には display:flex を付け、filter などは使わない。

import type { VirtualBackgroundId } from '@/lib/virtual-background-ids';

export { isVirtualBackgroundId, VIRTUAL_BACKGROUND_IDS, type VirtualBackgroundId } from '@/lib/virtual-background-ids';

/** 再現性のある疑似乱数（同じ背景は毎回同じ配置で描く）。 */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type Shape = CSSProperties & { key?: string };

// next/og（Satori）は値が undefined のスタイルで落ちるため取り除く。
/** ぼんやり光る円。正方形の枠内でグラデーションを消し、端に境目が出ないようにする。 */
const glow = (left: number, top: number, size: number, color: string): CSSProperties => ({
  position: 'absolute', display: 'flex', left, top, width: size, height: size,
  // 透明側も同じ色にしないと、境目に白っぽい輪が出る。
  background: `radial-gradient(circle, ${color} 0%, ${color.replace(/[\d.]+\)$/, '0)')} 50%)`,
});

const abs = (style: CSSProperties): CSSProperties => Object.fromEntries(
  Object.entries({ position: 'absolute', display: 'flex', ...style }).filter(([, value]) => value !== undefined),
) as CSSProperties;

function shapesFor(id: VirtualBackgroundId, w: number, h: number): { background: string; shapes: Shape[] } {
  const u = w / 100;
  const rand = seeded(id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0));
  switch (id) {
    case 'vb_aurora':
      return {
        background: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 45%, #0e7490 100%)',
        shapes: [
          glow(-12 * u, -24 * u, 72 * u, 'rgba(52,211,153,0.6)'),
          glow(42 * u, -20 * u, 78 * u, 'rgba(244,114,182,0.5)'),
          glow(18 * u, 8 * u, 76 * u, 'rgba(96,165,250,0.4)'),
          ...Array.from({ length: 40 }, () => {
            const size = 0.15 * u + rand() * 0.25 * u;
            return abs({ left: rand() * w, top: rand() * h * 0.6, width: size, height: size, borderRadius: 9999, background: '#ffffff', opacity: 0.4 + rand() * 0.5 });
          }),
        ],
      };
    case 'vb_space':
      return {
        background: 'radial-gradient(circle at 70% 30%, #1e3a8a 0%, #0f172a 45%, #020617 100%)',
        shapes: [
          ...Array.from({ length: 140 }, () => {
            const size = 0.1 * u + rand() * 0.3 * u;
            return abs({ left: rand() * w, top: rand() * h, width: size, height: size, borderRadius: 9999, background: '#ffffff', opacity: 0.3 + rand() * 0.7 });
          }),
          abs({ left: 68 * u, top: 6 * u, width: 22 * u, height: 22 * u, borderRadius: 9999, background: 'radial-gradient(circle at 35% 35%, #fde68a 0%, #f59e0b 45%, #b45309 100%)', boxShadow: `0 0 ${4 * u}px rgba(251,191,36,0.45)` }),
          abs({ left: 63 * u, top: 15 * u, width: 32 * u, height: 4.5 * u, borderRadius: 9999, border: `${0.5 * u}px solid rgba(253,230,138,0.75)`, transform: 'rotate(-16deg)' }),
          abs({ left: 8 * u, top: 38 * u, width: 7 * u, height: 7 * u, borderRadius: 9999, background: 'radial-gradient(circle at 35% 35%, #a5f3fc 0%, #0891b2 60%, #164e63 100%)' }),
        ],
      };
    case 'vb_sakura':
      return {
        background: 'linear-gradient(180deg, #e0f2fe 0%, #fdf2f8 55%, #fbcfe8 100%)',
        shapes: [
          glow(-14 * u, 22 * u, 48 * u, 'rgba(249,168,212,0.8)'),
          glow(68 * u, -14 * u, 50 * u, 'rgba(244,114,182,0.6)'),
          ...Array.from({ length: 60 }, () => {
            const size = 0.8 * u + rand() * 1.4 * u;
            return abs({ left: rand() * w, top: rand() * h, width: size, height: size * 0.75, borderRadius: '70% 0 70% 0', background: rand() > 0.5 ? '#f9a8d4' : '#fbcfe8', opacity: 0.7 + rand() * 0.3, transform: `rotate(${Math.round(rand() * 360)}deg)` });
          }),
        ],
      };
    case 'vb_ocean':
      return {
        background: 'linear-gradient(180deg, #7dd3fc 0%, #bae6fd 38%, #0ea5e9 40%, #0369a1 75%, #0c4a6e 100%)',
        shapes: [
          abs({ left: 74 * u, top: 6 * u, width: 12 * u, height: 12 * u, borderRadius: 9999, background: 'radial-gradient(circle, #fef9c3 0%, #fde047 60%, rgba(253,224,71,0) 72%)' }),
          // 水平線付近のきらめき（奥ほど細く短い）
          ...Array.from({ length: 26 }, (_, index) => {
            const depth = index / 26;
            return abs({ left: rand() * w - 4 * u, top: h * (0.41 + depth * 0.5), width: (3 + depth * 9) * u, height: Math.max(2, (0.15 + depth * 0.35) * u), borderRadius: 9999, background: `rgba(255,255,255,${0.45 - depth * 0.25})` });
          }),
          ...Array.from({ length: 36 }, () => {
            const size = 0.4 * u + rand() * 1.4 * u;
            return abs({ left: rand() * w, top: h * 0.5 + rand() * h * 0.5, width: size, height: size, borderRadius: 9999, border: `${Math.max(1, 0.12 * u)}px solid rgba(255,255,255,0.55)` });
          }),
        ],
      };
    case 'vb_chalkboard':
      return {
        background: 'linear-gradient(180deg, #92400e 0%, #78350f 100%)',
        shapes: [
          abs({ left: 3 * u, top: 3 * u, width: w - 6 * u, height: h - 9 * u, borderRadius: 1 * u, background: 'radial-gradient(circle at 50% 40%, #166534 0%, #14532d 60%, #052e16 100%)', boxShadow: `inset 0 0 ${3 * u}px rgba(0,0,0,0.5)` }),
          abs({ left: 3 * u, top: h - 6.5 * u, width: w - 6 * u, height: 1.6 * u, borderRadius: 0.4 * u, background: '#a16207' }),
          abs({ left: 70 * u, top: h - 8.2 * u, width: 6 * u, height: 1 * u, borderRadius: 9999, background: '#f8fafc' }),
          abs({ left: 78 * u, top: h - 8.2 * u, width: 4 * u, height: 1 * u, borderRadius: 9999, background: '#fde047' }),
          abs({ left: 84 * u, top: h - 8.2 * u, width: 5 * u, height: 1 * u, borderRadius: 9999, background: '#f9a8d4' }),
          abs({ left: 10 * u, top: 10 * u, width: 12 * u, height: 12 * u, borderRadius: 9999, border: `${0.35 * u}px solid rgba(255,255,255,0.55)` }),
          abs({ left: 14 * u, top: 14 * u, width: 18 * u, height: 0.35 * u, background: 'rgba(255,255,255,0.5)', transform: 'rotate(-20deg)' }),
          abs({ left: 74 * u, top: 12 * u, width: 14 * u, height: 9 * u, border: `${0.35 * u}px solid rgba(254,240,138,0.6)`, transform: 'rotate(8deg)' }),
          ...Array.from({ length: 5 }, (_, index) => abs({ left: 30 * u + index * 5 * u, top: 40 * u + (index % 2) * 2 * u, width: 3 * u, height: 3 * u, borderRadius: 9999, border: `${0.3 * u}px solid rgba(255,255,255,0.4)` })),
        ],
      };
    case 'vb_library': {
      const shelves = [0.18, 0.43, 0.68].map(ratio => ratio * h);
      const books: Shape[] = [];
      shelves.forEach(shelfTop => {
        let x = 4 * u;
        while (x < w - 6 * u) {
          const bookWidth = 1.4 * u + rand() * 1.8 * u;
          const bookHeight = 11 * u + rand() * 5 * u;
          const palette = ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#7c3aed', '#be185d', '#0f766e', '#374151'];
          books.push(abs({ left: x, top: shelfTop + 16 * u - bookHeight, width: bookWidth, height: bookHeight, borderRadius: 0.3 * u, background: palette[Math.floor(rand() * palette.length)], boxShadow: `inset -${0.3 * u}px 0 0 rgba(0,0,0,0.25)` }));
          x += bookWidth + 0.25 * u + (rand() > 0.9 ? 3 * u : 0);
        }
      });
      return {
        background: 'linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)',
        shapes: [
          abs({ left: 2 * u, top: 0, width: w - 4 * u, height: h, background: '#78350f' }),
          abs({ left: 3.5 * u, top: 1.5 * u, width: w - 7 * u, height: h - 3 * u, background: 'linear-gradient(180deg, #451a03 0%, #78350f 100%)' }),
          ...books,
          ...shelves.map(top => abs({ left: 2 * u, top: top + 16 * u, width: w - 4 * u, height: 1.6 * u, background: '#92400e', boxShadow: `0 ${0.5 * u}px ${0.8 * u}px rgba(0,0,0,0.35)` })),
        ],
      };
    }
    case 'vb_pop':
    default:
      return {
        background: 'linear-gradient(135deg, #fef3c7 0%, #fce7f3 50%, #dbeafe 100%)',
        shapes: Array.from({ length: 34 }, (_, index) => {
          const size = 3 * u + rand() * 8 * u;
          const colors = ['#f472b6', '#60a5fa', '#facc15', '#34d399', '#a78bfa', '#fb923c'];
          const color = colors[index % colors.length];
          const square = index % 3 === 0;
          return abs({
            left: rand() * w - size / 2, top: rand() * h - size / 2, width: size, height: size,
            borderRadius: square ? 1.2 * u : 9999, background: index % 4 === 0 ? 'transparent' : color,
            border: index % 4 === 0 ? `${0.6 * u}px solid ${color}` : undefined,
            opacity: 0.55 + rand() * 0.35, transform: square ? `rotate(${Math.round(rand() * 60)}deg)` : undefined,
          });
        }),
      };
  }
}

/** バーチャル背景の絵。width/height はピクセル。 */
export function VirtualBackgroundArt({ id, width, height }: { id: VirtualBackgroundId; width: number; height: number }): ReactElement {
  const { background, shapes } = shapesFor(id, width, height);
  return (
    <div style={{ position: 'relative', display: 'flex', width, height, overflow: 'hidden', background }}>
      {shapes.map((style, index) => <div key={index} style={style} />)}
    </div>
  );
}
