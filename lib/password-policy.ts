// 生徒・保護者・講師は入力しやすさを優先して6文字、
// 個人情報を扱う管理系アカウントは10文字以上を必須にする。
const BASIC_ROLES = new Set(['student', 'teacher', 'parent', 'guardian']);

export function minPasswordLength(role: unknown) {
  return BASIC_ROLES.has(String(role || '').toLowerCase()) ? 6 : 10;
}
