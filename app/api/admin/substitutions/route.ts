import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError, type ServerUser } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { queuePushToUsers } from '@/lib/server/web-push';

export const runtime = 'nodejs';

// 管理画面（/master/substitutions）の代行依頼の操作。
// 再募集：講師から出た依頼で返答した講師に担当が移っていた場合は、依頼した講師へ担当を戻してから募集し直す。

class RouteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const requesterSchoolOf = (profile: FirebaseFirestore.DocumentData | undefined) =>
  String(profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || '').trim();

async function reopenPost(user: ServerUser, body: Record<string, unknown>) {
  const postId = String(body.post_id || '').trim();
  if (!postId) throw new RouteError('post_id is required', 400);

  const db = adminDb();
  const postRef = db.collection('teacher_substitution_posts').doc(postId);
  const initial = await postRef.get();
  if (!initial.exists) throw new RouteError('post-not-found', 404);
  const initialPost = initial.data() || {};
  const teacherRaised = initialPost.requested_by_teacher === true && Boolean(initialPost.requester_id);

  // 講師からの依頼は、依頼した講師の校舎を担当する管理者（とマスター）だけが扱える。
  // 校舎が分からない依頼はマスターだけ（通知の宛先と同じ考え方）。
  if (teacherRaised && user.role !== 'master') {
    const requesterSnap = await db.collection('users').doc(String(initialPost.requester_id)).get();
    const school = requesterSchoolOf(requesterSnap.data());
    if (!school || !canManageSchool(user, school)) throw new RouteError('forbidden', 403);
  }

  const outcome: { previous: FirebaseFirestore.DocumentData; restoredTo: { user_id: string; teacher_name: string } | null } = { previous: {}, restoredTo: null };
  const shiftId = String(initialPost.shift_assignment_id || '').trim();

  await db.runTransaction(async tx => {
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists) throw new RouteError('post-not-found', 404);
    const post = postSnap.data() || {};
    if (post.status === 'open') throw new RouteError('already-open', 409);
    outcome.previous = post;
    const claimedBy = String(post.claimed_by || '');

    let shiftRef: FirebaseFirestore.DocumentReference | null = null;
    let shift: FirebaseFirestore.DocumentData | null = null;
    if (teacherRaised && claimedBy && shiftId) {
      shiftRef = db.collection('shift_assignments').doc(shiftId);
      const shiftSnap = await tx.get(shiftRef);
      shift = shiftSnap.exists ? shiftSnap.data() || {} : null;
    }

    // この依頼への返答で担当が移ったままの講師配置だけを戻す（その後に手で配置し直したものは触らない）。
    if (shiftRef && shift && String(shift.substitute_post_id || '') === postId && String(shift.user_id || '') === claimedBy) {
      const originalId = String(shift.substitute_for_user_id || post.requester_id || '');
      const originalName = String(shift.substitute_for_teacher_name || post.requester_name || post.teacher_name || '');
      if (originalId) {
        outcome.restoredTo = { user_id: originalId, teacher_name: originalName };
        tx.set(shiftRef, {
          user_id: originalId,
          teacher_name: originalName,
          substitute_post_id: FieldValue.delete(),
          substitute_for_user_id: FieldValue.delete(),
          substitute_for_teacher_name: FieldValue.delete(),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    tx.set(postRef, {
      status: 'open',
      claimed_by: null,
      claimed_by_name: null,
      reopened_by: user.uid,
      reopened_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const { previous, restoredTo } = outcome;
  const previousClaimer = String(previous.claimed_by || '');
  const requesterId = String(previous.requester_id || '');
  const label = `${previous.target_date || ''} ${previous.period || ''}「${previous.title || ''}」`;
  const notified: string[] = [];
  if (teacherRaised) {
    const notices: Array<{ userId: string; suffix: string; title: string; message: string; push: string }> = [];
    if (previousClaimer && previousClaimer !== requesterId) {
      notices.push({
        userId: previousClaimer,
        suffix: 'claimer',
        title: '代行の返答が取り消されました',
        message: `${label} の代行は、管理者が再募集に戻しました。この授業の担当ではなくなりました。`,
        push: `${label} の代行は再募集になりました。`,
      });
    }
    if (requesterId) {
      notices.push({
        userId: requesterId,
        suffix: 'requester',
        title: '代行依頼が再募集になりました',
        message: restoredTo
          ? `${label} の代行依頼を管理者が再募集に戻しました。代わりの講師が決まるまで、担当は先生に戻ります。`
          : `${label} の代行依頼を管理者が再募集に戻しました。`,
        push: `${label} の代行依頼が再募集になりました。`,
      });
    }
    await Promise.all(notices.map(notice => db.collection('user_notifications').doc(`substitution_reopened_${postId}_${notice.suffix}`.slice(0, 900)).set({
      user_id: notice.userId,
      role: 'teacher',
      title: notice.title,
      message: notice.message.slice(0, 500),
      kind: 'teacher_substitution_reopened',
      link: '/teacher/substitutions',
      substitution_post_id: postId,
      shift_assignment_id: shiftId || null,
      read: false,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    })));
    notices.forEach(notice => {
      notified.push(notice.userId);
      queuePushToUsers([notice.userId], { title: notice.title, body: notice.push, link: '/teacher/substitutions' }, { kind: 'substitution' });
    });
  }

  await writeAuditLog({
    actor: user,
    action: 'substitution_reopen',
    target_type: 'teacher_substitution_post',
    target_id: postId,
    target_label: String(previous.title || ''),
    details: {
      target_date: previous.target_date || null,
      period: previous.period || null,
      previous_status: previous.status || null,
      previous_claimed_by: previousClaimer || null,
      requested_by_teacher: teacherRaised,
      shift_assignment_id: shiftId || null,
      restored_user_id: restoredTo?.user_id || null,
    },
  });

  return Response.json({ ok: true, restored: Boolean(restoredTo), notified });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new RouteError('forbidden', 403);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    if (action === 'reopen') return await reopenPost(user, body);
    return Response.json({ ok: false, error: 'unknown-action' }, { status: 400 });
  } catch (error) {
    if (error instanceof RouteError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
