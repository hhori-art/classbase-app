import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { extractOvertimeIntervals, normalizeDedicatedSchedule, totalOvertimeMinutes } from '@/lib/dedicated-attendance';
import { isDedicatedProfile } from '@/lib/employment-category';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { roundDownTo5Minutes, roundUpTo5Minutes } from '@/lib/attendance-time';

export const runtime = 'nodejs';

const clean = (value: unknown, max = 500) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const monthValue = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || ''))
  ? String(value)
  : new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
const belongsToMonth = (date: unknown, month: string) => String(date || '').startsWith(`${month}-`);

function requireDedicated(user: Awaited<ReturnType<typeof getServerUser>>) {
  requireRole(user, ['teacher']);
  if (!isDedicatedProfile(user.profile)) throw new Error('dedicated-employee-required');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireDedicated(user);
    const month = monthValue(request.nextUrl.searchParams.get('month'));
    const db = adminDb();
    const [recordSnap, overtimeSnap, lessonSnap, expenseSnap] = await Promise.all([
      db.collection('work_records').where('teacher_id', '==', user.uid).limit(1000).get(),
      db.collection('dedicated_overtime_claims').where('user_id', '==', user.uid).limit(1000).get(),
      db.collection('dedicated_lesson_claims').where('user_id', '==', user.uid).limit(1000).get(),
      db.collection('dedicated_transport_claims').where('user_id', '==', user.uid).limit(1000).get(),
    ]);
    const schedule = normalizeDedicatedSchedule(user.profile);
    const overtimeClaims = overtimeSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, unknown>))
      .filter(item => belongsToMonth(item.work_date, month));
    const claimByRecord = new Map(overtimeClaims.map(item => [String(item.work_record_id), item]));
    const records = recordSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .filter(item => belongsToMonth(item.date, month))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(record => {
        const roundedStart = record.start_time ? roundUpTo5Minutes(record.start_time).toISOString() : null;
        const roundedEnd = record.end_time ? roundDownTo5Minutes(record.end_time).toISOString() : null;
        const intervals = roundedStart && roundedEnd ? extractOvertimeIntervals(record.date, roundedStart, roundedEnd, schedule) : [];
        return { ...record, overtime_intervals: intervals, overtime_minutes: totalOvertimeMinutes(intervals), overtime_claim: claimByRecord.get(record.id) || null };
      });
    const lessons = lessonSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, unknown>))
      .filter(item => belongsToMonth(item.lesson_date, month))
      .sort((a, b) => `${b.lesson_date}_${b.start_time}`.localeCompare(`${a.lesson_date}_${a.start_time}`));
    const transport = expenseSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, unknown>))
      .filter(item => belongsToMonth(item.expense_date, month))
      .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
    return Response.json({ ok: true, month, schedule, records, overtime_claims: overtimeClaims, lessons, transport }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireDedicated(user);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 30);
    const db = adminDb();

    if (action === 'overtime_decision') {
      const workRecordId = clean(body.work_record_id, 100);
      const decision = body.decision === 'apply' ? 'apply' : body.decision === 'decline' ? 'decline' : '';
      if (!workRecordId || !decision) return Response.json({ ok: false, error: '時間外の申請判断を選択してください。' }, { status: 400 });
      const record = await db.collection('work_records').doc(workRecordId).get();
      if (!record.exists || record.data()?.teacher_id !== user.uid) throw new Error('forbidden');
      const data = record.data() || {};
      if (!data.end_time) return Response.json({ ok: false, error: '退勤打刻後に申請できます。' }, { status: 400 });
      const schedule = normalizeDedicatedSchedule(user.profile);
      const roundedStart = roundUpTo5Minutes(data.start_time).toISOString();
      const roundedEnd = roundDownTo5Minutes(data.end_time).toISOString();
      const intervals = extractOvertimeIntervals(data.date, roundedStart, roundedEnd, schedule);
      if (!intervals.length) return Response.json({ ok: false, error: '申請できる時間外候補はありません。' }, { status: 400 });
      const reason = clean(body.reason, 300);
      const details = clean(body.details, 1000);
      if (decision === 'apply' && !reason) return Response.json({ ok: false, error: '時間外申請の理由を入力してください。' }, { status: 400 });
      await db.collection('dedicated_overtime_claims').doc(`${user.uid}_${workRecordId}`).set({
        user_id: user.uid,
        user_name: clean(user.profile.name || user.profile.teacher_name || user.profile.display_name, 100),
        work_record_id: workRecordId,
        work_date: data.date,
        actual_start: roundedStart,
        actual_end: roundedEnd,
        prescribed_start: schedule.start_time,
        prescribed_end: schedule.end_time,
        overtime_intervals: intervals,
        overtime_minutes: totalOvertimeMinutes(intervals),
        decision,
        reason,
        details,
        status: decision === 'apply' ? 'pending' : 'not_applied',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, overtime_minutes: totalOvertimeMinutes(intervals) });
    }

    if (action === 'lesson_apply') {
      const lessonDate = clean(body.lesson_date, 10);
      const minutes = Math.floor(Number(body.lesson_minutes) || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate) || minutes < 1 || minutes > 720) {
        return Response.json({ ok: false, error: '授業日と授業分数（1〜720分）を入力してください。' }, { status: 400 });
      }
      const key = `daily_${createHash('sha256').update([user.uid, lessonDate].join('\u001f')).digest('hex').slice(0, 34)}`;
      await db.collection('dedicated_lesson_claims').doc(key).set({
        user_id: user.uid,
        user_name: clean(user.profile.name || user.profile.teacher_name || user.profile.display_name, 100),
        person_code: clean(user.profile.lifetime_id || user.profile.staff_id || user.profile.employee_id, 40),
        school_name: clean(body.school_name || user.profile.school_name || user.profile.school || user.profile.classroom, 100),
        lesson_date: lessonDate,
        start_time: '',
        end_time: '',
        lesson_minutes: minutes,
        course_name: '授業時間申請',
        details: '',
        entry_type: 'daily_minutes',
        source_type: 'self_report',
        status: 'pending',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, lesson_minutes: minutes });
    }

    if (action === 'transport_apply') {
      const expenseDate = clean(body.expense_date, 10);
      const from = clean(body.from, 100);
      const to = clean(body.to, 100);
      const amount = Math.max(0, Math.floor(Number(body.amount) || 0));
      const reason = clean(body.reason, 300);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !from || !to || !amount || !reason) {
        return Response.json({ ok: false, error: '日付・移動区間・金額・理由を入力してください。' }, { status: 400 });
      }
      const key = createHash('sha256').update([user.uid, expenseDate, from, to, String(amount), reason].join('\u001f')).digest('hex').slice(0, 40);
      await db.collection('dedicated_transport_claims').doc(key).set({
        user_id: user.uid,
        user_name: clean(user.profile.name || user.profile.teacher_name || user.profile.display_name, 100),
        expense_date: expenseDate,
        from,
        to,
        amount,
        reason,
        details: clean(body.details, 1000),
        status: 'pending',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, amount });
    }

    return Response.json({ ok: false, error: '操作が不正です。' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
