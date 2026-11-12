/**
 * 管理者・マスターは、ブラウザを閉じたらログアウトする（KDL診断 E.2.4）。
 * ログインしたときに、ブラウザを閉じると消えるクッキー（有効期限なし）を置き、
 * 次に開いたときにこれがなければ、管理系のアカウントはログアウトする。生徒・講師・保護者は今までどおり。
 */
const COOKIE = 'cb_admin_browser_session';
const ADMIN_ROLES = new Set(['master', 'admin', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin', 'test_admin', 'master_admin', 'super_admin', 'attendance_admin', 'attendance_only', 'attendance_manager']);

export const isAdminBrowserRole = (role: unknown) => ADMIN_ROLES.has(String(role || '').toLowerCase());

export function markAdminBrowserSession(role: string) {
  if (typeof document === 'undefined' || !isAdminBrowserRole(role)) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=1; Path=/; SameSite=Strict${secure}`;
}

export function hasAdminBrowserSession() {
  if (typeof document === 'undefined') return true;
  return document.cookie.split(';').some(part => part.trim().startsWith(`${COOKIE}=`));
}

export function clearAdminBrowserSession() {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}
