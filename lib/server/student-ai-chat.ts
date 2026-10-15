import 'server-only';
import { adminDb } from '@/lib/firebase-admin';

export type StudentAiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at_ms: number;
};

export async function loadStudentAiChatHistory(userId: string, requestedLimit = 100): Promise<StudentAiChatMessage[]> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId || safeUserId.includes('/')) throw new Error('invalid-user');
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(requestedLimit) || 100)));
  const snap = await adminDb().collection('users').doc(safeUserId).collection('chat_history')
    .orderBy('createdAt', 'desc').limit(boundedLimit).get();
  return snap.docs.map(doc => ({
    id: doc.id,
    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
    content: String(doc.data().content || '').slice(0, 8000),
    created_at_ms: doc.data().createdAt?.toMillis?.() || doc.data().created_at?.toMillis?.() || 0,
  }));
}
