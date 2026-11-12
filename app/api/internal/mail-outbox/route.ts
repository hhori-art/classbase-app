import { claimOutbox, reportOutbox, verifyGasRequest } from '@/lib/server/gas-mail';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Google Apps Script（docs/gas-mail-sender.gs）専用：送るメールの取り出しと、送った結果の報告。
 * GAS_MAIL_SECRET で作った署名（5分以内）がなければ 401。ログインのしくみは使わない。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const payload = verifyGasRequest(body || {});
  if (!payload) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const remaining = Number(payload.remaining);
  try {
    if (payload.action === 'claim') {
      const mails = await claimOutbox(Number(payload.limit) || 20, Number.isFinite(remaining) ? remaining : 0);
      return Response.json({ ok: true, mails }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (payload.action === 'report') {
      const updated = await reportOutbox(Array.isArray(payload.results) ? payload.results : [], remaining);
      return Response.json({ ok: true, updated });
    }
    return Response.json({ ok: false, error: 'unknown-action' }, { status: 400 });
  } catch (error) {
    console.error('[mail-outbox] failed', error);
    return Response.json({ ok: false, error: 'mail-outbox-failed' }, { status: 500 });
  }
}
