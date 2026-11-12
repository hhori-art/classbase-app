import crypto from 'crypto';

/**
 * 初期パスワードのハッシュ（HMAC-SHA256）。アプリ（lib/server/account-secrets.ts）と
 * 移行の手順（scripts/security/migrate-initial-passwords.mts）で同じ計算を使う。
 */
export const INITIAL_PASSWORD_HASH_VERSION = 1;

export function initialPasswordHmac(secret: string, salt: string, password: string) {
  return crypto.createHmac('sha256', secret).update(`initial-password:v1:${salt}:${String(password ?? '').trim()}`).digest('hex');
}

export const newInitialPasswordSalt = () => crypto.randomBytes(16).toString('hex');
