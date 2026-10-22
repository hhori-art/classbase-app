// 管理アプリごとの権限。理社講座・Booster・勤怠・オンライン校はそれぞれ独立して付け外しする（マスターは全て）。
export const ADMIN_APP_IDS = ['science_social', 'eiken', 'attendance', 'online_school'] as const;

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
  '/master/ui-guide',
  '/master/stats',
  '/master/announcements',
  '/master/community',
  '/master/parent-inquiries',
  '/master/safety-alerts',
  '/master/requests',
  '/master/inbox',
  '/master/audit-logs',
] as const;

export const ADMIN_APP_LABELS: Record<AdminAppId, string> = {
  science_social: '理社講座 管理',
  eiken: 'Booster 管理',
  attendance: '勤怠 管理',
  online_school: 'オンライン校 管理',
};

const EMPTY_PERMISSIONS: AdminAppPermissions = {
  science_social: false,
  eiken: false,
  attendance: false,
  online_school: false,
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

const SCHOOL_ADMIN_ALLOWED_PATHS = [
  '/master',
  '/master/science-social',
  '/master/school-students',
  '/master/monthly-schedules',
  '/master/shifts',
  // ポイント・景品管理。生徒への操作はAPI側で担当校の生徒に限定する。
  '/master/rewards',
  // 自分宛ての通知（APIは本人の通知だけを返す）。
  '/master/notifications',
] as const;

// どの管理者でも開ける画面（自分のホーム・自分宛ての通知・自分のアカウント）。
const GLOBAL_ADMIN_PATHS = ['/master', '/master/notifications', '/master/account'] as const;

export function isGlobalAdminPath(pathname: string) {
  return GLOBAL_ADMIN_PATHS.some(path => pathname === path || (path !== '/master' && pathname.startsWith(`${path}/`)));
}

export function isSchoolAdminAllowedPath(pathname: string) {
  return SCHOOL_ADMIN_ALLOWED_PATHS.some(path =>
    pathname === path || (path !== '/master' && pathname.startsWith(`${path}/`))
  );
}

export function normalizeAdminAppPermissions(
  role: unknown,
  profile: Record<string, any> = {},
): AdminAppPermissions {
  const normalizedRole = String(role || '').toLowerCase();

  if (normalizedRole === 'master') {
    return { science_social: true, eiken: true, attendance: true, online_school: true };
  }

  if (isAttendanceAppAccountRole(normalizedRole)) {
    return { ...EMPTY_PERMISSIONS, attendance: true };
  }

  if (!isConfigurableAdminRole(normalizedRole)) return { ...EMPTY_PERMISSIONS };

  const stored = profile.admin_permissions;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return {
      science_social: stored.science_social === true,
      eiken: stored.eiken === true,
      attendance: stored.attendance === true,
      online_school: stored.online_school === true,
    };
  }

  if (isConfigurableAdminRole(normalizedRole)) {
    const programs = programList(profile);
    // 権限を一度も設定していない古い管理者アカウントは理社講座だけ（勤怠・オンライン校は明示的に付けたときだけ）。
    return {
      science_social: true,
      eiken: profile.eiken_admin === true || programs.includes('eiken'),
      attendance: false,
      online_school: false,
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
    pathname.startsWith('/master/attendance-approvals')
  ) {
    return 'attendance';
  }
  if (pathname === '/master/eiken' || pathname.startsWith('/master/eiken/')) {
    return 'eiken';
  }
  if (pathname === '/master/online-school' || pathname.startsWith('/master/online-school/')) {
    return 'online_school';
  }
  // シフトは理社講座管理者と、専任の勤怠承認者が共用する。
  // 画面の基本所属は理社講座とし、layout側で専任承認者の例外入場を許可する。
  if (
    isGlobalAdminPath(pathname) ||
    isMasterOnlyAdminPath(pathname)
  ) {
    return null;
  }
  if (pathname.startsWith('/master/')) return 'science_social';
  return null;
}

/**
 * 校舎管理者（マスター以外の管理者）が理社講座の画面で入れる範囲の制限。
 * 制限は理社講座の画面だけにかける。勤怠・Booster・オンライン校は、権限を付けた画面をそのまま使える。
 */
export function isBlockedForSchoolAdmin(pathname: string) {
  return adminAppForPath(pathname) === 'science_social' && !isSchoolAdminAllowedPath(pathname);
}
