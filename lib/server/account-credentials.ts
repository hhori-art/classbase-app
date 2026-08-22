import 'server-only';

import { adminAuth, adminDb } from '@/lib/firebase-admin';

const EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'] as const;

export const normalizeAccountLoginId = (value: unknown) =>
  String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();

export const normalizeInitialPassword = (value: unknown) =>
  String(value || '').trim();

const normalizeEmail = (value: unknown) =>
  String(value || '').normalize('NFKC').trim().toLowerCase();

const isNotFoundAuthError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'auth/user-not-found' ||
    message.includes('no user record') ||
    message.includes('not found');
};

export function accountEmailCandidates(loginId: string, email?: unknown) {
  const normalizedLoginId = normalizeAccountLoginId(loginId);
  const requestedEmail = normalizeEmail(email);
  return Array.from(new Set([
    requestedEmail.includes('@') ? requestedEmail : '',
    ...EMAIL_DOMAINS.map(domain => `${normalizedLoginId}@${domain}`.toLowerCase()),
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

export async function syncAuthAccountCredentials(input: {
  loginId: string;
  email?: unknown;
  password: string;
  displayName: string;
  disabled?: boolean;
  preferredUid?: string;
}) {
  const auth = adminAuth();
  const loginId = normalizeAccountLoginId(input.loginId);
  const password = normalizeInitialPassword(input.password);
  const emails = accountEmailCandidates(loginId, input.email);
  const updatedUids = new Set<string>();
  let primary: { uid: string; email: string } | null = null;

  const updateAuthUser = async (uid: string, email: string) => {
    await auth.updateUser(uid, {
      password,
      displayName: input.displayName,
      emailVerified: true,
      disabled: Boolean(input.disabled),
    });
    updatedUids.add(uid);
    if (!primary) primary = { uid, email };
  };

  if (input.preferredUid) {
    try {
      const preferred = await auth.getUser(input.preferredUid);
      await updateAuthUser(preferred.uid, preferred.email || emails[0]);
    } catch (error: any) {
      if (!isNotFoundAuthError(error)) throw error;
    }
  }

  for (const email of emails) {
    try {
      const existing = await auth.getUserByEmail(email);
      if (updatedUids.has(existing.uid)) {
        if (!primary) primary = { uid: existing.uid, email };
        continue;
      }
      await updateAuthUser(existing.uid, email);
    } catch (error: any) {
      if (!isNotFoundAuthError(error)) throw error;
    }
  }

  if (!primary) {
    const email = emails[0] || `${loginId}@classbase.local`.toLowerCase();
    const created = await auth.createUser({
      email,
      password,
      displayName: input.displayName,
      emailVerified: true,
      disabled: Boolean(input.disabled),
    });
    primary = { uid: created.uid, email };
  }

  return {
    uid: primary.uid,
    email: primary.email,
    auth_created: updatedUids.size === 0,
    synchronized_auth_uids: Array.from(updatedUids),
  };
}
