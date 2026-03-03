import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function getClientIp(request: NextRequest) {
  // Vercel/Proxy: x-forwarded-for が基本
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIp = request.headers.get('x-real-ip');

  let ip = '';

  if (xForwardedFor) {
    ip = xForwardedFor.split(',')[0].trim();
  } else if (xRealIp) {
    ip = xRealIp.trim();
  } else if ((request as any).ip) {
    ip = String((request as any).ip);
  }

  // IPv6 mapped IPv4: ::ffff:1.2.3.4
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  // IPv6 loopback
  if (ip === '::1') return '127.0.0.1';

  return ip || '0.0.0.0';
}

function parseAllowedIps(envValue: string | undefined) {
  return (envValue || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean); // ★ '' を除外
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 403ページは必ず許可（ループ防止にもなる）
  if (pathname === '/403') return NextResponse.next();

  const ip = getClientIp(request);
  const allowedIps = parseAllowedIps(process.env.ALLOWED_IPS);

  const isLocal = ip === '127.0.0.1' || ip === 'localhost';
  const isInternalNetwork = isLocal || allowedIps.includes(ip);

  // 判定結果ヘッダ
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-is-internal', isInternalNetwork ? 'true' : 'false');
  requestHeaders.set('x-client-ip', ip);

  // --- アクセス制御 ---
  // 管理者 (/master) は社外アクセス禁止
  if (pathname.startsWith('/master')) {
    if (!isInternalNetwork) {
      // 必要ならここだけログ（本番ログ肥大化防止）
      console.log(`[Middleware] Blocked /master from IP: ${ip}`);
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  // 先生 (/teacher) は一部のみ社外アクセス許可
  if (pathname.startsWith('/teacher')) {
    if (!isInternalNetwork) {
      const allowedTeacherPaths = [
        '/teacher',
        '/teacher/settings',
        '/teacher/work',
        '/teacher/attendance',
        '/teacher/chat',
        '/teacher/shifts',
      ];

      const isAllowedPath = allowedTeacherPaths.some(p => pathname === p || pathname.startsWith(`${p}/`));
      if (!isAllowedPath) {
        console.log(`[Middleware] Blocked restricted /teacher from IP: ${ip} -> ${pathname}`);
        return NextResponse.redirect(new URL('/403', request.url));
      }
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/teacher/:path*', '/master/:path*'],
};