import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runDedicatedReportReminders, runWorkDetailReminders } from '@/lib/server/auto-notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Vercel Cron（毎朝8時台）：前日と3日前の勤務で、勤務詳細が未登録の講師へ知らせる。専任の月の報告書・一括申請の案内も一緒に送る。 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runWorkDetailReminders();
    const dedicated = await runDedicatedReportReminders().catch(error => {
      console.error('[cron dedicated-report-reminders] failed', error);
      return { error: 'dedicated-report-reminders-failed' };
    });
    return Response.json({ ok: true, ...result, dedicated });
  } catch (error) {
    console.error('[cron work-detail-reminders] failed', error);
    return Response.json({ ok: false, error: 'work-detail-reminders-failed' }, { status: 500 });
  }
}
