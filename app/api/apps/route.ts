import { NextRequest } from 'next/server';
import { canAccessEiken } from '@/lib/eiken/access';
import { normalizeAdminAppPermissions } from '@/lib/admin-app-permissions';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const eiken = await canAccessEiken(user);
    const adminPermissions = normalizeAdminAppPermissions(user.role, user.profile);
    const isManagementAccount = user.role === 'admin' || user.role === 'master';
    const attendance = isManagementAccount ? adminPermissions.attendance : user.role === 'teacher';
    const scienceSocial = isManagementAccount ? adminPermissions.science_social : user.role === 'teacher' && hasScienceSocialProgram(user.profile);

    return Response.json({
      ok: true,
      role: user.role,
      apps: {
        science_social: scienceSocial,
        eiken,
        attendance,
      },
      admin_permissions: isManagementAccount ? adminPermissions : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
