import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { calculateAttendanceInsights, type AttendanceInsightSource } from '@/lib/attendance-insights';
import { normalizeRegularAttendanceIntervalRecord, type RegularAttendanceInterval } from '@/lib/attendance-payroll';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';

const REGULAR_COLLECTION = 'attendance_regular_imports';

function monthRange(fromValue: string, toValue: string) {
  const current = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const from = /^\d{4}-\d{2}$/.test(fromValue) ? fromValue : current;
  const to = /^\d{4}-\d{2}$/.test(toValue) ? toValue : from;
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const span = (toYear - fromYear) * 12 + toMonth - fromMonth;
  if (span < 0 || span > 11) throw new Error('invalid attendance insight period');
  const lastDay = new Date(toYear, toMonth, 0).getDate();
  return { from, to, start: `${from}-01`, end: `${to}-${String(lastDay).padStart(2, '0')}` };
}

function expandRegularAttendance(documents: FirebaseFirestore.QueryDocumentSnapshot[]) {
  return documents.flatMap(doc => {
    const data = doc.data();
    if (!data.compacted || !Array.isArray(data.intervals)) {
      return [normalizeRegularAttendanceIntervalRecord({ id: doc.id, ...data })];
    }
    return data.intervals.map((interval: Record<string, unknown>, index: number) => normalizeRegularAttendanceIntervalRecord(interval, {
      id: `${doc.id}_${index}`,
      person_code: String(data.person_code || data.personCode || data.employeeId || ''),
      person_name: String(data.person_name || data.personName || ''),
      normalized_name: String(data.normalized_name || data.normalizedName || ''),
      source_name: String(data.source_name || data.sourceName || data.source || ''),
    }));
  }).filter((item: RegularAttendanceInterval) => item.date);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canManageAttendance(actor) || actor.role === 'teacher') throw new Error('forbidden');
    const legacyMonth = String(request.nextUrl.searchParams.get('month') || '');
    const period = monthRange(
      String(request.nextUrl.searchParams.get('from') || legacyMonth),
      String(request.nextUrl.searchParams.get('to') || legacyMonth),
    );
    const program = ['all', 'normal', 'science_social', 'breakthrough'].includes(String(request.nextUrl.searchParams.get('program')))
      ? String(request.nextUrl.searchParams.get('program'))
      : 'all';
    const requestedSource = String(request.nextUrl.searchParams.get('source') || 'combined');
    const source: AttendanceInsightSource = ['combined', 'system', 'external'].includes(requestedSource)
      ? requestedSource as AttendanceInsightSource
      : 'combined';
    const db = adminDb();
    const [recordDocs, regularDocs, profileDocs] = await Promise.all([
      source === 'external'
        ? Promise.resolve([])
        : getAllQueryDocuments(db.collection('work_records').where('date', '>=', period.start).where('date', '<=', period.end)),
      source === 'system'
        ? Promise.resolve([])
        : getAllQueryDocuments(db.collection(REGULAR_COLLECTION).where('date', '>=', period.start).where('date', '<=', period.end)),
      getAllQueryDocuments(db.collection('users').where('role', 'in', ['teacher', 'attendance_admin'])),
    ]);
    const profiles = new Map(profileDocs.map(doc => [doc.id, doc.data()]));
    const records = recordDocs.map(doc => ({ id: doc.id, ...doc.data() })).filter((record: any) => {
      if (actor.role === 'master') return true;
      const profile = profiles.get(String(record.teacher_id)) || {};
      const school = String(profile.school_id || profile.school || record.school_id || '');
      return actor.school_ids.includes(school) || actor.school === school;
    });
    const regularAttendance = expandRegularAttendance(regularDocs).filter(item => {
      if (actor.role === 'master') return true;
      const school = String(item.school_code || item.school_name || '');
      return actor.school_ids.includes(school) || actor.school === school;
    });
    return Response.json({
      ok: true,
      ...period,
      program,
      source,
      source_counts: {
        system_records: records.length,
        external_intervals: regularAttendance.length,
      },
      ...calculateAttendanceInsights(records, profiles, program, regularAttendance, source, { start: period.start, end: period.end }),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid attendance insight period') {
      return Response.json({ ok: false, error: '分析期間は開始月から終了月まで、最大12か月で指定してください。' }, { status: 400 });
    }
    return jsonError(error);
  }
}
