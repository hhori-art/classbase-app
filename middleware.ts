import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 制限対象のパスかどうか判定
  // 生徒用(/student)やトップページ(/)は対象外
  const isRestrictedPath = pathname.startsWith('/master') || pathname.startsWith('/teacher');

  if (isRestrictedPath) {
    // 2. アクセス元のIPアドレスを取得
    // 型エラー回避のため (request as any).ip としています
    let ip = (request as any).ip || request.headers.get('x-forwarded-for') || '127.0.0.1';

    // 複数のIPが含まれる場合（プロキシ経由など）、最初の1つを取得
    if (ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }

    // 環境変数から許可リストを取得
    const allowedIps = (process.env.ALLOWED_IPS || '').split(',');

    // ローカル開発環境(localhost)は常に許可する (::1 はIPv6のlocalhost)
    const isLocal = ip === '::1' || ip === '127.0.0.1';

    // 3. IPチェック
    if (!isLocal && !allowedIps.includes(ip)) {
      console.warn(`Blocked access from IP: ${ip} to ${pathname}`);
      
      // 許可されていない場合は「アクセス拒否ページ」へリダイレクト
      return NextResponse.redirect(new URL('/403', request.url));
    }
  }

  return NextResponse.next();
}

// ミドルウェアを適用するパスの設定
export const config = {
  matcher: [
    // /master と /teacher 配下のすべてのルートに適用
    '/master/:path*',
    '/teacher/:path*',
  ],
};