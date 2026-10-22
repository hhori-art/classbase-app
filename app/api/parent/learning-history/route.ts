import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { jstDateKeyDaysAgo, loadLessonDays, loadLinkedStudentForParent } from '@/lib/server/parent-learning-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 保護者向け：授業日ごとの受講記録（Zoomで参加・録画で視聴・欠席連絡）。 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['parent']);
    const studentId = String(request.nextUrl.searchParams.get('student_id') || '').trim().slice(0, 128);
    if (!studentId) return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    await loadLinkedStudentForParent(actor, studentId);
    // 1年分をまとめて返し、月の切り替えは画面側で行う。
    const days = await loadLessonDays(studentId, { fromDate: jstDateKeyDaysAgo(366) });
    return Response.json({ ok: true, days }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
