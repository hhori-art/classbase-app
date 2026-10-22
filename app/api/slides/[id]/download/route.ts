import { NextRequest } from 'next/server';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);
    if (!id || id.length > 200 || id.includes('/')) {
      return Response.json({ ok: false, error: 'invalid-id' }, { status: 400 });
    }

    const snap = await adminDb().collection('lesson_slides').doc(id).get();
    if (!snap.exists) return Response.json({ ok: false, error: 'not-found' }, { status: 404 });

    const data = snap.data() || {};
    const filePath = String(data.file_path || '');
    if (!filePath || !filePath.startsWith('lesson_slides/') || filePath.includes('..')) {
      return Response.json({ ok: false, error: 'file-not-found' }, { status: 404 });
    }

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
