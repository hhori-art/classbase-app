import 'server-only';

import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, normalizeRole, type ServerUser } from '@/lib/server-auth';
import { isDedicatedProfile } from '@/lib/employment-category';

const EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'] as const;

export const normalizeAccountLoginId = (value: unknown) =>
  String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();

export const normalizeInitialPassword = (value: unknown) =>
  String(value || '').trim();

const normalizeEmail = (value: unknown) =>
  String(value || '').normalize('NFKC').trim().toLowerCase();

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isNotFoundAuthError = (error: any) => error?.code === 'auth/user-not-found';

export function accountEmailCandidates(loginId: string, email?: unknown) {
  const normalizedLoginId = normalizeAccountLoginId(loginId);
  const requestedEmail = normalizeEmail(email);
  const loginEmail = normalizeEmail(normalizedLoginId);
  // 通常ログイン画面は、職員番号等のログインIDから classbase.local / sozogakuen.co.jp
  // の順で認証メールを生成する。新規作成時も同じ順序を正本にし、連絡先メールが
  // 入力されていても、それをFirebase Authのログイン識別子にはしない。
  // requestedEmail は既存アカウントの探索・移行候補として残す。
  return Array.from(new Set([
    isEmail(loginEmail) ? loginEmail : '',
    ...(!normalizedLoginId.includes('@')
      ? EMAIL_DOMAINS.map(domain => `${normalizedLoginId}@${domain}`.toLowerCase())
      : []),
    isEmail(requestedEmail) ? requestedEmail : '',
  ].filter(Boolean)));
}

export async function findAccountProfileDocs(
  loginId: string,
  email?: unknown,
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const db = adminDb();
  const normalizedLoginId = normalizeAccountLoginId(loginId);
  const loginCandidates = Array.from(new Set([
    normalizedLoginId,
    normalizedLoginId.toLowerCase(),
    normalizedLoginId.toUpperCase(),
  ].filter(Boolean)));
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  for (const candidate of loginCandidates) {
    for (const field of ['lifetime_id', 'initial_login_id'] as const) {
      const snapshot = await db.collection('users').where(field, '==', candidate).limit(20).get();
      snapshot.docs.forEach(doc => docs.set(doc.id, doc));
    }
  }

  for (const candidate of accountEmailCandidates(normalizedLoginId, email)) {
    const snapshot = await db.collection('users').where('email', '==', candidate).limit(20).get();
    snapshot.docs.forEach(doc => docs.set(doc.id, doc));
  }

  return Array.from(docs.values());
}

export function assertAccountTargetAllowed(actor: ServerUser, profile: FirebaseFirestore.DocumentData) {
  if (actor.role === 'master') return;
  const role = normalizeRole(profile.role);
  const school = String(profile.school_id || profile.school || '').trim();
  if (actor.role !== 'admin' || !['student', 'teacher', 'parent'].includes(role) ||
      !school || !canManageSchool(actor, school) ||
      profile.attendance_school_manager === true || isDedicatedProfile(profile)) {
    throw new Error('forbidden');
  }
}

type CredentialInput = {
  actor: ServerUser;
  loginId: string;
  email?: unknown;
  password: string;
  displayName: string;
  disabled?: boolean;
  preferredUid?: string;
  // 保存済みの初期PWと同じでも Auth へ書き込む（印刷PWの再同期用）。
  forcePassword?: boolean;
  // 初回ログイン済み（本人がパスワードを変更済み）のアカウントはパスワードを変えない（CSV再取込用）。
  preserveActivatedPassword?: boolean;
};

