import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runCameraTimeRecords } from '@/lib/server/zoom-camera-time';

export const runtime = 'nodejs';
// Zoom のダッシュボードを授業の数だけ読むので、60秒では足りない（11/9 に時間切れ）。
export const maxDuration = 300;

/**
 * Vercel Cron（毎晩22時50分）：今日の授業でカメラがオンだった分数を Zoom から読み、記録する（続けてオフの声かけ・先生ごとのON率に使う）。
 * ?date=YYYY-MM-DD でその日を処理し直せる（記録は上書き）。?dry=1 は読むだけで書かない。
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const date = String(params.get('date') || '');
  try {
    const result = await runCameraTimeRecords({
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      dryRun: params.get('dry') === '1',
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron camera-time] failed', error);
    return Response.json({ ok: false, error: 'camera-time-failed' }, { status: 500 });
  }
}
