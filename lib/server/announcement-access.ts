export const announcementRoleTargets: Record<string, string[]> = {
  student: ['all', 'student'], parent: ['all', 'parent'], guardian: ['all', 'parent'],
  teacher: ['all', 'teacher', 'staff'], attendance_admin: ['all', 'teacher', 'staff'],
  admin: ['all', 'admin', 'school_admin'], school_admin: ['all', 'admin', 'school_admin'], master: ['all', 'admin', 'school_admin'],
};

export const cleanAnnouncementList = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : String(value || '').split(',').map(item => item.trim()).filter(Boolean);

const schoolKeys = (value: unknown) => {
  const raw = String(value || '').normalize('NFKC').trim();
  if (!raw) return [];
  const code = resolveAttendanceSchoolCode(raw);
  return code && code !== raw ? [raw, code] : [raw];
};

const userSchools = (user: any) => new Set([user.school, user.profile?.school, user.profile?.school_id, user.profile?.school_code,
  ...cleanAnnouncementList(user.school_ids), ...cleanAnnouncementList(user.profile?.school_ids), ...cleanAnnouncementList(user.linked_schools),
].flatMap(schoolKeys));

export function canReadAnnouncement(user: any, item: any) {
  if (item.archived === true || item.is_active === false) return false;
  const publishAt = item.publish_at?.toDate ? item.publish_at.toDate() : item.publish_at ? new Date(item.publish_at) : null;
  if (publishAt && !Number.isNaN(publishAt.getTime()) && publishAt.getTime() > Date.now()) return false;
  const target = String(item.target || 'all').trim() || 'all';
  if (!(announcementRoleTargets[user.role] || []).includes(target)) return false;
  const targetSchools = cleanAnnouncementList(item.school_ids || item.target_school_ids || item.school_id || item.target_school_id).flatMap(schoolKeys);
  if (targetSchools.length && !targetSchools.some(school => userSchools(user).has(school))) return false;
  const targetGrades = cleanAnnouncementList(item.grades || item.target_grades || item.grade || item.target_grade);
  const viewerGrades = new Set([String(user.profile?.grade || '').trim(), ...cleanAnnouncementList(user.linked_grades)].filter(Boolean));
  return !targetGrades.length || targetGrades.some(grade => viewerGrades.has(grade));
}

const PARENT_ROLES = new Set(['parent', 'guardian']);
const MAX_LINKED_STUDENTS = 20;

/** 保護者が対象かどうかは、紐づく生徒の校舎・学年でも判定する。読み込む生徒のID（保護者以外は空）。 */
export function announcementLinkedStudentIds(user: any) {
  return PARENT_ROLES.has(user.role) ? cleanAnnouncementList(user.profile?.student_ids).slice(0, MAX_LINKED_STUDENTS) : [];
}

/** canReadAnnouncement に渡す閲覧者。保護者には紐づく生徒の校舎・学年を足す（お知らせの閲覧と端末への通知で共通）。 */
export function withAnnouncementLinkedStudents(user: any, students: Array<Record<string, any> | undefined>) {
  if (!PARENT_ROLES.has(user.role)) return user;
  const linked = students.filter((student): student is Record<string, any> => Boolean(student));
  return { ...user,
    linked_schools: linked.flatMap(data => [data.school_id, data.school_code, data.school].filter(Boolean)),
    linked_grades: linked.map(data => data.grade).filter(Boolean),
  };
}

const asIso = (value: any) => value?.toDate ? value.toDate().toISOString() : value || '';
export function serializeAnnouncement(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() || {};
  return { ...data, id: doc.id, created_at: asIso(data.created_at), updated_at: asIso(data.updated_at), publish_at: asIso(data.publish_at) };
}
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
