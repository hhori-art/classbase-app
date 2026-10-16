// galaxy 以降は交換所で手に入るテーマ（owned_cosmetics に theme_<id> がある生徒だけが使える）。
export type StudentThemeId = 'aurora' | 'ocean' | 'forest' | 'sunset' | 'mono' | 'galaxy' | 'sakura' | 'gold' | 'rainbow' | 'neon';
export type StudentCardStyle = 'soft' | 'glass' | 'solid';
export type StudentDensity = 'comfortable' | 'compact';
export type StudentHeaderStyle = 'standard' | 'calm' | 'pop';
export type StudentBackgroundPattern = 'none' | 'dots' | 'grid' | 'stars' | 'hearts' | 'stripes' | 'check';

export type StudentAppearance = {
  theme: StudentThemeId;
  cardStyle: StudentCardStyle;
  density: StudentDensity;
  headerStyle: StudentHeaderStyle;
  backgroundPattern: StudentBackgroundPattern;
  showMascot: boolean;
  /** 交換所で手に入れた称号（title_<id>）。空なら表示しない。 */
  title: string;
  /** 交換所で手に入れたバッジのフレーム（frame_<id>）。空ならフレームなし。 */
  frame: string;
};

export const DEFAULT_STUDENT_APPEARANCE: StudentAppearance = {
  theme: 'aurora',
  cardStyle: 'soft',
  density: 'comfortable',
  headerStyle: 'standard',
  backgroundPattern: 'none',
  showMascot: true,
  title: '',
  frame: '',
};

