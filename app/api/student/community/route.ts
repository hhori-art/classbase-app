import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

function japanDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || '');
    const teacherAudience = body.audience === 'teacher';
    if (teacherAudience) requireRole(user, ['teacher', 'admin', 'master']);
    else requireRole(user, ['student']);
    const db = adminDb();
    const collectionName = teacherAudience ? 'teacher_community_topics' : 'community_topics';
    const markStudentActivity = async () => {
      if (teacherAudience) return;
      await db.collection('users').doc(user.uid).set({
        last_community_activity_date: japanDateKey(),
        community_activity_count: FieldValue.increment(1),
        earned_badges: FieldValue.arrayUnion('badge_social'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    };

    if (action === 'create_topic') {
      const title = String(body.title || '').trim().slice(0, 120);
      const type = String(body.type || 'thread') === 'vote' ? 'vote' : 'thread';
      const options = Array.isArray(body.options)
        ? body.options.map((v: unknown) => String(v || '').trim().slice(0, 120)).filter(Boolean).slice(0, 5)
        : [];
      if (!title) return Response.json({ ok: false, error: 'title is required' }, { status: 400 });
      if (type === 'vote' && options.length < 2) return Response.json({ ok: false, error: 'options are required' }, { status: 400 });
      if (type === 'vote' && new Set(options).size !== options.length) return Response.json({ ok: false, error: 'options must be unique' }, { status: 400 });

      const category = ['instruction', 'operation', 'chat'].includes(String(body.category || ''))
        ? String(body.category)
        : 'instruction';
      const anonymous = teacherAudience && body.is_anonymous === true;
      const ref = await db.collection(collectionName).add({
        title,
        type,
        ...(teacherAudience ? { category, is_anonymous: anonymous } : {}),
        options: type === 'vote' ? options : null,
        votes: {},
        voted_by: [],
        creator_uid: user.uid,
        creator_name: anonymous ? '匿名講師' : user.profile.student_name || user.profile.name || user.email || '名前未設定',
        is_approved: teacherAudience,
        likes: 0,
        liked_by: [],
        created_at: FieldValue.serverTimestamp(),
        reward_given: false,
      });
      await markStudentActivity();
      return Response.json({ ok: true, id: ref.id });
    }

    const topicId = String(body.topic_id || '');
    if (!topicId) return Response.json({ ok: false, error: 'topic_id is required' }, { status: 400 });

    if (action === 'comment') {
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!text) return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
      const [topicSnap] = await db.getAll(db.collection(collectionName).doc(topicId));
      if (!topicSnap.exists || topicSnap.data()?.is_approved !== true || topicSnap.data()?.archived === true) {
        return Response.json({ ok: false, error: 'approved topic not found' }, { status: 404 });
      }
      const anonymous = teacherAudience && body.is_anonymous === true;
      const ref = await db.collection(collectionName).doc(topicId).collection('comments').add({
        text,
        uid: user.uid,
        name: anonymous ? '匿名講師' : user.profile.student_name || user.profile.name || user.email || '名前未設定',
        ...(teacherAudience ? { is_anonymous: anonymous } : {}),
        created_at: FieldValue.serverTimestamp(),
      });
      await markStudentActivity();
      return Response.json({ ok: true, id: ref.id });
    }

    if (action === 'like') {
      const topicRef = db.collection(collectionName).doc(topicId);
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(topicRef);
        if (!snap.exists || snap.data()?.is_approved !== true || snap.data()?.archived === true) throw new Error('topic-not-found');
        const topic = snap.data() || {};
        const likedBy = Array.isArray(topic.liked_by) ? topic.liked_by : [];
        if (likedBy.includes(user.uid)) return { applied: false, likes: Number(snap.data()?.likes || 0) };
        const likes = Number(topic.likes || 0) + 1;
        const creatorId = String(topic.creator_uid || '');
        const rewardRef = db.collection('coin_transactions').doc(
          `${creatorId}_community_like_reward_${collectionName}_${topicId}`.replace(/[\/\s#?]/g, '_')
        );
        const creatorRef = db.collection('users').doc(creatorId || '_missing_creator');
        const [creatorSnap, rewardSnap] = await tx.getAll(creatorRef, rewardRef);
        const creatorRole = String(creatorSnap.data()?.role || '').toLowerCase();
        const eligibleCreator = collectionName === 'community_topics'
          ? creatorRole === 'student'
          : ['teacher', 'admin', 'master', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin'].includes(creatorRole);
        const shouldReward = likes >= 10 && topic.reward_given !== true && creatorSnap.exists && eligibleCreator;
        tx.update(topicRef, {
          likes: FieldValue.increment(1),
          liked_by: FieldValue.arrayUnion(user.uid),
          ...(shouldReward || rewardSnap.exists ? {
            reward_given: true,
            reward_given_at: FieldValue.serverTimestamp(),
          } : {}),
        });
        if (shouldReward && !rewardSnap.exists) {
          tx.set(rewardRef, {
            user_id: creatorId,
            amount: 5,
            reason: 'コミュニティいいね報酬',
            actor_id: user.uid,
            source: 'community_like_reward',
            source_id: `${collectionName}_${topicId}`,
            metadata: { topic_id: topicId, collection_name: collectionName, likes },
            created_at: FieldValue.serverTimestamp(),
          });
          tx.set(creatorRef, {
            coins: FieldValue.increment(5),
            total_coins: FieldValue.increment(5),
            updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return { applied: true, likes, reward_applied: shouldReward && !rewardSnap.exists };
      });
      await markStudentActivity();
      return Response.json({ ok: true, ...result });
    }

    if (action === 'vote') {
      const optionIndex = Number(body.option_index);
      if (!Number.isInteger(optionIndex) || optionIndex < 0) return Response.json({ ok: false, error: 'invalid option' }, { status: 400 });
      const topicRef = db.collection(collectionName).doc(topicId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(topicRef);
        const topic = snap.data() || {};
        const options = Array.isArray(topic.options) ? topic.options : [];
        if (!snap.exists || topic.is_approved !== true || topic.archived === true || topic.type !== 'vote' || optionIndex >= options.length) {
          throw new Error('topic-not-found');
        }
        const votedBy = Array.isArray(snap.data()?.voted_by) ? snap.data()!.voted_by : [];
        if (votedBy.includes(user.uid)) return;
        tx.update(topicRef, {
          [`votes.${optionIndex}`]: FieldValue.increment(1),
          voted_by: FieldValue.arrayUnion(user.uid),
        });
      });
      await markStudentActivity();
      return Response.json({ ok: true });
    }

    if (teacherAudience && action === 'delete_topic') {
      const topicRef = db.collection(collectionName).doc(topicId);
      const [topicSnap] = await db.getAll(topicRef);
      if (!topicSnap.exists) return Response.json({ ok: false, error: 'topic not found' }, { status: 404 });
      if (String(topicSnap.data()?.creator_uid || '') !== user.uid && !['admin', 'master'].includes(user.role)) {
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      await topicRef.set({
        archived: true,
        is_approved: false,
        archived_at: FieldValue.serverTimestamp(),
        archived_by: user.uid,
      }, { merge: true });
      return Response.json({ ok: true });
    }

    if (teacherAudience && action === 'delete_comment') {
      const commentId = String(body.comment_id || '').trim();
      if (!commentId || commentId.includes('/')) return Response.json({ ok: false, error: 'comment_id is required' }, { status: 400 });
      const commentRef = db.collection(collectionName).doc(topicId).collection('comments').doc(commentId);
      const [commentSnap] = await db.getAll(commentRef);
      if (!commentSnap.exists) return Response.json({ ok: false, error: 'comment not found' }, { status: 404 });
      if (String(commentSnap.data()?.uid || '') !== user.uid && !['admin', 'master'].includes(user.role)) {
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      await commentRef.delete();
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
