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
  // --- 基本バッジ（最初から見える） ---
  { id: 'badge_1', name: 'はじまりの葉', icon: '🌱', description: '最初の授業に参加した証', secret: false },
  { id: 'badge_pencil', name: '学習家', icon: '✏️', description: '宿題を提出した証', secret: false },
  { id: 'badge_book', name: '本の虫', icon: '📚', description: 'アーカイブを視聴した証', secret: false },
  { id: 'badge_sun', name: '早起き', icon: '☀️', description: '午前の授業に参加した', secret: false },
  
  // --- 継続・回数バッジ（見える） ---
  { id: 'badge_fire_3', name: '三日熱中', icon: '🔥', description: '3回連続で出席した', secret: false },
  { id: 'badge_star_10', name: 'スター生徒', icon: '⭐️', description: '累計10回出席した', secret: false },
  { id: 'badge_medal', name: '継続の達人', icon: '🏅', description: '宿題を5回提出した', secret: false },
  
  // --- 実力バッジ（見える） ---
  { id: 'badge_brain', name: '博識博士', icon: '🧠', description: '理科と社会の両方を受けた', secret: false },
  { id: 'badge_rocket', name: '急成長', icon: '🚀', description: '1週間で100ポイント獲得', secret: false },

  // --- シークレットバッジ（獲得するまで「???」になる） ---
  { id: 'badge_owl', name: '夜更かしフクロウ', icon: '🦉', description: '夜20時以降にログインした', secret: true },
  { id: 'badge_ninja', name: '忍びの者', icon: '🥷', description: 'カメラオフで授業に参加', secret: true },
  { id: 'badge_king', name: '富豪王', icon: '💰', description: '所持コインが1000枚を超えた', secret: true },
  { id: 'badge_robot', name: 'メカニック', icon: '🤖', description: 'システム設定を変更した', secret: true },
  { id: 'badge_alien', name: '宇宙人', icon: '👽', description: '誰もいない教室に入った', secret: true },
  { id: 'badge_dragon', name: '伝説の龍', icon: '🐉', description: '全種類の授業を制覇した', secret: true },
  { id: 'badge_rainbow', name: '虹色気分', icon: '🌈', description: '7日間連続ログイン達成', secret: true },
  { id: 'badge_gem', name: 'トレジャーハンター', icon: '💎', description: '隠しページを見つけた', secret: true },
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