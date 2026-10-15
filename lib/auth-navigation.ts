import { isDedicatedProfile } from '@/lib/employment-category';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { hasAdminAppPermission } from '@/lib/admin-app-permissions';

export type AuthRole = 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin';

export const targetPathByRole = (_role: AuthRole) => '/apps';

type NavigationProfile = Record<string, unknown> & { role?: unknown };

export const isDedicatedScienceSocialProfile = (profile: NavigationProfile | null | undefined) =>
  Boolean(profile && String(profile.role || '').toLowerCase() === 'teacher' && isDedicatedProfile(profile) && hasScienceSocialProgram(profile));

/** ログイン後に最初に開く画面。専任の理社講座担当は自校舎の管理画面を直接開く。 */
export const targetPathForProfile = (profile: NavigationProfile) => {
  const role = String(profile.role || '').toLowerCase();
  if (role === 'master' || role === 'admin') return '/master';
  if (role === 'attendance_admin' || role === 'attendance_only' || role === 'attendance_manager') return '/master/attendance';
  if (isDedicatedScienceSocialProfile(profile)) return '/teacher/school-students';
  return '/apps';
};

/** 理社講座を選択したときの入り口。 */
export const scienceSocialPathForProfile = (profile: NavigationProfile) => {
  const role = String(profile.role || '').toLowerCase();
  if (role === 'student') return '/student';
  if (role === 'parent' || role === 'guardian') return '/parent';
  if (role === 'teacher') {
    return isDedicatedScienceSocialProfile(profile) ? '/teacher/school-students' : '/teacher';
  }
  return '/master/science-social';
};

export const roleMatchesPath = (role: AuthRole, path: string) => {
  if (path.startsWith('/zoom-meeting')) return true;
  if (path.startsWith('/account/password-change')) return true;
  if (path === '/apps' || path.startsWith('/apps/')) return true;
  if (role === 'teacher') {
    return path.startsWith('/teacher') || path.startsWith('/eiken/teacher');
  }
  if (role === 'master' || role === 'admin' || role === 'attendance_admin') {
    return path.startsWith('/master') || path.startsWith('/admin');
  }
  if (role === 'parent') {
    return path.startsWith('/parent') || path.startsWith('/eiken/parent');
  }
  return path.startsWith('/student') || path.startsWith('/eiken/student');
};

/**
 * Profile-aware route guard for the small number of cross-portal screens.
 * Dedicated attendance approvers remain teacher accounts. The attendance
 * shift planner is kept under /teacher and is gated again by the teacher layout.
 */
export const profileMatchesPath = (profile: NavigationProfile, path: string) => {
  if (path === '/master/shifts' || path.startsWith('/master/shifts/')) {
    return hasAdminAppPermission(profile.role, profile, 'science_social');
  }
  return roleMatchesPath(String(profile.role || '').toLowerCase() as AuthRole, path);
};

export const isRoleScopedPath = (path: string) =>
  path.startsWith('/account/password-change') ||
  path.startsWith('/student') ||
  path.startsWith('/teacher') ||
  path.startsWith('/master') ||
  path.startsWith('/admin') ||
  path.startsWith('/parent') ||
  path.startsWith('/eiken/student') ||
  path.startsWith('/eiken/teacher') ||
  path.startsWith('/eiken/parent');

/** Authentication-independent screens that must remain usable before login. */
export const isPublicAuthPath = (path: string) =>
  path === '/manual' ||
  path.startsWith('/manual/') ||
  path === '/password-reset' ||
  path.startsWith('/password-reset/');
