import * as THREE from 'three';

/**
 * 交流広場・教室の質感（芝・石畳・れんが・木目・しっくい・コルクなど）を、画像を読まずにその場で描く。
 * 同じ質感は一度だけ描いて使い回す（cache）。
 */

export const PLAZA_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';
const HAND_FONT = '"Klee One", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';

/** 毎回同じ模様にするための決まった乱数。 */
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, random: () => number) => void, options: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!, seededRandom(width * 7 + height));
  const texture = new THREE.CanvasTexture(canvas);
  if (options.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  if (options.repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...options.repeat);
  }
  texture.anisotropy = 8;
  return texture;
}

/** 細かい色むら（ノイズ）を足す。 */
function speckle(ctx: CanvasRenderingContext2D, random: () => number, count: number, colors: string[], size: [number, number], alpha = 0.35) {
  const { width, height } = ctx.canvas;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const s = size[0] + random() * (size[1] - size[0]);
    ctx.fillRect(random() * width, random() * height, s, s);
  }
  ctx.globalAlpha = 1;
}

const cache = new Map<string, THREE.Texture>();
const cached = (key: string, make: () => THREE.Texture) => {
  const hit = cache.get(key);
  if (hit) return hit;
  const texture = make();
  cache.set(key, texture);
  return texture;
};

/** 片付けのとき、使い回していた質感もまとめて捨てる。 */
export function disposeCachedTextures() {
  cache.forEach(texture => texture.dispose());
  cache.clear();
}

export const grassTexture = (repeat: number) => cached(`grass-${repeat}`, () => canvasTexture(256, 256, (ctx, random) => {
  ctx.fillStyle = '#7fb15a';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, random, 2600, ['#6a9e48', '#8fc266', '#5f8f3f', '#9ccc70', '#77a852'], [1, 3], 0.55);
  // 細い草の筋
  ctx.strokeStyle = 'rgba(70,110,40,0.35)';
  for (let i = 0; i < 500; i += 1) {
    const x = random() * 256;
    const y = random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 3, y - 3 - random() * 4);
    ctx.stroke();
  }
}, { repeat: [repeat, repeat] }));

export const stoneTileTexture = (repeat: number) => cached(`tile-${repeat}`, () => canvasTexture(256, 256, (ctx, random) => {
  const tones = ['#d9cbb0', '#d0c0a2', '#ddd1ba', '#cbb999'];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      ctx.fillStyle = tones[Math.floor(random() * tones.length)];
      ctx.fillRect(x * 64, y * 64, 64, 64);
    }
  }
  speckle(ctx, random, 3000, ['#cbb893', '#f6eddc', '#d6c4a2'], [1, 2], 0.4);
  ctx.strokeStyle = '#bfa983';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke();
  }
}, { repeat: [repeat, repeat] }));

export const brickTexture = (repeatX: number, repeatY: number) => cached(`brick-${repeatX}-${repeatY}`, () => canvasTexture(256, 256, (ctx, random) => {
  ctx.fillStyle = '#b9a58f';
  ctx.fillRect(0, 0, 256, 256);
  const tones = ['#b5714f', '#c27f5b', '#a9654a', '#c98a63', '#b87652'];
  const rows = 8;
  const h = 256 / rows;
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 ? 32 : 0;
    for (let x = -1; x < 4; x += 1) {
      ctx.fillStyle = tones[Math.floor(random() * tones.length)];
      ctx.fillRect(x * 64 + offset + 2, row * h + 2, 60, h - 4);
    }
  }
  speckle(ctx, random, 1500, ['#8e5038', '#d79c76'], [1, 2], 0.35);
}, { repeat: [repeatX, repeatY] }));

export const woodFloorTexture = (repeatX: number, repeatY: number) => cached(`floor-${repeatX}-${repeatY}`, () => canvasTexture(512, 512, (ctx, random) => {
  const planks = 8;
  const w = 512 / planks;
  for (let i = 0; i < planks; i += 1) {
    const base = 150 + Math.floor(random() * 30);
    ctx.fillStyle = `rgb(${base + 40},${base - 10},${base - 60})`;
    ctx.fillRect(i * w, 0, w, 512);
    // 木目
    for (let g = 0; g < 18; g += 1) {
      ctx.strokeStyle = `rgba(90,55,25,${0.08 + random() * 0.12})`;
      ctx.lineWidth = 1 + random() * 1.5;
      const x = i * w + random() * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (random() - 0.5) * 8, 170, x + (random() - 0.5) * 8, 340, x + (random() - 0.5) * 6, 512);
      ctx.stroke();
    }
    // 板の継ぎ目
    const joint = random() * 512;
    ctx.fillStyle = 'rgba(60,35,15,0.5)';
    ctx.fillRect(i * w, joint, w, 2);
    ctx.fillRect(i * w, 0, 2, 512);
  }
}, { repeat: [repeatX, repeatY] }));

export const woodGrainTexture = () => cached('grain', () => canvasTexture(256, 256, (ctx, random) => {
  ctx.fillStyle = '#d6b07c';
  ctx.fillRect(0, 0, 256, 256);
  for (let g = 0; g < 40; g += 1) {
    ctx.strokeStyle = `rgba(140,90,40,${0.1 + random() * 0.15})`;
    ctx.lineWidth = 1 + random() * 2;
    const y = random() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + (random() - 0.5) * 12, 170, y + (random() - 0.5) * 12, 256, y + (random() - 0.5) * 8);
    ctx.stroke();
  }
}));

export const plasterTexture = (repeat: number) => cached(`plaster-${repeat}`, () => canvasTexture(256, 256, (ctx, random) => {
  ctx.fillStyle = '#f3eee2';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, random, 2500, ['#e8e1d1', '#faf7ef', '#e2dac8'], [1, 3], 0.45);
}, { repeat: [repeat, repeat] }));

