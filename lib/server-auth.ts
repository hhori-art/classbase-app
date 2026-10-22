import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageAdminApp } from '@/lib/admin-app-access';
import { isDedicatedAttendanceApproverProfile, isDedicatedProfile } from '@/lib/employment-category';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';

export type AppRole = 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin';

export type ServerUser = {
  uid: string;
  email?: string;
  role: AppRole;
  school?: string;
  school_ids: string[];
  profile: FirebaseFirestore.DocumentData;
};

const ADMIN_ROLES: AppRole[] = ['master', 'admin'];
const ADMIN_ROLE_ALIASES = [
  'admin',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
];
const ATTENDANCE_ADMIN_ALIASES = ['attendance_admin', 'attendance_only', 'attendance_manager'];

export async function getServerUser(request: NextRequest): Promise<ServerUser> {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    throw new Error('missing-token');
  }

  const decoded = await adminAuth().verifyIdToken(token, true);
  const profileSnap = await adminDb().collection('users').doc(decoded.uid).get();

  if (!profileSnap.exists) {
    throw new Error('profile-not-found');
  }

  const profile = profileSnap.data() || {};
  if (['suspended', 'withdrawn', 'archived'].some(status =>
    profile.account_status === status || profile.status === status)) throw new Error('forbidden');
  const role = normalizeRole(profile.role);
  const primarySchoolCode = resolveAttendanceSchoolCode(
    profile.school_id || profile.school_code || profile.school_name || profile.school
  ) || String(profile.school_id || profile.school_code || profile.school_name || profile.school || '').trim();
  const primarySchoolName = attendanceSchoolName(primarySchoolCode);
  const storedSchoolIds = Array.isArray(profile.school_ids)
    ? profile.school_ids
    : Array.isArray(profile.attendance_school_ids) ? profile.attendance_school_ids : [];
  const schoolIds = Array.from(new Set([primarySchoolCode, primarySchoolName, ...storedSchoolIds.flatMap((value: unknown) => {
    const code = resolveAttendanceSchoolCode(value) || String(value || '').trim();
    return [code, attendanceSchoolName(code)];
  })].filter(Boolean)));

  return {
    uid: decoded.uid,
    email: decoded.email,
    role,
    school: profile.school_name || profile.school || primarySchoolName || primarySchoolCode,
    school_ids: schoolIds,
    profile,
  };
}

export function normalizeRole(role: unknown): AppRole {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'master') return 'master';
  if (ATTENDANCE_ADMIN_ALIASES.includes(r)) return 'attendance_admin';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  if (r === 'parent' || r === 'guardian') return 'parent';
  return 'student';
}

export function requireRole(user: ServerUser, allowed: AppRole[]) {
  if (!allowed.includes(user.role)) {
    throw new Error('forbidden');
  }
}

export function requireMaster(user: ServerUser) {
  if (user.role !== 'master') {
    throw new Error('forbidden');
  }
}

export function isAdminLike(user: ServerUser) {
  return ADMIN_ROLES.includes(user.role) && canManageAdminApp(user, 'science_social');
}

export function canManageAttendance(user: ServerUser) {
  return canManageAdminApp(user, 'attendance') || (
    user.role === 'teacher' &&
    isDedicatedProfile(user.profile) &&
    user.profile.attendance_school_manager === true
  );
}

export function canManageAttendanceSystem(user: ServerUser) {
  return canManageAdminApp(user, 'attendance');
}

export function canManageShifts(user: ServerUser) {
  return user.role === 'master' || isDedicatedAttendanceApproverProfile(user.profile);
}

/** 勤怠シフトは理社講座の講師配置とは分離し、マスターと専任の校舎承認者だけが管理する。 */
export function canManageAttendanceShiftPlans(user: ServerUser) {
  return user.role === 'master' || isDedicatedAttendanceApproverProfile(user.profile);
}