export const STUDENT_THEMES: Record<StudentThemeId, {
  label: string;
  description: string;
  /** 交換所で手に入れる必要があるテーマのプリセットID。 */
  premium?: string;
  pageBg: string;
  heroBg: string;
  heroAccent: string;
  nameColor: string;
  badgeBg: string;
  badgeText: string;
  primaryText: string;
  ring: string;
  questBg: string;
  previewDot: string;
}> = {
  aurora: {
    label: 'オーロラ',
    description: '明るく元気な標準テーマ',
    pageBg: 'bg-[#F0F4F8]',
    heroBg: 'bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500',
    heroAccent: 'bg-white/10',
    nameColor: 'text-yellow-300',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-600',
    primaryText: 'text-indigo-500',
    ring: 'border-indigo-100',
    questBg: 'bg-gradient-to-r from-teal-400 to-emerald-500',
    previewDot: 'bg-indigo-500',
  },
  ocean: {
    label: 'オーシャン',
    description: '集中しやすい青系テーマ',
    pageBg: 'bg-sky-50',
    heroBg: 'bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600',
    heroAccent: 'bg-white/15',
    nameColor: 'text-cyan-100',
    badgeBg: 'bg-sky-50',
    badgeText: 'text-sky-600',
    primaryText: 'text-sky-600',
    ring: 'border-sky-100',
    questBg: 'bg-gradient-to-r from-cyan-500 to-blue-500',
    previewDot: 'bg-sky-500',
  },
  forest: {
    label: 'フォレスト',
    description: '落ち着いた緑のテーマ',
    pageBg: 'bg-emerald-50',
    heroBg: 'bg-gradient-to-br from-emerald-600 via-teal-600 to-lime-500',
    heroAccent: 'bg-white/15',
    nameColor: 'text-lime-100',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    primaryText: 'text-emerald-600',
    ring: 'border-emerald-100',
    questBg: 'bg-gradient-to-r from-emerald-500 to-lime-500',
    previewDot: 'bg-emerald-500',
  },
  sunset: {
    label: 'サンセット',
    description: '温かい夕焼けテーマ',
    pageBg: 'bg-rose-50',
    heroBg: 'bg-gradient-to-br from-rose-500 via-orange-500 to-amber-400',
    heroAccent: 'bg-white/15',
    nameColor: 'text-amber-100',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-600',
    primaryText: 'text-rose-500',
    ring: 'border-rose-100',
    questBg: 'bg-gradient-to-r from-orange-500 to-rose-500',
    previewDot: 'bg-rose-500',
  },
  mono: {
    label: 'ミニマル',
    description: 'シンプルで見やすいテーマ',
    pageBg: 'bg-slate-100',
    heroBg: 'bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600',
    heroAccent: 'bg-white/10',
    nameColor: 'text-white',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    primaryText: 'text-slate-700',
    ring: 'border-slate-200',
    questBg: 'bg-gradient-to-r from-slate-700 to-slate-900',
    previewDot: 'bg-slate-700',
  },
  galaxy: {
    label: 'ギャラクシー',
    description: '宇宙色の限定テーマ',
    premium: 'theme_galaxy',
    pageBg: 'bg-indigo-50',
    heroBg: 'bg-gradient-to-br from-indigo-950 via-violet-700 to-pink-600',
    heroAccent: 'bg-fuchsia-300/20',
    nameColor: 'text-pink-200',
    badgeBg: 'bg-violet-50',
    badgeText: 'text-violet-700',
    primaryText: 'text-violet-600',
    ring: 'border-violet-200',
    questBg: 'bg-gradient-to-r from-violet-600 to-pink-500',
    previewDot: 'bg-gradient-to-br from-indigo-950 via-violet-700 to-pink-600',
  },
  sakura: {
    label: 'さくら',
    description: 'やさしいピンクの限定テーマ',
    premium: 'theme_sakura',
    pageBg: 'bg-pink-50',
    heroBg: 'bg-gradient-to-br from-pink-400 via-rose-300 to-amber-200',
    heroAccent: 'bg-white/25',
    nameColor: 'text-white',
    badgeBg: 'bg-pink-50',
    badgeText: 'text-pink-600',
    primaryText: 'text-pink-500',
    ring: 'border-pink-100',
    questBg: 'bg-gradient-to-r from-pink-400 to-rose-400',
    previewDot: 'bg-gradient-to-br from-pink-400 via-rose-300 to-amber-200',
  },
  gold: {
    label: 'ゴールド',
    description: 'きらびやかな限定テーマ',
    premium: 'theme_gold',
    pageBg: 'bg-amber-50',
    heroBg: 'bg-gradient-to-br from-amber-700 via-amber-500 to-yellow-300',
    heroAccent: 'bg-yellow-100/30',
    nameColor: 'text-yellow-50',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    primaryText: 'text-amber-600',
    ring: 'border-amber-200',
    questBg: 'bg-gradient-to-r from-amber-500 to-yellow-400',
    previewDot: 'bg-gradient-to-br from-amber-700 via-amber-500 to-yellow-300',
  },
  rainbow: {
    label: 'レインボー',
    description: '虹色の限定テーマ',
    premium: 'theme_rainbow',
    pageBg: 'bg-violet-50',
    heroBg: 'bg-[linear-gradient(110deg,#f43f5e,#f59e0b,#22c55e,#0ea5e9,#8b5cf6)]',
    heroAccent: 'bg-white/20',
    nameColor: 'text-white',
    badgeBg: 'bg-violet-50',
    badgeText: 'text-violet-600',
    primaryText: 'text-violet-500',
    ring: 'border-violet-100',
    questBg: 'bg-gradient-to-r from-sky-500 to-violet-500',
    previewDot: 'bg-[linear-gradient(110deg,#f43f5e,#f59e0b,#22c55e,#0ea5e9,#8b5cf6)]',
  },
  neon: {
    label: 'ネオン',
    description: '夜の街のような限定テーマ',
    premium: 'theme_neon',
    pageBg: 'bg-slate-100',
    heroBg: 'bg-gradient-to-br from-slate-950 via-cyan-700 to-fuchsia-600',
    heroAccent: 'bg-cyan-300/20',
    nameColor: 'text-cyan-200',
    badgeBg: 'bg-cyan-50',
    badgeText: 'text-cyan-700',
    primaryText: 'text-cyan-600',
    ring: 'border-cyan-200',
    questBg: 'bg-gradient-to-r from-cyan-500 to-fuchsia-500',
    previewDot: 'bg-gradient-to-br from-slate-950 via-cyan-700 to-fuchsia-600',
  },
};

