import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { normalizeTestPrepDefinition } from '@/lib/test-prep-registration';
import { jstSchoolYear, weekdayFromDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';

const assertAdmin = async (request: NextRequest) => {
  const user = await getServerUser(request);
  requireMaster(user);
  return user;
};

const validate = (value: ReturnType<typeof normalizeTestPrepDefinition>) => {
  const validDate = (date: string) => Boolean(weekdayFromDateKey(date));
  const allowedGrades = new Set(['中1', '中2', '中3']);
  const allowedCourses: Record<string, Set<string>> = {
    理科: new Set(['物理', '化学', '生物', '地学']),
    社会: new Set(['地理', '歴史', '公民']),
  };
  if (!value.title || !value.grade || !value.subject || !value.course_name) return '名称・学年・科目・講座名は必須です。';
  if (!allowedGrades.has(value.grade) || !allowedCourses[value.subject]?.has(value.course_name)) return '学年・科目・講座名を選択肢から選んでください。';
  if (!validDate(value.start_date) || !validDate(value.end_date) || value.start_date > value.end_date) return '正しい開始日・終了日を入力してください。';
  if (!validDate(value.registration_open_date) || !validDate(value.registration_close_date) || value.registration_open_date > value.registration_close_date) return '正しい受付開始日・締切日を入力してください。';
  if (value.registration_close_date > value.end_date) return '受付締切日は講座終了日以前にしてください。';
  if (value.units.length === 0 || value.units.length > 100 || value.units.some(unit => unit.length > 120)) return '対策単元は120文字以内で1〜100件入力してください。';
  if (value.title.length > 120) return '対策名は120文字以内で入力してください。';
  if (value.year < 2020 || value.year > 2100 || !Number.isInteger(value.year)) return '年度を正しく入力してください。';
  if (value.allowed_student_grades.length === 0 || value.allowed_student_grades.some(grade => !allowedGrades.has(grade))) return '登録可能な生徒学年を選択肢から1つ以上選んでください。';
  return '';
};

export async function GET(request: NextRequest) {
  try {
    await assertAdmin(request);
    // 年度は4月はじまり（日本時間）。
    const year = Number(request.nextUrl.searchParams.get('year') || jstSchoolYear());
    const snap = await adminDb().collection('test_prep_course_options').where('year', '==', year).limit(500).get();
    const items = snap.docs
      .map(doc => normalizeTestPrepDefinition(doc.id, doc.data()))
      .sort((a, b) => `${a.start_date}_${a.grade}_${a.subject}_${a.course_name}`.localeCompare(`${b.start_date}_${b.grade}_${b.subject}_${b.course_name}`, 'ja'));
    return Response.json({ ok: true, items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await assertAdmin(request);
    const body = await request.json();
    const requestedId = String(body.id || '').trim();
    const ref = requestedId
      ? adminDb().collection('test_prep_course_options').doc(requestedId)
      : adminDb().collection('test_prep_course_options').doc();
    const value = normalizeTestPrepDefinition(ref.id, body);
    const error = validate(value);
    if (error) return Response.json({ ok: false, error }, { status: 400 });
    const existing = await ref.get();
    await ref.set({
      ...value,
      id: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
      updated_by: user.uid,
      ...(!existing.exists ? { created_at: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    revalidateTag('course-registration-options');
    return Response.json({ ok: true, item: value });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await assertAdmin(request);
    const id = String(request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    const ref = adminDb().collection('test_prep_course_options').doc(id);
    const existing = await ref.get();
    if (!existing.exists) return Response.json({ ok: false, error: '対策講座が見つかりません。' }, { status: 404 });
    await ref.set({
      is_active: false,
      archived_at: FieldValue.serverTimestamp(),
      archived_by: user.uid,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: user.uid,
    }, { merge: true });
    revalidateTag('course-registration-options');
    return Response.json({ ok: true, archived: true });
  } catch (error) {
    return jsonError(error);
  }
}
