import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';
import { accessibleTeacherStudents, requireAccessibleStudent } from '@/lib/server/teacher-student-access';
import { consumeRateLimit } from '@/lib/server/password-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const clean = (value: unknown, max = 2000) => String(value || '').normalize('NFKC').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request); requireScienceSocialStaff(actor);
    const students = await accessibleTeacherStudents(actor);
    const studentId = clean(request.nextUrl.searchParams.get('student_id'), 128);
    if (studentId) {
      const student = await requireAccessibleStudent(actor, studentId);
      const [snap, legacyInquirySnap] = await Promise.all([
        adminDb().collection('chat_logs').where('uid', '==', studentId).orderBy('created_at', 'desc').limit(100).get(),
        adminDb().collection('teacher_inquiries').where('studentId', '==', studentId).limit(100).get(),
      ]);
      const unreadMessages = snap.docs.filter(doc => doc.data().role !== 'teacher' && doc.data().read === false);
      const unreadLegacyInquiries = legacyInquirySnap.docs.filter(doc => doc.data().status === 'unread');
      if (unreadMessages.length || unreadLegacyInquiries.length || Number(student.teacher_chat_unread_count || 0) > 0 || Number(student.teacher_inquiry_unread_count || 0) > 0) {
        const batch = adminDb().batch();
        unreadMessages.forEach(doc => batch.update(doc.ref, { read: true, read_at: FieldValue.serverTimestamp(), read_by: actor.uid }));
        unreadLegacyInquiries.forEach(doc => batch.update(doc.ref, { status: 'read', read_at: FieldValue.serverTimestamp(), read_by: actor.uid }));
        batch.set(adminDb().collection('users').doc(studentId), { teacher_chat_unread_count: 0, teacher_inquiry_unread_count: 0 }, { merge: true });
        await batch.commit();
      }
      const legacyMessages = legacyInquirySnap.docs.map(doc => ({
        id: `legacy-inquiry-${doc.id}`,
        uid: studentId,
        role: 'user',
        message: `【AIチューターとの会話を先生へ報告】\n\n${clean(doc.data().content, 20_000)}`,
        source: 'ai_chat_report',
        created_at_ms: millis(doc.data().createdAt || doc.data().created_at),
      }));
      const messages = [...snap.docs.map(doc => ({ id: doc.id, ...doc.data(), created_at_ms: millis(doc.data().created_at || doc.data().createdAt) })), ...legacyMessages]
        .sort((a, b) => a.created_at_ms - b.created_at_ms);
      return Response.json({ ok: true, messages }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const inquiries = students.filter(student => Number(student.teacher_inquiry_unread_count || 0) > 0).slice(0, 20).map(student => ({
      id: `student-inquiry-${student.id}`,
      studentId: student.id,
      studentName: student.student_name || student.name || '生徒',
      content: 'AIチューターとの会話報告があります',
    }));
    const alertIds = new Set(inquiries.map(row => row.studentId));
    return Response.json({ ok: true, students: students.map(student => ({ ...student, hasAlert: alertIds.has(student.id), unreadCount: Number(student.teacher_chat_unread_count || 0) })), inquiries }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request); requireScienceSocialStaff(actor);
    const body = await request.json();
    const message = clean(body.message);
    if (!message || String(body.message || '').trim().length > 2000) return Response.json({ ok: false, error: 'invalid-message' }, { status: 400 });
    const requestedIds = Array.from(new Set<string>((body.action === 'bulk' && Array.isArray(body.student_ids) ? body.student_ids : [body.student_id]).map((v: unknown) => clean(v, 128)).filter(Boolean)));
    if (!requestedIds.length || requestedIds.length > 100) return Response.json({ ok: false, error: 'invalid-targets' }, { status: 400 });
    if (!(await consumeRateLimit(`teacher_chat_${actor.uid}`, body.action === 'bulk' ? 5 : 30, 60_000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    const students = await accessibleTeacherStudents(actor);
    const allowed = new Map(students.map(student => [student.id, student]));
    if (requestedIds.some(id => !allowed.has(id))) throw new Error('forbidden');
    const batch = adminDb().batch();
    requestedIds.forEach(id => {
      const student = allowed.get(id)!;
      const messageId = crypto.randomUUID();
      const ref = adminDb().collection('chat_logs').doc(messageId);
      batch.set(ref, { uid: id, role: 'teacher', teacher_id: actor.uid, teacher_name: clean(actor.profile.name || actor.email || '担当講師', 120), student_name: clean(student.student_name || student.name || '生徒', 120), message, is_broadcast: body.action === 'bulk', student_read: false, created_at: FieldValue.serverTimestamp() });
      batch.set(adminDb().collection('user_notifications').doc(`teacher_chat_${messageId}`), {
        user_id: id,
        role: 'student',
        title: '先生からメッセージが届きました',
        message: message.slice(0, 500),
        kind: 'teacher_chat',
        link: '/student/chat',
        read: false,
        created_at: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return Response.json({ ok: true, count: requestedIds.length });
  } catch (error) { return jsonError(error); }
}
