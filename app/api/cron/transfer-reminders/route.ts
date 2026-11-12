import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runParentMonthlyReportNotices, runTransferReminders } from '@/lib/server/auto-notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Vercel Cron（毎夕18時台）：欠席の2日後・7日後に、振替を選んでいない生徒と保護者へ知らせる。毎月1日は保護者へ前の月のレポートの案内も送る。 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runTransferReminders();
    const parentReport = await runParentMonthlyReportNotices().catch(error => {
      console.error('[cron parent-monthly-report] failed', error);
      return { error: 'parent-monthly-report-failed' };
    });
    return Response.json({ ok: true, ...result, parentReport });
  } catch (error) {
    console.error('[cron transfer-reminders] failed', error);
    return Response.json({ ok: false, error: 'transfer-reminders-failed' }, { status: 500 });
  }
}
