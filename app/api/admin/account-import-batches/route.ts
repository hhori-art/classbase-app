import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireMaster } from '@/lib/server-auth';

export const runtime = 'nodejs';

const COLLECTION = 'account_import_batches';
const ALLOWED_ROLES = new Set(['student', 'teacher', 'master']);

function safeText(value: unknown, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeUserIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => safeText(item, 160)).filter(Boolean))).slice(0, 5000);
}

function serializeBatch(id: string, data: FirebaseFirestore.DocumentData) {
  const importedAt = data.imported_at?.toDate?.();
  return {
    id,
    file_name: safeText(data.file_name),
    role: ALLOWED_ROLES.has(String(data.role)) ? String(data.role) : 'student',
    user_ids: safeUserIds(data.user_ids),
    success_count: Number(data.success_count || 0),
    error_count: Number(data.error_count || 0),
    errors: Array.isArray(data.errors) ? data.errors.map((item: unknown) => safeText(item, 300)).slice(0, 20) : [],
    imported_at: importedAt instanceof Date ? importedAt.toISOString() : safeText(data.imported_at),
    imported_by: safeText(data.imported_by),
    source: safeText(data.source) || 'master_users',
    school: safeText(data.school),
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    const schoolFilter = safeText(request.nextUrl.searchParams.get('school'), 160);
    const sourceFilter = safeText(request.nextUrl.searchParams.get('source'), 80);
    if (actor.role !== 'master') {
      if (!schoolFilter || !canManageSchool(actor, schoolFilter)) throw new Error('forbidden');
    }

    const snapshot = await adminDb()
      .collection(COLLECTION)
      .orderBy('imported_at', 'desc')
      .limit(250)
      .get();

    const batches = snapshot.docs
      .map(doc => serializeBatch(doc.id, doc.data()))
      .filter(batch => !schoolFilter || batch.school === schoolFilter)
      .filter(batch => !sourceFilter || batch.source === sourceFilter)
      .slice(0, 100);

    return Response.json({
      ok: true,
      batches,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const body = await request.json();

    const role = safeText(body.role, 40);
    const fileName = safeText(body.file_name, 240);
    const userIds = safeUserIds(body.user_ids);
    if (!fileName) return Response.json({ ok: false, error: 'file_name is required' }, { status: 400 });
    if (!ALLOWED_ROLES.has(role)) return Response.json({ ok: false, error: 'invalid role' }, { status: 400 });

    const requestedBatchId = safeText(body.batch_id, 120).replace(/[^a-zA-Z0-9_-]/g, '');
    const ref = requestedBatchId
      ? adminDb().collection(COLLECTION).doc(requestedBatchId)
      : adminDb().collection(COLLECTION).doc();
    await ref.set({
      file_name: fileName,
      role,
      user_ids: userIds,
      success_count: Math.max(0, Number(body.success_count || userIds.length)),
      error_count: Math.max(0, Number(body.error_count || 0)),
      errors: Array.isArray(body.errors) ? body.errors.map((item: unknown) => safeText(item, 300)).filter(Boolean).slice(0, 20) : [],
      imported_at: FieldValue.serverTimestamp(),
      imported_by: actor.uid,
      source: 'master_users',
      school: '',
    });

    const saved = await ref.get();
    return Response.json({ ok: true, batch: serializeBatch(ref.id, saved.data() || {}) });
  } catch (error) {
    return jsonError(error);
  }
}
