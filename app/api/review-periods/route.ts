import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { requireAdminApp } from '@/lib/admin-app-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max = 120) => String(value || '').normalize('NFKC').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUBJECTS = new Set(['理科', '社会']);
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

type ReviewItem = { id: string; date: string; weekday: string; subject: string; unit: string; grade: string; time: string; lesson: string; level: string };

function normalizeItem(value: any, index: number): ReviewItem {
  const date = clean(value?.date, 10);
  const subject = clean(value?.subject, 10);
  const unit = clean(value?.unit, 100);
  if (!DATE_RE.test(date) || !SUBJECTS.has(subject) || !unit) throw new Error(`invalid-item-${index + 1}`);
  const parsed = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid-item-${index + 1}`);
  return {
    id: clean(value?.id, 80) || `review_${date}_${subject}_${index + 1}`,
    date,
    weekday: DAY_LABELS[parsed.getDay()],
    subject,
    unit,
    grade: clean(value?.grade, 20) || '全学年',
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

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    const db = adminDb();
    if (actor.role === 'student') {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const snap = await db.collection('review_periods').where('status', '==', 'active').limit(20).get();
      const grade = clean(actor.profile.grade, 20);
      const periods = snap.docs.map(serialize).filter(period => period.end_date >= today).map(period => ({
        ...period,
        items: period.items.filter((item: any) => !item.grade || item.grade === '全学年' || item.grade === grade),
      })).filter(period => period.items.length > 0).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const selectionDocs = await Promise.all(periods.map(period => db.collection('review_period_selections').doc(`${period.id}_${actor.uid}`).get()));
      const selections = Object.fromEntries(selectionDocs.filter(doc => doc.exists).map(doc => [clean(doc.data()?.period_id), doc.data()?.item_ids || []]));
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
      const grade = clean(actor.profile.grade, 20);
      const allowed = new Set(period.items.filter((item: any) => !item.grade || item.grade === '全学年' || item.grade === grade).map((item: any) => clean(item.id, 80)));
      if (requested.some(id => !allowed.has(id))) throw new Error('invalid-selection');
      await db.collection('review_period_selections').doc(`${periodId}_${actor.uid}`).set({
        period_id: periodId, student_id: actor.uid, student_name: clean(actor.profile.student_name || actor.profile.name),
        grade, item_ids: requested, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, item_ids: requested });
    }

    requireAdminApp(actor, 'science_social');
    if (body.action === 'archive') {
      const id = clean(body.id, 80);
      if (!id) throw new Error('invalid-period');
      await db.collection('review_periods').doc(id).set({ status: 'archived', updated_by: actor.uid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true });
    }
    const name = clean(body.name);
    const startDate = clean(body.start_date, 10);
    const endDate = clean(body.end_date, 10);
    if (!name || !DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) throw new Error('invalid-period');
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 500) throw new Error('invalid-items');
    const items: ReviewItem[] = rawItems.map(normalizeItem);
    if (items.some(item => item.date < startDate || item.date > endDate)) throw new Error('item-outside-period');
    const subjects = Array.from(new Set(items.map(item => item.subject)));
    const id = clean(body.id, 80);
    const ref = id ? db.collection('review_periods').doc(id) : db.collection('review_periods').doc();
    await ref.set({ name, start_date: startDate, end_date: endDate, subjects, items, status: 'active', updated_by: actor.uid, updated_at: FieldValue.serverTimestamp(), ...(!id ? { created_by: actor.uid, created_at: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    return Response.json({ ok: true, id: ref.id });
  } catch (error) { return jsonError(error); }
}
