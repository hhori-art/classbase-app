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

const asIso = (value: any) => value?.toDate ? value.toDate().toISOString() : value || '';
export function serializeAnnouncement(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() || {};
  return { ...data, id: doc.id, created_at: asIso(data.created_at), updated_at: asIso(data.updated_at), publish_at: asIso(data.publish_at) };
}
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
