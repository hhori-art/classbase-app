import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!['master', 'admin', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin'].includes(user.role)) throw new Error('forbidden');
    const status = request.nextUrl.searchParams.get('status') || 'all';
    const snap = await adminDb().collection('parent_inquiries').orderBy('created_at', 'desc').limit(150).get();
    const inquiries = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => status === 'all' || item.status === status)
      .slice(0, 100);
    return Response.json({ ok: true, inquiries });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!['master', 'admin', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin'].includes(user.role)) throw new Error('forbidden');
    const body = await request.json();
    const id = String(body.id || '');
    const response = String(body.response || '').trim();
    const status = String(body.status || (response ? 'answered' : 'open'));
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });

    await adminDb().collection('parent_inquiries').doc(id).set({
      response: response || null,
      status,
      responded_by: user.uid,
      responded_by_name: user.profile.name || user.profile.student_name || '管理者',
      responded_at: response ? FieldValue.serverTimestamp() : null,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