export const STUDENT_CARD_STYLES: Record<StudentCardStyle, {
  label: string;
  description: string;
  panel: string;
  feature: string;
}> = {
  soft: {
    label: 'やわらか',
    description: '影と丸みをしっかり出す',
    panel: 'bg-white rounded-3xl shadow-sm border border-white',
    feature: 'bg-white rounded-3xl shadow-sm border',
  },
  glass: {
    label: 'ガラス',
    description: '少し透明感を出す',
    panel: 'bg-white/75 backdrop-blur-md rounded-3xl shadow-sm border border-white/80',
    feature: 'bg-white/75 backdrop-blur-md rounded-3xl shadow-sm border',
  },
  solid: {
    label: 'くっきり',
    description: '枠線を強めて読みやすく',
    panel: 'bg-white rounded-2xl border-2 border-slate-200',
    feature: 'bg-white rounded-2xl border-2',
  },
};

export const STUDENT_DENSITIES: Record<StudentDensity, {
  label: string;
  description: string;
  sectionGap: string;
  cardPadding: string;
  featurePadding: string;
  heroBottom: string;
}> = {
  comfortable: {
    label: 'ゆったり',
    description: '余白を広めに表示',
    sectionGap: 'space-y-6',
    cardPadding: 'p-5',
    featurePadding: 'p-5',
    heroBottom: 'pb-24',
  },
  compact: {
    label: 'コンパクト',
    description: '情報を詰めて表示',
    sectionGap: 'space-y-4',
    cardPadding: 'p-4',
    featurePadding: 'p-4',
    heroBottom: 'pb-20',
  },
};

export const STUDENT_HEADER_STYLES: Record<StudentHeaderStyle, {
  label: string;
  description: string;
  heroShape: string;
  decoration: string;
}> = {
  standard: {
    label: '標準',
    description: 'いつものバランス',
    heroShape: 'rounded-b-[40px] shadow-lg',
    decoration: 'opacity-100',
  },
  calm: {
    label: 'すっきり',
    description: '丸みと影を少し控えめに',
    heroShape: 'rounded-b-[28px] shadow-md',
    decoration: 'opacity-60',
  },
  pop: {
    label: 'ポップ',
    description: 'ヘッダーを大きく楽しく',
    heroShape: 'rounded-b-[56px] shadow-xl',
    decoration: 'opacity-100 scale-125',
  },
};

export const STUDENT_BACKGROUND_PATTERNS: Record<StudentBackgroundPattern, {
  label: string;
  description: string;
  premium?: string;
}> = {
  none: {
    label: 'なし',
    description: '背景をシンプルに表示',
  },
  dots: {
    label: 'ドット',
    description: '細かい点でやわらかく',
  },
  grid: {
    label: 'グリッド',
    description: 'ノートのような背景',
  },
  stars: { label: '星', description: '星を散りばめた限定もよう', premium: 'pattern_stars' },
  hearts: { label: '水玉', description: 'カラフルな水玉の限定もよう', premium: 'pattern_hearts' },
  stripes: { label: 'ストライプ', description: 'ななめストライプの限定もよう', premium: 'pattern_stripes' },
  check: { label: 'チェック', description: 'ギンガムチェックの限定もよう', premium: 'pattern_check' },
};

/** バッジのフレーム（交換所で手に入れる frame_<id>）。 */
export const STUDENT_BADGE_FRAMES: Record<string, { label: string; background: string; glow: string }> = {
  frame_gold: { label: 'ゴールド', background: 'linear-gradient(135deg, #fde047, #f59e0b, #b45309)', glow: '0 0 14px rgba(245,158,11,.55)' },
  frame_rainbow: { label: 'レインボー', background: 'linear-gradient(135deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)', glow: '0 0 16px rgba(168,85,247,.55)' },
  frame_fire: { label: 'ほのお', background: 'linear-gradient(135deg, #fef08a, #f97316, #dc2626)', glow: '0 0 16px rgba(249,115,22,.6)' },
  frame_ice: { label: 'こおり', background: 'linear-gradient(135deg, #e0f2fe, #38bdf8, #6366f1)', glow: '0 0 14px rgba(56,189,248,.55)' },
};

