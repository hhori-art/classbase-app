import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';

export const runtime = 'nodejs';

const cleanList = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : [];
const startOf = (item: any) => String(item.start_date || item.target_date || '');
const endOf = (item: any) => String(item.end_date || item.target_date || startOf(item));
const schoolValues = (user: any) => new Set([
  user.school,
  ...user.school_ids,
  user.profile.school,
  user.profile.school_id,
  user.profile.school_code,
].map(value => String(value || '').trim()).filter(Boolean));

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student', 'parent']);
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const start = String(params.start || '').trim();
    const end = String(params.end || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return Response.json({ ok: false, error: 'invalid date range' }, { status: 400 });
    }
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs > 62 * 86400000) {
      return Response.json({ ok: false, error: 'date range too large' }, { status: 400 });
    }

    const db = adminDb();
    let audienceUser: any = user;
    if (user.role === 'parent') {
      const studentId = String(params.student_id || '').trim();
      if (!studentId) throw new Error('forbidden');
      const [studentSnapshot] = await db.getAll(db.collection('users').doc(studentId));
      const studentProfile = studentSnapshot?.data() || {};
      const linkedIds = cleanList(user.profile.student_ids);
      if (!studentSnapshot?.exists || (studentProfile.parent_uid !== user.uid && !linkedIds.includes(studentId))) {
        throw new Error('forbidden');
      }
      audienceUser = {
        ...user,
        school: studentProfile.school || studentProfile.school_name || studentProfile.school_id || '',
        school_ids: cleanList(studentProfile.school_ids),
        profile: studentProfile,
      };
    }
    const grade = String(audienceUser.profile.grade || '').trim();
    const subjects = cleanList(audienceUser.profile.subjects);
    const homeworkDocuments = grade ? await getAllQueryDocuments(
      db.collection('homework_assignments')
        .where('target_grade', '==', grade)
        .where('deadline', '>=', start)
        .where('deadline', '<=', end)
        .orderBy('deadline', 'asc'),
      200,
    ) : [];
    const homeworks = homeworkDocuments
      .map(snapshot => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
      .filter((item: any) => item.archived !== true && item.status !== 'archived')
      .filter((item: any) => !item.subject || subjects.length === 0 || subjects.includes(String(item.subject)))
      .map((item: any) => ({ id: item.id, title: item.title || '宿題', deadline: item.deadline, subject: item.subject || '' }));

    const [rangeDocuments, legacyDocuments] = await Promise.all([
      getAllQueryDocuments(db.collection('monthly_schedules').where('start_date', '<=', end).orderBy('start_date', 'asc'), 300),
      getAllQueryDocuments(db.collection('monthly_schedules').where('target_date', '>=', start).where('target_date', '<=', end), 300),
    ]);
    const schools = schoolValues(audienceUser);
    const scheduleMap = new Map<string, any>();
    [...rangeDocuments, ...legacyDocuments].forEach(snapshot => {
      const item: any = { id: snapshot.id, ...(snapshot.data() || {}) };
      const audience = String(item.audience || 'all');
      const grades = cleanList(item.grades);
      const targetSchools = cleanList(item.school_ids).concat(cleanList(item.school_id ? [item.school_id] : []));
      if (item.archived === true || item.category === 'curriculum') return;
      const allowedAudiences = user.role === 'parent' ? ['all', 'student_parent', 'parent'] : ['all', 'student_parent', 'student'];
      if (!allowedAudiences.includes(audience)) return;
      if (grades.length > 0 && (!grade || !grades.includes(grade))) return;
      if (targetSchools.length > 0 && !targetSchools.some(school => schools.has(school))) return;
      if (startOf(item) > end || endOf(item) < start) return;
      scheduleMap.set(item.id, {
        id: item.id,
        title: item.title || '予定',
        start_date: item.start_date || '',
        end_date: item.end_date || '',
        target_date: item.target_date || '',
        category: item.category || '',
      });
    });

    return Response.json({ ok: true, homeworks, schedules: Array.from(scheduleMap.values()) });
  } catch (error) {
    return jsonError(error);
  }
}
