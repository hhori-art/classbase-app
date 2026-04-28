import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

type EventInput = {
  actor_id: string;
  actor_role?: string;
  type: string;
  target_id?: string;
  target_type?: string;
  school?: string;
  metadata?: Record<string, unknown>;
};

export async function writeLearningEvent(input: EventInput) {
  const db = adminDb();
  const now = FieldValue.serverTimestamp();
  const data = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const doc = await db.collection('learning_events').add({
    ...data,
    created_at: now,
  });
  return doc.id;
}

export async function writeCoinTransaction(input: {
  user_id: string;
  amount: number;
  reason: string;
  actor_id: string;
  source: string;
  event_id?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = adminDb();
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async tx => {
    const userRef = db.collection('users').doc(input.user_id);
    const txRef = db.collection('coin_transactions').doc();

    tx.set(txRef, {
      ...input,
      created_at: now,
    });

    tx.set(userRef, {
      coins: FieldValue.increment(input.amount),
      total_coins: input.amount > 0 ? FieldValue.increment(input.amount) : FieldValue.increment(0),
      updated_at: now,
    }, { merge: true });
  });
}
