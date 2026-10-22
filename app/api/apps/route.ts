import { NextRequest } from 'next/server';
import { canAccessEiken } from '@/lib/eiken/access';
import { normalizeAdminAppPermissions } from '@/lib/admin-app-permissions';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { hasOnlineSchoolProgram } from '@/lib/online-school/access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const eiken = await canAccessEiken(user);
    const adminPermissions = normalizeAdminAppPermissions(user.role, user.profile);
    // 勤怠専用の管理者（attendance_admin）も管理アカウントとして、権限設定どおりにアプリを開く。
    const isManagementAccount = user.role === 'admin' || user.role === 'master' || user.role === 'attendance_admin';
    const isLinkedParent = user.role === 'parent' && Array.isArray(user.profile.student_ids) &&
      user.profile.student_ids.some((studentId: unknown) => String(studentId || '').trim());
    const attendance = isManagementAccount ? adminPermissions.attendance : user.role === 'teacher';
    const scienceSocial = isManagementAccount
      ? adminPermissions.science_social
      : user.role === 'student' || isLinkedParent || (user.role === 'teacher' && hasScienceSocialProgram(user.profile));

    return Response.json({
      ok: true,
      role: user.role,
      apps: {
        science_social: scienceSocial,
        eiken,
        attendance,
        online_school: isManagementAccount ? adminPermissions.online_school : user.role === 'student' && hasOnlineSchoolProgram(user.profile),
      },
      admin_permissions: isManagementAccount ? adminPermissions : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
