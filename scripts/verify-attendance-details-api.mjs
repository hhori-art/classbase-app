import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const baseUrl = String(process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

if (!projectId || !clientEmail || !privateKey || !apiKey) {
  throw new Error('Firebaseの検証用環境変数が不足しています。');
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const teacherUid = `attendance-detail-verify-${suffix}`;
const otherUid = `attendance-detail-other-${suffix}`;
const recordId = `attendance-detail-record-${suffix}`;
const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, `attendance-detail-${suffix}`);
const auth = getAuth(app);
const db = getFirestore(app);

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error(`IDトークンを作成できませんでした: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function post(token, workRecordId) {
  const response = await fetch(`${baseUrl}/api/teacher/attendance-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      work_record_id: workRecordId,
      work_segments: [
        { start: '09:00', end: '10:15', type: 'office', program: 'normal', school_id: 'エディック 西神本部校', office_task: 'grading', note: '答案採点' },
      ],
      transportation: [],
    }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await Promise.all([
    auth.createUser({ uid: teacherUid }),
    auth.createUser({ uid: otherUid }),
    db.collection('users').doc(teacherUid).set({ role: 'teacher', name: '勤怠保存検証' }),
    db.collection('users').doc(otherUid).set({ role: 'teacher', name: '権限検証' }),
  ]);
  await db.collection('work_records').doc(recordId).set({
    teacher_id: teacherUid,
    start_time: '2026-09-04T09:00:00+09:00',
    end_time: '2026-09-04T10:15:00+09:00',
    status: 'pending',
  });

  const [teacherToken, otherToken] = await Promise.all([idTokenFor(teacherUid), idTokenFor(otherUid)]);
  const ownResult = await post(teacherToken, recordId);
  if (ownResult.status !== 200 || ownResult.body.ok !== true) {
    throw new Error(`本人の保存に失敗しました: ${JSON.stringify(ownResult)}`);
  }

  const saved = (await db.collection('work_records').doc(recordId).get()).data();
  const office = saved?.work_segments?.[0];
  if (office?.office_task !== 'grading' || office?.note !== '答案採点') {
    throw new Error(`事務内容が正しく保存されていません: ${JSON.stringify(office)}`);
  }
  if (JSON.stringify(saved?.work_segments || []).includes('undefined')) {
    throw new Error('保存データにundefinedが残っています。');
  }

  const forbiddenResult = await post(otherToken, recordId);
  if (forbiddenResult.status !== 403) {
    throw new Error(`本人以外の更新が拒否されませんでした: ${JSON.stringify(forbiddenResult)}`);
  }

  console.log(JSON.stringify({ ok: true, base_url: baseUrl, own_save: ownResult.status, forbidden_save: forbiddenResult.status, office_task: office.office_task }));
} finally {
  await Promise.allSettled([
    db.collection('work_records').doc(recordId).delete(),
    db.collection('users').doc(teacherUid).delete(),
    db.collection('users').doc(otherUid).delete(),
    auth.deleteUser(teacherUid),
    auth.deleteUser(otherUid),
  ]);
  await deleteApp(app);
}
