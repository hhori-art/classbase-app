import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageShifts, getServerUser, isAdminLike, jsonError, requireMaster, type ServerUser } from '@/lib/server-auth';
import { AUDIT_LOG_COLLECTION, writeAuditLog } from '@/lib/server/audit-log';
import { isAuditAction, isClientReportedAuditAction, type ClientReportedAuditAction } from '@/app/components/master/audit-log-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);

/** 画面からの記録依頼を受け付ける人。シフト配置の解除は専任の勤怠承認者も行う。 */
function canReport(user: ServerUser, action: ClientReportedAuditAction) {
  if (user.role === 'master' || isAdminLike(user)) return true;
  return action === 'shift_unassign' && canManageShifts(user);
}

/**
 * 画面から直接 Firestore に書く操作（シフト解除・依頼の削除など）を、操作が成功した後に記録する。
 * 操作した人はサーバーで確認したログイン中の利用者を使い、送られてきた名前やIDは使わない。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (!isClientReportedAuditAction(action)) return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    if (!canReport(user, action)) throw new Error('forbidden');
    const targetType = clean(body.target_type, 60);
    const targetId = clean(body.target_id, 300);
    if (!targetType || !targetId) return Response.json({ ok: false, error: 'target is required' }, { status: 400 });
    const details = body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {};
    const saved = await writeAuditLog({
      actor: user,
      action,
      target_type: targetType,
      target_id: targetId,
      target_label: clean(body.target_label, 200),
      school_id: clean(body.school_id, 60) || null,
      details,
      reported_by_client: true,
    });
    if (!saved) return Response.json({ ok: false, error: 'audit log could not be saved' }, { status: 500 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** 操作ログの一覧（マスターだけ）。新しい順に50件ずつ。操作の種類・操作した人・期間で絞り込む。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const params = request.nextUrl.searchParams;
    const action = clean(params.get('action'), 60);
    const actorId = clean(params.get('actor_id'), 200);
    const from = clean(params.get('from'), 10);
    const to = clean(params.get('to'), 10);
    if (action && !isAuditAction(action)) return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    if (actorId.includes('/')) return Response.json({ ok: false, error: 'invalid actor' }, { status: 400 });
    if ((from && !DATE_KEY.test(from)) || (to && !DATE_KEY.test(to))) return Response.json({ ok: false, error: 'invalid date' }, { status: 400 });

    const collection = adminDb().collection(AUDIT_LOG_COLLECTION);
    let query: FirebaseFirestore.Query = collection;
    if (action) query = query.where('action', '==', action);
    if (actorId) query = query.where('actor_id', '==', actorId);
    // 期間は日本時間の日付で受け取る。
    if (from) query = query.where('created_at', '>=', new Date(`${from}T00:00:00+09:00`));
    if (to) query = query.where('created_at', '<=', new Date(`${to}T23:59:59.999+09:00`));
    query = query.orderBy('created_at', 'desc');
    const cursorId = clean(params.get('cursor'), 200);
    if (cursorId && !cursorId.includes('/')) {
      const cursor = await collection.doc(cursorId).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }
    const snap = await query.limit(PAGE_SIZE).get();
    const logs = snap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        action: String(data.action || ''),
        // 以前からの記録は actor_uid・metadata の形式なので合わせて読む。
        actor_id: String(data.actor_id || data.actor_uid || ''),
        actor_name: String(data.actor_name || ''),
        actor_role: String(data.actor_role || ''),
        target_type: String(data.target_type || ''),
        target_id: data.target_id || null,
        target_label: data.target_label || null,
        school_id: data.school_id || null,
        details: [data.details, data.metadata].find(value => value && typeof value === 'object') || {},
        reported_by_client: data.reported_by_client === true,
        created_at: iso(data.created_at),
      };
    });
    return Response.json({
      ok: true,
      logs,
      next_cursor: snap.size === PAGE_SIZE ? snap.docs.at(-1)?.id || null : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
