import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ★ 1. 制限の「対象外」にするパスを最初に定義
  // 静的ファイル(画像、favicon、/_next など)と、拒否画面(/403)は常に許可
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('favicon.ico') ||
    pathname === '/403' ||
    pathname === '/' // トップページも一旦許可
  ) {
    return NextResponse.next();
  }

  // ★ 2. 制限をかけたいパス（先生・マスター用）
  const isRestrictedPath = pathname.startsWith('/master') || pathname.startsWith('/teacher');

  if (isRestrictedPath) {
    // アクセス元のIPを取得
    let ip = (request as any).ip || request.headers.get('x-forwarded-for') || '127.0.0.1';
    if (ip.includes(',')) ip = ip.split(',')[0].trim();

    const allowedIps = (process.env.ALLOWED_IPS || '').split(',');
    const isLocal = ip === '::1' || ip === '127.0.0.1';

    // 許可リストになければ /403 へ飛ばす
    if (!isLocal && !allowedIps.includes(ip)) {
      console.log(`Blocked: IP ${ip} tried to access ${pathname}`);
      // 絶対URLでリダイレクト
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  return NextResponse.next();
}

// ミドルウェアを適用する範囲を絞る（パフォーマンス向上）
export const config = {
  matcher: [
    /*
     * /teacher, /master 配下のすべてのページに適用
     */
    '/teacher/:path*',
    '/master/:path*',
  ],
};