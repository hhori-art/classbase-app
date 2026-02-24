// app/api/create-user-from-gas/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, collection } from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret, users } = body;

    if (secret !== 'EDIC_SECRET_KEY_2026') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const createdIds: string[] = []; // ★追加：作成したIDを記憶する配列

    // スプレッドシートから送られてきた生徒データを保存
    for (const u of users) {
      const docId = doc(collection(db, 'users')).id;
      
      await setDoc(doc(db, 'users', docId), {
        uid: docId,
        role: 'student',
        student_name: u.name,
        lifetime_id: String(u.id),
        initial_password: String(u.password || 'class1234'),
        grade: u.grade || '',
        classroom: u.classroom || '',
        subject_science: u.science || '',
        subject_social: u.social || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true }); 
      
      createdIds.push(docId); // ★追加：IDを保存
    }

    // ★修正：createdIds も一緒に送り返す
    return NextResponse.json({ success: true, count: users.length, createdIds });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}