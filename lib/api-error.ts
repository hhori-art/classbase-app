/**
 * APIのエラー応答を作る（jsonError の中身。Firebase などに依存しないのでテストから直接読める）。
 * 画面に出すのは、こちらで用意した日本語の文言と、こちらで決めた短いコードだけ。
 * それ以外（Firebase・Google・Zoom などの英語の文言、スタック）は「受付番号」だけ見せ、中身はサーバーのログに残す。
 */

/** 画面にそのまま見せてよい文言のエラー。status を付けると、その状態コードで返す。 */
export class UserFacingError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.status = options.status;
    this.code = options.code;
  }
}

export const INTERNAL_ERROR_CODE = 'internal-error';

const REAUTH_MESSAGE = 'ログイン情報が失効しています。再度ログインしてください。';
const REAUTH_FIREBASE_CODES = ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-disabled', 'auth/argument-error'];

// どの画面でも同じ意味になる汎用のコードだけ、サーバー側で日本語にする（元のコードは code に残す）。
const GENERIC_MESSAGES: Record<string, string> = {
  forbidden: 'この操作を行う権限がありません。',
  'profile-not-found': 'アカウントの情報が見つかりません。管理者に連絡してください。',
};

const HAS_JAPANESE = /[぀-ヿ㐀-鿿]/;
// 日本語でも、こうした内部の情報が混ざっていたら見せない。
const INTERNAL_MARKERS = /https?:\/\/|projects\/|\/databases\/|\/documents\/|node_modules|\bat\s+\S+\s+\(|\.(?:ts|tsx|js|mjs):\d+|[A-Z][A-Z_]{5,}:|Error:|\{|\}/;
// こちらで決めた短いコード（例: too-many-attempts, recording_id-or-shift_id-required）。
const SAFE_CODE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
// こちらのコードで投げている英小文字の短い文（例: work record not found）。画面側の対応表がこの文言を見ている。
const OWN_ENGLISH_CODE = /^[a-z][a-z0-9_ ,;.\-]{0,79}$/;

/** こちらで決めた短いコードか。 */
export function isSafeErrorCode(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 60 && SAFE_CODE.test(value);
}

/** 日本語で、内部の情報を含まない文言か。 */
export function isPreparedJapaneseMessage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300 && HAS_JAPANESE.test(value) && !INTERNAL_MARKERS.test(value);
}

/**
 * 入力チェックなどで投げた日本語の文言ならそれを、そうでなければ決まった案内を返す。
 * context を渡すと、見せなかった中身をログに残す。
 */
export function preparedMessageOr(error: unknown, fallback: string, context?: string) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = errorCodeOf(error);
  if (isPreparedJapaneseMessage(message) && (code === undefined || isSafeErrorCode(code))) return message;
  if (context) logInternalError(createErrorReference(), error, context);
  return fallback;
}

/** 受付番号（ログと突き合わせるための短い番号）。 */
export function createErrorReference() {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function errorCodeOf(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
}

/** new Error('...') や throw '...' そのもの（Firebase などのライブラリの独自のエラーではない）か。 */
function isPlainError(error: unknown) {
  if (typeof error === 'string') return true;
  if (!(error instanceof Error)) return false;
  if (Object.getPrototypeOf(error) !== Error.prototype) return false;
  const code = errorCodeOf(error);
  return code === undefined || isSafeErrorCode(code);
}

export type ApiErrorBody = { ok: false; error: string; code?: string; ref?: string };

/** エラーから、返す内容と状態コードを決める（ログ出力はしない）。 */
export function describeApiError(error: unknown, status?: number): { status: number; body: ApiErrorBody; userFacing: boolean } {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = errorCodeOf(error);
  const codeText = typeof code === 'string' ? code : '';

  if (message === 'missing-token' || REAUTH_FIREBASE_CODES.includes(codeText)) {
    return { status: 401, body: { ok: false, error: REAUTH_MESSAGE, code: 'reauth-required' }, userFacing: true };
  }
  if (message === 'forbidden' || message === 'profile-not-found') {
    return { status: 403, body: { ok: false, error: GENERIC_MESSAGES[message], code: message }, userFacing: true };
  }

  const fallbackStatus = status ?? 400;
  if (error instanceof UserFacingError) {
    const safeCode = isSafeErrorCode(error.code) ? error.code : undefined;
    return { status: error.status ?? fallbackStatus, body: { ok: false, error: message, ...(safeCode ? { code: safeCode } : {}) }, userFacing: true };
  }

  const external = error instanceof Error && code !== undefined && !isSafeErrorCode(code);
  if (!external && isPreparedJapaneseMessage(message)) {
    return { status: fallbackStatus, body: { ok: false, error: message }, userFacing: true };
  }
  if (isPlainError(error) && isSafeErrorCode(message)) {
    // 画面側がコードで分岐しているので error にもコードを入れる（日本語にできる汎用のものだけ置き換える）。
    return { status: fallbackStatus, body: { ok: false, error: GENERIC_MESSAGES[message] || message, code: message }, userFacing: true };
  }
  if (isPlainError(error) && OWN_ENGLISH_CODE.test(message)) {
    return { status: fallbackStatus, body: { ok: false, error: message }, userFacing: true };
  }

  const ref = createErrorReference();
  return {
    status: status && status >= 500 ? status : 500,
    body: { ok: false, error: `内部エラーが発生しました（受付番号: ${ref}）`, code: INTERNAL_ERROR_CODE, ref },
    userFacing: false,
  };
}

/** 画面に見せないエラーの中身を、受付番号つきでサーバーのログに残す。 */
export function logInternalError(ref: string, error: unknown, context?: string) {
  const err = error instanceof Error ? error : null;
  const code = errorCodeOf(error);
  console.error(JSON.stringify({
    type: 'api_internal_error',
    ref,
    ...(context ? { context } : {}),
    name: err?.name,
    message: (err ? err.message : String(error ?? '')).slice(0, 2000),
    code: code === undefined ? undefined : String(code).slice(0, 200),
    stack: err?.stack ? err.stack.split('\n').slice(0, 8).join('\n') : undefined,
  }));
}

/**
 * APIのエラー応答。日本語の文言・こちらのコードはそのまま返し、
 * それ以外は「内部エラー（受付番号）」にして中身はログへ出す。
 */
export function jsonError(error: unknown, status?: number) {
  const result = describeApiError(error, status);
  if (!result.userFacing && result.body.ref) logInternalError(result.body.ref, error);
  return Response.json(result.body, { status: result.status });
}

/** 外部サービス（Zoom など）の失敗を、決まった日本語で返すとき用。中身はログへ出す。 */
export function internalErrorResponse(error: unknown, options: { message?: string; status?: number; context?: string; extra?: Record<string, unknown> } = {}) {
  const ref = createErrorReference();
  logInternalError(ref, error, options.context);
  return Response.json({
    ok: false,
    ...options.extra,
    error: `${options.message || '内部エラーが発生しました'}（受付番号: ${ref}）`,
    code: INTERNAL_ERROR_CODE,
    ref,
  }, { status: options.status ?? 500 });
}
