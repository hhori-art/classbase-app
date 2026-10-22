import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { consumeRateLimit, getClientIp, requestFingerprint } from '@/lib/server/password-recovery';
import { verifyExistingFirebasePassword } from '@/lib/server/firebase-password-check';

export const runtime = 'nodejs';

const ADMIN_ROLE_ALIASES = [
  'master',
  'admin',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
];

const normalizeLogin = (value: unknown) =>
  String(value || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const normalizePassword = (value: unknown) =>
  String(value || '').trim();

const normalizeEmail = (login: string, email?: unknown) => {
  const cleanedEmail = normalizeLogin(email);
  if (cleanedEmail.includes('@')) return cleanedEmail;
  if (login.includes('@')) return login;
  return `${login}@classbase.local`;
};

async function findUserDocs(db: FirebaseFirestore.Firestore, login: string) {
  const candidates = Array.from(new Set([
    login,
    login.includes('@') ? login.split('@')[0] : login,
  ].filter(Boolean)));
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  for (const value of candidates) {
    let snap = await db.collection('users').where('email', '==', value).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));

    snap = await db.collection('users').where('lifetime_id', '==', value).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));

    snap = await db.collection('users').where('initial_login_id', '==', value).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));
  }

  return Array.from(docs.values());
}

function pickUserDoc(docs: FirebaseFirestore.QueryDocumentSnapshot[], password: string) {
  const matchingPassword = docs.find(doc => {
    const data = doc.data() || {};
    const saved = normalizePassword(data.initial_password || data.raw_password || data.password);
    return saved && saved === password;
  });
  return matchingPassword || docs[0] || null;
}

function isAdminRole(role: unknown) {
  return ADMIN_ROLE_ALIASES.includes(String(role || '').toLowerCase());
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const login = normalizeLogin(body.login);
    const password = normalizePassword(body.password);

    if (!login || !password) {
      return NextResponse.json({ ok: false, error: 'invalid-params' }, { status: 400 });
    }

    const [ipAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(requestFingerprint(['admin-first-login-ip', getClientIp(req)]), 8, 15 * 60 * 1000),
      consumeRateLimit(requestFingerprint(['admin-first-login-account', login]), 5, 15 * 60 * 1000),
    ]);
    if (!ipAllowed || !accountAllowed) {
      return NextResponse.json({ ok: false, error: 'too-many-attempts' }, { status: 429 });
    }

    const db = adminDb();
    const auth = adminAuth();
    const userDocs = await findUserDocs(db, login);
    const userDoc = pickUserDoc(userDocs, password);

    if (!userDoc) {
      return NextResponse.json({ ok: false, error: 'not-registered' }, { status: 404 });
    }

    const profile = userDoc.data() || {};
    if (['suspended', 'withdrawn', 'archived'].some(status =>
      profile.account_status === status || profile.status === status)) {
      return NextResponse.json({ ok: false, error: 'initial-login-not-allowed' }, { status: 403 });
    }
    if (!isAdminRole(profile.role)) {
      return NextResponse.json({ ok: false, error: 'not-admin' }, { status: 403 });
    }

    // 初回登録後の管理者は初期PWを保持しない。ログインIDとAuthの
    // メールが異なる旧アカウントだけ、現在PWの検証後に実メールを返す。
    if (profile.isFirstLogin === false) {
      let authUser;
      try {
        authUser = await auth.getUser(String(profile.uid || userDoc.id));
      } catch (error: any) {
        if (error?.code !== 'auth/user-not-found' || !profile.email) throw error;
        authUser = await auth.getUserByEmail(normalizeLogin(profile.email));
      }
      if (authUser.disabled) return NextResponse.json({ ok: false, error: 'initial-login-not-allowed' }, { status: 403 });
      const email = normalizeLogin(authUser.email);
      if (!email || !await verifyExistingFirebasePassword(email, password)) {
        return NextResponse.json({ ok: false, error: 'wrong-password' }, { status: 401 });
      }
      return NextResponse.json({ ok: true, uid: authUser.uid, email, existing_account: true });
    }

    const savedPassword = normalizePassword(profile.initial_password || profile.raw_password || profile.password);
    if (!savedPassword || savedPassword !== password) {
      return NextResponse.json({ ok: false, error: 'wrong-password' }, { status: 401 });
    }

    const email = normalizeEmail(login, profile.email);
    const displayName = String(profile.name || profile.student_name || profile.parent_name || email);

    let uid = '';
    try {
      const existing = await auth.getUserByEmail(email);
      const target = await db.collection('users').doc(existing.uid).get();
      if (target.exists && target.id !== userDoc.id) throw new Error('account-identity-conflict');
      uid = existing.uid;
      await auth.updateUser(uid, {
        password,
        displayName,
        disabled: profile.account_status === 'suspended' || profile.status === 'suspended',
      });
    } catch (error: any) {
      const notFound =
        error?.code === 'auth/user-not-found' ||
        String(error?.message || '').toLowerCase().includes('no user record');
      if (!notFound) throw error;
      const created = await auth.createUser({
        email,
        password,
        displayName,
        disabled: profile.account_status === 'suspended' || profile.status === 'suspended',
      });
      uid = created.uid;
    }

    await db.collection('users').doc(uid).set({
      ...profile,
      uid,
      id: uid,
      email,
      isFirstLogin: profile.isFirstLogin ?? true,
      migrated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    if (userDoc.id !== uid) await userDoc.ref.delete();

    return NextResponse.json({ ok: true, uid, email });
  } catch (error: any) {
    console.error('[admin-first-login] error:', error);
    if (error?.message === 'account-inactive') {
      return NextResponse.json({ ok: false, error: 'initial-login-not-allowed' }, { status: 403 });
    }
    if (error?.message === 'too-many-attempts') {
      return NextResponse.json({ ok: false, error: 'too-many-attempts' }, { status: 429 });
    }
    return NextResponse.json({ ok: false, error: `server-error:${error?.message || 'unknown'}` }, { status: 500 });
  }
}
