import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runBetaSchoolReport } from '@/lib/server/beta-school-report';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Vercel Cron（毎朝8時台）：βテスト校（112・132・147）の前日の利用状況をメールで送る。2026年11月21日まで。 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runBetaSchoolReport();
    return Response.json({ ok: true, ...result, body: undefined });
  } catch (error) {
    console.error('[cron beta-report] failed', error);
    return Response.json({ ok: false, error: 'beta-report-failed' }, { status: 500 });
  }
}
