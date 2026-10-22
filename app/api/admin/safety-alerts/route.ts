import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError, type ServerUser } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'in_progress', 'resolved'] as const;
const PAGE_SIZE = 50;

/** マスターは全件。理社講座管理者は校舎が分かる担当校舎のアラートだけ。 */
function canSeeAlert(user: ServerUser, alert: FirebaseFirestore.DocumentData) {
  if (user.role === 'master') return true;
  const school = String(alert.school_id || alert.school_name || '').trim();
  return Boolean(school) && canManageSchool(user, school);
}

const staffDisplayName = (profile: FirebaseFirestore.DocumentData) =>
  String(profile.name || profile.display_name || profile.teacher_name || profile.admin_name || '').trim() || '管理者';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const status = request.nextUrl.searchParams.get('status') || 'active';
    if (!['active', 'all', ...STATUSES].includes(status)) return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    const collection = adminDb().collection('safety_alerts');
    let query: FirebaseFirestore.Query = status === 'all'
      ? collection
      : status === 'active'
        ? collection.where('status', 'in', ['open', 'in_progress'])
        : collection.where('status', '==', status);
    query = query.orderBy('created_at', 'desc');
    const cursorId = String(request.nextUrl.searchParams.get('cursor') || '').trim().slice(0, 200);
    if (cursorId && !cursorId.includes('/')) {
      const cursor = await collection.doc(cursorId).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }
    const snap = await query.limit(PAGE_SIZE).get();
    const alerts = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .filter(alert => canSeeAlert(user, alert));
    return Response.json({
      ok: true,
      alerts,
      next_cursor: snap.size === PAGE_SIZE ? snap.docs.at(-1)?.id || null : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    const status = String(body.status || '').trim();
    const memo = body.memo === undefined ? undefined : String(body.memo || '').trim();
    if (!id || id.includes('/') || id.length > 200) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    if (!(STATUSES as readonly string[]).includes(status)) return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    if (memo !== undefined && memo.length > 2000) return Response.json({ ok: false, error: 'memo is too long' }, { status: 400 });

    const db = adminDb();
    const ref = db.collection('safety_alerts').doc(id);
    let previous: FirebaseFirestore.DocumentData = {};
    const found = await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return false;
      previous = snap.data() || {};
      if (!canSeeAlert(user, previous)) throw new Error('forbidden');
      transaction.update(ref, {
        status,
        ...(memo !== undefined ? { memo } : {}),
        handled_by: user.uid,
        handled_by_name: staffDisplayName(user.profile),
        resolved_at: status === 'resolved' ? FieldValue.serverTimestamp() : null,
        updated_at: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!found) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    await writeAuditLog({
      actor: user,
      action: 'safety_alert_status',
      target_type: 'safety_alert',
      target_id: id,
      target_label: String(previous.student_name || ''),
      school_id: String(previous.school_id || previous.school_name || ''),
      details: { status, previous_status: String(previous.status || ''), memo_changed: memo !== undefined },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
