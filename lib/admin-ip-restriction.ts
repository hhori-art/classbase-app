/**
 * 管理者・教室管理の画面と API は、許可したネットワーク（教室・オフィスの回線、ALLOWED_IPS）からだけ使える。
 * 講師の業務メニューで社外からロックしている項目と同じ考え方で、勤怠（打刻・承認・シフト・代行）は社外からも使える。
 * 生徒・保護者の画面、ログイン、cron・GAS などのサーバー間の呼び出しは対象外。
 */

const RESTRICTED_PAGE_PREFIXES = [
  '/master',
  '/teacher/online-school',
  '/teacher/contacts',
  '/teacher/homework',
  '/teacher/students',
  '/teacher/school-students',
  '/teacher/pf',
  '/teacher/risk-monitor',
];

/** /master の中でも勤怠の管理は社外から使える（講師メニューの勤怠と同じ）。 */
const ATTENDANCE_PAGE_PREFIXES = [
  '/master/attendance',
  '/master/attendance-approvals',
  '/master/attendance-corrections',
  '/master/shifts',
  '/master/substitutions',
];

const RESTRICTED_API_PREFIXES = [
  '/api/admin',
  '/api/teacher/contacts',
  '/api/teacher/contact-call-marks',
  '/api/teacher/homework',
  '/api/teacher/students',
  '/api/teacher/attention',
  '/api/teacher/analyze-risk',
  '/api/teacher/risk-resolution',
  '/api/online-school/admin',
  '/api/curriculum-admin',
  '/api/eiken/admin',
];

/** 勤怠の画面（講師の専任勤怠承認を含む）が使う管理 API。 */
const ATTENDANCE_API_PREFIXES = [
  '/api/admin/dedicated-attendance',
  '/api/admin/shifts',
  '/api/admin/shift-merges',
  '/api/admin/substitutions',
  '/api/admin/attendance-integration',
  '/api/admin/transport-fares',
  '/api/admin/transport-stations',
];

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const matchesAny = (pathname: string, prefixes: string[]) => prefixes.some(prefix => matchesPrefix(pathname, prefix));

export function isIpRestrictedPath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (matchesAny(path, RESTRICTED_API_PREFIXES)) return !matchesAny(path, ATTENDANCE_API_PREFIXES);
  if (matchesAny(path, RESTRICTED_PAGE_PREFIXES)) return !matchesAny(path, ATTENDANCE_PAGE_PREFIXES);
  return false;
}
