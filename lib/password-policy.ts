// パスワードのきまり（KDL診断 A.1.1 への対応、2026-11-12 決定）。画面とサーバーの両方でこの1か所を使う。
// - 管理系アカウント（マスター・管理者など）は15文字以上。
// - 生徒・保護者・講師は、小中学生が自分で入力するため8文字以上にとどめ、よく使われるパスワードは登録できないようにする。
// - 今のパスワードには変更を求めない。新しく決めるときから、このきまりを使う。
const BASIC_ROLES = new Set(['student', 'teacher', 'parent', 'guardian']);

export const PASSWORD_MAX_LENGTH = 128;
export const BASIC_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 15;

export function minPasswordLength(role: unknown) {
  return BASIC_ROLES.has(String(role || '').toLowerCase()) ? BASIC_PASSWORD_MIN_LENGTH : ADMIN_PASSWORD_MIN_LENGTH;
}

// よく使われるパスワード（漏えいしたパスワードの上位から、8文字以上のもの）と、学校・アプリに関係する語。
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwertyui', 'qwerty12', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfasdf', 'zxcvbnm1', '1qaz2wsx', 'qazwsxedc',
  'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'starwars', 'whatever',
  'trustno1', 'letmein1', 'welcome1', 'abcd1234', 'abc12345', 'abcdefgh', 'aaaaaaaa', 'pokemon1', 'doraemon',
  'classbase', 'classbase1', 'sozogakuen', 'sozo1234', 'gakuen123', 'student1', 'teacher1', 'school123',
]);

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** 同じ文字の繰り返し（aaaaaaaa）や、並んだ数字・文字（12345678、abcdefgh）だけでできているか。 */
function isTrivialSequence(value: string) {
  if (new Set(value).size <= 2) return true;
  let up = true;
  let down = true;
  for (let index = 1; index < value.length; index += 1) {
    const diff = value.charCodeAt(index) - value.charCodeAt(index - 1);
    if (diff !== 1) up = false;
    if (diff !== -1) down = false;
  }
  return up || down;
}

export function isCommonPassword(password: string, loginIds: unknown[] = []) {
  const value = normalize(password);
  if (COMMON_PASSWORDS.has(value) || isTrivialSequence(value)) return true;
  // ID や生年月日のような、本人のIDと同じ・IDに数字を足しただけのもの
  return loginIds.map(id => normalize(String(id || '').split('@')[0])).filter(id => id.length >= 4)
    .some(id => value === id || value.replace(/\d+$/, '') === id || value.includes(id) && value.length - id.length <= 3);
}

/** きまりに合わないときは、画面に出す日本語の理由を返す。合えば空文字。 */
export function passwordPolicyError(password: unknown, role: unknown, loginIds: unknown[] = []) {
  const value = typeof password === 'string' ? password : '';
  const min = minPasswordLength(role);
  if (value.length < min) return `パスワードは${min}文字以上で入力してください。`;
  if (value.length > PASSWORD_MAX_LENGTH) return `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください。`;
  if (/\s/.test(value)) return 'パスワードに空白は使えません。';
  if (isCommonPassword(value, loginIds)) return 'よく使われるパスワードや、IDに近いパスワードは使えません。別のパスワードにしてください。';
  return '';
}

/** 画面の案内文（例：「8文字以上」）。 */
export const passwordRuleLabel = (role: unknown) => `${minPasswordLength(role)}文字以上`;
