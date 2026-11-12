import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runBetaSchoolReport } from '@/lib/server/beta-school-report';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Vercel Cron（毎朝8時台）：βテスト校（112・132・147）の前日の利用状況をメールで送る。2026年11月21日まで。 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runBetaSchoolReport();
    // 1通も送れなかったときは失敗として返す（Vercel の記録で気づけるように）。
    const failed = 'sent' in result && result.sent === 0;
    if (failed) console.error('[cron beta-report] no email sent', 'error' in result ? result.error : result.errors);
    return Response.json({ ok: !failed, ...result, body: undefined }, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error('[cron beta-report] failed', error);
    return Response.json({ ok: false, error: 'beta-report-failed' }, { status: 500 });
  }
}
