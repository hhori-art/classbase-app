import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const action = String(body.action || '');
    const db = adminDb();

    if (action === 'create_topic') {
      const title = String(body.title || '').trim().slice(0, 120);
      const type = String(body.type || 'thread') === 'vote' ? 'vote' : 'thread';
      const options = Array.isArray(body.options)
        ? body.options.map((v: unknown) => String(v || '').trim()).filter(Boolean).slice(0, 5)
        : [];
      if (!title) return Response.json({ ok: false, error: 'title is required' }, { status: 400 });
      if (type === 'vote' && options.length < 2) return Response.json({ ok: false, error: 'options are required' }, { status: 400 });

      const ref = await db.collection('community_topics').add({
        title,
        type,
        options: type === 'vote' ? options : null,
        votes: {},
        voted_by: [],
        creator_uid: user.uid,
        creator_name: user.profile.student_name || user.profile.name || user.email || '名無し',
        is_approved: false,
        likes: 0,
        liked_by: [],
        created_at: FieldValue.serverTimestamp(),
        reward_given: false,
      });
      await db.collection('users').doc(user.uid).set({
        last_community_activity_date: new Date().toISOString().split('T')[0],
        earned_badges: FieldValue.arrayUnion('badge_social'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, id: ref.id });
    }

    const topicId = String(body.topic_id || '');
    if (!topicId) return Response.json({ ok: false, error: 'topic_id is required' }, { status: 400 });

    if (action === 'comment') {
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!text) return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
      const ref = await db.collection('community_topics').doc(topicId).collection('comments').add({
        text,
        uid: user.uid,
        name: user.profile.student_name || user.profile.name || user.email || '名無し',
        created_at: FieldValue.serverTimestamp(),
      });
      await db.collection('users').doc(user.uid).set({
        last_community_activity_date: new Date().toISOString().split('T')[0],
        earned_badges: FieldValue.arrayUnion('badge_social'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, id: ref.id });
    }

    if (action === 'like') {
      const topicRef = db.collection('community_topics').doc(topicId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(topicRef);
        if (!snap.exists) throw new Error('topic-not-found');
        const likedBy = Array.isArray(snap.data()?.liked_by) ? snap.data()!.liked_by : [];
        if (likedBy.includes(user.uid)) return;
        tx.update(topicRef, {
          likes: FieldValue.increment(1),
          liked_by: FieldValue.arrayUnion(user.uid),
        });
      });
      await db.collection('users').doc(user.uid).set({
        last_community_activity_date: new Date().toISOString().split('T')[0],
        earned_badges: FieldValue.arrayUnion('badge_social'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true });
    }

    if (action === 'vote') {
      const optionIndex = Number(body.option_index);
      if (!Number.isInteger(optionIndex) || optionIndex < 0) return Response.json({ ok: false, error: 'invalid option' }, { status: 400 });
      const topicRef = db.collection('community_topics').doc(topicId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(topicRef);
        if (!snap.exists) throw new Error('topic-not-found');
        const votedBy = Array.isArray(snap.data()?.voted_by) ? snap.data()!.voted_by : [];
        if (votedBy.includes(user.uid)) return;
        tx.update(topicRef, {
          [`votes.${optionIndex}`]: FieldValue.increment(1),
          voted_by: FieldValue.arrayUnion(user.uid),
        });
      });
      await db.collection('users').doc(user.uid).set({
        last_community_activity_date: new Date().toISOString().split('T')[0],
        earned_badges: FieldValue.arrayUnion('badge_social'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
