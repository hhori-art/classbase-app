import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { verifyTransferOptionToken } from '@/lib/server/transfer-option-token';
import { weekdayFromDateKey } from '@/lib/date-key';

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
    const rawTargetDate = clean(body.target_date);
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawTargetDate) && weekdayFromDateKey(rawTargetDate)
      ? rawTargetDate
      : '';
    const reason = clean(body.reason || body.content);
    const absenceType = clean(body.absence_type) || 'absent';
    const studentSelectsTransfer = Boolean(body.student_selects_transfer || body.transfer_selection_mode === 'student');

    if (!studentId || !targetDate) {
      return Response.json({ ok: false, error: 'student_id and target_date are required' }, { status: 400 });
    }
    if (type === 'absence' && !reason) {
      return Response.json({ ok: false, error: 'reason is required' }, { status: 400 });
    }
    if (reason.length > 2000) {
      return Response.json({ ok: false, error: 'reason is too long' }, { status: 400 });
    }
    if (type === 'absence' && !['absent', 'late'].includes(absenceType)) {
      return Response.json({ ok: false, error: 'invalid absence_type' }, { status: 400 });
    }

    const studentSnap = await db.collection('users').doc(studentId).get();
    if (!studentSnap.exists) throw new Error('student-not-found');
    const student = studentSnap.data() || {};
    if (String(student.role || '') !== 'student') throw new Error('student-not-found');
    const isOwnStudentRequest = user.role === 'student' && user.uid === studentId;
    if (!isOwnStudentRequest && !parentLinkedTo(user, studentId, student)) throw new Error('forbidden');

    const isTransfer = type === 'transfer';
    const transferShiftIdForId = isTransfer ? clean(body.transfer_shift_id) : '';
    const deterministicTransferId = isTransfer
      ? `parent_transfer_${crypto.createHash('sha256').update(`${studentId}\u0000${targetDate}\u0000${transferShiftIdForId}`).digest('hex')}`
      : '';
    const deterministicAbsenceId = type === 'absence'
      ? `parent_absence_${crypto.createHash('sha256').update(`${studentId}\u0000${targetDate}\u0000${absenceType}`).digest('hex')}`
      : '';
    const requestRef = db.collection('requests').doc(deterministicTransferId || deterministicAbsenceId);

    if (isTransfer) {
      const transferShiftId = clean(body.transfer_shift_id);
      const transferToken = clean(body.transfer_token);
      if (!transferShiftId || !transferToken) {
        return Response.json({ ok: false, error: 'transfer option is required' }, { status: 400 });
      }
      const pendingAbsenceId = `pending:${studentId}:${targetDate}`;
      const grant = verifyTransferOptionToken(transferToken, {
        actor_id: user.uid, student_id: studentId, absence_id: pendingAbsenceId, shift_id: transferShiftId,
      });
      const absenceRef = db.collection('requests').doc(`${requestRef.id}_absence`);
      await db.runTransaction(async transaction => {
        const [latestStudentSnap, shiftSnap, existingTransferSnap] = await transaction.getAll(
          db.collection('users').doc(studentId),
          db.collection('shift_assignments').doc(transferShiftId),
          requestRef,
        );
        if (!latestStudentSnap.exists || !shiftSnap.exists) throw new Error('transfer option not found');
        const latestStudent = latestStudentSnap.data() || {};
        const stillOwn = user.role === 'student' ? user.uid === studentId : parentLinkedTo(user, studentId, latestStudent);
        if (!stillOwn || String(latestStudent.role || '') !== 'student') throw new Error('forbidden');
        const shift = shiftSnap.data() || {};
        const shiftDate = clean(shift.target_date).slice(0, 10);
        const shiftUnit = clean(shift.unit);
        const shiftSubject = clean(shift.target_subject);
        const shiftCourse = clean(shift.target_detail_subject || shift.target_subject);
        if (shiftDate !== grant.target_date || shiftUnit !== grant.unit || shiftSubject !== grant.subject || shiftCourse !== grant.course_name) {
          throw new Error('transfer option changed; reload options');
        }
        if (shiftDate === targetDate) throw new Error('transfer date must differ from absence date');
        if (existingTransferSnap.exists) {
          const existing = existingTransferSnap.data() || {};
          if (existing.student_id !== studentId || existing.absence_date !== targetDate || existing.transfer_shift_id !== transferShiftId) {
            throw new Error('transfer id conflict');
          }
          return;
        }
        const shared = {
          user_id: studentId, student_id: studentId,
          student_name: latestStudent.student_name || latestStudent.name || '生徒',
          parent_id: user.role === 'parent' ? user.uid : clean(latestStudent.parent_uid) || null,
          parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
          source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
        };
        transaction.create(absenceRef, {
          ...shared, type: 'absence', absence_type: 'absent', target_date: targetDate,
          content: `【欠席連絡】\n${reason || '振替登録と同時に欠席登録'}`, reason,
          transfer_selection_mode: 'parent', transfer_status: 'registered',
          transfer_request_id: requestRef.id, status: 'completed',
          created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        });
        transaction.create(requestRef, {
          ...shared, type: 'transfer', absence_request_id: absenceRef.id, absence_date: targetDate,
          target_date: shiftDate, transfer_shift_id: transferShiftId, target_shift_id: transferShiftId,
          transfer_unit: shiftUnit || null, transfer_subject: shiftSubject || null,
          transfer_course_name: shiftCourse || null, transfer_period: grant.period || null,
          transfer_meeting_id: clean(shift.target_meeting_id) || null,
          content: `【振替確定】\n${shiftDate} ${shiftSubject} ${shiftCourse}${shiftUnit ? ` / ${shiftUnit}` : ''}\n${reason}`,
          reason, transfer_selection_mode: 'parent', transfer_status: 'registered', status: 'confirmed',
          created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        });
      });
      return Response.json({ ok: true, id: requestRef.id, absence_id: absenceRef.id, status: 'confirmed' });
    }

    await db.runTransaction(async transaction => {
      const [latestStudentSnap, existingSnap] = await transaction.getAll(
        db.collection('users').doc(studentId),
        requestRef,
      );
      if (!latestStudentSnap.exists) throw new Error('student-not-found');
      const latestStudent = latestStudentSnap.data() || {};
      const stillOwn = user.role === 'student' ? user.uid === studentId : parentLinkedTo(user, studentId, latestStudent);
      if (!stillOwn || String(latestStudent.role || '') !== 'student') throw new Error('forbidden');
      if (existingSnap.exists) {
        const existing = existingSnap.data() || {};
        if (existing.student_id !== studentId || existing.target_date !== targetDate || existing.absence_type !== absenceType) {
          throw new Error('absence id conflict');
        }
        return;
      }

      transaction.create(requestRef, {
        user_id: studentId,
        student_id: studentId,
        student_name: latestStudent.student_name || latestStudent.name || '生徒',
        parent_id: user.role === 'parent' ? user.uid : clean(latestStudent.parent_uid) || null,
        parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
        type,
        absence_type: absenceType,
        target_date: targetDate,
        content: `【欠席連絡】\n${reason}`,
        reason,
        source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
        transfer_shift_id: null,
        target_shift_id: null,
        transfer_unit: null,
        transfer_subject: null,
        transfer_course_name: null,
        transfer_period: null,
        transfer_meeting_id: null,
        transfer_selection_mode: studentSelectsTransfer ? 'student' : null,
        transfer_status: studentSelectsTransfer ? 'waiting_student_selection' : null,
        transfer_required_by_parent: studentSelectsTransfer,
        status: 'completed',
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });

      if (user.role === 'parent') {
        transaction.create(db.collection('user_notifications').doc(`absence_${requestRef.id}`), {
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
    });
    return Response.json({ ok: true, id: requestRef.id, status: 'completed' });
  } catch (error) {
    return jsonError(error);
  }
}
