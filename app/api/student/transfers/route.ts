import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { verifyTransferOptionToken } from '@/lib/server/transfer-option-token';
import { linkedParentIds, loadParentIdsListingStudent } from '@/lib/server/linked-parents';
import { queuePushToUsers } from '@/lib/server/web-push';

export const runtime = 'nodejs';

function clean(value: unknown) {
  return String(value || '').trim();
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const db = adminDb();
    const absenceId = clean(body.absence_id);
    const transferShiftId = clean(body.transfer_shift_id);
    const transferToken = clean(body.transfer_token);
    const note = clean(body.note);
    if (!absenceId || !transferShiftId || !transferToken) {
      return Response.json({ ok: false, error: 'absence_id, transfer_shift_id and transfer_token are required' }, { status: 400 });
    }
    const grant = verifyTransferOptionToken(transferToken, {
      actor_id: user.uid, student_id: user.uid, absence_id: absenceId, shift_id: transferShiftId,
    });
    // 振替は欠席1件につき1件。保護者画面からの振替と同じく、欠席IDをもとにした固定IDで作る。
    const requestRef = db.collection('requests').doc(`${absenceId}_transfer`);
    const extraParentIds = await loadParentIdsListingStudent(db, user.uid);
    let notifiedParentIds: string[] = [];
    let pushBody = '';
    await db.runTransaction(async transaction => {
      notifiedParentIds = [];
      const absenceRef = db.collection('requests').doc(absenceId);
      const shiftRef = db.collection('shift_assignments').doc(transferShiftId);
      const [absenceSnap, shiftSnap, existingTransferSnap] = await transaction.getAll(absenceRef, shiftRef, requestRef);
      const absence = absenceSnap.data() || {};
      const shift = shiftSnap.data() || {};
      if (!absenceSnap.exists || absence.student_id !== user.uid || absence.type !== 'absence') throw new Error('forbidden');
      if (['cancelled', 'rejected'].includes(String(absence.status || ''))) throw new Error('absence is not active');
      if (absence.absence_type === 'late') throw new Error('late requests cannot be transferred');
      if (absence.transfer_status === 'registered' || absence.transfer_request_id) throw new Error('transfer already registered');
      if (existingTransferSnap.exists && !['cancelled', 'rejected'].includes(String(existingTransferSnap.data()?.status || ''))) {
        throw new Error('transfer already registered');
      }
      if (!shiftSnap.exists) throw new Error('transfer-shift-not-found');
      const shiftDate = clean(shift.target_date).slice(0, 10);
      const shiftUnit = clean(shift.unit);
      const shiftSubject = clean(shift.target_subject);
      const shiftCourse = clean(shift.target_detail_subject || shift.target_subject);
      if (shiftDate !== grant.target_date || shiftUnit !== grant.unit || shiftSubject !== grant.subject || shiftCourse !== grant.course_name) {
        throw new Error('transfer option changed; reload options');
      }
      if (shiftDate === clean(absence.target_date).slice(0, 10)) throw new Error('transfer date must differ from absence date');
      const parentId = clean(user.profile.parent_uid || absence.parent_id);
      const studentName = clean(user.profile.student_name || user.profile.name) || '生徒';
      transaction.set(requestRef, {
        user_id: user.uid, student_id: user.uid,
        student_name: studentName, parent_id: parentId || null,
        type: 'transfer', source: 'student_portal', absence_request_id: absenceId,
        absence_date: absence.target_date || null, target_date: shiftDate,
        transfer_shift_id: transferShiftId, target_shift_id: transferShiftId,
        transfer_unit: shiftUnit || null, transfer_subject: shiftSubject || null,
        transfer_course_name: shiftCourse || null, transfer_period: grant.period || null,
        transfer_meeting_id: shift.target_meeting_id || null,
        content: `【振替確定】\n${shiftDate} ${shiftSubject} ${shiftCourse}${shiftUnit ? ` / ${shiftUnit}` : ''}\n${note}`,
        reason: note, status: 'confirmed', created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      });
      transaction.set(absenceRef, {
        transfer_status: 'registered', transfer_request_id: requestRef.id, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      // 生徒に結びつく保護者全員（parent_ids / parent_uid / 保護者側の student_ids）へ知らせる。
      notifiedParentIds = linkedParentIds({ ...user.profile, parent_uid: parentId }, extraParentIds);
      pushBody = `${shiftDate}の授業に振替が確定しました。`;
      notifiedParentIds.forEach(id => {
        transaction.set(db.collection('user_notifications').doc(`transfer_${requestRef.id}_parent_${id}`), {
          user_id: id, role: 'parent', title: '振替が確定しました',
          message: `${studentName}さんの振替が確定しました。${shiftDate} ${shiftCourse}${shiftUnit ? `（${shiftUnit}）` : ''}`,
          kind: 'student_transfer_confirmed', request_id: requestRef.id, absence_request_id: absenceId,
          student_id: user.uid, student_name: studentName,
          read: false, created_at: FieldValue.serverTimestamp(),
        });
      });
    });
    queuePushToUsers(notifiedParentIds, { title: '振替が確定しました', body: pushBody, link: '/parent/notifications' }, { kind: 'attendance' });
    return Response.json({ ok: true, id: requestRef.id });
  } catch (error) {
    return jsonError(error);
  }
}
