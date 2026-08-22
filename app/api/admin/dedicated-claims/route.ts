import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';
const clean = (value: unknown, max = 500) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const monthRange = (month: string) => {
  const value = /^\d{4}-\d{2}$/.test(month) ? month : new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  return { month: value, start: `${value}-01`, end: `${value}-31` };
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canManageAttendance(user)) throw new Error('forbidden');
    const { month, start, end } = monthRange(clean(request.nextUrl.searchParams.get('month'), 7));
    const db = adminDb();
    const [overtimeSnap, lessonSnap, transportSnap] = await Promise.all([
      db.collection('dedicated_overtime_claims').where('work_date', '>=', start).where('work_date', '<=', end).limit(3000).get(),
      db.collection('dedicated_lesson_claims').where('lesson_date', '>=', start).where('lesson_date', '<=', end).limit(3000).get(),
      db.collection('dedicated_transport_claims').where('expense_date', '>=', start).where('expense_date', '<=', end).limit(3000).get(),
    ]);
    const overtime = overtimeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => String(b.work_date).localeCompare(String(a.work_date)));
    const lessons = lessonSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => String(b.lesson_date).localeCompare(String(a.lesson_date)));
    const transport = transportSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => String(b.expense_date).localeCompare(String(a.expense_date)));
    return Response.json({ ok: true, month, overtime, lessons, transport }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canManageAttendance(user)) throw new Error('forbidden');
    const body = await request.json() as Record<string, unknown>;
    const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
    const rawItems = Array.isArray(body.items) ? body.items : [{ kind: body.kind, id: body.id }];
    const items = rawItems.map((item: any) => ({
      kind: item?.kind === 'lesson' ? 'lesson' : item?.kind === 'overtime' ? 'overtime' : item?.kind === 'transport' ? 'transport' : '',
      id: clean(item?.id, 120),
    })).filter(item => item.kind && item.id);
    if (!status || !items.length || items.length > 150) return Response.json({ ok: false, error: '確認内容が不正です。' }, { status: 400 });
    const db = adminDb();
    const collectionFor = (kind: string) => kind === 'lesson' ? 'dedicated_lesson_claims' : kind === 'transport' ? 'dedicated_transport_claims' : 'dedicated_overtime_claims';
    const refs = items.map(item => db.collection(collectionFor(item.kind)).doc(item.id));
    const snapshots = await db.getAll(...refs);
    if (snapshots.some(snapshot => !snapshot.exists)) return Response.json({ ok: false, error: '申請が見つかりません。' }, { status: 404 });
    const batch = db.batch();
    snapshots.forEach((snapshot, index) => {
      const item = items[index];
      const data = snapshot.data() || {};
      const reviewNote = clean(body.review_note, 1000);
      batch.set(snapshot.ref, { status, review_note: reviewNote, reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      if (item.kind === 'lesson' && status === 'approved') {
        batch.set(db.collection('employee_lesson_assignments').doc(`claim_${item.id}`), {
          employee_id: data.user_id, person_code: data.person_code || '', employee_name: data.user_name || '', school_name: data.school_name || '', lesson_date: data.lesson_date,
          start_time: data.start_time || '', end_time: data.end_time || '', lesson_minutes: Number(data.lesson_minutes || 0), course_name: data.course_name || '授業時間申請', role: 'main', note: data.details || '',
          source_type: 'dedicated_self_report', source_claim_id: item.id, approved_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (item.kind === 'overtime' && data.work_record_id) {
        batch.set(db.collection('work_records').doc(String(data.work_record_id)), {
          dedicated_overtime_minutes: status === 'approved' ? Number(data.overtime_minutes || 0) : 0,
          dedicated_overtime_status: status, dedicated_overtime_claim_id: item.id, updated_at_server: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      const kindLabel = item.kind === 'overtime' ? '時間外' : item.kind === 'lesson' ? '授業時間' : '交通費';
      batch.set(db.collection('user_notifications').doc(`dedicated_review_${item.kind}_${item.id}`), {
        user_id: data.user_id,
        title: `${kindLabel}申請が${status === 'approved' ? '承認' : '差し戻し'}されました`,
        message: reviewNote || (status === 'approved' ? '申請内容が承認されました。' : '申請内容を確認し、必要に応じて再申請してください。'),
        kind: '専任勤怠', read: false, claim_kind: item.kind, claim_id: item.id, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
    return Response.json({ ok: true, updated: items.length });
  } catch (error) {
    return jsonError(error);
  }
}
