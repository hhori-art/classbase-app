import { resolveAttendanceSchoolCode } from './attendance-schools';

/**
 * 個人情報を入れずにテストしている校舎。生徒・保護者の氏名は登録せず、生徒番号を名前として使う。
 * 名前を保存するすべての入口（生徒の編集・生徒の追加・アカウント作成・CSV取込・一括登録）で、ここを見て番号に置き換える。
 * セキュリティチェックの期間（NO_PERSONAL_INFO_UNTIL の日まで）だけ有効で、翌日0時（日本時間）から自動で解除する。
 * チェックが早く終わったときは、この日付を前倒しする。
 */
export const NO_PERSONAL_INFO_SCHOOL_CODES = ['147', '132', '112'] as const;
/** セキュリティチェックの終了予定日（この日の終わりまで制限する）。 */
export const NO_PERSONAL_INFO_UNTIL = '2026-11-30';

const jstToday = (now: Date) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** いまがセキュリティチェックの期間中か。 */
export const isNoPersonalInfoPeriod = (now = new Date()) => jstToday(now) <= NO_PERSONAL_INFO_UNTIL;

export const NUMERIC_NAME_NOTICE = 'セキュリティ上の理由により、名前の代わりに生徒番号を表示しています。';

export function isNoPersonalInfoSchool(value: unknown, now = new Date()) {
  if (!isNoPersonalInfoPeriod(now)) return false;
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const code = resolveAttendanceSchoolCode(raw) || raw;
  return (NO_PERSONAL_INFO_SCHOOL_CODES as readonly string[]).includes(code);
}

/** 保護者のログインID（末尾の P）から生徒番号を取り出す。 */
const studentNumberOf = (loginId: unknown) => String(loginId ?? '').trim().replace(/P$/i, '');

/** テスト中の校舎の生徒の名前（生徒番号そのもの）。 */
export const anonymousStudentName = (loginId: unknown) => studentNumberOf(loginId);

/** テスト中の校舎の保護者の名前（「生徒番号 保護者」）。 */
export const anonymousParentName = (loginId: unknown) => `${studentNumberOf(loginId)} 保護者`;

/** 名前が生徒番号（または「番号 保護者」）で表示されているか。生徒・保護者の画面で注意書きを出すのに使う。 */
export function isNumberOnlyName(name: unknown, now = new Date()) {
  // 期間が終わったら注意書きは出さない（名前を戻すまでの間に「セキュリティ上の理由」と出し続けないため）。
  if (!isNoPersonalInfoPeriod(now)) return false;
  return /^[0-9A-Za-z_-]+(?:\s*保護者)?$/.test(String(name ?? '').trim()) && /\d/.test(String(name ?? ''));
}
