import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { loadLinkedStudentForParent } from '@/lib/server/parent-learning-history';
import { buildParentMonthlyReport } from '@/lib/server/parent-monthly-report';
import { jstMonthKey, parseReportMonth, REPORT_PAST_MONTHS, shiftMonthKey } from '@/lib/server/parent-monthly-report-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 保護者向け：お子さま1人・1か月分の学習レポート（GET ?student_id=&month=YYYY-MM）。紐づくお子さまだけ。 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['parent']);
    const studentId = String(request.nextUrl.searchParams.get('student_id') || '').trim().slice(0, 128);
    if (!studentId) return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    const nowMs = Date.now();
    const month = parseReportMonth(request.nextUrl.searchParams.get('month'), nowMs);
    if (!month) return Response.json({ ok: false, error: 'invalid month' }, { status: 400 });
    const student = await loadLinkedStudentForParent(actor, studentId);
    const report = await buildParentMonthlyReport(studentId, month, nowMs);
    const current = jstMonthKey(nowMs);
    return Response.json({
      ok: true,
      student: { id: student.id, name: String(student.data.student_name || student.data.name || '').trim().slice(0, 120) || 'お子さま', grade: String(student.data.grade || '').trim().slice(0, 40) },
      months: { newest: current, oldest: shiftMonthKey(current, -REPORT_PAST_MONTHS) },
      ...report,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
