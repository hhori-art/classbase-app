import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

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

async function findUserDoc(db: FirebaseFirestore.Firestore, login: string) {
  const candidates = Array.from(new Set([
    login,
    login.includes('@') ? login.split('@')[0] : login,
  ].filter(Boolean)));

  for (const value of candidates) {
    let snap = await db.collection('users').where('email', '==', value).limit(1).get();
    if (!snap.empty) return snap.docs[0];

    snap = await db.collection('users').where('lifetime_id', '==', value).limit(1).get();
    if (!snap.empty) return snap.docs[0];

    snap = await db.collection('users').where('initial_login_id', '==', value).limit(1).get();
    if (!snap.empty) return snap.docs[0];
  }

  return null;
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

    const db = adminDb();
    const auth = adminAuth();
    const userDoc = await findUserDoc(db, login);

    if (!userDoc) {
      return NextResponse.json({ ok: false, error: 'not-registered' }, { status: 404 });
    }

    const profile = userDoc.data() || {};
    if (!isAdminRole(profile.role)) {
      return NextResponse.json({ ok: false, error: 'not-admin' }, { status: 403 });
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
      uid = existing.uid;
      await auth.updateUser(uid, {
        password,
        displayName,
        emailVerified: true,
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
        emailVerified: true,
        disabled: profile.account_status === 'suspended' || profile.status === 'suspended',
      });
      uid = created.uid;
    }

    await db.collection('users').doc(uid).set({
      ...profile,
      uid,
      id: uid,
      email,
      migrated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    if (userDoc.id !== uid) {
      await userDoc.ref.delete().catch(() => {});
    }

    return NextResponse.json({ ok: true, uid, email });
  } catch (error: any) {
    console.error('[admin-first-login] error:', error);
    return NextResponse.json({ ok: false, error: `server-error:${error?.message || 'unknown'}` }, { status: 500 });
  }
}
