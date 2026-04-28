import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

const substituteMarkers = ['⇒', '→', '代講', '代行', '未定', '調整', '募集'];
const isSubstitutePlaceholder = (value: unknown) => {
  const name = String(value || '').trim();
  if (!name) return true;
  return substituteMarkers.some(marker => name.includes(marker));
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);

    const body = await request.json();
    const postId = String(body.post_id || '').trim();
    if (!postId) return Response.json({ ok: false, error: 'post_id is required' }, { status: 400 });

    const db = adminDb();
    const postRef = db.collection('teacher_substitution_posts').doc(postId);
    const teacherName = user.profile.name || user.profile.student_name || user.email || '講師';
    let shiftId = '';

    await db.runTransaction(async tx => {
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists) throw new Error('post-not-found');
      const post = postSnap.data() || {};
      if (post.status !== 'open') throw new Error('already-claimed-or-closed');
      shiftId = String(post.shift_assignment_id || '').trim();

      if (shiftId) {
        const shiftRef = db.collection('shift_assignments').doc(shiftId);
        const shiftSnap = await tx.get(shiftRef);
        if (!shiftSnap.exists) throw new Error('shift-not-found');
        const shift = shiftSnap.data() || {};
        if (shift.user_id && !isSubstitutePlaceholder(shift.teacher_name)) throw new Error('shift-already-filled');
        if (!isSubstitutePlaceholder(shift.teacher_name)) throw new Error('shift-already-filled');
        tx.set(shiftRef, {
          user_id: user.uid,
          teacher_name: teacherName,
          substitute_post_id: postId,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      tx.set(postRef, {
        status: 'claimed',
        claimed_by: user.uid,
        claimed_by_name: teacherName,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'teacher_substitution_claimed',
      target_id: postId,
      target_type: 'teacher_substitution_post',
      school: user.school,
      metadata: { shift_assignment_id: shiftId || null },
    });

    return Response.json({ ok: true, event_id: eventId, shift_assignment_id: shiftId || null });
  } catch (error) {
    return jsonError(error);
  }
}