export function canManageAttendanceSchool(user: ServerUser, targetSchool?: string | null) {
  if (!canManageAttendance(user)) return false;
  if (user.role === 'master') return true;
  const allowed = new Set([user.school, ...user.school_ids].map(value =>
    resolveAttendanceSchoolCode(value) || String(value || '').trim()
  ).filter(Boolean));
  // 校舎未設定の勤怠管理アカウントは全校担当として扱う（校舎を設定すればその校舎に限定）。
  if (user.role === 'attendance_admin' && allowed.size === 0) return true;
  const canonicalTarget = resolveAttendanceSchoolCode(targetSchool) || String(targetSchool || '').trim();
  return Boolean(canonicalTarget && allowed.has(canonicalTarget));
}

export function canUseTeacherAttendance(user: ServerUser) {
  return user.role === 'teacher';
}

export function canManageSchool(user: ServerUser, targetSchool?: string | null) {
  if (user.role === 'master') return true;
  if (user.role !== 'admin' || !canManageAdminApp(user, 'science_social')) return false;
  if (!targetSchool) return true;
  const canonicalTarget = resolveAttendanceSchoolCode(targetSchool) || String(targetSchool).trim();
  return user.school_ids.some(value =>
    (resolveAttendanceSchoolCode(value) || String(value).trim()) === canonicalTarget
  );
}

/** 管理アプリ（勤怠・オンライン校など）の権限を持つ管理者が、その校舎の生徒・講師を扱えるか。マスターは全校。 */
export function canManageAdminAppSchool(user: ServerUser, app: Parameters<typeof canManageAdminApp>[1], targetSchool?: string | null) {
  if (user.role === 'master') return true;
  if (!canManageAdminApp(user, app) || !targetSchool) return false;
  const canonicalTarget = resolveAttendanceSchoolCode(targetSchool) || String(targetSchool).trim();
  return [user.school, ...user.school_ids].some(value =>
    (resolveAttendanceSchoolCode(value) || String(value || '').trim()) === canonicalTarget
  );
}

/**
 * 理社講座の講師向け機能（生徒一覧・生徒とのチャット・連絡・宿題・スライド等）を使える職員か。
 * 管理者は理社講座の管理権限が必要。講師は担当プログラムが設定されている場合は理社講座を含むこと
 * （プログラム未設定の古い講師アカウントは従来どおり許可し、校舎の範囲は各APIで絞る）。
 */
export function canUseScienceSocialStaffTools(user: ServerUser) {
  if (user.role === 'master') return true;
  if (user.role === 'admin') return isAdminLike(user);
  if (user.role === 'teacher') {
    return !Array.isArray(user.profile.enabled_programs) || hasScienceSocialProgram(user.profile);
  }
  return false;
}

export function requireScienceSocialStaff(user: ServerUser) {
  if (!canUseScienceSocialStaffTools(user)) throw new Error('forbidden');
}

export function canViewSchoolStudents(user: ServerUser, targetSchool?: string | null) {
  if (isAdminLike(user)) return canManageSchool(user, targetSchool);
  if (user.role !== 'teacher' || !isDedicatedProfile(user.profile) || !hasScienceSocialProgram(user.profile)) return false;
  if (!targetSchool) return true;
  const canonicalTarget = resolveAttendanceSchoolCode(targetSchool) || String(targetSchool).trim();
  return [user.school, ...user.school_ids].some(value =>
    (resolveAttendanceSchoolCode(value) || String(value || '').trim()) === canonicalTarget
  );
}

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const authenticationExpired = message === 'missing-token' ||
    ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-disabled', 'auth/argument-error'].includes(code);
  const normalizedStatus =
    authenticationExpired ? 401 :
    message === 'profile-not-found' ? 403 :
    message === 'forbidden' ? 403 :
    status;

  return Response.json({
    ok: false,
    error: authenticationExpired ? 'ログイン情報が失効しています。再度ログインしてください。' : message,
    ...(authenticationExpired ? { code: 'reauth-required' } : {}),
  }, { status: normalizedStatus });
}
