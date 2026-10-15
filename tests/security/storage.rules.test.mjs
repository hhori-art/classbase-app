import fs from 'node:fs';
import test, { after, before, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

let env;
const projectId = 'demo-classbase-security';

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync('storage.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/student-1'), { role: 'student' }),
      setDoc(doc(db, 'users/master-1'), { role: 'master' }),
    ]);
  });
});

after(async () => env?.cleanup());

test('未認証ユーザーは授業資料をアップロードできない', async () => {
  const storage = env.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(storage, 'lesson_slides/attack.txt'), new Uint8Array([1])));
});

test('授業資料は管理者もStorageへ直接アップロードできず専用APIを経由する', async () => {
  const masterStorage = env.authenticatedContext('master-1').storage();
  const studentStorage = env.authenticatedContext('student-1').storage();
  await assertFails(uploadBytes(ref(masterStorage, 'lesson_slides/lesson.txt'), new Uint8Array([1, 2])));
  await assertFails(uploadBytes(ref(studentStorage, 'lesson_slides/attack.txt'), new Uint8Array([1])));
});

test('宿題画像は生徒がStorageへ直接作成できず専用APIを経由する', async () => {
  const storage = env.authenticatedContext('student-1').storage();
  await assertFails(uploadBytes(ref(storage, 'submissions/task/student-1/answer.png'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
});

test('カスタムスタンプは講師がStorageへ直接作成できず画像検査APIを経由する', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users/teacher-1'), { role: 'teacher' }));
  const storage = env.authenticatedContext('teacher-1').storage();
  await assertFails(uploadBytes(ref(storage, 'stamps/teacher-1/stamp.png'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
});

test('勤怠取込は権限者本人の検証済みExcelだけを許可する', async () => {
  const storage = env.authenticatedContext('master-1').storage();
  const xlsMetadata = { contentType: 'application/vnd.ms-excel' };
  const xlsxMetadata = { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  await assertSucceeds(uploadBytes(ref(storage, 'attendance_imports/master-1/source.xls'), new Uint8Array([1, 2, 3]), xlsMetadata));
  await assertSucceeds(uploadBytes(ref(storage, 'attendance_imports/master-1/source.xlsx'), new Uint8Array([1, 2, 3]), xlsxMetadata));
  await assertFails(uploadBytes(ref(storage, 'attendance_imports/master-1/spoofed.xlsx'), new Uint8Array([1]), xlsMetadata));
  await assertFails(uploadBytes(ref(storage, 'attendance_imports/other/source.xlsx'), new Uint8Array([1]), xlsxMetadata));
});

test('勤怠取込ファイルはアップロード本人でも読み出せない', async () => {
  const storage = env.authenticatedContext('master-1').storage();
  const fileRef = ref(storage, 'attendance_imports/master-1/source.xls');
  await assertSucceeds(uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'application/vnd.ms-excel' }));
  await assertFails(getBytes(fileRef));
});

test('授業資料は全利用者がStorageから直接取得できず専用APIを経由する', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(), 'lesson_slides/lesson.txt'), new Uint8Array([1, 2]));
  });
  const studentRef = ref(env.authenticatedContext('student-1').storage(), 'lesson_slides/lesson.txt');
  await assertFails(getBytes(studentRef));
  const masterRef = ref(env.authenticatedContext('master-1').storage(), 'lesson_slides/lesson.txt');
  await assertFails(getBytes(masterRef));
});
