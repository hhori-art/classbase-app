import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

type Body = {
  lifetimeId: string;
  password: string;
};

const EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'];

function normalizeId(id: string) {
  return String(id || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
}

function normalizePassword(value: unknown) {
  return String(value || '').trim();
}

function savedInitialPassword(data: FirebaseFirestore.DocumentData) {
  return normalizePassword(data.initial_password || data.raw_password || data.password);
}

function idVariants(id: string) {
  return Array.from(new Set([id, id.toLowerCase(), id.toUpperCase()].filter(Boolean)));
}

async function findSeedDocs(db: FirebaseFirestore.Firestore, lifetimeIdRaw: string) {
  const lifetimeId = normalizeId(lifetimeIdRaw);
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  for (const candidateId of idVariants(lifetimeId)) {
    let snap = await db.collection('users').where('lifetime_id', '==', candidateId).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));
    snap = await db.collection('users').where('initial_login_id', '==', candidateId).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));
    for (const domain of EMAIL_DOMAINS) {
      snap = await db.collection('users').where('email', '==', `${candidateId}@${domain}`).limit(10).get();
      snap.docs.forEach(doc => docs.set(doc.id, doc));
    }

    // 数値で検索（型ズレ対策）
    const n = Number(candidateId);
    if (!Number.isNaN(n)) {
      snap = await db.collection('users').where('lifetime_id', '==', n).limit(10).get();
      snap.docs.forEach(doc => docs.set(doc.id, doc));
    }
  }

  return Array.from(docs.values());
}

async function resolveAuthUser(auth: ReturnType<typeof adminAuth>, lifetimeId: string, password: string, seedEmail?: unknown) {
  const candidates = [
    String(seedEmail || '').trim().toLowerCase(),
    ...idVariants(lifetimeId).flatMap(candidateId => EMAIL_DOMAINS.map(domain => `${candidateId}@${domain}`)),
  ].filter(Boolean);

  const uniqueCandidates = Array.from(new Set(candidates));
  for (const email of uniqueCandidates) {
    try {
      const existing = await auth.getUserByEmail(email);
      await auth.updateUser(existing.uid, { password, emailVerified: true, disabled: false });
      return { uid: existing.uid, email };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      const notFound = error?.code === 'auth/user-not-found' || message.includes('no user record') || message.includes('not found');
      if (!notFound) throw error;
    }
  }

  const email = uniqueCandidates[0] || `${lifetimeId}@classbase.local`;
  const created = await auth.createUser({ email, password, emailVerified: true });
  return { uid: created.uid, email };
}

function pickSeedDoc(docs: FirebaseFirestore.QueryDocumentSnapshot[], password: string) {
  const normalizedPassword = normalizePassword(password);
  const withMatchingPassword = docs.find(doc => savedInitialPassword(doc.data() || {}) === normalizedPassword);
  if (withMatchingPassword) return withMatchingPassword;
  return docs[0] || null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Body>;
    const lifetimeIdRaw = body.lifetimeId;
    const passwordRaw = body.password;

    if (!lifetimeIdRaw || !passwordRaw) {
      return NextResponse.json({ ok: false, error: 'invalid-params' }, { status: 400 });
    }

    const lifetimeId = normalizeId(lifetimeIdRaw);
    const password = normalizePassword(passwordRaw);

    if (!/^[0-9A-Za-z_-]+$/.test(lifetimeId)) {
      return NextResponse.json({ ok: false, error: 'id-invalid-format' }, { status: 400 });
    }

    const db = adminDb();
    const auth = adminAuth();

    // 1) seed取得
    const seedDocs = await findSeedDocs(db, lifetimeId);
    const seedDoc = pickSeedDoc(seedDocs, password);
    if (!seedDoc) {
      return NextResponse.json({ ok: false, error: 'not-registered' }, { status: 404 });
    }
    const seed = seedDoc.data();

    // 2) 初回PW検証（登録経路差異に対応して initial_password / raw_password / password を見る）
    const initialPassword = savedInitialPassword(seed);
    if (!initialPassword) {
      return NextResponse.json({ ok: false, error: 'missing-initial-password' }, { status: 401 });
    }
    if (initialPassword !== password) {
      return NextResponse.json({ ok: false, error: 'wrong-initial-password' }, { status: 401 });
    }

    // 3) Auth作成 or 既存取得（登録経路により classbase.local / sozogakuen.co.jp の両方があり得る）
    const resolvedAuth = await resolveAuthUser(auth, lifetimeId, password, seed.email);
    const uid = resolvedAuth.uid;
    const email = resolvedAuth.email;

    // 5) users/{uid} に移行（merge）
    await db.collection('users').doc(uid).set(
      {
        ...seed,
        uid,
        id: uid,
        email,
        isFirstLogin: seed.isFirstLogin ?? true,
        migrated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    // 6) 旧doc削除（同一IDなら削除しない）
    await Promise.all(seedDocs
      .filter(doc => doc.ref.id !== uid)
      .map(doc => doc.ref.delete().catch(() => {})));

    return NextResponse.json({ ok: true, uid, email }, { status: 200 });
  } catch (err: any) {
    console.error('[first-login] error:', err);
    return NextResponse.json({ ok: false, error: `server-error:${err?.message || 'unknown'}` }, { status: 500 });
  }
}
