import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole, type ServerUser } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { jstDateKey } from '@/lib/date-key';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';
import { queuePushToUsers } from '@/lib/server/web-push';

export const runtime = 'nodejs';

const substituteMarkers = ['⇒', '→', '代講', '代行', '未定', '調整', '募集'];
const isSubstitutePlaceholder = (value: unknown) => {
  const name = String(value || '').trim();
  if (!name) return true;
  return substituteMarkers.some(marker => name.includes(marker));
};

const MAX_REASON_LENGTH = 500;
const MAX_OWN_SHIFTS = 60;

const teacherNameOf = (user: ServerUser) =>
  String(user.profile.name || user.profile.student_name || user.profile.display_name || user.email || '講師').trim();

// 管理画面（/master/substitutions）の「講師配置から作成」と同じ表記にそろえる。
const periodFromShift = (shift: FirebaseFirestore.DocumentData) => {
  const raw = `${shift.note || ''} ${shift.target_detail_subject || ''}`.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (Number(shift.period) === 1 || raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return '1限';
  if (Number(shift.period) === 2 || raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return '2限';
  return String(shift.note || 'その他');
};
const shiftTitle = (shift: FirebaseFirestore.DocumentData) => {
  const subject = [shift.target_grade, shift.target_subject, shift.target_detail_subject].filter(Boolean).join(' ');
  return subject || String(shift.note || '') || '授業';
};
const shiftView = (id: string, shift: FirebaseFirestore.DocumentData) => ({
  id,
  target_date: String(shift.target_date || ''),
  period: periodFromShift(shift),
  title: shiftTitle(shift),
  role_type: String(shift.role_type || 'main'),
  unit: String(shift.unit || ''),
  target_place: String(shift.target_place || shift.teacher_workplace || ''),
  substitute_post_id: String(shift.substitute_post_id || ''),
});

class RouteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function ownUpcomingShifts(user: ServerUser) {
  const db = adminDb();
  const today = jstDateKey();
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  try {
    docs = (await db.collection('shift_assignments')
      .where('user_id', '==', user.uid)
      .where('target_date', '>=', today)
      .orderBy('target_date', 'asc')
      .limit(MAX_OWN_SHIFTS)
      .get()).docs;
  } catch {
    // 複合インデックスの作成前でも動くよう、講師IDだけで読んで日付は手元で絞る。
    docs = (await db.collection('shift_assignments').where('user_id', '==', user.uid).limit(500).get()).docs;
  }
  return docs
    .map(doc => shiftView(doc.id, doc.data() || {}))
    .filter(shift => shift.target_date >= today)
    .sort((a, b) => a.target_date.localeCompare(b.target_date) || a.period.localeCompare(b.period))
    .slice(0, MAX_OWN_SHIFTS);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);
    return Response.json({ ok: true, shifts: await ownUpcomingShifts(user) });
  } catch (error) {
    return jsonError(error);
  }
}

