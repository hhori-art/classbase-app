import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole, type ServerUser } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';

// 講師のシフト希望（teacher_availability）の提出・取り消し。
// 管理画面（/master/shifts）が読む項目名はそのまま保つ。
const ROLE_IDS = ['main', 'sub', 'general', 'office'];
const ROLE_LABELS: Record<string, string> = {
  main: '講師 (授業)',
  sub: 'サポート (個別)',
  general: '全体サポート',
  office: '事務作業',
};
const MAX_DATES = 62;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RANGE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/;

class RouteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const teacherNameOf = (user: ServerUser) =>
  String(user.profile.name || user.profile.student_name || user.profile.display_name || user.email || '講師').trim();

const isValidDateKey = (value: string) => {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

async function existingDates(user: ServerUser, from: string) {
  const db = adminDb();
  const [byTeacher, byUser] = await Promise.all([
    db.collection('teacher_availability').where('teacher_id', '==', user.uid).where('available_date', '>=', from).get(),
    db.collection('teacher_availability').where('user_id', '==', user.uid).where('available_date', '>=', from).get(),
  ]);
  return new Set([...byTeacher.docs, ...byUser.docs].map(doc => String(doc.data()?.available_date || '')));
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const dates = Array.from(new Set((Array.isArray(body.dates) ? body.dates : []).map(value => String(value || '').trim()))).sort();
    const timeRange = String(body.time_range || '').trim();
    const workplace = String(body.workplace || '').trim().slice(0, 80);
    const roles = Array.from(new Set((Array.isArray(body.roles) ? body.roles : []).map(value => String(value || '')))).filter(role => ROLE_IDS.includes(role));

    if (!dates.length) throw new RouteError('dates-required', 400);
    if (dates.length > MAX_DATES) throw new RouteError('too-many-dates', 400);
    if (dates.some(date => !isValidDateKey(date))) throw new RouteError('invalid-date', 400);
    if (!TIME_RANGE_PATTERN.test(timeRange)) throw new RouteError('invalid-time-range', 400);
    if (timeRange.slice(0, 5) >= timeRange.slice(8)) throw new RouteError('invalid-time-range', 400);
    if (!workplace) throw new RouteError('workplace-required', 400);
    if (!roles.length) throw new RouteError('roles-required', 400);

    const today = jstDateKey();
    // 過ぎた日のシフト希望は提出できない（当日分は提出可）。
    if (dates.some(date => date < today)) throw new RouteError('date-in-past', 400);

    const already = await existingDates(user, today);
    const fresh = dates.filter(date => !already.has(date));
    const db = adminDb();
    const batch = db.batch();
    const teacherName = teacherNameOf(user);
    const note = `希望: ${roles.map(role => ROLE_LABELS[role]).join(' / ')}`;
    const createdAt = new Date().toISOString();
    fresh.forEach(date => {
      batch.set(db.collection('teacher_availability').doc(), {
        teacher_id: user.uid,
        user_id: user.uid,
        teacher_name: teacherName,
        available_date: date,
        time_range: timeRange,
        workplace,
        location: workplace,
        note,
        roles,
        status: 'possible',
        created_by: user.uid,
        created_at: createdAt,
      });
    });
    if (fresh.length) await batch.commit();
    return Response.json({ ok: true, created: fresh.length, skipped: dates.filter(date => already.has(date)) });
  } catch (error) {
    if (error instanceof RouteError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);
    const id = String(request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) throw new RouteError('id-required', 400);

    const db = adminDb();
    const ref = db.collection('teacher_availability').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new RouteError('not-found', 404);
    const data = snap.data() || {};
    if (data.teacher_id !== user.uid && data.user_id !== user.uid) throw new RouteError('forbidden', 403);

    const date = String(data.available_date || '');
    // 当日・過去の希望は取り消せない。授業に配置済みなら代行依頼で調整してもらう。
    if (!date || date <= jstDateKey()) throw new RouteError('locked-date', 409);
    const assigned = await db.collection('shift_assignments')
      .where('user_id', '==', user.uid)
      .where('target_date', '==', date)
      .limit(1)
      .get();
    if (!assigned.empty) throw new RouteError('already-assigned', 409);

    await ref.delete();
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RouteError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
