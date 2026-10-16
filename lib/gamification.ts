// ランク定義
// Dashboardで rank.color を使用するため、colorプロパティを追加しました
export const RANKS = [
  { name: 'ビギナー', min: 0, icon: '🌱', color: 'text-green-600' },
  { name: 'ブロンズ', min: 100, icon: '🥉', color: 'text-orange-700' },
  { name: 'シルバー', min: 500, icon: '🥈', color: 'text-gray-500' },
  { name: 'ゴールド', min: 1000, icon: '🥇', color: 'text-yellow-500' },
  { name: 'プラチナ', min: 3000, icon: '💎', color: 'text-cyan-500' },
  { name: 'マスター', min: 5000, icon: '👑', color: 'text-purple-600' },
  { name: 'レジェンド', min: 10000, icon: '🦄', color: 'text-rose-500' },
];

export const getRank = (points: number) => {
  // ポイントに基づいてランクを判定（高い順にチェックして該当するものを返す）
  return [...RANKS].reverse().find(r => points >= r.min) || RANKS[0];
};

// --- バッジ ---
// 獲得判定はサーバー（lib/server/badges.ts）がユーザーの累計カウンターから行う。
// manual のバッジは理社講座管理者が「ポイント・景品管理」から個別に授与する。

export type BadgeMetric =
  | 'login_count'
  | 'best_login_streak'
  | 'total_coins'
  | 'quest_clear_count'
  | 'homework_count'
  | 'recording_complete_count'
  | 'community_activity_count'
  | 'reward_exchange_count'
  | 'gacha_draw_count'
  | 'gacha_win_count'
  | 'manual'
  | 'shop';

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type BadgeCategory = 'start' | 'streak' | 'login' | 'quest' | 'homework' | 'recording' | 'community' | 'coin' | 'reward' | 'shop' | 'special';

export type BadgeDefinition = {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  metric: BadgeMetric;
  threshold: number;
  secret?: boolean;
};

export const BADGE_CATEGORIES: { id: BadgeCategory; label: string }[] = [
  { id: 'start', label: 'はじめの一歩' },
  { id: 'streak', label: '連続ログイン' },
  { id: 'login', label: '累計ログイン' },
  { id: 'quest', label: '学習クエスト' },
  { id: 'homework', label: '宿題' },
  { id: 'recording', label: '授業アーカイブ' },
  { id: 'community', label: 'コミュニティ' },
  { id: 'coin', label: 'コイン' },
  { id: 'reward', label: '景品・ガチャ' },
  { id: 'shop', label: '交換所限定' },
  { id: 'special', label: '先生からの特別バッジ' },
];

export const BADGE_RARITY_LABELS: Record<BadgeRarity, string> = {
  common: 'ノーマル',
  rare: 'レア',
  epic: 'スーパーレア',
  legendary: 'レジェンド',
};

export const BADGE_RARITY_STYLES: Record<BadgeRarity, string> = {
  common: 'border-slate-200 bg-white',
  rare: 'border-sky-300 bg-sky-50',
  epic: 'border-violet-300 bg-violet-50',
  legendary: 'border-amber-400 bg-amber-50',
};

const badge = (
  id: string, name: string, icon: string, description: string,
  category: BadgeCategory, rarity: BadgeRarity, metric: BadgeMetric, threshold: number, secret = false,
): BadgeDefinition => ({ id, name, icon, description, category, rarity, metric, threshold, secret });

