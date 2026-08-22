export const ADMIN_APP_IDS = ['science_social', 'eiken', 'attendance'] as const;

export type AdminAppId = typeof ADMIN_APP_IDS[number];

export type AdminAppPermissions = Record<AdminAppId, boolean>;

const CONFIGURABLE_ADMIN_ROLES = new Set([
  'admin',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
]);

const ATTENDANCE_APP_ACCOUNT_ROLES = new Set([
  'attendance_admin',
  'attendance_only',
  'attendance_manager',
]);

const MASTER_ONLY_ADMIN_PATHS = [
  '/master/access-control',
  '/master/accounts',
  '/master/users',
  '/master/delete',
  '/master/settings',
  '/master/stats',
] as const;

export const ADMIN_APP_LABELS: Record<AdminAppId, string> = {
  science_social: '理社講座 管理',
  eiken: 'Booster 管理',
  attendance: '勤怠 管理',
};

const EMPTY_PERMISSIONS: AdminAppPermissions = {
  science_social: false,
  eiken: false,
  attendance: false,
};

const programList = (profile: Record<string, any>) =>
  Array.isArray(profile.enabled_programs)
    ? profile.enabled_programs.map((value: unknown) => String(value))
    : [];

export function isAttendanceAppAccountRole(role: unknown) {
  return ATTENDANCE_APP_ACCOUNT_ROLES.has(String(role || '').toLowerCase());
}

export function isConfigurableAdminRole(role: unknown) {
  return CONFIGURABLE_ADMIN_ROLES.has(String(role || '').toLowerCase());
}

export function normalizeAdminAppPermissions(
  role: unknown,
  profile: Record<string, any> = {},
): AdminAppPermissions {
  const normalizedRole = String(role || '').toLowerCase();

  if (normalizedRole === 'master') {
    return { science_social: true, eiken: true, attendance: true };
  }

  if (isAttendanceAppAccountRole(normalizedRole)) {
    return { ...EMPTY_PERMISSIONS, attendance: true };
  }

  const stored = profile.admin_permissions;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return {
      science_social: stored.science_social === true,
      eiken: stored.eiken === true,
      attendance: stored.attendance === true,
    };
  }

  if (normalizedRole === 'admin' || normalizedRole.includes('admin')) {
    const programs = programList(profile);
    return {
      science_social: true,
      eiken: profile.eiken_admin === true || programs.includes('eiken'),
      attendance: true,
    };
  }

  return { ...EMPTY_PERMISSIONS };
}

export function hasAdminAppPermission(
  role: unknown,
  profile: Record<string, any>,
  app: AdminAppId,
) {
  return normalizeAdminAppPermissions(role, profile)[app];
}

export function isMasterOnlyAdminPath(pathname: string) {
  return MASTER_ONLY_ADMIN_PATHS.some(path =>
    pathname === path || pathname.startsWith(`${path}/`)
  );
}

export function adminAppForPath(pathname: string): AdminAppId | null {
  if (
    pathname === '/master/attendance' ||
    pathname.startsWith('/master/attendance/') ||
    pathname.startsWith('/master/attendance-corrections')
  ) {
    return 'attendance';
  }
  if (pathname === '/master/eiken' || pathname.startsWith('/master/eiken/')) {
    return 'eiken';
  }
  if (
    pathname === '/master' ||
    isMasterOnlyAdminPath(pathname)
  ) {
    return null;
  }
  if (pathname.startsWith('/master/')) return 'science_social';
  return null;
}
