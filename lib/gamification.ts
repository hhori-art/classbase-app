import { db } from '@/lib/firebase';
import { doc, updateDoc, increment, collection, addDoc, serverTimestamp } from 'firebase/firestore';

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

// バッジ定義
export const BADGES = [
  // --- すぐ分かる基本バッジ ---
  { id: 'badge_1', name: 'スタート', icon: '🌱', description: '初回ログインで獲得', secret: false },
  { id: 'badge_pencil', name: '宿題提出', icon: '✏️', description: '宿題を提出すると獲得', secret: false },
  { id: 'badge_book', name: '録画視聴', icon: '📚', description: '授業アーカイブを最後まで見ると獲得', secret: false },
  { id: 'badge_social', name: '発信者', icon: '💬', description: 'コミュニティに投稿・コメントすると獲得', secret: false },

  // --- 継続バッジ ---
  { id: 'badge_fire_3', name: '3日連続', icon: '🔥', description: '3日連続ログインで獲得', secret: false },
  { id: 'badge_rainbow', name: '7日連続', icon: '🌈', description: '7日連続ログインで獲得', secret: false },
  { id: 'badge_star_10', name: '10回ログイン', icon: '⭐️', description: '累計10回ログインで獲得', secret: false },
  { id: 'badge_medal', name: '継続の達人', icon: '🏅', description: '学習行動を積み重ねると獲得', secret: false },

  // --- 特別バッジ ---
  { id: 'badge_king', name: 'コインマスター', icon: '💰', description: '所持コインが1000枚を超えると獲得', secret: true },
  { id: 'badge_dragon', name: 'レジェンド', icon: '🐉', description: '特別な達成で獲得', secret: true },
];

/**
 * ▼ ここを追加しました ▼
 * ユーザーにポイントを追加する関数
 */
export const addPoints = async (userId: string, amount: number, reason: string = 'unknown') => {
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);

    // 1. ユーザーの合計ポイントを加算
    await updateDoc(userRef, {
      total_points: increment(amount),
      // 必要であれば最終アクティブ日時なども更新
      // last_active_at: serverTimestamp(),
    });

    // 2. ポイント獲得履歴をサブコレクションに記録
    await addDoc(collection(db, 'users', userId, 'point_history'), {
      amount: amount,
      reason: reason,
      created_at: serverTimestamp(),
    });

  } catch (error) {
    console.error("Error adding points:", error);
  }
};
