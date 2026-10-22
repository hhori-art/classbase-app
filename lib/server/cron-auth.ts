import 'server-only';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Vercel Cron からの呼び出しか確認する。Vercel は環境変数 CRON_SECRET が設定されていると
 * `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ。CRON_SECRET が未設定なら常に拒否する（値は32文字以上のランダム文字列を推奨）。
 */
export function isAuthorizedCronRequest(request: Request) {
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret) return false;
  const supplied = String(request.headers.get('authorization') || '');
  // 長さの違いで比較時間が変わらないよう、ハッシュ同士を比べる。
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`));
}
