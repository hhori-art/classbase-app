import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isOpsAgentRequest, notifyOpsOwner, OPS_REPORTS, publicBaseUrl, signDecisionToken, validReportId } from '@/lib/server/ops-reports';

export const runtime = 'nodejs';

const SEVERITIES = new Set(['ok', 'info', 'warning', 'critical']);
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

/**
 * 毎日の点検の報告を受け取り、決めた1人にスマホで知らせる（Mac の定期実行から呼ぶ）。
 * 本文には生徒の個人情報を入れない（点検の側で守る）。同じ日の報告は上書きする（返事は消さない）。
 */
export async function POST(request: Request) {
  if (!isOpsAgentRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = clean(body.id, 30);
  if (!validReportId(id)) return Response.json({ ok: false, error: 'invalid-id' }, { status: 400 });
  const severity = SEVERITIES.has(clean(body.severity, 20)) ? clean(body.severity, 20) : 'info';
  const fixBranch = /^ops\/[a-z0-9][a-z0-9._/-]{0,80}$/.test(clean(body.fix_branch, 100)) ? clean(body.fix_branch, 100) : '';
  const report = {
    id,
    title: clean(body.title, 120) || '毎日の点検',
    severity,
    summary: clean(body.summary, 1500),
    body: clean(body.body, 60000),
    fix_branch: fixBranch || null,
    fix_summary: clean(body.fix_summary, 1000),
    updated_at: FieldValue.serverTimestamp(),
  };
  await adminDb().collection(OPS_REPORTS).doc(id).set(report, { merge: true });

  const link = `${publicBaseUrl()}/api/ops/decision?t=${encodeURIComponent(signDecisionToken(id))}`;
  const mark = severity === 'critical' ? '【至急】' : severity === 'warning' ? '【要確認】' : '';
  const text = [
    report.summary,
    fixBranch ? `\n修正の準備：${report.fix_summary || fixBranch}\n本番に反映するかを選んでください。` : '',
    `\n詳しく見る・返事をする：\n${link}`,
    '\n（リンクは3日有効。返事は1回だけ受け付けます）',
  ].filter(Boolean).join('\n');
  const channel = body.notify === false ? 'skipped' : await notifyOpsOwner({ id: `report_${id}_${Date.now()}`, subject: `${mark}ClassBase 毎日の点検 ${id}：${report.title}`, text });
  return Response.json({ ok: true, id, channel });
}
