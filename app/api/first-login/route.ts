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

    // 1) 初回登録データを Firestore から検索（Admin権限）
    const snap = await adminDb
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

    // 3) Firebase Auth ユーザー作成（すでにあれば取得）
    let uid: string;
    try {
      const created = await adminAuth.createUser({ email, password });
      uid = created.uid;
    } catch (e: any) {
      if (e?.code === 'auth/email-already-exists') {
        const existing = await adminAuth.getUserByEmail(email);
        uid = existing.uid;
      } else {
        throw e;
      }
    }

    // 4) users/{uid} に移行（merge）
    await adminDb.collection('users').doc(uid).set(
      {
        ...userData,
        uid,
        email,
        migrated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    // 5) 旧ドキュメント削除（同一IDなら削除しない）
    if (oldDoc.ref.id !== uid) {
      await oldDoc.ref.delete();
    }

    return NextResponse.json({ ok: true, uid }, { status: 200 });
  } catch (err) {
    console.error('[first-login] error', err);
    return NextResponse.json({ ok: false, error: 'server-error' }, { status: 500 });
  }
}