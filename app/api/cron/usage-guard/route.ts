import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runUsageGuard } from '@/lib/server/usage-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Vercel Cron（1時間ごと）：Vercel の使用額から月末の見込みを出し、節約モードを切り替える（lib/server/usage-guard.ts）。 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runUsageGuard()) });
  } catch (error) {
    console.error('[cron usage-guard] failed', error);
    return Response.json({ ok: false, error: 'usage-guard-failed' }, { status: 500 });
  }
}
