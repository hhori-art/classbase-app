// app/api/first-login/route.ts
import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

type Body = {
  lifetimeId: string;
  email: string;
  password: string;
};

export async function POST(req: Request) {
  try {
    const { lifetimeId, email, password } = (await req.json()) as Body;

    if (!lifetimeId || !email || !password) {
      return NextResponse.json({ ok: false, error: 'invalid-params' }, { status: 400 });
    }

    const db = adminDb();
    const auth = adminAuth();

    // 1) 初回登録データを検索
    const snap = await db
      .collection('users')
      .where('lifetime_id', '==', lifetimeId)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: false, error: 'not-registered' }, { status: 404 });
    }

    const oldDoc = snap.docs[0];
    const userData = oldDoc.data();

    // 2) 初回パスワード検証
    if (userData.initial_password && userData.initial_password !== password) {
      return NextResponse.json({ ok: false, error: 'wrong-initial-password' }, { status: 401 });
    }

    // 3) Authユーザー作成（既存なら取得）
    let uid: string;
    try {
      const created = await auth.createUser({ email, password });
      uid = created.uid;
    } catch (e: any) {
      if (e?.code === 'auth/email-already-exists') {
        const existing = await auth.getUserByEmail(email);
        uid = existing.uid;
      } else {
        throw e;
      }
    }

    // 4) users/{uid} に移行
    await db.collection('users').doc(uid).set(
      {
        ...userData,
        uid,
        email,
        migrated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    // 5) 旧doc削除（同一IDなら削除しない）
    if (oldDoc.ref.id !== uid) {
      await oldDoc.ref.delete();
    }

    return NextResponse.json({ ok: true, uid }, { status: 200 });
  } catch (err: any) {
    console.error('[first-login] error', err);
    const msg = String(err?.message || '');

    // env不足をレスポンスに出すと特定しやすい（本番では隠してもOK）
    if (msg.startsWith('Missing env:')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }

    return NextResponse.json({ ok: false, error: 'server-error' }, { status: 500 });
  }
}