// バーチャル背景のID（描画は lib/virtual-backgrounds.tsx）。サーバーの判定から JSX を読み込まないよう分けている。
export const VIRTUAL_BACKGROUND_IDS = ['vb_aurora', 'vb_space', 'vb_sakura', 'vb_ocean', 'vb_chalkboard', 'vb_library', 'vb_pop'] as const;
export type VirtualBackgroundId = typeof VIRTUAL_BACKGROUND_IDS[number];

export const isVirtualBackgroundId = (value: unknown): value is VirtualBackgroundId =>
  (VIRTUAL_BACKGROUND_IDS as readonly string[]).includes(String(value));
