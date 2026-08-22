import { NextRequest } from 'next/server';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    if (!['teacher', 'admin', 'master'].includes(user.role)) throw new Error('forbidden');

    const snap = await adminDb().collection('lesson_slides').doc(params.id).get();
    if (!snap.exists) return Response.json({ ok: false, error: 'not-found' }, { status: 404 });

    const data = snap.data() || {};
    const filePath = String(data.file_path || '');
    if (!filePath) return Response.json({ ok: false, error: 'file-not-found' }, { status: 404 });

    const [url] = await adminBucket().file(filePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 5 * 60 * 1000,
      responseDisposition: `attachment; filename="${encodeURIComponent(String(data.file_name || 'lesson.pptx'))}"`,
    });

    return Response.json({ ok: true, url });
  } catch (error) {
    return jsonError(error);
  }
}
