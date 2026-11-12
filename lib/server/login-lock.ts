import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requestFingerprint } from '@/lib/server/password-recovery';

/**
 * ログインのロック（KDL診断 A.1.2 への対応）。
 * - 「ID＋接続元」で失敗を数える。5回目から待ち時間をだんだん延ばし、10回で30分ロック。ロックが繰り返されたら長くする（最大24時間）。
 *   生徒IDは連番で推測しやすいので、IDだけで数えると、他人が生徒をわざと締め出せてしまう。
 * - 接続元を変えながらの総当たりに備えて、IDごとにも1時間50回でロックする。
 * - 書き込むのは失敗したときだけ。成功したときは、失敗の記録があったときだけ消す。
 * - 校舎とサポートセンターは unlockLoginAccount で解ける。
 */

export const LOGIN_LOCKS_COLLECTION = 'login_locks';

const SLOW_START_FAILURES = 5;
const LOCK_FAILURES = 10;
const BASE_WAIT_MS = 30 * 1000;
const BASE_LOCK_MS = 30 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const ACCOUNT_WINDOW_FAILURES = 50;

export const normalizeLoginAccount = (value: unknown) => String(value || '').normalize('NFKC').replace(/\s+/g, '').trim().toLowerCase();

const accountKey = (account: string) => requestFingerprint(['login-lock-account', normalizeLoginAccount(account)]);
const pairDoc = (account: string, ip: string) => adminDb().collection(LOGIN_LOCKS_COLLECTION).doc(requestFingerprint(['login-lock-pair', normalizeLoginAccount(account), ip]));
const accountDoc = (account: string) => adminDb().collection(LOGIN_LOCKS_COLLECTION).doc(accountKey(account));

const millis = (value: any) => typeof value?.toMillis === 'function' ? value.toMillis() : 0;

export type LoginLockState = { locked: boolean; retryAfterSeconds: number; hasFailures: boolean };

/** 失敗の回数から、次に試せるまでの待ち時間（5回目から 30秒→1分→2分→4分→8分）。 */
export const slowDownMs = (failures: number) => failures < SLOW_START_FAILURES ? 0 : Math.min(BASE_LOCK_MS, BASE_WAIT_MS * 2 ** (failures - SLOW_START_FAILURES));
/** ロックの長さ（1回目30分、繰り返すたびに倍、最大24時間）。 */
export const lockDurationMs = (lockCount: number) => Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** Math.max(0, lockCount));

function stateOf(pair: any, account: any, now: number): LoginLockState {
  const until = Math.max(millis(pair?.locked_until), millis(pair?.next_allowed_at), millis(account?.locked_until));
  return {
    locked: until > now,
    retryAfterSeconds: until > now ? Math.ceil((until - now) / 1000) : 0,
    hasFailures: Number(pair?.failures || 0) > 0,
  };
}

export async function checkLoginLock(account: string, ip: string): Promise<LoginLockState> {
  const [pair, whole] = await adminDb().getAll(pairDoc(account, ip), accountDoc(account));
  return stateOf(pair.data(), whole.data(), Date.now());
}

/** 失敗を1回記録し、記録したあとの状態を返す。 */
export async function recordLoginFailure(account: string, ip: string): Promise<LoginLockState> {
  const db = adminDb();
  const pairRef = pairDoc(account, ip);
  const accountRef = accountDoc(account);
  const now = Date.now();
  return db.runTransaction(async transaction => {
    const [pairSnap, accountSnap] = await transaction.getAll(pairRef, accountRef);
    const pair = pairSnap.data() || {};
    const whole = accountSnap.data() || {};
    const key = accountKey(account);

    let failures = Number(pair.failures || 0) + 1;
    let lockCount = Number(pair.lock_count || 0);
    let lockedUntil = millis(pair.locked_until);
    if (failures >= LOCK_FAILURES) {
      lockedUntil = now + lockDurationMs(lockCount);
      lockCount += 1;
      failures = 0;
    }
    const nextAllowedAt = now + slowDownMs(failures);
    const nextPair = {
      account_key: key,
      scope: 'pair',
      failures,
      lock_count: lockCount,
      locked_until: lockedUntil ? Timestamp.fromMillis(lockedUntil) : null,
      next_allowed_at: Timestamp.fromMillis(nextAllowedAt),
      last_failed_at: Timestamp.fromMillis(now),
      // ロックが続いた記録は、最後の失敗から2日で消してよい（Firestore の TTL）。
      expires_at: Timestamp.fromMillis(Math.max(lockedUntil, now) + 2 * MAX_LOCK_MS),
    };

    const windowStarted = millis(whole.window_started_at);
    const inWindow = now - windowStarted < ACCOUNT_WINDOW_MS;
    let windowFailures = (inWindow ? Number(whole.window_failures || 0) : 0) + 1;
    let accountLocks = Number(whole.lock_count || 0);
    let accountLockedUntil = millis(whole.locked_until);
    if (windowFailures >= ACCOUNT_WINDOW_FAILURES) {
      accountLockedUntil = now + lockDurationMs(accountLocks);
      accountLocks += 1;
      windowFailures = 0;
    }
    const nextAccount = {
      account_key: key,
      scope: 'account',
      window_failures: windowFailures,
      window_started_at: inWindow && windowFailures ? whole.window_started_at : Timestamp.fromMillis(now),
      lock_count: accountLocks,
      locked_until: accountLockedUntil ? Timestamp.fromMillis(accountLockedUntil) : null,
      last_failed_at: Timestamp.fromMillis(now),
      expires_at: Timestamp.fromMillis(Math.max(accountLockedUntil, now) + 2 * MAX_LOCK_MS),
    };
    transaction.set(pairRef, nextPair);
    transaction.set(accountRef, nextAccount);
    return stateOf(nextPair, nextAccount, now);
  });
}

/** ログインできたら、この接続元での失敗の記録を消す（IDごとの1時間の数は残す）。 */
export async function clearLoginFailures(account: string, ip: string) {
  await pairDoc(account, ip).delete();
}

/** 校舎・サポートセンターがロックを解く。そのIDのすべての接続元の記録を消す。 */
export async function unlockLoginAccount(account: string) {
  const db = adminDb();
  const snap = await db.collection(LOGIN_LOCKS_COLLECTION).where('account_key', '==', accountKey(account)).limit(200).get();
  const batch = db.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  if (!snap.empty) await batch.commit();
  return snap.size;
}

/** 管理画面に出す、今のロックの状態（ロック中か・いつまでか）。 */
export async function loginLockStatus(account: string) {
  const snap = await adminDb().collection(LOGIN_LOCKS_COLLECTION).where('account_key', '==', accountKey(account)).limit(200).get();
  const now = Date.now();
  const until = Math.max(0, ...snap.docs.map(doc => Math.max(millis(doc.data().locked_until), millis(doc.data().next_allowed_at))));
  return { locked: until > now, locked_until: until > now ? new Date(until).toISOString() : null, records: snap.size };
}
