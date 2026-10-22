import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { requireAdminApp } from '@/lib/admin-app-access';
import { jstDateKey, weekdayFromDateKey } from '@/lib/date-key';
import { normalizeGrade } from '@/lib/test-prep-registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max = 120) => String(value || '').normalize('NFKC').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const SUBJECTS = new Set(['理科', '社会']);
const ALL_GRADES = '全学年';
const GRADES = new Set([ALL_GRADES, '中1', '中2', '中3']);

type ReviewItem = { id: string; date: string; weekday: string; subject: string; unit: string; grade: string; time: string; lesson: string; level: string };

// 新しい行のIDはサーバーで乱数から作る（日付・科目・行番号から作ると、行の並べ替えで別の講座に付け替わるため）。
const newItemId = () => `review_${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '')}`;

/** 学年は「全学年・中1・中2・中3」にそろえる（自由入力の「中２」「2年」なども同じ学年として扱う）。 */
const normalizeItemGrade = (value: unknown) => {
  const text = clean(value, 20);
  if (!text || text === ALL_GRADES) return ALL_GRADES;
  return normalizeGrade(text);
};

function normalizeItem(value: any, index: number): ReviewItem {
  const date = clean(value?.date, 10);
  const subject = clean(value?.subject, 10);
  const unit = clean(value?.unit, 100);
  // 曜日は日付文字列から暦どおりに求める（サーバーのタイムゾーンに左右されない）。
  const weekday = DATE_RE.test(date) ? weekdayFromDateKey(date) : '';
  const grade = normalizeItemGrade(value?.grade);
  if (!weekday || !SUBJECTS.has(subject) || !unit || !GRADES.has(grade)) throw new Error(`invalid-item-${index + 1}`);
  const suppliedId = clean(value?.id, 80);
  if (suppliedId && !ITEM_ID_RE.test(suppliedId)) throw new Error(`invalid-item-${index + 1}`);
  return {
    id: suppliedId || newItemId(),
    date,
    weekday,
    subject,
    unit,
    grade,
    time: clean(value?.time, 40),
    lesson: clean(value?.lesson, 20),
    level: clean(value?.level, 20) || '通常',
  };
}

const serialize = (doc: FirebaseFirestore.DocumentSnapshot) => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    name: clean(data.name),
    start_date: clean(data.start_date, 10),
    end_date: clean(data.end_date, 10),
    subjects: Array.isArray(data.subjects) ? data.subjects.map((v: unknown) => clean(v, 10)).filter((v: string) => SUBJECTS.has(v)) : [],
    items: Array.isArray(data.items) ? data.items : [],
    status: data.status === 'archived' ? 'archived' : 'active',
  };
};

