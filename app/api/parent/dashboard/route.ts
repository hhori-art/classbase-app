import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { jstDateKeyDaysAgo, loadLessonDays } from '@/lib/server/parent-learning-history';
import { normalizeClassButtonSettings } from '@/lib/class-button-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max = 500) => String(value || '').normalize('NFKC').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;

// ホームの「がんばり」は直近60日（日本時間の日付）で数える。一覧は新しい順に上限つきで返す。
const WINDOW_DAYS = 60;
const LIST_LIMIT = 20;
const FALLBACK_SCAN_LIMIT = 300;
type Query = FirebaseFirestore.Query;

/** 期間内の件数を count() 集計で数える（1,000件ごとに1読取）。インデックス未作成などで失敗したら fallback を使う。 */
async function countOr(query: Query, fallback: () => Promise<number>) {
  try {
    const snap = await query.count().get();
    return Number(snap.data().count) || 0;
  } catch (error) {
    console.warn('[parent/dashboard] count fallback', error);
    return fallback();
  }
}

/** 宿題の提出（submitted_at は ISO 文字列）を期間で絞り、新しい順に取る。複合インデックス submissions(student_id, submitted_at DESC) を使う。 */
async function recentSubmissions(studentId: string, fromIso: string) {
  const base = adminDb().collection('submissions').where('student_id', '==', studentId);
  const windowed = base.where('submitted_at', '>=', fromIso).orderBy('submitted_at', 'desc');
  const fallback = async () => {
    // インデックスが使えないときだけ、上限つきで読み込んで期間内を数える。
    const snap = await base.limit(FALLBACK_SCAN_LIMIT).get();
    return snap.docs
      .filter(doc => String(doc.data()?.submitted_at || '') >= fromIso)
      .sort((a, b) => String(b.data()?.submitted_at || '').localeCompare(String(a.data()?.submitted_at || '')));
  };
  try {
    const listSnap = await windowed.limit(LIST_LIMIT).get();
    const count = await countOr(windowed, async () => (await fallback()).length);
    return { docs: listSnap.docs, count: Math.max(count, listSnap.size) };
  } catch (error) {
    console.warn('[parent/dashboard] submissions fallback', error);
    const docs = await fallback();
    return { docs: docs.slice(0, LIST_LIMIT), count: docs.length };
  }
}

/** AIチャットを期間で絞る。一覧は createdAt の単一フィールド、質問数は複合インデックス chat_history(role, createdAt DESC) を使う。 */
async function recentChat(studentId: string, from: Timestamp) {
  const history = adminDb().collection('users').doc(studentId).collection('chat_history');
  const windowed = history.where('createdAt', '>=', from).orderBy('createdAt', 'desc');
  const listSnap = await windowed.limit(LIST_LIMIT).get();
  const questionCount = await countOr(
    history.where('role', '==', 'user').where('createdAt', '>=', from).orderBy('createdAt', 'desc'),
    async () => {
      const snap = await windowed.select('role').limit(FALLBACK_SCAN_LIMIT * 2).get();
      return snap.docs.filter(doc => doc.data()?.role === 'user').length;
    },
  );
  return { docs: listSnap.docs, questionCount };
}

const idList = (value: unknown) => (Array.isArray(value) ? value : [])
  .map((item: unknown) => clean(item, 500)).filter(Boolean).slice(0, 100);

const publicStudent = (id: string, data: FirebaseFirestore.DocumentData) => ({
  id,
  student_name: clean(data.student_name || data.name, 120) || '生徒',
  grade: clean(data.grade, 40),
  school: clean(data.school_name || data.school, 120),
  school_id: clean(data.school_id || data.school_code, 80),
  day_of_week: clean(data.day_of_week, 80),
  selected_course_ids: idList(data.selected_course_ids),
  // 保護者の受講講座変更画面（/parent/courses）で、いまの登録内容を選択済みにするための値。
  selected_course_keys: idList(data.selected_course_keys),
  selected_test_prep_course_ids: idList(data.selected_test_prep_course_ids),
  selected_test_prep_course_keys: idList(data.selected_test_prep_course_keys),
  active_course_registration_id: clean(data.active_course_registration_id, 200),
  subject_science: clean(data.subject_science, 40),
  subject_social: clean(data.subject_social, 40),
});

