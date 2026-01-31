import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 常に許可するパス
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('favicon.ico') ||
    pathname === '/403' ||
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  // --- IPアドレス取得ロジック ---
  let ip = '127.0.0.1';
  
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIp = request.headers.get('x-real-ip');

  if (xForwardedFor) {
    // プロキシ経由の場合、カンマ区切りの先頭がクライアントIP
    ip = xForwardedFor.split(',')[0].trim();
  } else if (xRealIp) {
    ip = xRealIp;
  } else if ((request as any).ip) {
    ip = (request as any).ip;
  }

  // IPv6射影アドレス (::ffff:192.168.1.1) 対策
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // 環境変数から許可IPリストを取得
  const allowedIps = (process.env.ALLOWED_IPS || '').split(',').map(i => i.trim());
  
  // ローカルIPまたは許可リストに含まれるか判定
  const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
  const isInternalNetwork = isLocal || allowedIps.includes(ip);

  // ★重要: デバッグ用ログ (本番運用時は削除してください)
  // サーバーのコンソール(ターミナル)を確認し、ここに表示された IP を .env に追加してください
  console.log(`[Middleware] Path: ${pathname}`);
  console.log(`[Middleware] Detected IP: ${ip}`);
  console.log(`[Middleware] Is Internal?: ${isInternalNetwork}`);

  // 判定結果をヘッダーにセット
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-is-internal', isInternalNetwork ? 'true' : 'false');

  // --- アクセス制御 ---

  // A. 管理者 (/master) は社外アクセス完全禁止
  if (pathname.startsWith('/master')) {
    if (!isInternalNetwork) {
      console.log(`Blocked Master Access: IP ${ip}`);
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  // B. 先生 (/teacher) は一部のみ社外アクセス許可
  if (pathname.startsWith('/teacher')) {
    if (isInternalNetwork) {
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }

    // 社外からのアクセス許可リスト
    const allowedTeacherPaths = [
      '/teacher',             
      '/teacher/settings',    
      '/teacher/work',        
      '/teacher/attendance',  
      '/teacher/chat',        
      '/teacher/shifts',      
    ];

    // 現在のパスが許可リストのいずれかに該当するか (サブパス含む)
    const isAllowedPath = allowedTeacherPaths.some(path => 
      pathname === path || pathname.startsWith(`${path}/`)
    );

    if (!isAllowedPath) {
      console.log(`Blocked Teacher Restricted Access: IP ${ip} -> ${pathname}`);
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    '/teacher/:path*',
    '/master/:path*',
  ],
};