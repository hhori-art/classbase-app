import { NextRequest } from 'next/server';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { canSeeStudentSchool, canUseStudentOverview, loadAdminStudentRoster } from '@/lib/server/admin-student-roster';
import { searchStudentEntries, STUDENT_SEARCH_MAX_RESULTS } from '@/lib/server/student-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 生徒検索（名前・ふりがな・ログインID／生涯番号の部分一致）。
 * マスターは全校、理社講座の管理者は担当校の生徒だけ。名簿は5分の共有キャッシュから探し、最大20人を返す。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canUseStudentOverview(user)) throw new Error('forbidden');
    const query = String(request.nextUrl.searchParams.get('q') || '').slice(0, 60);
    if (!query.trim()) return Response.json({ ok: true, students: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    const roster = await loadAdminStudentRoster();
    const matches = searchStudentEntries(roster, query, entry => canSeeStudentSchool(user, entry.school), STUDENT_SEARCH_MAX_RESULTS);
    return Response.json({
      ok: true,
      students: matches.map(entry => ({
        id: entry.id,
        name: entry.name,
        kana: entry.kana,
        grade: entry.grade,
        school_name: attendanceSchoolName(entry.school) || entry.school,
        lifetime_id: entry.lifetime_id || entry.login_id,
        inactive: entry.inactive,
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
