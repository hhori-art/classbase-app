import { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { repairUserProfileForAuth } from '@/lib/account-repair';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return Response.json({ ok: false, error: 'missing-token' }, { status: 401 });

    const decoded = await adminAuth().verifyIdToken(token);
    const result = await repairUserProfileForAuth(decoded.uid, decoded.email || null);
    if (!result.ok) return Response.json(result, { status: 404 });
    return Response.json(result);
  } catch (error: any) {
    console.error('[repair-profile] error:', error);
    return Response.json({ ok: false, error: error?.message || 'repair failed' }, { status: 400 });
  }
}
