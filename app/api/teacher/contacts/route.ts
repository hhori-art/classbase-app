import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const body = await request.json();
    const action = String(body.action || '');
    const studentId = String(body.student_id || '');
    const studentName = String(body.student_name || '');
    const note = String(body.note || '').slice(0, 1000);
    const week = String(body.week || '').replace(/[^0-9]/g, '') || '1';
    const teacherName = user.profile.name || user.profile.teacher_name || user.email || '講師';

    if (!studentId) {
      return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    }

    const db = adminDb();

    if (action === 'mark_called') {
      await db.collection('contact_logs').add({
        student_id: studentId,
        student_name: studentName,
        teacher_id: user.uid,
        teacher_name: teacherName,
        result: '電話済み(繋がらず/留守)',
        content: note,
        created_at: FieldValue.serverTimestamp(),
      });
      return Response.json({ ok: true });
    }

    if (action === 'confirm_absence') {
      const recordId = `${studentId}_w${week}`;
      await db.collection('pf_records').doc(recordId).set({
        student_id: studentId,
        week_number: week,
        attendance_status: '欠',
        note: note || '電話確認による欠席',
        updated_at: new Date().toISOString(),
        updated_at_server: FieldValue.serverTimestamp(),
        updated_by: user.uid,
      }, { merge: true });

      await db.collection('contact_logs').add({
        student_id: studentId,
        student_name: studentName,
        teacher_id: user.uid,
        teacher_name: teacherName,
        result: '欠席確定',
        content: note || '電話確認による欠席',
        created_at: FieldValue.serverTimestamp(),
      });

      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
