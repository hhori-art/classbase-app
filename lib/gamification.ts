import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, increment, arrayUnion, setDoc } from 'firebase/firestore';

// ★ポイント設定
export const POINTS = {
  ATTENDANCE: 50, // 出席
  QUIZ: 30,       // 小テスト（実力テスト）
  HOMEWORK: 100,  // 宿題（タスク完了）
};

// ★ランク定義
export const RANKS = [
  { name: 'ビギナー', min: 0, color: 'text-green-500', icon: '🌱' },
  { name: 'ブロンズ', min: 500, color: 'text-amber-700', icon: '🥉' },
  { name: 'シルバー', min: 2000, color: 'text-gray-400', icon: '🥈' },
  { name: 'ゴールド', min: 5000, color: 'text-yellow-500', icon: '🥇' },
  { name: 'マスター', min: 10000, color: 'text-purple-500', icon: '👑' },
];

// ★バッジ定義
export const BADGES = [
  { id: 'first_login', name: 'はじめの一歩', desc: '初めてログインした', icon: '🐣' },
  { id: 'hw_master', name: '宿題マスター', desc: '宿題を5回提出', icon: '📝' },
  { id: 'quiz_king', name: 'クイズ王', desc: '小テストを10回実施', icon: '🎓' },
];

export const getRank = (points: number) => {
  return RANKS.slice().reverse().find(r => points >= r.min) || RANKS[0];
};

// ポイント加算関数
export const addPoints = async (userId: string, type: 'ATTENDANCE' | 'QUIZ' | 'HOMEWORK') => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) return;
  const userData = userSnap.data();

  const today = new Date().toISOString().split('T')[0];

  // 出席は1日1回まで
  if (type === 'ATTENDANCE' && userData.last_attendance === today) {
    return { success: false, message: '本日の出席ポイントは獲得済みです' };
  }

  const pointToAdd = POINTS[type];
  
  const updates: any = {
    points: increment(pointToAdd),
    updated_at: new Date().toISOString()
  };

  if (type === 'ATTENDANCE') {
    updates.last_attendance = today;
  }
  if (type === 'HOMEWORK') {
    updates.homework_count = increment(1);
  }

  await updateDoc(userRef, updates);
  
  // バッジ獲得ロジック（例）
  if (type === 'HOMEWORK' && (userData.homework_count || 0) + 1 >= 5) {
     await updateDoc(userRef, { badges: arrayUnion('hw_master') });
  }

  return { success: true, earned: pointToAdd };
};