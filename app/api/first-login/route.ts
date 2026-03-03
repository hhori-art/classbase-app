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

async function findSeedDoc(db: FirebaseFirestore.Firestore, lifetimeIdRaw: string) {
  const lifetimeId = normalizeId(lifetimeIdRaw);

  // 文字列で検索
  let snap = await db.collection('users').where('lifetime_id', '==', lifetimeId).limit(1).get();
  if (!snap.empty) return snap.docs[0];

  // 数値で検索（型ズレ対策）
  const n = Number(lifetimeId);
  if (!Number.isNaN(n)) {
    snap = await db.collection('users').where('lifetime_id', '==', n).limit(1).get();
    if (!snap.empty) return snap.docs[0];
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Body>;
    const lifetimeIdRaw = body.lifetimeId;
    const password = body.password;

    if (!lifetimeIdRaw || !password) {
      return NextResponse.json({ ok: false, error: 'invalid-params' }, { status: 400 });
    }

    const lifetimeId = normalizeId(lifetimeIdRaw);
    if (!/^[0-9]+$/.test(lifetimeId)) {
      return NextResponse.json({ ok: false, error: 'id-must-be-numeric' }, { status: 400 });
    }

    const db = adminDb();
    const auth = adminAuth();

    // 1) seed取得（lifetime_id 検索）
    const seedDoc = await findSeedDoc(db, lifetimeId);
    if (!seedDoc) {
      return NextResponse.json({ ok: false, error: 'not-registered' }, { status: 404 });
    }
    const seed = seedDoc.data();

    // 2) 初回PW検証
    if (seed.initial_password == null) {
      return NextResponse.json({ ok: false, error: 'missing-initial-password' }, { status: 401 });
    }
    if (String(seed.initial_password) !== String(password)) {
      return NextResponse.json({ ok: false, error: 'wrong-initial-password' }, { status: 401 });
    }

    // 3) email 固定
    const email = `${lifetimeId}@${EMAIL_DOMAIN}`;

    // 4) Auth作成 or 既存取得（既存なら未移行時だけPW更新で救済）
    let uid: string;
    try {
      const created = await auth.createUser({ email, password: String(password) });
      uid = created.uid;
    } catch (e: any) {
      const msg = String(e?.message || '');
      const alreadyExists =
        e?.code === 'auth/email-already-exists' ||
        msg.toLowerCase().includes('already exists');

      if (!alreadyExists) throw e;

      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;

      // users/{uid} が未移行なら PW を合わせて救済（移行済みは触らない）
      const existingUserDoc = await db.collection('users').doc(uid).get();
      const alreadyMigrated = existingUserDoc.exists && !!existingUserDoc.data()?.migrated_at;
      if (!alreadyMigrated) {
        await auth.updateUser(uid, { password: String(password) });
      }
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
    if (seedDoc.ref.id !== uid) {
      await seedDoc.ref.delete().catch(() => {});
    }

    return NextResponse.json({ ok: true, uid, email }, { status: 200 });
  } catch (err: any) {
    console.error('[first-login] error:', err);
    return NextResponse.json({ ok: false, error: 'server-error' }, { status: 500 });
  }
}