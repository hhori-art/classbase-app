import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

const scienceKeywords = ['理科', '物理', '化学', '生物', '地学'];
const socialKeywords = ['社会', '地理', '歴史', '公民'];

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const body = await request.json();
    const action = String(body.action || 'create');
    const db = adminDb();

    if (action === 'create') {
      const title = String(body.title || '').trim();
      const subject = String(body.subject || '理科').trim();
      const deadline = String(body.deadline || '').trim();
      const targetGrade = String(body.target_grade || body.grade || '').trim();
      const description = String(body.description || body.content || '').trim();

      if (!title || !deadline || !targetGrade) {
        return Response.json({ ok: false, error: 'title/deadline/target_grade is required' }, { status: 400 });
      }

      const ref = await db.collection('homework_assignments').add({
        title,
        subject,
        deadline,
        target_grade: targetGrade,
        grade: targetGrade,
        description,
        content: description,
        target_week: body.target_week || null,
        created_by: user.uid,
        teacher_name: user.profile.name || user.profile.teacher_name || user.email || '担当講師',
        created_at: FieldValue.serverTimestamp(),
        status: 'active',
        is_completed_count: 0,
      });
      return Response.json({ ok: true, id: ref.id });
    }

    if (action === 'delete') {
      const assignmentId = String(body.assignment_id || '');
      if (!assignmentId) return Response.json({ ok: false, error: 'assignment_id is required' }, { status: 400 });
      await db.collection('homework_assignments').doc(assignmentId).delete();
      return Response.json({ ok: true });
    }

    if (action === 'review_submission') {
      const submissionId = String(body.submission_id || '');
      const assignmentId = String(body.assignment_id || '');
      const status = String(body.status || '');
      if (!submissionId || !assignmentId || !['checked', 'resubmit'].includes(status)) {
        return Response.json({ ok: false, error: 'invalid review payload' }, { status: 400 });
      }

      const [assignmentSnap, submissionSnap] = await Promise.all([
        db.collection('homework_assignments').doc(assignmentId).get(),
        db.collection('submissions').doc(submissionId).get(),
      ]);
      if (!assignmentSnap.exists) throw new Error('assignment-not-found');
      if (!submissionSnap.exists) throw new Error('submission-not-found');

      const assignment = assignmentSnap.data() || {};
      const submission = submissionSnap.data() || {};

      if (status === 'checked') {
        await db.collection('submissions').doc(submissionId).set({
          status: 'checked',
          checked_at: new Date().toISOString(),
          checked_at_server: FieldValue.serverTimestamp(),
          checked_by: user.uid,
          feedback: null,
          teacher_comment: String(body.teacher_comment || '').slice(0, 1000),
          stamp_url: body.stamp_url || null,
        }, { merge: true });

        const weekNum = String(assignment.target_week || '').replace(/[^0-9]/g, '');
        const studentId = String(submission.student_id || '');
        if (weekNum && studentId) {
          const pfUpdateData: Record<string, unknown> = {
            student_id: studentId,
            week_number: weekNum,
            updated_at: new Date().toISOString(),
            updated_at_server: FieldValue.serverTimestamp(),
            updated_by: user.uid,
          };
          const subject = String(assignment.subject || '');
          if (scienceKeywords.some(k => subject.includes(k))) pfUpdateData.homework_science = '〇';
          if (socialKeywords.some(k => subject.includes(k))) pfUpdateData.homework_social = '〇';
          if (pfUpdateData.homework_science || pfUpdateData.homework_social) {
            await db.collection('pf_records').doc(`${studentId}_w${weekNum}`).set(pfUpdateData, { merge: true });
          }
        }

        return Response.json({ ok: true });
      }

      await db.collection('submissions').doc(submissionId).set({
        status: 'resubmit',
        feedback: String(body.feedback || '').slice(0, 1000),
        checked_at: new Date().toISOString(),
        checked_at_server: FieldValue.serverTimestamp(),
        checked_by: user.uid,
        teacher_comment: null,
        stamp_url: null,
      }, { merge: true });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
