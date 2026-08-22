import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

type Payload = {
  filters?: {
    grade?: string;
    science?: string;
    social?: string;
    day?: string;
    classroom?: string;
  };
  zoom_url?: string;
  zoom_url_2?: string;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const body = await request.json().catch(() => ({})) as Payload;
    const filters = body.filters || {};
    const updates: Record<string, string> = {};
    if (body.zoom_url) updates.zoom_url = String(body.zoom_url).trim();
    if (body.zoom_url_2) updates.zoom_url_2 = String(body.zoom_url_2).trim();
    if (!updates.zoom_url && !updates.zoom_url_2) throw new Error('missing-url');

    let q: FirebaseFirestore.Query = adminDb().collection('users').where('role', '==', 'student');
    if (filters.grade) q = q.where('grade', '==', filters.grade);
    if (filters.science) q = q.where('science_subject', '==', filters.science);
    if (filters.social) q = q.where('social_subject', '==', filters.social);
    if (filters.day) q = q.where('day_of_week', '==', filters.day);
    if (filters.classroom) q = q.where('classroom', '==', filters.classroom);

    const snap = await q.get();
    if (snap.empty) return Response.json({ ok: true, updated: 0 });

    let batch = adminDb().batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.set(doc.ref, {
        ...updates,
        zoom_url_updated_at: new Date().toISOString(),
        zoom_url_updated_by: user.uid,
      }, { merge: true });
      count += 1;
      if (count % 450 === 0) {
        await batch.commit();
        batch = adminDb().batch();
      }
    }
    if (count % 450 !== 0) await batch.commit();

    return Response.json({ ok: true, updated: count });
  } catch (error) {
    return jsonError(error);
  }
}