// Resolve and authorize every representation before changing any credentials.
// Callers handling both student and parent accounts prepare both before executing.
export async function prepareAuthAccountCredentials(input: CredentialInput) {
  if (!['master', 'admin'].includes(input.actor.role)) throw new Error('forbidden');
  const auth = adminAuth();
  const db = adminDb();
  const loginId = normalizeAccountLoginId(input.loginId);
  const password = normalizeInitialPassword(input.password);
  const emails = accountEmailCandidates(loginId, input.email);
  const profiles = await findAccountProfileDocs(loginId, input.email);
  profiles.forEach(profile => assertAccountTargetAllowed(input.actor, profile.data() || {}));
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  const existing = new Map<string, {
    uid: string;
    email: string;
    displayName: string;
    disabled: boolean;
    storedPassword: string;
    activated: boolean;
  }>();
  const remember = async (getUser: () => Promise<{ uid: string; email?: string; displayName?: string; disabled?: boolean }>) => {
    try {
      const user = await getUser();
      // ログインID/メール検索で取得済みのプロフィールを再利用し、
      // 同じusersドキュメントを重複読取しない。
      const profile = profilesById.get(user.uid) || (await db.getAll(db.collection('users').doc(user.uid)))[0];
      if (input.actor.role !== 'master' && !profile.exists) throw new Error('forbidden');
      const profileData = profile.data() || {};
      assertAccountTargetAllowed(input.actor, profileData);
      existing.set(user.uid, {
        uid: user.uid,
        email: user.email || emails[0],
        displayName: String(user.displayName || ''),
        disabled: Boolean(user.disabled),
        storedPassword: normalizeInitialPassword(profileData.initial_password || profileData.raw_password),
        activated: profileData.isFirstLogin === false && !normalizeInitialPassword(profileData.initial_password || profileData.raw_password),
      });
    } catch (error: any) {
      if (!isNotFoundAuthError(error)) throw error;
    }
  };
  if (input.preferredUid) await remember(() => auth.getUser(input.preferredUid!));
  for (const email of emails) await remember(() => auth.getUserByEmail(email));

  return async () => {
    const revokedAuthUids: string[] = [];
    let passwordPreserved = false;
    for (const user of existing.values()) {
      const disabled = Boolean(input.disabled);
      const keepPassword = Boolean(input.preserveActivatedPassword) && user.activated;
      if (keepPassword) passwordPreserved = true;
      // 画面は既存の初期PWも送るため、保存のたびにパスワードを
      // 再設定すると全セッションが不要に失効する。実際に変更された時だけ更新する。
      const passwordChanged = !keepPassword && Boolean(password) && (
        Boolean(input.forcePassword) || !user.storedPassword || user.storedPassword !== password
      );
      const disabledChanged = user.disabled !== disabled;
      const update: { password?: string; displayName?: string; disabled?: boolean } = {};
      if (passwordChanged) update.password = password;
      if (user.displayName !== input.displayName) update.displayName = input.displayName;
      if (disabledChanged) update.disabled = disabled;
      if (Object.keys(update).length > 0) await auth.updateUser(user.uid, update);
      if (passwordChanged || disabledChanged) {
        await auth.revokeRefreshTokens(user.uid);
        revokedAuthUids.push(user.uid);
      }
    }
    let primary: { uid: string; email: string } | undefined = existing.values().next().value;
    if (!primary) {
      if (!password) throw new Error('password-required-for-new-account');
      const email = emails[0] || `${loginId}@classbase.local`.toLowerCase();
      const created = await auth.createUser({
        email, password, displayName: input.displayName,
        // Synthetic login addresses are identifiers, not verified mailboxes.
        emailVerified: false, disabled: Boolean(input.disabled),
      });
      primary = { uid: created.uid, email };
    }
    if (!primary) throw new Error('account-credential-sync-failed');
    return {
      uid: primary.uid, email: primary.email, auth_created: existing.size === 0,
      synchronized_auth_uids: Array.from(existing.keys()),
      revoked_auth_uids: revokedAuthUids,
      reauth_required: revokedAuthUids.includes(input.actor.uid),
      password_preserved: passwordPreserved,
    };
  };
}

export async function syncAuthAccountCredentials(input: CredentialInput) {
  return (await prepareAuthAccountCredentials(input))();
}