/** 選んだフレームでバッジを囲むためのスタイル（フレームなしなら undefined）。 */
export function studentBadgeFrameStyle(frame: string) {
  const definition = STUDENT_BADGE_FRAMES[frame];
  if (!definition) return undefined;
  return { background: definition.background, padding: 3, boxShadow: definition.glow };
}

export function studentBackgroundPatternStyle(pattern: StudentBackgroundPattern) {
  if (pattern === 'dots') {
    return {
      backgroundImage: 'radial-gradient(rgba(15, 23, 42, 0.10) 1px, transparent 1px)',
      backgroundSize: '18px 18px',
    };
  }
  if (pattern === 'stars') {
    return { backgroundImage: 'radial-gradient(rgba(250, 204, 21, 0.55) 1.5px, transparent 2px), radial-gradient(rgba(129, 140, 248, 0.35) 1px, transparent 1.5px)', backgroundSize: '26px 26px, 17px 17px', backgroundPosition: '0 0, 9px 11px' };
  }
  if (pattern === 'hearts') {
    return { backgroundImage: 'radial-gradient(rgba(244, 114, 182, 0.28) 4px, transparent 4.5px), radial-gradient(rgba(96, 165, 250, 0.25) 3px, transparent 3.5px)', backgroundSize: '30px 30px, 30px 30px', backgroundPosition: '0 0, 15px 15px' };
  }
  if (pattern === 'stripes') {
    return { backgroundImage: 'repeating-linear-gradient(45deg, rgba(99, 102, 241, 0.07) 0 12px, transparent 12px 24px)' };
  }
  if (pattern === 'check') {
    return { backgroundImage: 'linear-gradient(rgba(56, 189, 248, 0.12) 50%, transparent 50%), linear-gradient(90deg, rgba(56, 189, 248, 0.12) 50%, transparent 50%)', backgroundSize: '28px 28px' };
  }
  if (pattern === 'grid') {
    return {
      backgroundImage: 'linear-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    };
  }
  return undefined;
}

/**
 * 保存された見た目を正規化する。限定アイテムは owned（users.owned_cosmetics）に
 * 含まれる時だけ有効にし、持っていなければ標準に戻す（owned はサーバーだけが書き込む）。
 */
export function normalizeStudentAppearance(input: unknown, owned: unknown = []): StudentAppearance {
  const raw = (input || {}) as Partial<StudentAppearance>;
  const ownedSet = new Set(Array.isArray(owned) ? owned.map(String) : []);
  const allowed = (premium?: string) => !premium || ownedSet.has(premium);
  const theme = raw.theme && STUDENT_THEMES[raw.theme] && allowed(STUDENT_THEMES[raw.theme].premium) ? raw.theme : DEFAULT_STUDENT_APPEARANCE.theme;
  const pattern = raw.backgroundPattern && STUDENT_BACKGROUND_PATTERNS[raw.backgroundPattern] && allowed(STUDENT_BACKGROUND_PATTERNS[raw.backgroundPattern].premium)
    ? raw.backgroundPattern : DEFAULT_STUDENT_APPEARANCE.backgroundPattern;
  const title = typeof raw.title === 'string' && raw.title.startsWith('title_') && ownedSet.has(raw.title) ? raw.title : '';
  const frame = typeof raw.frame === 'string' && STUDENT_BADGE_FRAMES[raw.frame] && ownedSet.has(raw.frame) ? raw.frame : '';
  return {
    theme,
    cardStyle: raw.cardStyle && STUDENT_CARD_STYLES[raw.cardStyle] ? raw.cardStyle : DEFAULT_STUDENT_APPEARANCE.cardStyle,
    density: raw.density && STUDENT_DENSITIES[raw.density] ? raw.density : DEFAULT_STUDENT_APPEARANCE.density,
    headerStyle: raw.headerStyle && STUDENT_HEADER_STYLES[raw.headerStyle] ? raw.headerStyle : DEFAULT_STUDENT_APPEARANCE.headerStyle,
    backgroundPattern: pattern,
    showMascot: raw.showMascot !== false,
    title,
    frame,
  };
}