export const ceilingTexture = (repeatX: number, repeatY: number) => cached(`ceiling-${repeatX}-${repeatY}`, () => canvasTexture(256, 256, (ctx, random) => {
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, random, 1800, ['#d9d6cc', '#c9c5b9'], [1, 2], 0.5);
  ctx.strokeStyle = '#cfcabd';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 256, 256);
}, { repeat: [repeatX, repeatY] }));

export const corkTexture = () => cached('cork', () => canvasTexture(512, 128, (ctx, random) => {
  ctx.fillStyle = '#c4935c';
  ctx.fillRect(0, 0, 512, 128);
  speckle(ctx, random, 5000, ['#a8743f', '#d8a970', '#8f5f30', '#e0b783'], [1, 3], 0.6);
}));

export const lockerTexture = () => cached('locker', () => canvasTexture(1024, 128, ctx => {
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, 1024, 128);
  const cols = 20;
  const w = 1024 / cols;
  for (let i = 0; i < cols; i += 1) {
    for (let row = 0; row < 2; row += 1) {
      ctx.fillStyle = '#d4ccb6';
      ctx.fillRect(i * w + 4, row * 64 + 4, w - 8, 56);
      ctx.fillStyle = '#b9ae92';
      ctx.fillRect(i * w + 4, row * 64 + 56, w - 8, 4);
    }
  }
}));

/** 教室の窓から見える景色（校庭・木・遠くの山）。 */
export const windowViewTexture = () => cached('window-view', () => canvasTexture(1024, 256, (ctx, random) => {
  const sky = ctx.createLinearGradient(0, 0, 0, 160);
  sky.addColorStop(0, '#6fb3ea');
  sky.addColorStop(1, '#d9eefb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#8fb9a8';
  ctx.beginPath();
  ctx.moveTo(0, 150);
  for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, 120 + Math.sin(x / 140) * 18 + random() * 6);
  ctx.lineTo(1024, 256); ctx.lineTo(0, 256);
  ctx.fill();
  ctx.fillStyle = '#d8c39c';
  ctx.fillRect(0, 175, 1024, 81);
  for (let i = 0; i < 26; i += 1) {
    const x = random() * 1024;
    const h = 30 + random() * 30;
    ctx.fillStyle = '#4f8a45';
    ctx.beginPath();
    ctx.arc(x, 165 - h / 2, h / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4a2c';
    ctx.fillRect(x - 2, 165 - h / 4, 4, h / 2);
  }
}));

/** 掲示物（時間割・学級目標など）。 */
export const posterTexture = (title: string, lines: string[], color: string) => cached(`poster-${title}`, () => canvasTexture(256, 360, ctx => {
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(0, 0, 256, 360);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 30px ${PLAZA_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 128, 30);
  ctx.fillStyle = '#334155';
  ctx.font = `bold 22px ${PLAZA_FONT}`;
  lines.forEach((line, index) => ctx.fillText(line, 128, 92 + index * 40));
}));

/** 時計の文字盤（端末の時刻）。redraw で針を動かす。 */
export function createClockFace() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const redraw = () => {
    const ctx = canvas.getContext('2d')!;
    const now = new Date();
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#fffdf5';
    ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.font = `bold 26px ${PLAZA_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillText(String(i), 128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92);
    }
    const hand = (angle: number, length: number, width: number, color = '#1e293b') => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.sin(angle) * length, 128 - Math.cos(angle) * length);
      ctx.stroke();
    };
    const minutes = now.getMinutes() + now.getSeconds() / 60;
    hand(((now.getHours() % 12) + minutes / 60) / 12 * Math.PI * 2, 52, 9);
    hand(minutes / 60 * Math.PI * 2, 80, 6);
    hand(now.getSeconds() / 60 * Math.PI * 2, 86, 2, '#dc2626');
    texture.needsUpdate = true;
  };
  redraw();
  return { texture, redraw };
}

/** 黒板（チョークの字）。 */
export function drawBlackboard(ctx: CanvasRenderingContext2D, data: { topicTitle: string | null; topicCount: number }) {
  const { width, height } = ctx.canvas;
  const random = seededRandom(42);
  ctx.fillStyle = '#25483a';
  ctx.fillRect(0, 0, width, height);
  // 消し跡
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.015 + random() * 0.025})`;
    ctx.beginPath();
    ctx.ellipse(random() * width, random() * height, 60 + random() * 160, 20 + random() * 50, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const chalk = (text: string, x: number, y: number, size: number, color = 'rgba(255,255,255,0.92)', align: CanvasTextAlign = 'left') => {
    ctx.font = `bold ${size}px ${HAND_FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = 3;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  };
  const now = new Date();
  const week = '日月火水木金土'[now.getDay()];
  chalk(`${now.getMonth() + 1}月${now.getDate()}日（${week}）`, width - 60, 70, 56, 'rgba(255,255,255,0.9)', 'right');
  chalk('ようこそ、交流広場の教室へ', 70, 80, 72);
  chalk('今日の話題', 70, 210, 52, 'rgba(250,224,120,0.95)');
  const title = data.topicTitle || 'まだ投稿がありません';
  const chars = Array.from(title);
  const line1 = chars.slice(0, 22).join('');
  const line2 = chars.length > 22 ? `${chars.slice(22, 43).join('')}${chars.length > 43 ? '…' : ''}` : '';
  chalk(`「${line1}${line2 ? '' : '」'}`, 90, 300, 66);
  if (line2) chalk(`${line2}」`, 130, 385, 66);
  chalk(`後ろの掲示板に、新しい投稿が${Math.min(8, data.topicCount)}件はってあるよ`, 70, height - 70, 46, 'rgba(160,220,255,0.92)');
}
