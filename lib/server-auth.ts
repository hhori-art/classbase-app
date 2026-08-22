import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageAdminApp } from '@/lib/admin-app-access';

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

  const decoded = await adminAuth().verifyIdToken(token);
  const profileSnap = await adminDb().collection('users').doc(decoded.uid).get();

  if (!profileSnap.exists) {
    throw new Error('profile-not-found');
  }

  const profile = profileSnap.data() || {};
  const role = normalizeRole(profile.role);
  const schoolIds = Array.isArray(profile.school_ids)
    ? profile.school_ids.filter(Boolean)
    : [profile.school_id, profile.school].filter(Boolean);

  return {
    uid: decoded.uid,
    email: decoded.email,
    role,
    school: profile.school || profile.school_id,
    school_ids: schoolIds,
    profile,
  };
}

export function normalizeRole(role: unknown): AppRole {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'master') return 'master';
  // 旧勤怠管理者は講師へ統合する。
  if (ATTENDANCE_ADMIN_ALIASES.includes(r)) return 'teacher';
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
  return canManageAdminApp(user, 'attendance');
}

export function canUseTeacherAttendance(user: ServerUser) {
  return user.role === 'teacher';
}

export function canManageSchool(user: ServerUser, targetSchool?: string | null) {
  if (user.role === 'master') return true;
  if (user.role !== 'admin' || !canManageAdminApp(user, 'science_social')) return false;
  if (!targetSchool) return true;
  return user.school_ids.includes(targetSchool);
}

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedStatus =
    message === 'missing-token' ? 401 :
    message === 'profile-not-found' ? 403 :
    message === 'forbidden' ? 403 :
    status;

  return Response.json({ ok: false, error: message }, { status: normalizedStatus });
}
