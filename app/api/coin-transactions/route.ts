import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

const MISSION_CONFIG: Record<string, { amount: number; label: string }> = {
  last_mission_date: { amount: 10, label: 'ログインミッション' },
  last_ai_mission_date: { amount: 20, label: 'AI学習ミッション' },
};

async function applyCoinOnce(input: {
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
  source: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = adminDb();
  const txId = `${input.userId}_${input.source}_${input.sourceId}`.replace(/[\/\s#?]/g, '_');
  const txRef = db.collection('coin_transactions').doc(txId);
  const userRef = db.collection('users').doc(input.userId);

  return db.runTransaction(async tx => {
    const [txSnap, userSnap] = await Promise.all([tx.get(txRef), tx.get(userRef)]);
    if (txSnap.exists) return { applied: false, transaction_id: txId, coins: userSnap.data()?.coins || 0 };
    const currentCoins = Number(userSnap.data()?.coins || 0);
    if (input.amount < 0 && currentCoins + input.amount < 0) {
      throw new Error('insufficient-coins');
    }

    tx.set(txRef, {
      user_id: input.userId,
      amount: input.amount,
      reason: input.reason,
      actor_id: input.actorId,
      source: input.source,
      source_id: input.sourceId,
      metadata: input.metadata || {},
      created_at: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, {
      coins: FieldValue.increment(input.amount),
      total_coins: input.amount > 0 ? FieldValue.increment(input.amount) : FieldValue.increment(0),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { applied: true, transaction_id: txId, coins: currentCoins + input.amount };
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || '');

    if (action === 'homework_submission_reward') {
      requireRole(user, ['student']);
      const assignmentId = String(body.assignment_id || '');
      if (!assignmentId) return Response.json({ ok: false, error: 'assignment_id is required' }, { status: 400 });
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: 50,
        reason: '宿題提出',
        actorId: user.uid,
        source: 'homework_submission',
        sourceId: assignmentId,
        metadata: { assignment_id: assignmentId },
      });
      await adminDb().collection('users').doc(user.uid).set({
        homework_count: FieldValue.increment(result.applied ? 1 : 0),
        earned_badges: FieldValue.arrayUnion('badge_pencil'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'survey_reward') {
      requireRole(user, ['student']);
      const shiftId = String(body.shift_id || '');
      if (!shiftId) return Response.json({ ok: false, error: 'shift_id is required' }, { status: 400 });
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: 10,
        reason: '授業アンケート回答',
        actorId: user.uid,
        source: 'survey_response',
        sourceId: shiftId,
        metadata: { shift_id: shiftId },
      });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'mission_reward') {
      requireRole(user, ['student']);
      const dateField = String(body.date_field || '');
      const config = MISSION_CONFIG[dateField];
      if (!config) return Response.json({ ok: false, error: 'invalid mission' }, { status: 400 });
      const today = new Date().toISOString().split('T')[0];
      const userRef = adminDb().collection('users').doc(user.uid);
      const snap = await userRef.get();
      if (snap.data()?.[dateField] === today) return Response.json({ ok: true, applied: false, already_claimed: true, coins: snap.data()?.coins || 0 });
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: config.amount,
        reason: config.label,
        actorId: user.uid,
        source: dateField,
        sourceId: today,
        metadata: { date_field: dateField },
      });
      if (result.applied) {
        await userRef.set({ [dateField]: today, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      }
      return Response.json({ ok: true, amount: config.amount, ...result });
    }

    if (action === 'reward_exchange') {
      requireRole(user, ['student']);
      const rewardId = String(body.reward_id || '');
      if (!rewardId) return Response.json({ ok: false, error: 'reward_id is required' }, { status: 400 });
      const db = adminDb();
      const rewardSnap = await db.collection('rewards').doc(rewardId).get();
      if (!rewardSnap.exists) return Response.json({ ok: false, error: 'reward not found' }, { status: 404 });
      const reward = rewardSnap.data() || {};
      const cost = Math.max(0, Number(reward.required_coins || 0));
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: -cost,
        reason: `景品交換: ${reward.name || rewardId}`,
        actorId: user.uid,
        source: 'reward_exchange',
        sourceId: rewardId,
        metadata: { reward_id: rewardId, reward_name: reward.name || '', cost },
      });
      if (result.applied) {
        await db.collection('requests').add({
          type: 'exchange',
          userId: user.uid,
          userName: user.profile.student_name || user.profile.name || user.email || '生徒',
          rewardId,
          rewardName: reward.name || '',
          cost,
          status: 'pending',
          created_at: FieldValue.serverTimestamp(),
        });
      }
      return Response.json({ ok: true, cost, ...result });
    }

    if (action === 'community_like_reward') {
      requireRole(user, ['student', 'teacher', 'admin', 'master']);
      const topicId = String(body.topic_id || '');
      const collectionName = String(body.collection_name || 'community_topics');
      if (!['community_topics', 'teacher_community_topics'].includes(collectionName)) {
        return Response.json({ ok: false, error: 'invalid collection_name' }, { status: 400 });
      }
      if (!topicId) return Response.json({ ok: false, error: 'topic_id is required' }, { status: 400 });
      const db = adminDb();
      const topicRef = db.collection(collectionName).doc(topicId);
      const topicSnap = await topicRef.get();
      if (!topicSnap.exists) return Response.json({ ok: false, error: 'topic not found' }, { status: 404 });
      const topic = topicSnap.data() || {};
      const likes = Number(topic.likes || 0);
      if (topic.reward_given || likes < 10 || !topic.creator_uid) {
        return Response.json({ ok: true, applied: false });
      }
      const result = await applyCoinOnce({
        userId: String(topic.creator_uid),
        amount: 5,
        reason: 'コミュニティいいね報酬',
        actorId: user.uid,
        source: 'community_like_reward',
        sourceId: `${collectionName}_${topicId}`,
        metadata: { topic_id: topicId, collection_name: collectionName, likes },
      });
      if (result.applied) {
        await topicRef.set({ reward_given: true, reward_given_at: FieldValue.serverTimestamp() }, { merge: true });
      }
      return Response.json({ ok: true, ...result });
    }

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'coin_transaction_rejected',
      target_type: 'coin_transaction',
      school: user.school,
      metadata: { action },
    });
    return Response.json({ ok: false, error: 'invalid action', event_id: eventId }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
