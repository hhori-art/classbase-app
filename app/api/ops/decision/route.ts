import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { escapeHtml, OPS_ACTIONS, OPS_DECISIONS, OPS_REPORTS, verifyDecisionToken, type OpsAction } from '@/lib/server/ops-reports';

export const runtime = 'nodejs';

/**
 * 毎日の点検の報告を、スマホで読んで返事をするページ（LINE・メールのリンクから開く）。
 * 開いただけでは何も起きない（LINE がリンクを先読みするため）。ボタンを押したときだけ、返事を1回だけ記録する。
 * 実際の対応（本番への反映など）は、Mac の定期実行がこの返事を読んでから行う。
 */

const ACTION_LABELS: Record<OpsAction, string> = {
  deploy: '本番に反映する',
  skip: '見送る',
  comment: 'コメントだけ送る',
};

const page = (title: string, inner: string, status = 200) => new Response(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#f6f7f9;color:#1f2937;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin:0 0 16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin:12px 0}
pre{white-space:pre-wrap;word-break:break-word;font:14px/1.7 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;margin:0}
button{display:block;width:100%;min-height:52px;border:0;border-radius:12px;font-size:17px;font-weight:700;margin:10px 0;cursor:pointer}
.deploy{background:#2563eb;color:#fff}.skip{background:#e5e7eb;color:#111827}.comment{background:#fff;color:#2563eb;border:1px solid #93c5fd}
textarea{width:100%;box-sizing:border-box;min-height:96px;border:1px solid #d1d5db;border-radius:10px;padding:10px;font-size:16px}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;background:#eef2ff;color:#3730a3}
</style></head><body><main>${inner}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const invalidPage = (reason: string) => page('リンクが使えません', `<h1>このリンクは使えません</h1><p class="sub">${reason === 'expired' ? '有効期限（3日）が切れました。次の報告のリンクから返事をしてください。' : 'リンクが正しくありません。'}</p>`, 400);

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t') || '';
  const verified = verifyDecisionToken(token);
  if (!verified.ok) return invalidPage(verified.reason);
  const db = adminDb();
  const [reportSnap, decisionSnap] = await Promise.all([
    db.collection(OPS_REPORTS).doc(verified.reportId).get(),
    db.collection(OPS_DECISIONS).doc(verified.reportId).get(),
  ]);
  if (!reportSnap.exists) return invalidPage('invalid');
  const report = reportSnap.data() || {};
  const decision = decisionSnap.data();
  const actions: OpsAction[] = report.fix_branch ? ['deploy', 'skip', 'comment'] : ['comment'];
  const form = decision
    ? `<div class="card"><p><span class="badge">返事済み</span> ${escapeHtml(ACTION_LABELS[decision.action as OpsAction] || decision.action)}</p>${decision.comment ? `<pre>${escapeHtml(decision.comment)}</pre>` : ''}${decision.result_message ? `<p class="sub">結果：${escapeHtml(decision.result_message)}</p>` : '<p class="sub">Mac が15分ごとに読み、順に対応します。</p>'}</div>`
    : `<form method="post" class="card">
        <input type="hidden" name="t" value="${escapeHtml(token)}">
        <label for="comment" class="sub">コメント（任意。指示や質問をどうぞ）</label>
        <textarea id="comment" name="comment" maxlength="1000" placeholder="例：今日の授業が終わってから反映して"></textarea>
        ${actions.map(action => `<button type="submit" name="action" value="${action}" class="${action}">${ACTION_LABELS[action]}</button>`).join('')}
        ${report.fix_branch ? '<p class="sub">「本番に反映する」は、Mac がテストをし直してから出します（KDLの修正は含めません）。結果はまた知らせます。</p>' : ''}
      </form>`;
  return page(`点検 ${report.id}`, `
    <h1>${escapeHtml(report.title)}</h1>
    <p class="sub">ClassBase 毎日の点検 ${escapeHtml(report.id)}</p>
    ${report.summary ? `<div class="card"><pre>${escapeHtml(report.summary)}</pre></div>` : ''}
    ${report.fix_branch ? `<div class="card"><p><span class="badge">修正の準備あり</span></p><pre>${escapeHtml(report.fix_summary || report.fix_branch)}</pre></div>` : ''}
    ${form}
    <details class="card"><summary>報告の全文</summary><pre>${escapeHtml(report.body)}</pre></details>`);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get('t') || '');
  const action = String(form?.get('action') || '') as OpsAction;
  const comment = String(form?.get('comment') || '').trim().slice(0, 1000);
  const verified = verifyDecisionToken(token);
  if (!verified.ok) return invalidPage(verified.reason);
  if (!OPS_ACTIONS.includes(action)) return page('選び直してください', '<h1>選び直してください</h1>', 400);
  if (action === 'comment' && !comment) return page('コメントが空です', '<h1>コメントを入れてから送ってください</h1><p class="sub">ブラウザの「戻る」で前の画面に戻れます。</p>', 400);

  const db = adminDb();
  const reportSnap = await db.collection(OPS_REPORTS).doc(verified.reportId).get();
  if (!reportSnap.exists) return invalidPage('invalid');
  const report = reportSnap.data() || {};
  if (action === 'deploy' && !report.fix_branch) return page('反映するものがありません', '<h1>この報告には、反映する修正がありません</h1>', 400);

  const ref = db.collection(OPS_DECISIONS).doc(verified.reportId);
  const created = await db.runTransaction(async transaction => {
    if ((await transaction.get(ref)).exists) return false;
    transaction.create(ref, {
      report_id: verified.reportId,
      action,
      comment,
      fix_branch: report.fix_branch || null,
      status: 'pending',
      decided_at: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!created) return page('返事済みです', '<h1>この報告には、もう返事をしています</h1><p class="sub">返事は1回だけ受け付けます。</p>');
  return page('受け付けました', `<h1>受け付けました</h1><p>「${escapeHtml(ACTION_LABELS[action])}」で受け付けました。</p><p class="sub">Mac が15分以内に読み、対応したらまた知らせます。</p>`);
}
