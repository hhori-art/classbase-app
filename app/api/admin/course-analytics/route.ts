import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { analyticsRange, analyticsRate, attendanceMatchesCourse, homeworkEligibleStudent } from '@/lib/course-analytics';
import { jstDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();
const dateValue = (value: any) => value?.toDate?.() || (value ? new Date(value) : null);
const dateKey = (value: any) => {
  const date = dateValue(value);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : clean(value).slice(0, 10);
};
const rate = analyticsRate;
const schoolOf = (row: Record<string, any>) => clean(row.school_id || row.school || row.classroom || row.classroom_name);
const gradeOf = (row: Record<string, any>) => clean(row.grade || row.target_grade || row.class_grade);
const nameOf = (row: Record<string, any>) => clean(row.student_name || row.name || row.display_name) || '氏名未設定';
const canonicalCourseLabel = (value: unknown) => {
  const label = clean(value);
  if (!label) return '';
  if (/^(?:class|course|shift_class)_/.test(label)) {
    const grade = label.match(/中[123]/)?.[0] || '';
    const subject = label.match(/理科|社会/)?.[0] || '';
    const afterSubject = subject ? label.split(subject)[1] || '' : '';
    const field = afterSubject.replace(/^_+/, '').split('_').find(part => part && !/^(?:通常|対策|標準)/.test(part)) || '';
    const day = label.match(/[月火水木金土日](?:曜)?/)?.[0]?.replace('曜', '') || '';
    const lesson = label.match(/([12])(?:時間目|限)/)?.[1] || '';
    const compact = [grade, subject, field].filter(Boolean).join(' ');
    return `${compact}${day ? `・${day}曜` : ''}${lesson ? `${lesson}限` : ''}` || label;
  }
  if (label.includes(' / ')) return label.split(' / ').slice(0, 2).join(' / ');
  return label;
};
const courseLabels = (row: Record<string, any>) => {
  const labels = Array.isArray(row.selected_course_labels) ? row.selected_course_labels : [];
  const ids = Array.isArray(row.selected_course_ids) ? row.selected_course_ids : [];
  const keys = Array.isArray(row.selected_course_keys) ? row.selected_course_keys : [];
  const preferred = labels.some((value: unknown) => clean(value)) ? labels : keys.some((value: unknown) => clean(value)) ? keys : ids;
  return Array.from(new Set(preferred.map(canonicalCourseLabel).filter(Boolean)));
};
const isActiveRegistration = (row: Record<string, any>) =>
  !['withdrawn', 'cancelled', 'canceled', '解除', '退会'].includes(clean(row.status).toLowerCase()) && row.is_current !== false && row.current !== false;
const isWithdrawn = (row: Record<string, any>) => ['withdrawn', 'cancelled', 'canceled', '解除', '退会'].includes(clean(row.status).toLowerCase());
const attendancePresent = (row: Record<string, any>) => ['joined', 'present', 'late', '出席', '遅刻'].some(value => clean(row.type || row.status || row.attendance_status).toLowerCase().includes(value));

const reportPayload = async (request: NextRequest) => {
  const requestedPeriod = clean(request.nextUrl.searchParams.get('period') || 'month');
  if (!['week', 'month'].includes(requestedPeriod)) throw new Error('invalid analytics period');
  const period = requestedPeriod as 'week' | 'month';
  const range = analyticsRange(period, clean(request.nextUrl.searchParams.get('anchor')) || jstDateKey());
  const school = clean(request.nextUrl.searchParams.get('school'));
  const grade = clean(request.nextUrl.searchParams.get('grade'));
  const db = adminDb();
  const [studentDocs, registrationDocs, attendanceDocs, assignmentDocs, submissionDocs] = await Promise.all([
    getAllQueryDocuments(db['collection']('users').where('role', '==', 'student')),
    getAllQueryDocuments(db['collection']('course_registrations').limit(5000)),
    getAllQueryDocuments(db['collection']('attendance').where('target_date', '>=', range.start).where('target_date', '<=', range.end)),
    getAllQueryDocuments(db['collection']('homework_assignments').limit(1000)),
    getAllQueryDocuments(db['collection']('submissions').limit(5000)),
  ]);
  const allStudents = studentDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>));
  const students = allStudents.filter(student => (!school || schoolOf(student) === school) && (!grade || gradeOf(student) === grade));
  const studentIds = new Set(students.map(student => student.id));
  const registrations = registrationDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>)).filter(row => studentIds.has(clean(row.student_id)));
  const activeRegistrations = registrations.filter(isActiveRegistration);
  const activeStudentIds = new Set(activeRegistrations.map(row => clean(row.student_id)));
  const attendance = attendanceDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>)).filter(row => activeStudentIds.has(clean(row.student_id || row.user_id)) && attendancePresent(row));
  const attendedStudentIds = new Set(attendance.map(row => clean(row.student_id || row.user_id)));
  const startedStudentIds = new Set([...activeStudentIds].filter(id => attendedStudentIds.has(id)));
  const withdrawn = registrations.filter(row => isWithdrawn(row) && (() => { const key = dateKey(row.updated_at || row.created_at); return key >= range.start && key <= range.end; })());

  const assignments = assignmentDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>)).filter(row => {
    const deadline = dateKey(row.deadline || row.created_at);
    return deadline >= range.start && deadline <= range.end && clean(row.status || 'active') !== 'deleted';
  });
  const assignmentMap = new Map(assignments.map(item => [item.id, item]));
  const submissions = submissionDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>)).filter(row => studentIds.has(clean(row.student_id)) && assignmentMap.has(clean(row.assignment_id)));
  const submittedPairs = new Set(submissions.map(row => `${clean(row.student_id)}\u0000${clean(row.assignment_id)}`));
  let homeworkEligible = 0;
  let homeworkSubmitted = 0;
  assignments.forEach(assignment => {
    const targetGrade = gradeOf(assignment);
    students.filter(student => homeworkEligibleStudent(student, assignment)).forEach(student => {
      homeworkEligible += 1;
      if (submittedPairs.has(`${student.id}\u0000${assignment.id}`)) homeworkSubmitted += 1;
    });
  });

  const courses = new Map<string, { name: string; students: Set<string>; schools: Set<string>; grades: Set<string> }>();
  activeRegistrations.forEach(registration => courseLabels(registration).forEach(label => {
    if (!courses.has(label)) courses.set(label, { name: label, students: new Set(), schools: new Set(), grades: new Set() });
    const item = courses.get(label)!;
    item.students.add(clean(registration.student_id));
    const student = students.find(value => value.id === clean(registration.student_id));
    if (student) { item.schools.add(schoolOf(student)); item.grades.add(gradeOf(student)); }
  }));
  const courseRows = Array.from(courses.values()).map(course => {
    const attended = [...course.students].filter(id => attendance.some(row =>
      clean(row.student_id || row.user_id) === id && attendanceMatchesCourse(row, course.name, canonicalCourseLabel)
    )).length;
    return { name: course.name, enrolled: course.students.size, attended_students: attended, start_rate: rate(attended, course.students.size), schools: [...course.schools].filter(Boolean), grades: [...course.grades].filter(Boolean) };
  }).sort((a, b) => b.enrolled - a.enrolled || a.name.localeCompare(b.name, 'ja'));

  const trendMap = new Map<string, { date: string; attended: Set<string>; submissions: number }>();
  for (let cursor = new Date(`${range.start}T00:00:00+09:00`); cursor <= new Date(`${range.end}T00:00:00+09:00`); cursor.setDate(cursor.getDate() + 1)) {
    const key = cursor.toLocaleDateString('sv-SE'); trendMap.set(key, { date: key, attended: new Set(), submissions: 0 });
  }
  attendance.forEach(row => trendMap.get(dateKey(row.target_date || row.date))?.attended.add(clean(row.student_id || row.user_id)));
  submissions.forEach(row => { const key = dateKey(row.submitted_at || row.created_at || row.updated_at); const trend = trendMap.get(key); if (trend) trend.submissions += 1; });

  const exceptionStudents = students.map(student => {
    const id = student.id;
    const enrolled = activeStudentIds.has(id);
    const attended = attendedStudentIds.has(id);
    const eligibleAssignments = assignments.filter(assignment => homeworkEligibleStudent(student, assignment));
    const submitted = eligibleAssignments.filter(assignment => submittedPairs.has(`${id}\u0000${assignment.id}`)).length;
    return { id, name: nameOf(student), school: schoolOf(student), grade: gradeOf(student), enrolled, attended, homework_submitted: submitted, homework_total: eligibleAssignments.length, homework_rate: rate(submitted, eligibleAssignments.length), alert_count: (enrolled && !attended ? 1 : 0) + (eligibleAssignments.length && submitted < eligibleAssignments.length ? 1 : 0) };
  }).filter(row => row.alert_count > 0).sort((a, b) => b.alert_count - a.alert_count || a.name.localeCompare(b.name, 'ja'));

  return {
    ok: true, period, range, filters: { school, grade },
    options: { schools: Array.from(new Set(allStudents.map(schoolOf).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja')), grades: Array.from(new Set(allStudents.map(gradeOf).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })) },
    summary: {
      students: students.length,
      enrolled_students: activeStudentIds.size,
      attendance_rate: rate(attendedStudentIds.size, activeStudentIds.size),
      attendance_numerator: attendedStudentIds.size,
      attendance_denominator: activeStudentIds.size,
      homework_rate: rate(homeworkSubmitted, homeworkEligible),
      homework_numerator: homeworkSubmitted,
      homework_denominator: homeworkEligible,
      start_rate: rate(startedStudentIds.size, activeStudentIds.size),
      started_students: startedStudentIds.size,
      withdrawal_rate: rate(withdrawn.length, activeRegistrations.length + withdrawn.length),
      withdrawals: withdrawn.length,
      registration_records: activeRegistrations.length + withdrawn.length,
      course_count: courseRows.length,
    },
    courses: courseRows,
    trend: Array.from(trendMap.values()).map(row => ({ date: row.date, attended_students: row.attended.size, homework_submissions: row.submissions })),
    exceptions: exceptionStudents.slice(0, 200),
    definitions: {
      attendance_rate: '対象期間に1回以上出席記録がある受講生 ÷ 現在の受講生',
      homework_rate: '対象期間が期限の宿題に対する提出数 ÷ 学年条件を満たす提出対象数',
      start_rate: '対象期間に1回以上出席した現在の受講生 ÷ 現在の受講生',
      withdrawal_rate: '対象期間に解除された登録数 ÷ 抽出範囲内の登録履歴数',
    },
    generated_at: new Date().toISOString(),
  };
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master']);
    return Response.json(await reportPayload(request), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}

const escapeHtml = (value: unknown) => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master']);
    const body = await request.json();
    const email = clean(body.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ ok: false, error: '送信先メールアドレスを確認してください。' }, { status: 400 });
    const url = new URL(request.url);
    url.searchParams.set('period', body.period === 'week' ? 'week' : 'month');
    if (body.anchor) url.searchParams.set('anchor', clean(body.anchor));
    if (body.school) url.searchParams.set('school', clean(body.school));
    if (body.grade) url.searchParams.set('grade', clean(body.grade));
    const report = await reportPayload(new NextRequest(url, { headers: request.headers }));
    const s = report.summary;
    const subject = `【講座運用レポート】${report.range.label}`;
    const text = [`講座運用レポート（${report.range.label}）`, `受講人数: ${s.enrolled_students}人`, `出席率: ${s.attendance_rate ?? '-'}%`, `宿題提出率: ${s.homework_rate ?? '-'}%`, `開始率: ${s.start_rate ?? '-'}%`, `解除率: ${s.withdrawal_rate ?? '-'}%`, `要確認: ${report.exceptions.length}人`].join('\n');
    const html = `<div style="font-family:sans-serif;line-height:1.7"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(report.filters.school || '全校舎')}・${escapeHtml(report.filters.grade || '全学年')}</p><ul><li>受講人数: ${s.enrolled_students}人</li><li>出席率: ${s.attendance_rate ?? '-'}%</li><li>宿題提出率: ${s.homework_rate ?? '-'}%</li><li>開始率: ${s.start_rate ?? '-'}%</li><li>解除率: ${s.withdrawal_rate ?? '-'}%</li><li>要確認: ${report.exceptions.length}人</li></ul></div>`;
    const resendKey = clean(process.env.RESEND_API_KEY);
    if (resendKey) {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: clean(process.env.RESEND_FROM_EMAIL) || '創造学園アプリ <noreply@sozogakuen.co.jp>', to: [email], subject, text, html }) });
      if (!response.ok) throw new Error('email-delivery-failed');
    } else {
      const collectionName = clean(process.env.FIREBASE_MAIL_COLLECTION);
      if (!collectionName) throw new Error('email-service-not-configured');
      await adminDb()['collection'](collectionName).add({ to: [email], message: { subject, text, html }, metadata: { kind: 'course_analytics_report', actor_id: actor.uid }, created_at: FieldValue.serverTimestamp() });
    }
    await adminDb()['collection']('analytics_report_deliveries').add({ email, period: report.period, range: report.range, filters: report.filters, sent_by: actor.uid, sent_at: FieldValue.serverTimestamp() });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
