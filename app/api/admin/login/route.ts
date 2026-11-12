import { loginRoute } from '@/lib/server/login-route';

export const runtime = 'nodejs';

// 管理者のログイン（/admin/login）。管理系のアカウントだけ通す。社内の回線からだけ使える（middleware.ts）。
export const POST = loginRoute({ adminOnly: true });
