import { isVirtualBackgroundId } from '@/lib/virtual-background-ids';

// 追加費用なしで用意できる景品（アプリ内で完結するデジタル景品）。
// 管理画面の「プリセットから追加」で rewards に登録し、交換・ガチャの景品にできる。
//  - virtual_background: オンライン授業用バーチャル背景（PNG をダウンロード）
//  - theme / pattern / title / frame: ホーム画面のきせかえ（設定 → 見た目 で使う）
//  - badge: 交換所限定バッジ（トロフィーに追加）

export type RewardPresetCategory = 'virtual_background' | 'theme' | 'pattern' | 'title' | 'frame' | 'badge';

export type RewardPreset = {
  id: string;
  category: RewardPresetCategory;
  name: string;
  description: string;
  defaultCost: number;
  /** プレビュー用の見た目（テーマ・パターン・枠は CSS、称号は文字、バッジは絵文字）。 */
  swatch?: string;
  emoji?: string;
};

export const REWARD_PRESET_CATEGORY_LABELS: Record<RewardPresetCategory, string> = {
  virtual_background: 'オンライン授業のバーチャル背景',
  theme: 'ホーム画面のテーマ',
  pattern: 'ホーム画面の背景もよう',
  title: '名前の上に出る称号',
  frame: 'バッジのフレーム',
  badge: '交換所限定バッジ',
};

