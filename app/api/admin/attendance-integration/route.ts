import { NextRequest } from 'next/server';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';
import {
  getExternalAttendanceStatus,
  syncExternalAttendance,
  testExternalAttendanceConnection,
} from '@/lib/server/external-attendance-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

function monthRange(raw: string) {
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : todayJst().slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(year, number, 0).getDate();
  return { month, start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function requireManager(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (!canManageAttendance(user)) throw new Error('forbidden');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireManager(user);
    const { month, start, end } = monthRange(String(request.nextUrl.searchParams.get('month') || ''));
    return Response.json({ ok: true, month, ...(await getExternalAttendanceStatus(start, end)) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireManager(user);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'test_connection') {
      return Response.json({ ok: true, result: await testExternalAttendanceConnection() });
    }
    if (action === 'sync') {
      const { month, start, end } = monthRange(String(body.month || ''));
      const result = await syncExternalAttendance({ start, end, forceFull: Boolean(body.force_full), requestedBy: user.uid });
      return Response.json({ ok: true, month, result });
    }
    return Response.json({ ok: false, error: 'unsupported-action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