async function linkedStudents(parentId: string, listedValue: unknown) {
  const db = adminDb();
  const listedIds = Array.from(new Set((Array.isArray(listedValue) ? listedValue : [])
    .map(value => clean(value, 128)).filter(Boolean))).slice(0, 20);
  const [listedDocs, reverseSnap] = await Promise.all([
    Promise.all(listedIds.map(id => db.collection('users').doc(id).get())),
    db.collection('users').where('parent_uid', '==', parentId).limit(20).get(),
  ]);
  const students = new Map<string, Record<string, unknown>>();
  [...listedDocs, ...reverseSnap.docs].forEach(doc => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (clean(data.role, 40) !== 'student') return;
    if (!listedIds.includes(doc.id) && clean(data.parent_uid, 128) !== parentId) return;
    students.set(doc.id, publicStudent(doc.id, data));
  });
  return [...students.values()];
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['parent']);
    const db = adminDb();
    const requestedId = clean(request.nextUrl.searchParams.get('student_id'), 128);
    if (!requestedId) {
      const students = await linkedStudents(actor.uid, actor.profile.student_ids);
      return Response.json({ ok: true, students }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const listedIds = (Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids : []).map(value => clean(value, 128));
    const studentSnap = await db.collection('users').doc(requestedId).get();
    const studentData = studentSnap.data() || {};
    if (!studentSnap.exists || clean(studentData.role, 40) !== 'student' ||
      (!listedIds.includes(requestedId) && clean(studentData.parent_uid, 128) !== actor.uid)) throw new Error('forbidden');
    const student = publicStudent(studentSnap.id, studentData);

    // 欠席・振替は日付で範囲を切って新しい日付から取る（カレンダーの「連絡済み」表示を取りこぼさない）。
    // 複合インデックス requests(user_id, type, target_date DESC) を使う。
    const fromDate = jstDateKeyDaysAgo(WINDOW_DAYS);
    const fromMs = Date.parse(`${fromDate}T00:00:00+09:00`);
    const [submissions, absenceSnap, transferSnap, chat, settingsSnap] = await Promise.all([
      recentSubmissions(requestedId, new Date(fromMs).toISOString()),
      db.collection('requests').where('user_id', '==', requestedId).where('type', '==', 'absence').where('target_date', '>=', fromDate).orderBy('target_date', 'desc').limit(60).get(),
      db.collection('requests').where('user_id', '==', requestedId).where('type', '==', 'transfer').where('target_date', '>=', fromDate).orderBy('target_date', 'desc').limit(60).get(),
      recentChat(requestedId, Timestamp.fromDate(new Date(fromMs))),
      db.collection('settings').doc('class_button').get(),
    ]);
    // 出席は1日1件なので、期間の日数ぶん読めば欠けない。
    const lessonDays = await loadLessonDays(requestedId, { fromDate, attendanceLimit: WINDOW_DAYS + 10, viewLimit: 200, viewsSinceFromDate: true, requests: { absence: absenceSnap, transfer: transferSnap } });
    const classTimes = normalizeClassButtonSettings(settingsSnap.data() || {});

    const homework = submissions.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, title: clean(data.title || data.homework_title, 160) || '宿題提出', occurred_at: millis(data.submitted_at || data.created_at), body: clean(data.comment || data.memo, 2000), status: clean(data.status, 40) };
    });
    // 見送り・取消になった連絡も返して、保護者に結果が分かるようにする。
    // ただし同じ日の連絡をまとめた時に自動で取り消した重複（replaced_by あり）は出さない。
    const requests = [...absenceSnap.docs, ...transferSnap.docs].filter(doc => !clean(doc.data()?.replaced_by, 128)).map(doc => {
      const data = doc.data() || {};
      const type = clean(data.type, 30);
      return { id: doc.id, type, absence_type: clean(data.absence_type, 20), title: type === 'transfer' ? '振替' : data.absence_type === 'late' ? '遅刻連絡' : '欠席連絡', target_date: clean(data.target_date, 20), absence_date: clean(data.absence_date, 20), status: clean(data.status, 60).toLowerCase() || 'pending', transfer_status: clean(data.transfer_status, 40), body: clean(data.content || data.reason, 2000) };
    });
    const aiMessages = chat.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, role: data.role === 'assistant' ? 'assistant' : 'user', occurred_at: millis(data.createdAt || data.created_at), body: clean(data.content, 8000) };
    });
    const summary = { window_days: WINDOW_DAYS, from_date: fromDate, homework_count: submissions.count, ai_question_count: chat.questionCount };

    return Response.json({ ok: true, student, details: { homework, absence: requests, aiMessages, lessons: lessonDays }, summary, class_times: { period1_end: classTimes.period1_end, period2_end: classTimes.period2_end } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
