import { NextRequest } from 'next/server';
import { recordSecurityEvent } from '@/lib/server/security-events';

export const runtime = 'nodejs';

/**
 * 脆弱性を探る不審なアクセス（.php、wp-admin、.env など）の受け口。
 * middleware がこのURLへ振り替える。記録だけして、通常の「見つかりません」を返す（何も読まない）。
 */
async function handle(request: NextRequest) {
  const original = String(request.headers.get('x-probe-path') || request.nextUrl.pathname).slice(0, 200);
  recordSecurityEvent({ kind: 'probe', request, path: original });
  return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;
