import 'server-only';
import { adminDb } from '@/lib/firebase-admin';

export type StudentAiChatMessage = {
  id: string;
  request_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at_ms: number;
};

const ROLE_ORDER = { user: 0, assistant: 1 } as const;

/**
 * 古い順の比較。旧データは質問と回答が同じ createdAt で保存されているため、
 * 同じ時刻・同じ request_id のときは質問(user)を先に並べる。
 */
export function compareStudentAiChatMessages(a: StudentAiChatMessage, b: StudentAiChatMessage) {
  if (a.created_at_ms !== b.created_at_ms) return a.created_at_ms - b.created_at_ms;
  if (a.request_id && a.request_id === b.request_id) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  return 0;
}

/** 新しい順で返す（呼び出し側で reverse すると古い順の会話になる）。 */
export async function loadStudentAiChatHistory(userId: string, requestedLimit = 100): Promise<StudentAiChatMessage[]> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId || safeUserId.includes('/')) throw new Error('invalid-user');
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(requestedLimit) || 100)));
  const snap = await adminDb().collection('users').doc(safeUserId).collection('chat_history')
    .orderBy('createdAt', 'desc').limit(boundedLimit).get();
  const messages: StudentAiChatMessage[] = snap.docs.map(doc => {
    const data = doc.data();
    const toMillis = (value: any) => value?.toMillis?.() || (typeof value?.getTime === 'function' ? value.getTime() : 0);
    return {
      id: doc.id,
      request_id: String(data.request_id || '').trim() || doc.id.replace(/_(user|assistant)$/, ''),
      role: data.role === 'assistant' ? 'assistant' : 'user',
      content: String(data.content || '').slice(0, 8000),
      created_at_ms: toMillis(data.createdAt) || toMillis(data.created_at) || Number(data.created_at_ms) || 0,
    };
  });
  return messages.sort(compareStudentAiChatMessages).reverse();
}
