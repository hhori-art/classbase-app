import { loginRoute } from '@/lib/server/login-route';

export const runtime = 'nodejs';

export const POST = loginRoute({ adminOnly: false });
