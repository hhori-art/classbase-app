import 'server-only';
import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/server/password-recovery';
import { performLogin } from '@/lib/server/login-service';
import { monitorLoginResponses } from '@/lib/server/security-login-monitor';

/** ログインの API（生徒・講師・保護者用と、管理者用）。成功したらログイン用のトークンを返す。 */
export function loginRoute(options: { adminOnly: boolean }) {
  const handler = async (request: Request) => {
    try {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const result = await performLogin({
        login: body.login ?? body.lifetimeId,
        password: body.password,
        ip: getClientIp(request),
        adminOnly: options.adminOnly,
      });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error, ...(result.retryAfterSeconds ? { retry_after_seconds: result.retryAfterSeconds } : {}) },
          { status: result.status, headers: result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : undefined },
        );
      }
      return NextResponse.json({ ok: true, token: result.token, role: result.role });
    } catch (error: any) {
      // 中身は記録だけに残し、画面には決まった理由だけを返す。
      console.error(JSON.stringify({ level: 'error', message: 'login failed', error: String(error?.message || error).slice(0, 300) }));
      // Firebase 自身が、パスワード違いの続いたアカウントを一時的に止めたとき（診断環境では1分ほどで解けた）。
      // こちらのロックではないので、校舎での解除では解けない。待ち時間を付けて返す。
      if (error?.message === 'too-many-attempts') {
        return NextResponse.json({ ok: false, error: 'too-many-attempts', retry_after_seconds: 60 }, { status: 429, headers: { 'Retry-After': '60' } });
      }
      if (error?.message === 'account-inactive') return NextResponse.json({ ok: false, error: 'account-inactive' }, { status: 403 });
      return NextResponse.json({ ok: false, error: 'server-error' }, { status: 500 });
    }
  };
  // ログインの失敗・ロックでの拒否を、攻撃の監視（lib/server/security-events.ts）に記録する。
  return monitorLoginResponses(handler, body => body.login ?? body.lifetimeId);
}
