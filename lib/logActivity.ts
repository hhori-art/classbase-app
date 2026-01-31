import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export type ActivityType = 'login' | 'submit' | 'chat' | 'entry' | 'alert';

/**
 * アクティビティログを記録する関数
 * @param uid ユーザーID (ない場合は 'system')
 * @param userName ユーザー名
 * @param type 行動タイプ
 * @param content ログの内容
 */
export const logActivity = async (uid: string, userName: string, type: ActivityType, content: string) => {
  try {
    await addDoc(collection(db, 'activity_logs'), {
      uid,
      userName,
      type,
      content,
      created_at: serverTimestamp(),
    });
  } catch (e) {
    console.error("Log Error:", e);
  }
};