import { NextRequest } from 'next/server';
import { externalAttendanceConfigStatus, syncExternalAttendance } from '@/lib/server/external-attendance-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || '');
  const supplied = String(request.headers.get('authorization') || '');
  if (!expected || supplied !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const status = externalAttendanceConfigStatus();
  if (!status.enabled || !status.configured) {
    return Response.json({ ok: true, skipped: true, reason: status.enabled ? 'not-configured' : 'sync-disabled' });
  }

  try {
    const today = todayJst();
    const startDate = new Date(`${today}T00:00:00+09:00`);
    startDate.setDate(startDate.getDate() - 45);
    const start = new Date(startDate.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await syncExternalAttendance({ start, end: today, requestedBy: 'vercel-cron' });
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
