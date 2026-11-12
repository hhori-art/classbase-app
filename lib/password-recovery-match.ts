/**
 * 生徒・保護者のパスワード再設定：入力が登録情報と一致するかの判定（純粋関数）。
 * 照合項目：ログインID（生徒番号）・氏名・校舎・学年・登録電話番号の下4桁。
 * 保護者は、校舎・学年をつながっているお子さまのどれかで、電話は保護者本人の登録で照合する。
 * 生徒は、電話を本人の登録か、つながっている保護者の登録で照合する。
 */

export const RECOVERY_GRADES = ['小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'] as const;

const nfkc = (value: unknown) => String(value ?? '').normalize('NFKC');

/** 「中学2年」「中2」「中学２年生」→「中2」。判定できなければ空。 */
export function normalizeRecoveryGrade(value: unknown) {
  const raw = nfkc(value).replace(/\s+/g, '');
  const stage = raw.match(/[小中高]/)?.[0];
  const year = raw.match(/[1-6]/)?.[0];
  if (!stage || !year) return '';
  if (stage !== '小' && Number(year) > 3) return '';
  return `${stage}${year}`;
}

/** 「西明石」「エディック 西明石校」「西明石校」を同じ校舎として比べるための形。 */
export function normalizeRecoverySchool(value: unknown) {
  return nfkc(value)
    .replace(/[\s　・]/g, '')
    .replace(/^(創造学園|エディック|EDIC)/i, '')
    .replace(/(教室|校舎|校)$/, '')
    .toLowerCase();
}

export function schoolMatches(input: unknown, candidates: unknown[]) {
  const wanted = normalizeRecoverySchool(input);
  if (wanted.length < 2) return false;
  return candidates.map(normalizeRecoverySchool).filter(Boolean).some(candidate => candidate === wanted);
}

export const phoneLast4 = (value: unknown) => nfkc(value).replace(/\D/g, '').slice(-4);

export const profilePhones = (profile: Record<string, any>) =>
  [profile.phone_number, profile.phone, profile.tel, profile.telephone, profile.parent_phone, profile.guardian_phone]
    .map(phoneLast4).filter(value => value.length === 4);

export const profileSchools = (profile: Record<string, any>) =>
  [profile.school_id, profile.school_code, profile.school_name, profile.school, profile.classroom, profile.classroom_name];

export type RecoveryMatchInput = { school: string; grade: string; phoneLast4: string };

export type RecoveryMatchContext = {
  role: 'student' | 'parent';
  /** 生徒なら本人、保護者ならつながっているお子さま（複数可）。 */
  students: Array<Record<string, any>>;
  /** 照合に使ってよい電話：生徒は本人＋つながっている保護者、保護者は本人。 */
  phones: string[];
};

/** 氏名・ログインIDは呼び出し側で確認済みとして、残りの項目がそろって一致するか。 */
export function recoveryInfoMatches(input: RecoveryMatchInput, context: RecoveryMatchContext) {
  const grade = normalizeRecoveryGrade(input.grade);
  const phone = phoneLast4(input.phoneLast4);
  if (!grade || phone.length !== 4 || !context.phones.includes(phone)) return false;
  return context.students.some(student => (
    normalizeRecoveryGrade(student.grade) === grade && schoolMatches(input.school, profileSchools(student))
  ));
}

/** 通知文に載せるため、宛先メールを一部だけ見せる（ab***@example.com）。 */
export function maskEmail(email: string) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}
