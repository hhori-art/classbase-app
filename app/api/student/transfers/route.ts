import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

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
    const note = clean(body.note);
    if (!absenceId || !transferShiftId) {
      return Response.json({ ok: false, error: 'absence_id and transfer_shift_id are required' }, { status: 400 });
    }

    const [absenceSnap, shiftSnap] = await Promise.all([
      db.collection('requests').doc(absenceId).get(),
      db.collection('shift_assignments').doc(transferShiftId).get(),
    ]);
    if (!absenceSnap.exists || absenceSnap.data()?.student_id !== user.uid || absenceSnap.data()?.type !== 'absence') throw new Error('forbidden');
    if (absenceSnap.data()?.transfer_status === 'registered') {
      return Response.json({ ok: false, error: 'transfer already registered' }, { status: 409 });
    }
    if (!shiftSnap.exists) throw new Error('transfer-shift-not-found');
    const absence = absenceSnap.data() || {};
    const shift = shiftSnap.data() || {};
    const parentId = clean(user.profile.parent_uid || absence.parent_id);
    const requestRef = db.collection('requests').doc();
    const batch = db.batch();

    batch.set(requestRef, {
      user_id: user.uid,
      student_id: user.uid,
      student_name: user.profile.student_name || user.profile.name || '生徒',
      parent_id: parentId || null,
      type: 'transfer',
      source: 'student_portal',
      absence_request_id: absenceId,
      absence_date: absence.target_date || null,
      target_date: shift.target_date || null,
      transfer_shift_id: transferShiftId,
      target_shift_id: transferShiftId,
      transfer_unit: shift.unit || null,
      transfer_subject: shift.target_subject || null,
      transfer_course_name: shift.target_detail_subject || shift.target_subject || null,
      transfer_period: shift.period || null,
      transfer_meeting_id: shift.target_meeting_id || null,
      content: `【振替確定】\n${shift.target_date || ''} ${shift.target_subject || ''} ${shift.target_detail_subject || ''}${shift.unit ? ` / ${shift.unit}` : ''}\n${note}`,
      reason: note,
      status: 'confirmed',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    batch.set(absenceSnap.ref, {
      transfer_status: 'registered',
      transfer_request_id: requestRef.id,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (parentId) {
      batch.set(db.collection('user_notifications').doc(), {
        user_id: parentId,
        role: 'parent',
        title: '振替が確定しました',
        message: `${user.profile.student_name || '生徒'}さんの振替が確定しました。${shift.target_date || ''} ${shift.unit || ''}`,
        kind: 'student_transfer_confirmed',
        request_id: requestRef.id,
        absence_request_id: absenceId,
        read: false,
        created_at: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return Response.json({ ok: true, id: requestRef.id });
  } catch (error) {
    return jsonError(error);
  }
}
