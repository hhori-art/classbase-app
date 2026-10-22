import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runMissedClassNotifications } from '@/lib/server/auto-notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 授業の未参加の通知。各時限の開始から10分たった時限だけを処理し、時限ごとに1日1回だけ送る（何度呼んでも重ならない）。
 * 無料プランの Vercel Cron は1日1回・1時間の幅でしか起動できないため、20時台・21時台・22時台の3回呼んでいる。
 * 有料プランに切り替えたら vercel.json を 5分ごと（例："*\/5 10-12 * * *"、UTC）の1本にすると、開始10分後に届く。
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runMissedClassNotifications()) });
  } catch (error) {
    console.error('[cron missed-class] failed', error);
    return Response.json({ ok: false, error: 'missed-class-failed' }, { status: 500 });
  }
}