async function requestSubstitution(user: ServerUser, body: Record<string, unknown>) {
  const shiftId = String(body.shift_assignment_id || '').trim();
  const reason = String(body.reason || '').trim();
  if (!shiftId) throw new RouteError('shift_assignment_id is required', 400);
  if (!reason) throw new RouteError('reason-required', 400);
  if (reason.length > MAX_REASON_LENGTH) throw new RouteError('reason-too-long', 400);

  const db = adminDb();
  const shiftRef = db.collection('shift_assignments').doc(shiftId);
  // 同じ講師配置への依頼は1件にまとめ、取り下げ後の再依頼は同じ文書を使い直す。
  const postRef = db.collection('teacher_substitution_posts').doc(`teacher_${shiftId}`.slice(0, 900));
  const teacherName = teacherNameOf(user);
  let post: Record<string, unknown> = {};

  await db.runTransaction(async tx => {
    const shiftSnap = await tx.get(shiftRef);
    if (!shiftSnap.exists) throw new RouteError('shift-not-found', 404);
    const shift = shiftSnap.data() || {};
    if (String(shift.user_id || '') !== user.uid) throw new RouteError('forbidden', 403);
    const targetDate = String(shift.target_date || '');
    if (!targetDate || targetDate < jstDateKey()) throw new RouteError('shift-in-past', 400);

    const [existingPost, linked] = await Promise.all([
      tx.get(postRef),
      tx.get(db.collection('teacher_substitution_posts').where('shift_assignment_id', '==', shiftId)),
    ]);
    const active = (data: FirebaseFirestore.DocumentData | undefined) => data?.status === 'open' || data?.status === 'claimed';
    if (active(existingPost.data()) || linked.docs.some(doc => active(doc.data()))) throw new RouteError('already-requested', 409);

    const view = shiftView(shiftId, shift);
    post = {
      created_by: user.uid,
      teacher_id: user.uid,
      teacher_name: teacherName,
      requested_by_teacher: true,
      requester_id: user.uid,
      requester_name: teacherName,
      reason,
      target_date: targetDate,
      period: view.period,
      title: view.title,
      detail: [
        `理由: ${reason}`,
        view.unit ? `単元: ${view.unit}` : '',
        view.target_place ? `場所: ${view.target_place}` : '',
        `現在の担当: ${teacherName}`,
      ].filter(Boolean).join('\n'),
      shift_assignment_id: shiftId,
      shift_summary: {
        target_grade: String(shift.target_grade || ''),
        target_subject: String(shift.target_subject || ''),
        target_detail_subject: String(shift.target_detail_subject || ''),
        unit: view.unit,
        target_place: view.target_place,
      },
      status: 'open',
      claimed_by: null,
      claimed_by_name: null,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    tx.set(postRef, post);
  });

  const recipients = await loadSchoolStaffRecipients(user.profile.school_id || user.school);
  const notified = await notifyStaff(recipients, {
    idPrefix: `substitution_request_${postRef.id}`,
    title: '講師から代行依頼が届きました',
    message: `${teacherName} 先生: ${post.target_date} ${post.period}「${post.title}」 理由: ${reason}`.slice(0, 500),
    kind: 'teacher_substitution_request',
    masterLink: '/master/substitutions',
    pushBody: `${post.target_date} ${post.period} の代行依頼です。`,
    extra: { substitution_post_id: postRef.id, shift_assignment_id: shiftId },
  });
  return Response.json({ ok: true, post_id: postRef.id, notified_count: notified });
}

async function cancelRequest(user: ServerUser, body: Record<string, unknown>) {
  const postId = String(body.post_id || '').trim();
  if (!postId) throw new RouteError('post_id is required', 400);
  const db = adminDb();
  const postRef = db.collection('teacher_substitution_posts').doc(postId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(postRef);
    if (!snap.exists) throw new RouteError('post-not-found', 404);
    const post = snap.data() || {};
    if (String(post.requester_id || '') !== user.uid) throw new RouteError('forbidden', 403);
    if (post.status !== 'open') throw new RouteError('already-claimed-or-closed', 409);
    tx.set(postRef, { status: 'closed', cancelled_by_requester: true, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  });
  return Response.json({ ok: true });
}

async function claimPost(user: ServerUser, body: Record<string, unknown>) {
  const postId = String(body.post_id || '').trim();
  if (!postId) return Response.json({ ok: false, error: 'post_id is required' }, { status: 400 });

  const db = adminDb();
  const postRef = db.collection('teacher_substitution_posts').doc(postId);
  const teacherName = teacherNameOf(user);
  let shiftId = '';
  let requesterId = '';
  let postLabel = '';

  await db.runTransaction(async tx => {
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists) throw new Error('post-not-found');
    const post = postSnap.data() || {};
    if (post.status !== 'open') throw new Error('already-claimed-or-closed');
    requesterId = String(post.requester_id || '');
    if (requesterId && requesterId === user.uid) throw new Error('cannot-claim-own-request');
    postLabel = `${post.target_date || ''} ${post.period || ''}「${post.title || ''}」`;
    shiftId = String(post.shift_assignment_id || '').trim();

    if (shiftId) {
      const shiftRef = db.collection('shift_assignments').doc(shiftId);
      const shiftSnap = await tx.get(shiftRef);
      if (!shiftSnap.exists) throw new Error('shift-not-found');
      const shift = shiftSnap.data() || {};
      // 講師本人が出した依頼は、まだ本人が担当のままなら引き継げる。
      const handover = Boolean(requesterId) && String(shift.user_id || '') === requesterId;
      const filledByThisPost = String(shift.substitute_post_id || '') === postId;
      if (!handover && !filledByThisPost && !isSubstitutePlaceholder(shift.teacher_name)) throw new Error('shift-already-filled');
      tx.set(shiftRef, {
        user_id: user.uid,
        teacher_name: teacherName,
        substitute_post_id: postId,
        ...(handover ? { substitute_for_user_id: requesterId, substitute_for_teacher_name: String(shift.teacher_name || '') } : {}),
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

  if (requesterId) {
    await db.collection('user_notifications').doc(`substitution_claimed_${postId}`).set({
      user_id: requesterId,
      role: 'teacher',
      title: '代行依頼に返答がありました',
      message: `${teacherName} 先生が ${postLabel} を代行できると返答しました。`.slice(0, 500),
      kind: 'teacher_substitution_claimed',
      link: '/teacher/substitutions',
      read: false,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    queuePushToUsers([requesterId], { title: '代行依頼に返答がありました', body: `${postLabel} の代行を引き受ける講師が見つかりました。`, link: '/teacher/substitutions' }, { kind: 'substitution' });
  }

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
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || 'claim');
    if (action === 'request') return await requestSubstitution(user, body);
    if (action === 'cancel') return await cancelRequest(user, body);
    if (action === 'claim') return await claimPost(user, body);
    return Response.json({ ok: false, error: 'unknown-action' }, { status: 400 });
  } catch (error) {
    if (error instanceof RouteError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
