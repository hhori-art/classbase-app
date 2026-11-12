import 'server-only';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { INITIAL_PASSWORD_HASH_VERSION, initialPasswordHmac, newInitialPasswordSalt } from '@/lib/initial-password-hash';

/**
 * 初期パスワード（KDL診断 A.3.1 への対応）。
 * - アカウント情報（users）には置かず、サーバーしか読めない account_secrets/{アカウントのdocID} に置く。
 * - 置くのは、サーバーだけが持つ鍵（INITIAL_PASSWORD_HMAC_SECRET）と、アカウントごとの塩を使ったハッシュ（HMAC）だけ。元には戻せない。
 * - 初回ログインのあとパスワードを変えたら消す。ID書面を刷り直すときは、新しい初期パスワードを発行し直す。
 * - 前から users に平文で残っている初期パスワード（initial_password など）は、移行の手順
 *   （scripts/security/migrate-initial-passwords.mjs）で消すまで、照合にだけ使う。
 */

export const ACCOUNT_SECRETS_COLLECTION = 'account_secrets';
export const LEGACY_PASSWORD_FIELDS = ['initial_password', 'raw_password', 'password', 'parent_initial_password'] as const;

function hmacKey() {
  const secret = String(process.env.INITIAL_PASSWORD_HMAC_SECRET || '').trim();
  if (secret.length >= 32) return secret;
  if (process.env.NODE_ENV !== 'production') return 'local-development-initial-password-secret';
  throw new Error('initial-password-secret-missing');
}

const normalizePassword = (value: unknown) => String(value ?? '').trim();

export function hashInitialPassword(password: string, salt: string) {
  return initialPasswordHmac(hmacKey(), salt, normalizePassword(password));
}

const sameHex = (left: string, right: string) => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};

const sameText = (left: string, right: string) => {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b) && left.length > 0;
};

/** 前から users に平文で残っている初期パスワード（移行で消すまで）。 */
export const legacyInitialPassword = (data: FirebaseFirestore.DocumentData | undefined) =>
  normalizePassword(data?.initial_password || data?.raw_password || data?.password);

/** 初期パスワードをハッシュで置く。users に平文が残っていれば、同じ書き込みで消す。 */
export function initialPasswordWrites(docId: string, password: string, issuedBy = '') {
  const salt = newInitialPasswordSalt();
  return {
    secretRef: adminDb().collection(ACCOUNT_SECRETS_COLLECTION).doc(docId),
    secret: {
      initial_password_hash: hashInitialPassword(password, salt),
      initial_password_salt: salt,
      initial_password_version: INITIAL_PASSWORD_HASH_VERSION,
      initial_password_issued_at: FieldValue.serverTimestamp(),
      initial_password_issued_by: issuedBy || null,
    },
    userPatch: Object.fromEntries(LEGACY_PASSWORD_FIELDS.map(field => [field, FieldValue.delete()])),
  };
}

export async function setInitialPassword(docId: string, password: string, issuedBy = '') {
  const writes = initialPasswordWrites(docId, password, issuedBy);
  const batch = adminDb().batch();
  batch.set(writes.secretRef, writes.secret);
  batch.set(adminDb().collection('users').doc(docId), { ...writes.userPatch, initial_password_issued_at: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

/** 初期パスワードが合っているか（ハッシュ → 前からの平文の順に見る）。 */
export async function verifyInitialPassword(docId: string, password: string, userData?: FirebaseFirestore.DocumentData) {
  const input = normalizePassword(password);
  if (!input) return false;
  const snap = await adminDb().collection(ACCOUNT_SECRETS_COLLECTION).doc(docId).get();
  const secret = snap.data();
  if (secret?.initial_password_hash && secret?.initial_password_salt) {
    return sameHex(hashInitialPassword(input, String(secret.initial_password_salt)), String(secret.initial_password_hash));
  }
  const legacy = legacyInitialPassword(userData);
  return Boolean(legacy) && sameText(legacy, input);
}

export async function hasInitialPassword(docId: string, userData?: FirebaseFirestore.DocumentData) {
  if (legacyInitialPassword(userData)) return true;
  const snap = await adminDb().collection(ACCOUNT_SECRETS_COLLECTION).doc(docId).get();
  return Boolean(snap.data()?.initial_password_hash);
}

/** 初回ログインで登録データのdocIDが Auth の uid に変わるとき、初期パスワードも移す。 */
export async function moveInitialPassword(fromId: string, toId: string) {
  if (!fromId || !toId || fromId === toId) return;
  const db = adminDb();
  const fromRef = db.collection(ACCOUNT_SECRETS_COLLECTION).doc(fromId);
  const snap = await fromRef.get();
  if (!snap.exists) return;
  const batch = db.batch();
  batch.set(db.collection(ACCOUNT_SECRETS_COLLECTION).doc(toId), snap.data() || {});
  batch.delete(fromRef);
  await batch.commit();
}

/** 初回ログインが済んだ（自分のパスワードに変えた）ら、初期パスワードを消す。 */
export function clearInitialPasswordWrites(docId: string) {
  return {
    secretRef: adminDb().collection(ACCOUNT_SECRETS_COLLECTION).doc(docId),
    userPatch: Object.fromEntries(LEGACY_PASSWORD_FIELDS.map(field => [field, FieldValue.delete()])),
  };
}

export async function clearInitialPassword(docId: string) {
  const writes = clearInitialPasswordWrites(docId);
  const batch = adminDb().batch();
  batch.delete(writes.secretRef);
  batch.set(adminDb().collection('users').doc(docId), writes.userPatch, { merge: true });
  await batch.commit();
}
