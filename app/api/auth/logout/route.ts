import { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

// ログアウト（KDL診断 B.3.1）。このアカウントのログインをサーバーで取り消し、前のトークンでは操作できなくする。
// 取り消すと、ほかの端末のログインも切れる（報告会で了承済み）。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    await adminAuth().revokeRefreshTokens(user.uid);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
