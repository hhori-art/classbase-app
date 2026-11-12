import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isOpsAgentRequest, notifyOpsOwner, OPS_DECISIONS, validReportId } from '@/lib/server/ops-reports';

export const runtime = 'nodejs';

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

/** Mac の定期実行が、まだ対応していない返事を読む。 */
export async function GET(request: Request) {
  if (!isOpsAgentRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const snap = await adminDb().collection(OPS_DECISIONS).where('status', '==', 'pending').limit(20).get();
  const decisions = snap.docs.map(doc => {
    const data = doc.data();
    return { report_id: doc.id, action: data.action, comment: data.comment || '', fix_branch: data.fix_branch || null, decided_at: data.decided_at?.toDate?.().toISOString?.() || null };
  });
  return Response.json({ ok: true, decisions });
}

/** 対応した結果を残し、本人に知らせる。 */
export async function POST(request: Request) {
  if (!isOpsAgentRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const reportId = clean(body.report_id, 30);
  const status = ['done', 'failed', 'in_progress'].includes(clean(body.status, 20)) ? clean(body.status, 20) : '';
  if (!validReportId(reportId) || !status) return Response.json({ ok: false, error: 'invalid-params' }, { status: 400 });
  const message = clean(body.message, 1500);
  await adminDb().collection(OPS_DECISIONS).doc(reportId).set({ status, result_message: message, handled_at: FieldValue.serverTimestamp() }, { merge: true });
  if (status !== 'in_progress' && body.notify !== false) {
    await notifyOpsOwner({ id: `result_${reportId}_${status}`, subject: `ClassBase 毎日の点検 ${reportId}：${status === 'done' ? '対応しました' : '対応できませんでした'}`, text: message || (status === 'done' ? '対応が終わりました。' : '対応できませんでした。') });
  }
  return Response.json({ ok: true });
}
