import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { currentUsageLevel } from '@/lib/server/usage-guard';
import { shouldSkipInSavingMode } from '@/lib/usage-guard';
import { runMissedClassNotifications } from '@/lib/server/auto-notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 授業の未参加の通知。各時限の開始から10分たった時限だけを処理し、時限ごとに1日1回だけ送る（何度呼んでも重ならない）。
 * Vercel Cron（Pro プラン）で、日本時間19時〜22時台に5分ごとに呼ぶ（vercel.json："*\/5 10-13 * * *"、UTC）。
 * 各時限の開始10分後から5分以内に届く。
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    // 節約モードでは15分ごとにする（通知そのものは止めない）。
    if (shouldSkipInSavingMode('missed_class', await currentUsageLevel(), new Date())) {
      return Response.json({ ok: true, skipped: 'usage-saving' });
    }
    return Response.json({ ok: true, ...(await runMissedClassNotifications()) });
  } catch (error) {
    console.error('[cron missed-class] failed', error);
    return Response.json({ ok: false, error: 'missed-class-failed' }, { status: 500 });
  }
}
