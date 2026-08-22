import 'server-only';

import type { ServerUser } from '@/lib/server-auth';
import {
  hasAdminAppPermission,
  type AdminAppId,
} from '@/lib/admin-app-permissions';

export function canManageAdminApp(user: ServerUser, app: AdminAppId) {
  return hasAdminAppPermission(user.role, user.profile, app);
}

export function requireAdminApp(user: ServerUser, app: AdminAppId) {
  if (!canManageAdminApp(user, app)) throw new Error('forbidden');
}
