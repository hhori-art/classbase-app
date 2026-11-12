import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isProbePath } from '@/lib/security-probe';
import { isIpRestrictedPath } from '@/lib/admin-ip-restriction';

function getClientIp(request: NextRequest) {
  // Vercel が付与するヘッダーを優先し、一般的なProxyヘッダーへフォールバックする。
  const xVercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIp = request.headers.get('x-real-ip');

  let ip = '';

  if (xVercelForwardedFor) {
    ip = xVercelForwardedFor.split(',')[0].trim();
  } else if (xForwardedFor) {
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

// API の応答は個人情報を含むため保存させない（next.config.mjs の headers と同じ値。どちらかが外れても効くよう二重にする）。
function withApiNoStore<T extends Response>(response: T, pathname: string): T {
  if (pathname === '/api' || pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  return withApiNoStore(handle(request, pathname), pathname);
}

function handle(request: NextRequest, pathname: string) {
  if (pathname !== '/api/security/probe' && isProbePath(pathname)) {
    const headers = new Headers(request.headers);
    headers.set('x-probe-path', pathname);
    return NextResponse.rewrite(new URL('/api/security/probe', request.url), { request: { headers } });
  }

  // 403ページは必ず許可（ループ防止にもなる）
  if (pathname === '/403') return NextResponse.next();

  const ip = getClientIp(request);
  const allowedIps = parseAllowedIps(process.env.ALLOWED_IPS);

  const isLocal = ip === '127.0.0.1' || ip === 'localhost';
  const isInternalNetwork = isLocal || allowedIps.includes(ip);
  const isSecurityDiagnosis = process.env.SECURITY_DIAGNOSIS_MODE === 'true';

  // 判定結果ヘッダ
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-is-internal', isInternalNetwork ? 'true' : 'false');
  requestHeaders.set('x-client-ip', ip);

  // --- アクセス制御 ---
  // 外部診断環境では、診断会社の許可IPとローカル接続以外を全画面・APIで遮断する。
  // 通常環境では無効なので、既存の公開画面には影響しない。
  if (isSecurityDiagnosis && !isInternalNetwork) {
    console.log(`[Middleware] Blocked security diagnosis access from IP: ${ip} -> ${pathname}`);
    return NextResponse.redirect(new URL('/403', request.url));
  }

  // 管理者・教室管理の画面と API は、許可ネットワーク（ALLOWED_IPS）以外から遮断する。
  // 生徒・保護者・ログイン・勤怠は対象外（lib/admin-ip-restriction.ts）。ALLOWED_IPS 未設定の環境では全員を締め出さないよう無効。
  if (!isInternalNetwork && allowedIps.length > 0 && isIpRestrictedPath(pathname)) {
    console.log(`[Middleware] Blocked admin access from outside network: ${ip} -> ${pathname}`);
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: 'ip_restricted', message: '管理機能は、教室・オフィスのネットワークからだけ使えます。' },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL('/403', request.url));
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // 公開静的ファイルは Function を起動せず CDN から配信する。
  // 画面と API は従来どおり対象にし、診断環境の全体 IP 制限も維持する。
  // 拡張子付きの不審なアクセス（.php など）も監視のため対象にする（実在する静的ファイルの拡張子は含めない）。
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)',
    '/((?:.*)\\.(?:php\\d?|phtml|asp|aspx|jsp|cgi|pl|env|ini|sql|bak|old|swp|git|svn|htaccess|htpasswd|DS_Store)(?:/.*)?)',
    '/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|cgi-bin|\\.git|\\.env)(.*)',
  ],
};
