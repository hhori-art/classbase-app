import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { verifyClassParticipationToken } from '@/lib/server/class-participation-token';

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const eventIdFor = (studentId: string, targetDate: string, classId: string) =>
  `class_join_${crypto.createHash('sha256').update(`${studentId}\u0000${targetDate}\u0000${classId}`).digest('hex')}`;

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const today = todayInJapan();
    let grant;
    try {
      grant = verifyClassParticipationToken(body.participation_token, user.uid, today);
    } catch {
      return Response.json({ ok: false, error: 'class-participation-not-authorized' }, { status: 403 });
    }
    if (body.class_id && String(body.class_id) !== grant.class_id) {
      return Response.json({ ok: false, error: 'class-participation-not-authorized' }, { status: 403 });
    }

    const db = adminDb();
    const eventId = eventIdFor(user.uid, grant.target_date, grant.class_id);
    const eventRef = db.collection('learning_events').doc(eventId);
    const attendanceRef = db.collection('attendance').doc(`${user.uid}_${grant.target_date}`);
    const requestedTwinIds = Array.from(new Set(
      (Array.isArray(user.profile.twin_sibling_ids) ? user.profile.twin_sibling_ids : [])
        .map(String).map(id => id.trim()).filter(id => id && id !== user.uid)
    )).slice(0, 4);

    const result = await db.runTransaction(async transaction => {
      const [eventSnap, attendanceSnap, ...twinSnaps] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(attendanceRef),
        ...requestedTwinIds.map(id => transaction.get(db.collection('users').doc(id))),
      ]);
      const validTwins = twinSnaps.flatMap((snap, index) => {
        if (!snap.exists) return [];
        const data = snap.data() || {};
        const reciprocalIds = Array.isArray(data.twin_sibling_ids) ? data.twin_sibling_ids.map(String) : [];
        if (String(data.role || '') !== 'student' || !reciprocalIds.includes(user.uid)) return [];
        return [{ id: requestedTwinIds[index], data }];
      });
      const twinAttendanceSnaps = await Promise.all(validTwins.map(twin =>
        transaction.get(db.collection('attendance').doc(`${twin.id}_${grant.target_date}`))
      ));

      const participation = {
        class_id: grant.class_id,
        target_date: grant.target_date,
        subject: grant.subject,
        course_name: grant.course_name,
      };
      if (!eventSnap.exists) {
        transaction.set(eventRef, {
          actor_id: user.uid,
          actor_role: user.role,
          type: 'class_join_clicked',
          target_id: grant.class_id,
          target_type: 'class_session',
          school: user.school || null,
          metadata: { target_date: grant.target_date, source: 'zoom_button', subject: grant.subject, course_name: grant.course_name },
          created_at: FieldValue.serverTimestamp(),
        });
      }
      transaction.set(attendanceRef, {
        user_id: user.uid,
        student_id: user.uid,
        student_name: user.profile.student_name || user.profile.name || '',
        target_date: grant.target_date,
        type: 'joined',
        subject: grant.subject,
        course_name: grant.course_name,
        participation_subjects: FieldValue.arrayUnion(grant.subject),
        participations: FieldValue.arrayUnion(participation),
        contacted_by: 'student',
        reason: 'Zoom参加ボタンより参加ログを記録',
        participation_event_id: eventId,
        updated_at: FieldValue.serverTimestamp(),
        ...(!attendanceSnap.exists ? { created_at: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });

      validTwins.forEach((twin, index) => {
        const twinAttendanceRef = db.collection('attendance').doc(`${twin.id}_${grant.target_date}`);
        transaction.set(twinAttendanceRef, {
          user_id: twin.id,
          student_id: twin.id,
          student_name: twin.data.student_name || twin.data.name || '',
          target_date: grant.target_date,
          type: 'joined',
          subject: grant.subject,
          course_name: grant.course_name,
          participation_subjects: FieldValue.arrayUnion(grant.subject),
          participations: FieldValue.arrayUnion({ ...participation, twin_source_student_id: user.uid }),
          contacted_by: 'twin_auto',
          reason: '双子連携により片方の出席から自動OK判定',
          twin_source_student_id: user.uid,
          participation_event_id: eventId,
          updated_at: FieldValue.serverTimestamp(),
          ...(!twinAttendanceSnaps[index]?.exists ? { created_at: FieldValue.serverTimestamp() } : {}),
        }, { merge: true });
      });

      return { duplicate: eventSnap.exists, twinCount: validTwins.length };
    });

    return Response.json({ ok: true, event_id: eventId, duplicate: result.duplicate, twin_attendance_count: result.twinCount });
  } catch (error) {
    return jsonError(error);
  }
}
