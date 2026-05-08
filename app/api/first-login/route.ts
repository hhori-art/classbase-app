import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

type Body = {
  lifetimeId: string;
  password: string;
};

const EMAIL_DOMAIN = 'sozogakuen.co.jp';

function normalizeId(id: string) {
  return String(id || '')
    .trim()
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
}

async function findSeedDocs(db: FirebaseFirestore.Firestore, lifetimeIdRaw: string) {
  const lifetimeId = normalizeId(lifetimeIdRaw);
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  // 文字列で検索
  let snap = await db.collection('users').where('lifetime_id', '==', lifetimeId).limit(10).get();
  snap.docs.forEach(doc => docs.set(doc.id, doc));
  snap = await db.collection('users').where('initial_login_id', '==', lifetimeId).limit(10).get();
  snap.docs.forEach(doc => docs.set(doc.id, doc));
  snap = await db.collection('users').where('email', '==', `${lifetimeId}@${EMAIL_DOMAIN}`).limit(10).get();
  snap.docs.forEach(doc => docs.set(doc.id, doc));

  // 数値で検索（型ズレ対策）
  const n = Number(lifetimeId);
  if (!Number.isNaN(n)) {
    snap = await db.collection('users').where('lifetime_id', '==', n).limit(10).get();
    snap.docs.forEach(doc => docs.set(doc.id, doc));
  }

  return Array.from(docs.values());
}

function pickSeedDoc(docs: FirebaseFirestore.QueryDocumentSnapshot[], password: string) {
  const withMatchingPassword = docs.find(doc => String((doc.data() || {}).initial_password || '').trim() === password);
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
    const password = String(passwordRaw).trim();

    if (!/^[0-9]+$/.test(lifetimeId)) {
      return NextResponse.json({ ok: false, error: 'id-must-be-numeric' }, { status: 400 });
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

    // 2) 初回PW検証（trim比較）
    if (seed.initial_password == null) {
      return NextResponse.json({ ok: false, error: 'missing-initial-password' }, { status: 401 });
    }
    if (String(seed.initial_password).trim() !== password) {
      return NextResponse.json({ ok: false, error: 'wrong-initial-password' }, { status: 401 });
    }

    // 3) email固定
    const email = `${lifetimeId}@${EMAIL_DOMAIN}`;

    // 4) Auth作成 or 既存取得（★既存なら必ずpassword更新で救済）
    let uid: string;
    try {
      const created = await auth.createUser({ email, password });
      uid = created.uid;
    } catch (e: any) {
      const msg = String(e?.message || '');
      const alreadyExists =
        e?.code === 'auth/email-already-exists' ||
        msg.toLowerCase().includes('already exists');

      if (!alreadyExists) {
        console.error('[first-login] createUser error:', e);
        return NextResponse.json({ ok: false, error: 'createUser-failed' }, { status: 500 });
      }

      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;

      // ★核心：初期PWが正しいことが確定しているので、必ずパスワードを揃える
      await auth.updateUser(uid, { password });
    }

    // 5) users/{uid} に移行（merge）
    await db.collection('users').doc(uid).set(
      {
        ...seed,
        uid,
        id: uid,
        email,
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
