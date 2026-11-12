import 'server-only';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { verifyExistingFirebasePassword } from '@/lib/server/firebase-password-check';
import { moveInitialPassword, verifyInitialPassword } from '@/lib/server/account-secrets';
import { checkLoginLock, clearLoginFailures, normalizeLoginAccount, recordLoginFailure } from '@/lib/server/login-lock';

/**
 * ログイン（KDL診断 A.1.2 への対応）。
 * 画面から Firebase へ直接パスワードを送らず、サーバーで確かめてから、ログイン用のトークン（カスタムトークン）を返す。
 * こうすると、ふだんのログインも初回ログインも、同じロック（lib/server/login-lock.ts）で数えられる。
 */

export const LOGIN_EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'];
const INACTIVE_STATUSES = ['suspended', 'withdrawn', 'archived'];
export const ADMIN_LOGIN_ROLES = ['master', 'admin', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin', 'test_admin', 'master_admin', 'super_admin', 'attendance_admin', 'attendance_only', 'attendance_manager'];

export type LoginResult =
  | { ok: true; uid: string; token: string; role: string }
  | { ok: false; error: string; status: number; retryAfterSeconds?: number };

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isNotFound = (error: any) => error?.code === 'auth/user-not-found' || String(error?.message || '').toLowerCase().includes('no user record');
const inactive = (data: FirebaseFirestore.DocumentData | undefined) => INACTIVE_STATUSES.some(status => data?.account_status === status || data?.status === status);

function idVariants(id: string) {
  return Array.from(new Set([id, id.toLowerCase(), id.toUpperCase()].filter(Boolean)));
}

function candidateEmails(login: string) {
  if (isEmail(login)) {
    const local = login.split('@')[0];
    return Array.from(new Set([login.toLowerCase(), ...LOGIN_EMAIL_DOMAINS.map(domain => `${local.toLowerCase()}@${domain}`)]));
  }
  return LOGIN_EMAIL_DOMAINS.map(domain => `${login.toLowerCase()}@${domain}`);
}

async function authUserByEmail(email: string) {
  try {
    return await adminAuth().getUserByEmail(email);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function authUserById(uid: string) {
  try {
    return await adminAuth().getUser(uid);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** ログインIDから、登録データ（初回ログイン前のものを含む）を探す。失敗したときだけ使う。 */
async function findSeedDocs(login: string) {
  const db = adminDb();
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const add = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.forEach(doc => docs.set(doc.id, doc));
  if (isEmail(login)) {
    add(await db.collection('users').where('email', '==', login.toLowerCase()).limit(10).get());
    return Array.from(docs.values());
  }
  for (const candidateId of idVariants(login)) {
    add(await db.collection('users').where('lifetime_id', '==', candidateId).limit(10).get());
    add(await db.collection('users').where('initial_login_id', '==', candidateId).limit(10).get());
    for (const domain of LOGIN_EMAIL_DOMAINS) add(await db.collection('users').where('email', '==', `${candidateId.toLowerCase()}@${domain}`).limit(10).get());
    const numeric = Number(candidateId);
    if (Number.isFinite(numeric) && String(numeric) === candidateId) add(await db.collection('users').where('lifetime_id', '==', numeric).limit(10).get());
  }
  return Array.from(docs.values());
}

/** 初回ログイン：Auth のアカウントを作る（または前からあるものにパスワードを入れる）。 */
async function resolveAuthUserForSeed(login: string, password: string, seed: FirebaseFirestore.DocumentData, seedId: string) {
  const auth = adminAuth();
  const emails = Array.from(new Set([String(seed.email || '').trim().toLowerCase(), ...candidateEmails(login)].filter(Boolean)));
  for (const email of emails) {
    const existing = await authUserByEmail(email);
    if (!existing) continue;
    const target = await adminDb().collection('users').doc(existing.uid).get();
    if (target.exists && target.id !== seedId) throw new Error('account-identity-conflict');
    await auth.updateUser(existing.uid, { password });
    await auth.revokeRefreshTokens(existing.uid);
    return { uid: existing.uid, email };
  }
  const email = emails[0] || `${login.toLowerCase()}@classbase.local`;
  const created = await auth.createUser({ email, password, emailVerified: false, displayName: String(seed.name || '') || undefined });
  return { uid: created.uid, email };
}

async function loginWithSeed(login: string, password: string, adminOnly: boolean): Promise<{ uid: string } | { error: string } | null> {
  const seeds = await findSeedDocs(login);
  for (const seedDoc of seeds) {
    const seed = seedDoc.data() || {};
    if (inactive(seed)) continue;
    // 管理者用のログインでは、管理系でない登録データは、初回登録（Authの作成・移動）まで進めない。
    if (adminOnly && !ADMIN_LOGIN_ROLES.includes(String(seed.role || '').toLowerCase())) continue;
    // 実メールで登録した職員など、ログインIDとAuthのメールが違うアカウントは、そのメールで確かめる。
    const seedEmail = String(seed.email || '').trim().toLowerCase();
    if (seedEmail && !candidateEmails(login).includes(seedEmail)) {
      const existing = await authUserByEmail(seedEmail);
      if (existing && existing.uid === seedDoc.id && !existing.disabled && await verifyExistingFirebasePassword(seedEmail, password)) {
        return { uid: existing.uid };
      }
    }
    // メールアドレスでのログインは、初回登録（生徒番号・職員番号で行う）の対象外。
    if (seed.isFirstLogin === false || isEmail(login)) continue;
    // 初回登録の印が「済み」になっていない古いアカウントでも、すでに Auth のアカウントがあれば、
    // 初期パスワードで本人のパスワードを上書きしない（初回登録の印が true のときだけ上書きを認める）。
    if (seed.isFirstLogin !== true && await authUserById(seedDoc.id)) continue;
    if (!await verifyInitialPassword(seedDoc.id, password, seed)) continue;
    const resolved = await resolveAuthUserForSeed(login, password, seed, seedDoc.id);
    if (resolved.uid !== seedDoc.id) {
      await adminDb().collection('users').doc(resolved.uid).set({
        ...seed, uid: resolved.uid, id: resolved.uid, email: resolved.email,
        isFirstLogin: seed.isFirstLogin ?? true, migrated_at: new Date().toISOString(),
      }, { merge: true });
      await moveInitialPassword(seedDoc.id, resolved.uid);
      await seedDoc.ref.delete();
    } else if (seed.email !== resolved.email) {
      await seedDoc.ref.set({ email: resolved.email, migrated_at: new Date().toISOString() }, { merge: true });
    }
    return { uid: resolved.uid };
  }
  return null;
}

export async function performLogin(input: { login: unknown; password: unknown; ip: string; adminOnly?: boolean }): Promise<LoginResult> {
  const login = String(input.login || '').normalize('NFKC').replace(/\s+/g, '').trim();
  const password = String(input.password ?? '');
  if (!login || !password || password.length > 128) return { ok: false, error: 'invalid-params', status: 400 };
  if (!/^[0-9A-Za-z_-]+$/.test(login) && !isEmail(login)) return { ok: false, error: 'id-invalid-format', status: 400 };

  const account = normalizeLoginAccount(login);
  const lock = await checkLoginLock(account, input.ip);
  if (lock.locked) return { ok: false, error: 'too-many-attempts', status: 429, retryAfterSeconds: lock.retryAfterSeconds };

  let uid = '';
  // 1) ふだんのログイン：IDから作るメール（またはメール）で Auth のアカウントを探し、パスワードを確かめる。
  for (const email of candidateEmails(login)) {
    const existing = await authUserByEmail(email);
    if (!existing) continue;
    // 停止中のアカウントは、パスワードを確かめずに「違う」と同じ扱いにする（IDが停止中かどうかを知られないため）。
    if (existing.disabled) continue;
    if (await verifyExistingFirebasePassword(email, password)) {
      uid = existing.uid;
      break;
    }
  }
  // 2) 初回ログイン・実メールで登録した職員
  if (!uid) {
    const seeded = await loginWithSeed(login, password.trim(), Boolean(input.adminOnly));
    if (seeded && 'uid' in seeded) uid = seeded.uid;
  }

  if (!uid) {
    const after = await recordLoginFailure(account, input.ip);
    return after.locked
      ? { ok: false, error: 'too-many-attempts', status: 429, retryAfterSeconds: after.retryAfterSeconds }
      : { ok: false, error: 'wrong-password', status: 401 };
  }

  const profileSnap = await adminDb().collection('users').doc(uid).get();
  const profile = profileSnap.data() || {};
  if (inactive(profile)) return { ok: false, error: 'account-inactive', status: 403 };
  const role = String(profile.role || '').toLowerCase();
  if (input.adminOnly && !ADMIN_LOGIN_ROLES.includes(role)) return { ok: false, error: 'not-admin', status: 403 };
  if (lock.hasFailures) await clearLoginFailures(account, input.ip).catch(error => console.warn('[login] lock clear failed', error?.message));
  const token = await adminAuth().createCustomToken(uid);
  return { ok: true, uid, token, role };
}