export const BADGES: BadgeDefinition[] = [
  // はじめの一歩（既存IDを維持）
  badge('badge_1', 'スタート', '🌱', '初めてログインすると獲得', 'start', 'common', 'login_count', 1),
  badge('badge_pencil', '宿題提出', '✏️', '宿題を初めて提出すると獲得', 'start', 'common', 'homework_count', 1),
  badge('badge_book', '録画視聴', '📚', '授業アーカイブを初めて最後まで見ると獲得', 'start', 'common', 'recording_complete_count', 1),
  badge('badge_social', '発信者', '💬', 'コミュニティに初めて参加すると獲得', 'start', 'common', 'community_activity_count', 1),
  badge('badge_quest_1', 'クエスト挑戦者', '🗡️', '学習クエストに初めて合格すると獲得', 'start', 'common', 'quest_clear_count', 1),

  // 連続ログイン
  badge('badge_fire_3', '3日連続', '🔥', '3日連続でログイン', 'streak', 'common', 'best_login_streak', 3),
  badge('badge_rainbow', '7日連続', '🌈', '7日連続でログイン', 'streak', 'rare', 'best_login_streak', 7),
  badge('badge_streak_14', '2週間連続', '⚡', '14日連続でログイン', 'streak', 'rare', 'best_login_streak', 14),
  badge('badge_streak_30', '1か月連続', '🌙', '30日連続でログイン', 'streak', 'epic', 'best_login_streak', 30),
  badge('badge_streak_100', '100日連続', '☀️', '100日連続でログイン', 'streak', 'legendary', 'best_login_streak', 100),

  // 累計ログイン
  badge('badge_star_10', '10回ログイン', '⭐️', '累計10回ログイン', 'login', 'common', 'login_count', 10),
  badge('badge_login_30', '30回ログイン', '🌟', '累計30回ログイン', 'login', 'rare', 'login_count', 30),
  badge('badge_medal', '継続の達人', '🏅', '累計50回ログイン', 'login', 'rare', 'login_count', 50),
  badge('badge_login_100', '100回ログイン', '🎖️', '累計100回ログイン', 'login', 'epic', 'login_count', 100),
  badge('badge_login_365', '1年皆勤', '🏛️', '累計365回ログイン', 'login', 'legendary', 'login_count', 365),

  // 学習クエスト
  badge('badge_quest_10', 'クエスト10', '🛡️', '学習クエストに10回合格', 'quest', 'common', 'quest_clear_count', 10),
  badge('badge_quest_30', 'クエスト30', '⚔️', '学習クエストに30回合格', 'quest', 'rare', 'quest_clear_count', 30),
  badge('badge_quest_100', 'クエストマスター', '🧙', '学習クエストに100回合格', 'quest', 'epic', 'quest_clear_count', 100),
  badge('badge_quest_300', '伝説の勇者', '🐲', '学習クエストに300回合格', 'quest', 'legendary', 'quest_clear_count', 300),

  // 宿題
  badge('badge_homework_10', '宿題10回', '📝', '宿題を10回提出', 'homework', 'common', 'homework_count', 10),
  badge('badge_homework_30', '宿題30回', '📒', '宿題を30回提出', 'homework', 'rare', 'homework_count', 30),
  badge('badge_homework_100', '宿題の鬼', '👹', '宿題を100回提出', 'homework', 'epic', 'homework_count', 100),

  // 授業アーカイブ
  badge('badge_recording_10', '復習上手', '🎬', '授業アーカイブを10本見終える', 'recording', 'common', 'recording_complete_count', 10),
  badge('badge_recording_30', '復習の達人', '🎞️', '授業アーカイブを30本見終える', 'recording', 'rare', 'recording_complete_count', 30),
  badge('badge_recording_100', '映像博士', '🎓', '授業アーカイブを100本見終える', 'recording', 'epic', 'recording_complete_count', 100),

  // コミュニティ
  badge('badge_community_10', '人気者', '🤝', 'コミュニティに10回参加', 'community', 'common', 'community_activity_count', 10),
  badge('badge_community_50', 'ムードメーカー', '🎉', 'コミュニティに50回参加', 'community', 'rare', 'community_activity_count', 50),

  // コイン（累計獲得）
  badge('badge_coin_100', 'コイン100', '🪙', '累計100コイン獲得', 'coin', 'common', 'total_coins', 100),
  badge('badge_coin_500', 'コイン500', '💴', '累計500コイン獲得', 'coin', 'common', 'total_coins', 500),
  badge('badge_king', 'コインマスター', '💰', '累計1,000コイン獲得', 'coin', 'rare', 'total_coins', 1000),
  badge('badge_coin_3000', 'お金持ち', '💎', '累計3,000コイン獲得', 'coin', 'epic', 'total_coins', 3000),
  badge('badge_dragon', 'レジェンド', '🐉', '累計10,000コイン獲得', 'coin', 'legendary', 'total_coins', 10000, true),

  // 景品・ガチャ
  badge('badge_exchange_1', 'はじめての交換', '🎁', '景品と初めて交換', 'reward', 'common', 'reward_exchange_count', 1),
  badge('badge_exchange_5', 'コレクター', '🧺', '景品と5回交換', 'reward', 'rare', 'reward_exchange_count', 5),
  badge('badge_gacha_1', 'ガチャデビュー', '🎰', 'ガチャを初めて回す', 'reward', 'common', 'gacha_draw_count', 1),
  badge('badge_gacha_10', 'ガチャ10連', '🎲', 'ガチャを10回回す', 'reward', 'rare', 'gacha_draw_count', 10),
  badge('badge_gacha_win_5', '強運の持ち主', '🍀', 'ガチャで景品を5回当てる', 'reward', 'epic', 'gacha_win_count', 5, true),

  // 交換所限定（lib/reward-presets.ts の badge プリセットを交換・ガチャで手に入れる）
  badge('badge_shop_unicorn', 'ユニコーン', '🦄', '交換所・ガチャで手に入る限定バッジ', 'shop', 'epic', 'shop', 0),
  badge('badge_shop_rocket', 'ロケット', '🚀', '交換所・ガチャで手に入る限定バッジ', 'shop', 'rare', 'shop', 0),
  badge('badge_shop_diamond', 'ダイヤモンド', '💎', '交換所・ガチャで手に入る限定バッジ', 'shop', 'legendary', 'shop', 0),
  badge('badge_shop_cat', 'ねこ先生', '🐱', '交換所・ガチャで手に入る限定バッジ', 'shop', 'rare', 'shop', 0),
  badge('badge_shop_ninja', 'ニンジャ', '🥷', '交換所・ガチャで手に入る限定バッジ', 'shop', 'rare', 'shop', 0),

  // 先生からの特別バッジ（手動授与）
  badge('badge_special_effort', 'がんばり賞', '💪', '先生が努力を認めた生徒に授与', 'special', 'rare', 'manual', 0),
  badge('badge_special_hanamaru', '花まる', '💮', '素晴らしい取り組みに授与', 'special', 'rare', 'manual', 0),
  badge('badge_special_improve', '成績アップ賞', '📈', 'テストの点数が大きく伸びた生徒に授与', 'special', 'epic', 'manual', 0),
  badge('badge_special_perfect', '皆勤賞', '🏆', '授業を休まず出席した生徒に授与', 'special', 'epic', 'manual', 0),
  badge('badge_special_mvp', 'MVP', '👑', '特に活躍した生徒に授与', 'special', 'legendary', 'manual', 0),
];