/** 生徒の学年で受けられる行か（どちらも学年表記をそろえて比べる）。 */
const itemAllowedForGrade = (item: any, grade: string) => {
  const itemGrade = normalizeItemGrade(item?.grade);
  return itemGrade === ALL_GRADES || itemGrade === normalizeGrade(grade);
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    const db = adminDb();
    if (actor.role === 'student') {
      const today = jstDateKey();
      // 終了日が今日以降の有効な期間だけを、終了日の近い順に取る（複合インデックス review_periods(status, end_date)）。
      const snap = await db.collection('review_periods')
        .where('status', '==', 'active')
        .where('end_date', '>=', today)
        .orderBy('end_date', 'asc')
        .limit(20)
        .get();
      const grade = clean(actor.profile.grade, 20);
      const periods = snap.docs.map(serialize).filter(period => period.status === 'active' && period.end_date >= today).map(period => ({
        ...period,
        items: grade ? period.items.filter((item: any) => itemAllowedForGrade(item, grade)) : [],
      })).filter(period => period.items.length > 0).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const selectionDocs = await Promise.all(periods.map(period => db.collection('review_period_selections').doc(`${period.id}_${actor.uid}`).get()));
      // 保存済みの選択は、いま選べる行だけに絞って返す（削除・対象外になった行が残ると保存できなくなるため）。
      const allowedByPeriod = new Map(periods.map(period => [period.id, new Set(period.items.map((item: any) => clean(item.id, 80)))]));
      const selections = Object.fromEntries(selectionDocs.filter(doc => doc.exists).map(doc => {
        const periodId = clean(doc.data()?.period_id);
        const allowed = allowedByPeriod.get(periodId) || new Set<string>();
        const itemIds = (Array.isArray(doc.data()?.item_ids) ? doc.data()?.item_ids : []).map((id: unknown) => clean(id, 80)).filter((id: string) => allowed.has(id));
        return [periodId, itemIds];
      }));
      return Response.json({ ok: true, periods, selections, grade_required: !grade }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    requireAdminApp(actor, 'science_social');
    const snap = await db.collection('review_periods').orderBy('start_date', 'desc').limit(50).get();
    return Response.json({ ok: true, periods: snap.docs.map(serialize) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    const body = await request.json();
    const db = adminDb();
    if (actor.role === 'student') {
      const periodId = clean(body.period_id, 80);
      const requested: string[] = Array.from(new Set<string>((Array.isArray(body.item_ids) ? body.item_ids : []).map((v: unknown) => clean(v, 80)).filter(Boolean)));
      if (!periodId || requested.length > 40) throw new Error('invalid-selection');
      const periodSnap = await db.collection('review_periods').doc(periodId).get();
      if (!periodSnap.exists || periodSnap.data()?.status === 'archived') throw new Error('period-not-found');
      const period = serialize(periodSnap);
      // 終了日を過ぎた期間の選択は変えられない。
      if (!period.end_date || period.end_date < jstDateKey()) throw new Error('period-ended');
      const grade = clean(actor.profile.grade, 20);
      if (!grade) throw new Error('grade-required');
      const knownIds = new Set(period.items.map((item: any) => clean(item.id, 80)));
      const allowed = new Set(period.items.filter((item: any) => itemAllowedForGrade(item, grade)).map((item: any) => clean(item.id, 80)));
      // 期間から削除された行は黙って外す。存在するが学年の対象外の行は受け付けない。
      const known = requested.filter(id => knownIds.has(id));
      if (known.some(id => !allowed.has(id))) throw new Error('invalid-selection');
      await db.collection('review_period_selections').doc(`${periodId}_${actor.uid}`).set({
        period_id: periodId, student_id: actor.uid, student_name: clean(actor.profile.student_name || actor.profile.name),
        grade, item_ids: known, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, item_ids: known });
    }

    requireAdminApp(actor, 'science_social');
    if (body.action === 'archive') {
      const id = clean(body.id, 80);
      if (!id) throw new Error('invalid-period');
      const ref = db.collection('review_periods').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('period-not-found');
      await ref.set({ status: 'archived', updated_by: actor.uid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true });
    }
    const name = clean(body.name);
    const startDate = clean(body.start_date, 10);
    const endDate = clean(body.end_date, 10);
    if (!name || !weekdayFromDateKey(startDate) || !weekdayFromDateKey(endDate) || startDate > endDate) throw new Error('invalid-period');
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 500) throw new Error('invalid-items');
    const items: ReviewItem[] = rawItems.map(normalizeItem);
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('duplicate-item-id');
    if (items.some(item => item.date < startDate || item.date > endDate)) throw new Error('item-outside-period');
    const subjects = Array.from(new Set(items.map(item => item.subject)));
    const id = clean(body.id, 80);
    if (id) {
      // 既存期間の更新だけを受け付ける。終了済みの期間を保存で黙って再開させない。
      const existing = await db.collection('review_periods').doc(id).get();
      if (!existing.exists) throw new Error('period-not-found');
      if (existing.data()?.status === 'archived') throw new Error('period-archived');
    }
    const ref = id ? db.collection('review_periods').doc(id) : db.collection('review_periods').doc();
    await ref.set({ name, start_date: startDate, end_date: endDate, subjects, items, status: 'active', updated_by: actor.uid, updated_at: FieldValue.serverTimestamp(), ...(!id ? { created_by: actor.uid, created_at: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    return Response.json({ ok: true, id: ref.id });
  } catch (error) { return jsonError(error); }
}
