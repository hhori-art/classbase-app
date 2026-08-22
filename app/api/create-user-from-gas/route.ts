// app/api/create-user-from-gas/route.ts
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

function configuredSecret() {
  return process.env.CLASSBASE_GAS_USER_SECRET || process.env.CLASSBASE_SYNC_SECRET || process.env.SECRET_KEY || '';
}

function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret, users } = body;

    const expectedSecret = configuredSecret();
    if (!expectedSecret || !safeEqual(String(secret || ''), expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!Array.isArray(users)) {
      return NextResponse.json({ error: 'users must be array' }, { status: 400 });
    }

    const db = adminDb();
    const createdIds: string[] = [];

    // スプレッドシートから送られてきた生徒データを保存
    for (const u of users) {
      const docId = db.collection('users').doc().id;
      
      await db.collection('users').doc(docId).set({
        uid: docId,
        role: 'student',
        account_status: 'active',
        student_name: u.name,
        lifetime_id: String(u.id),
        initial_password_policy: 'imported-from-gas',
        grade: u.grade || '',
        classroom: u.classroom || '',
        subject_science: u.science || '',
        subject_social: u.social || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true }); 
      
      createdIds.push(docId);
    }

    return NextResponse.json({ success: true, count: users.length, createdIds });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
