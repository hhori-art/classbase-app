import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max = 500) => String(value || '').normalize('NFKC').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;

const publicStudent = (id: string, data: FirebaseFirestore.DocumentData) => ({
  id,
  student_name: clean(data.student_name || data.name, 120) || '生徒',
  grade: clean(data.grade, 40),
  school: clean(data.school_name || data.school, 120),
  school_id: clean(data.school_id || data.school_code, 80),
  day_of_week: clean(data.day_of_week, 80),
  selected_course_ids: Array.isArray(data.selected_course_ids)
    ? data.selected_course_ids.map((value: unknown) => clean(value, 500)).filter(Boolean).slice(0, 100)
    : [],
});

async function linkedStudents(parentId: string, listedValue: unknown) {
  const db = adminDb();
  const listedIds = Array.from(new Set((Array.isArray(listedValue) ? listedValue : [])
    .map(value => clean(value, 128)).filter(Boolean))).slice(0, 20);
  const [listedDocs, reverseSnap] = await Promise.all([
    Promise.all(listedIds.map(id => db.collection('users').doc(id).get())),
    db.collection('users').where('parent_uid', '==', parentId).limit(20).get(),
  ]);
  const students = new Map<string, Record<string, unknown>>();
  [...listedDocs, ...reverseSnap.docs].forEach(doc => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (clean(data.role, 40) !== 'student') return;
    if (!listedIds.includes(doc.id) && clean(data.parent_uid, 128) !== parentId) return;
    students.set(doc.id, publicStudent(doc.id, data));
  });
  return [...students.values()];
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['parent']);
    const db = adminDb();
    const requestedId = clean(request.nextUrl.searchParams.get('student_id'), 128);
    if (!requestedId) {
      const students = await linkedStudents(actor.uid, actor.profile.student_ids);
      return Response.json({ ok: true, students }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const listedIds = (Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids : []).map(value => clean(value, 128));
    const studentSnap = await db.collection('users').doc(requestedId).get();
    const studentData = studentSnap.data() || {};
    if (!studentSnap.exists || clean(studentData.role, 40) !== 'student' ||
      (!listedIds.includes(requestedId) && clean(studentData.parent_uid, 128) !== actor.uid)) throw new Error('forbidden');
    const student = publicStudent(studentSnap.id, studentData);

    const [submissionSnap, attendanceSnap, absenceSnap, transferSnap, recordingSnap, chatSnap] = await Promise.all([
      db.collection('submissions').where('student_id', '==', requestedId).limit(20).get(),
      db.collection('attendance').where('user_id', '==', requestedId).limit(30).get(),
      db.collection('requests').where('user_id', '==', requestedId).where('type', '==', 'absence').limit(30).get(),
      db.collection('requests').where('user_id', '==', requestedId).where('type', '==', 'transfer').limit(30).get(),
      db.collection('recording_views').where('user_id', '==', requestedId).limit(30).get(),
      db.collection('users').doc(requestedId).collection('chat_history').orderBy('createdAt', 'desc').limit(20).get(),
    ]);

    const homework = submissionSnap.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, title: clean(data.title || data.homework_title, 160) || '宿題提出', occurred_at: millis(data.submitted_at || data.created_at), body: clean(data.comment || data.memo, 2000), status: clean(data.status, 40) };
    });
    const attendance = attendanceSnap.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, title: clean(data.target_date || data.date, 20) || '出席記録', status: clean(data.status || data.attendance_status, 60) || '記録あり', body: clean(data.note, 2000) };
    });
    const requests = [...absenceSnap.docs, ...transferSnap.docs].map(doc => {
      const data = doc.data() || {};
      const type = clean(data.type, 30);
      return { id: doc.id, title: type === 'transfer' ? '振替希望' : data.absence_type === 'late' ? '遅刻連絡' : '欠席連絡', target_date: clean(data.target_date, 20), status: clean(data.status, 60) || 'pending', body: clean(data.content || data.reason, 2000) };
    });
    const recordings = recordingSnap.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, title: clean(data.recording_title || data.title, 160) || '録画視聴', occurred_at: millis(data.updated_at || data.started_at || data.created_at), status: clean(data.event_type || data.status, 60) || 'view', watch_seconds: Math.max(0, Number(data.watch_seconds) || 0) };
    });
    const aiMessages = chatSnap.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, role: data.role === 'assistant' ? 'assistant' : 'user', occurred_at: millis(data.createdAt || data.created_at), body: clean(data.content, 8000) };
    });

    return Response.json({ ok: true, student, details: { homework, attendance, absence: requests, recordings, aiMessages } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
