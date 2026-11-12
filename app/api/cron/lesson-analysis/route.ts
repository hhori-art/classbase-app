import { isAuthorizedCronRequest } from '@/lib/server/cron-auth';
import { runLessonAnalyses } from '@/lib/server/lesson-analysis';
import { jstDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Vercel Cron：授業の振り返りを作る。
 *  - 23:20（カメラの記録のあと）にその日の授業。
 *  - 翌10:40（?yesterday=1）に前の日の授業。文字起こしが夜のうちに届かなかった授業を拾う。
 * ?date=YYYY-MM-DD でその日を作り直せる。
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const requested = String(params.get('date') || '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested)
    ? requested
    : params.get('yesterday') === '1' ? jstDateKey(new Date(Date.now() - 86_400_000)) : undefined;
  try {
    return Response.json({ ok: true, ...(await runLessonAnalyses({ date })) });
  } catch (error) {
    console.error('[cron lesson-analysis] failed', (error as Error)?.message);
    return Response.json({ ok: false, error: 'lesson-analysis-failed' }, { status: 500 });
  }
}
