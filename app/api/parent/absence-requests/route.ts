import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

function clean(value: unknown) {
  return String(value || '').trim();
}

function parentLinkedTo(user: Awaited<ReturnType<typeof getServerUser>>, studentId: string, student: FirebaseFirestore.DocumentData) {
  const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids.map(String) : [];
  return linkedIds.includes(studentId) || clean(student.parent_uid) === user.uid;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent', 'student']);

    const body = await request.json();
    const db = adminDb();
    const studentId = clean(body.student_id);
    const type = clean(body.type) === 'transfer' ? 'transfer' : 'absence';
    const targetDate = clean(body.target_date).slice(0, 10);
    const reason = clean(body.reason || body.content);
    const studentSelectsTransfer = Boolean(body.student_selects_transfer || body.transfer_selection_mode === 'student');

    if (!studentId || !targetDate) {
      return Response.json({ ok: false, error: 'student_id and target_date are required' }, { status: 400 });
    }
    if (type === 'absence' && !reason) {
      return Response.json({ ok: false, error: 'reason is required' }, { status: 400 });
    }

    const studentSnap = await db.collection('users').doc(studentId).get();
    if (!studentSnap.exists) throw new Error('student-not-found');
    const student = studentSnap.data() || {};
    const isOwnStudentRequest = user.role === 'student' && user.uid === studentId;
    if (!isOwnStudentRequest && !parentLinkedTo(user, studentId, student)) throw new Error('forbidden');

    const isTransfer = type === 'transfer';
    const requestRef = db.collection('requests').doc();
    const batch = db.batch();

    batch.set(requestRef, {
      user_id: studentId,
      student_id: studentId,
      student_name: student.student_name || student.name || '生徒',
      parent_id: user.role === 'parent' ? user.uid : clean(student.parent_uid) || null,
      parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
      type,
      absence_type: isTransfer ? null : clean(body.absence_type) || 'absent',
      target_date: targetDate,
      content: isTransfer
        ? `【振替確定】${clean(body.transfer_title) ? `\n${clean(body.transfer_title)}` : ''}${clean(body.transfer_unit) ? ` / ${clean(body.transfer_unit)}` : ''}\n${reason}`
        : `【欠席連絡】\n${reason}`,
      reason,
      source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
      transfer_shift_id: clean(body.transfer_shift_id) || null,
      target_shift_id: clean(body.target_shift_id || body.transfer_shift_id) || null,
      transfer_unit: clean(body.transfer_unit) || null,
      transfer_subject: clean(body.transfer_subject) || null,
      transfer_course_name: clean(body.transfer_course_name) || null,
      transfer_period: body.transfer_period ? Number(body.transfer_period) : null,
      transfer_meeting_id: clean(body.transfer_meeting_id) || null,
      transfer_selection_mode: studentSelectsTransfer ? 'student' : isTransfer ? 'parent' : null,
      transfer_status: !isTransfer && studentSelectsTransfer ? 'waiting_student_selection' : isTransfer ? 'registered' : null,
      transfer_required_by_parent: !isTransfer && studentSelectsTransfer,
      status: isTransfer ? 'confirmed' : 'completed',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    if (!isTransfer && user.role === 'parent') {
      batch.set(db.collection('user_notifications').doc(), {
        user_id: studentId,
        role: 'student',
        title: '欠席連絡が完了しました',
        message: studentSelectsTransfer
          ? `${targetDate}の欠席連絡が完了しました。振替先を選択してください。`
          : `${targetDate}の欠席連絡が完了しました。必要に応じて振替登録をしてください。`,
        kind: 'absence_transfer_required',
        request_id: requestRef.id,
        target_date: targetDate,
        transfer_required_by_parent: studentSelectsTransfer,
        read: false,
        created_at: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return Response.json({ ok: true, id: requestRef.id, status: isTransfer ? 'confirmed' : 'completed' });
  } catch (error) {
    return jsonError(error);
  }
}
