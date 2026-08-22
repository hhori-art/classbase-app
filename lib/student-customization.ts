export type StudentThemeId = 'aurora' | 'ocean' | 'forest' | 'sunset' | 'mono';
export type StudentCardStyle = 'soft' | 'glass' | 'solid';
export type StudentDensity = 'comfortable' | 'compact';
export type StudentHeaderStyle = 'standard' | 'calm' | 'pop';
export type StudentBackgroundPattern = 'none' | 'dots' | 'grid';

export type StudentAppearance = {
  theme: StudentThemeId;
  cardStyle: StudentCardStyle;
  density: StudentDensity;
  headerStyle: StudentHeaderStyle;
  backgroundPattern: StudentBackgroundPattern;
  showMascot: boolean;
};

export const DEFAULT_STUDENT_APPEARANCE: StudentAppearance = {
  theme: 'aurora',
  cardStyle: 'soft',
  density: 'comfortable',
  headerStyle: 'standard',
  backgroundPattern: 'none',
  showMascot: true,
};

export const STUDENT_THEMES: Record<StudentThemeId, {
  label: string;
  description: string;
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
};

export function studentBackgroundPatternStyle(pattern: StudentBackgroundPattern) {
  if (pattern === 'dots') {
    return {
      backgroundImage: 'radial-gradient(rgba(15, 23, 42, 0.10) 1px, transparent 1px)',
      backgroundSize: '18px 18px',
    };
  }
  if (pattern === 'grid') {
    return {
      backgroundImage: 'linear-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    };
  }
  return undefined;
}

export function normalizeStudentAppearance(input: unknown): StudentAppearance {
  const raw = (input || {}) as Partial<StudentAppearance>;
  return {
    theme: raw.theme && STUDENT_THEMES[raw.theme] ? raw.theme : DEFAULT_STUDENT_APPEARANCE.theme,
    cardStyle: raw.cardStyle && STUDENT_CARD_STYLES[raw.cardStyle] ? raw.cardStyle : DEFAULT_STUDENT_APPEARANCE.cardStyle,
    density: raw.density && STUDENT_DENSITIES[raw.density] ? raw.density : DEFAULT_STUDENT_APPEARANCE.density,
    headerStyle: raw.headerStyle && STUDENT_HEADER_STYLES[raw.headerStyle] ? raw.headerStyle : DEFAULT_STUDENT_APPEARANCE.headerStyle,
    backgroundPattern: raw.backgroundPattern && STUDENT_BACKGROUND_PATTERNS[raw.backgroundPattern] ? raw.backgroundPattern : DEFAULT_STUDENT_APPEARANCE.backgroundPattern,
    showMascot: raw.showMascot !== false,
  };
}
