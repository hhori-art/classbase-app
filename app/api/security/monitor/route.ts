import { NextRequest } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { currentUsageLevel } from '@/lib/server/usage-guard';
import { shouldSkipInSavingMode } from '@/lib/usage-guard';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { runSecurityMonitor } from '@/lib/server/security-monitor';

export const runtime = 'nodejs';

const hoursOf = (request: NextRequest, fallback: number) => {
  const value = Number(request.nextUrl.searchParams.get('hours'));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Vercel Cron から呼ぶ攻撃の監視（5分ごとに hours=1 で直近1時間、毎朝7時に直近24時間）。 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const hours = hoursOf(request, 24);
    // 5分ごとの確認は、節約モードでは1時間ごとにする（毎朝の1日分の確認は続ける）。
    if (hours < 24 && shouldSkipInSavingMode('security_monitor_frequent', await currentUsageLevel(), new Date())) {
      return Response.json({ ok: true, skipped: 'usage-saving' });
    }
    const result = await runSecurityMonitor({ hours });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('[security-monitor] failed', error);
    return Response.json({ ok: false, error: 'monitor-failed' }, { status: 500 });
  }
}

/** マスターが「今すぐ確認」したいときに手動で実行する。 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (user.role !== 'master') throw new Error('forbidden');
    // ?test_email=1 のときは、見つかったものがなくても通知メールのテストを送る。
    const result = await runSecurityMonitor({ hours: hoursOf(request, 24), testEmail: request.nextUrl.searchParams.get('test_email') === '1' });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