export const MANUAL_BADGES = BADGES.filter(item => item.metric === 'manual');

export const findBadge = (id: unknown) => BADGES.find(item => item.id === (id === 'beginner' ? 'badge_1' : id));

export type BadgeStats = Record<Exclude<BadgeMetric, 'manual' | 'shop'>, number>;

const isCounterMetric = (metric: BadgeMetric): metric is keyof BadgeStats => metric !== 'manual' && metric !== 'shop';

const numberOf = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export function badgeStatsFromProfile(profile: Record<string, any>): BadgeStats {
  return {
    login_count: numberOf(profile.login_count || profile.attendance_count),
    best_login_streak: Math.max(numberOf(profile.best_login_streak), numberOf(profile.login_streak)),
    total_coins: numberOf(profile.total_coins),
    quest_clear_count: numberOf(profile.quest_clear_count),
    homework_count: numberOf(profile.homework_count),
    recording_complete_count: numberOf(profile.recording_complete_count),
    community_activity_count: numberOf(profile.community_activity_count),
    reward_exchange_count: numberOf(profile.reward_exchange_count),
    gacha_draw_count: numberOf(profile.gacha_draw_count),
    gacha_win_count: numberOf(profile.gacha_win_count),
  };
}

/** 累計カウンターから自動獲得できるバッジIDを返す（手動バッジは含まない）。 */
export function eligibleBadgeIds(stats: BadgeStats) {
  return BADGES
    .filter(item => isCounterMetric(item.metric) && stats[item.metric] >= item.threshold)
    .map(item => item.id);
}

export function badgeProgress(item: BadgeDefinition, stats: BadgeStats) {
  if (!isCounterMetric(item.metric)) return null;
  const current = stats[item.metric];
  return { current: Math.min(current, item.threshold), target: item.threshold, rate: Math.min(1, current / item.threshold) };
}