export const REWARD_PRESETS: RewardPreset[] = [
  // バーチャル背景（1920×1080 PNG）
  { id: 'vb_aurora', category: 'virtual_background', name: 'バーチャル背景「オーロラ」', description: '夜空にかかるオーロラ。Zoomの背景に設定できます。', defaultCost: 150 },
  { id: 'vb_space', category: 'virtual_background', name: 'バーチャル背景「宇宙」', description: '星空と土星が浮かぶ宇宙の背景です。', defaultCost: 150 },
  { id: 'vb_sakura', category: 'virtual_background', name: 'バーチャル背景「さくら」', description: '花びらが舞う春の背景です。', defaultCost: 150 },
  { id: 'vb_ocean', category: 'virtual_background', name: 'バーチャル背景「海」', description: '青い海と泡の夏らしい背景です。', defaultCost: 150 },
  { id: 'vb_chalkboard', category: 'virtual_background', name: 'バーチャル背景「黒板」', description: '教室の黒板の前で授業を受けている気分に。', defaultCost: 120 },
  { id: 'vb_library', category: 'virtual_background', name: 'バーチャル背景「図書室」', description: '本棚に囲まれた落ち着いた背景です。', defaultCost: 120 },
  { id: 'vb_pop', category: 'virtual_background', name: 'バーチャル背景「ポップ」', description: 'カラフルな図形が楽しい背景です。', defaultCost: 100 },

  // ホーム画面のテーマ（lib/student-customization.ts の premium テーマ）
  { id: 'theme_galaxy', category: 'theme', name: 'テーマ「ギャラクシー」', description: 'ホーム画面を宇宙色に。', defaultCost: 200, swatch: 'linear-gradient(135deg, #1e1b4b, #6d28d9, #db2777)' },
  { id: 'theme_sakura', category: 'theme', name: 'テーマ「さくら」', description: 'やさしいピンクのホーム画面に。', defaultCost: 200, swatch: 'linear-gradient(135deg, #f9a8d4, #fbcfe8, #fde68a)' },
  { id: 'theme_gold', category: 'theme', name: 'テーマ「ゴールド」', description: 'きらびやかな金色のホーム画面に。', defaultCost: 300, swatch: 'linear-gradient(135deg, #b45309, #f59e0b, #fde047)' },
  { id: 'theme_rainbow', category: 'theme', name: 'テーマ「レインボー」', description: '虹色のホーム画面に。', defaultCost: 400, swatch: 'linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)' },
  { id: 'theme_neon', category: 'theme', name: 'テーマ「ネオン」', description: '夜の街のようなネオンカラーに。', defaultCost: 300, swatch: 'linear-gradient(135deg, #0f172a, #0891b2, #c026d3)' },

  // 背景もよう
  { id: 'pattern_stars', category: 'pattern', name: 'もよう「星」', description: 'ホーム画面の背景に星を散りばめます。', defaultCost: 80, swatch: 'radial-gradient(circle, #facc15 1.5px, transparent 2px) 0 0 / 14px 14px, #fff' },
  { id: 'pattern_hearts', category: 'pattern', name: 'もよう「水玉」', description: 'カラフルな水玉もようの背景に。', defaultCost: 80, swatch: 'radial-gradient(circle, #f9a8d4 3px, transparent 3.5px) 0 0 / 16px 16px, #fff' },
  { id: 'pattern_stripes', category: 'pattern', name: 'もよう「ストライプ」', description: 'ななめストライプの背景に。', defaultCost: 80, swatch: 'repeating-linear-gradient(45deg, #e0e7ff 0 6px, #fff 6px 12px)' },
  { id: 'pattern_check', category: 'pattern', name: 'もよう「チェック」', description: 'ギンガムチェックの背景に。', defaultCost: 80, swatch: 'linear-gradient(rgba(56,189,248,.25) 50%, transparent 50%) 0 0 / 16px 16px, linear-gradient(90deg, rgba(56,189,248,.25) 50%, transparent 50%) 0 0 / 16px 16px, #fff' },

  // 称号
  { id: 'title_scholar', category: 'title', name: '称号「勉強の達人」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 120 },
  { id: 'title_quiz_king', category: 'title', name: '称号「クイズ王」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 120 },
  { id: 'title_persistent', category: 'title', name: '称号「継続は力なり」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 120 },
  { id: 'title_science', category: 'title', name: '称号「理科博士」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 120 },
  { id: 'title_history', category: 'title', name: '称号「歴史マニア」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 120 },
  { id: 'title_ace', category: 'title', name: '称号「期待のエース」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 200 },
  { id: 'title_legend', category: 'title', name: '称号「伝説の受験生」', description: 'ホーム画面の名前の上に表示されます。', defaultCost: 500 },

  // バッジのフレーム
  { id: 'frame_gold', category: 'frame', name: 'フレーム「ゴールド」', description: 'ホーム画面のバッジを金色の枠で飾ります。', defaultCost: 150, swatch: 'linear-gradient(135deg, #fde047, #f59e0b, #b45309)' },
  { id: 'frame_rainbow', category: 'frame', name: 'フレーム「レインボー」', description: 'ホーム画面のバッジを虹色の枠で飾ります。', defaultCost: 250, swatch: 'linear-gradient(135deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)' },
  { id: 'frame_fire', category: 'frame', name: 'フレーム「ほのお」', description: 'ホーム画面のバッジを燃える枠で飾ります。', defaultCost: 200, swatch: 'linear-gradient(135deg, #fef08a, #f97316, #dc2626)' },
  { id: 'frame_ice', category: 'frame', name: 'フレーム「こおり」', description: 'ホーム画面のバッジを氷の枠で飾ります。', defaultCost: 200, swatch: 'linear-gradient(135deg, #e0f2fe, #38bdf8, #6366f1)' },

  // 交換所限定バッジ（lib/gamification.ts の shop バッジ）
  { id: 'badge_shop_unicorn', category: 'badge', name: '限定バッジ「ユニコーン」', description: 'トロフィーに飾れる交換所限定バッジです。', defaultCost: 300, emoji: '🦄' },
  { id: 'badge_shop_rocket', category: 'badge', name: '限定バッジ「ロケット」', description: 'トロフィーに飾れる交換所限定バッジです。', defaultCost: 250, emoji: '🚀' },
  { id: 'badge_shop_diamond', category: 'badge', name: '限定バッジ「ダイヤモンド」', description: 'トロフィーに飾れる交換所限定バッジです。', defaultCost: 500, emoji: '💎' },
  { id: 'badge_shop_cat', category: 'badge', name: '限定バッジ「ねこ先生」', description: 'トロフィーに飾れる交換所限定バッジです。', defaultCost: 200, emoji: '🐱' },
  { id: 'badge_shop_ninja', category: 'badge', name: '限定バッジ「ニンジャ」', description: 'トロフィーに飾れる交換所限定バッジです。', defaultCost: 250, emoji: '🥷' },
];

export const findRewardPreset = (id: unknown) => REWARD_PRESETS.find(preset => preset.id === String(id || ''));

/** 称号のIDから表示文字列を返す（「称号「…」」の「…」部分）。 */
export const presetTitleText = (id: unknown) => {
  const preset = findRewardPreset(id);
  if (!preset || preset.category !== 'title') return '';
  return preset.name.replace(/^称号「(.*)」$/, '$1');
};

/** バーチャル背景だけはファイルとしてダウンロードし、それ以外はアプリ内のきせかえとして使う。 */
export const presetRewardKind = (preset: RewardPreset) =>
  preset.category === 'virtual_background' && isVirtualBackgroundId(preset.id) ? 'digital' as const : 'cosmetic' as const;
