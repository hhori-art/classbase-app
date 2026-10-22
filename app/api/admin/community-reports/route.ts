import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 交流掲示板の通報（community_reports）。掲示板の管理画面（マスター専用）から確認して、対応済み・問題なしにする。
const STATUSES = ['open', 'resolved', 'dismissed'] as const;
type ReportStatus = typeof STATUSES[number];

const iso = (value: any) => value?.toDate?.()?.toISOString?.() || null;

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const status = request.nextUrl.searchParams.get('status') === 'all' ? 'all' : 'open';
    const collection = adminDb().collection('community_reports');
    const snap = await (status === 'all' ? collection.orderBy('created_at', 'desc') : collection.where('status', '==', 'open').orderBy('created_at', 'desc'))
      .limit(100)
      .get();
    // 同じ投稿への通報はまとめて、件数と理由を並べる。
    const groups = new Map<string, any>();
    snap.docs.forEach(doc => {
      const data = doc.data() || {};
      const key = `${data.target_type}:${data.target_id}`;
      const group = groups.get(key) || {
        key,
        target_type: data.target_type,
        target_id: data.target_id,
        topic_id: data.topic_id,
        comment_id: data.comment_id || null,
        excerpt: data.target_excerpt || '',
        reasons: [] as string[],
        report_ids: [] as string[],
        status: data.status || 'open',
        latest_at: iso(data.created_at),
      };
      group.report_ids.push(doc.id);
      if (data.reason_label && !group.reasons.includes(data.reason_label)) group.reasons.push(data.reason_label);
      groups.set(key, group);
    });
    return Response.json({ ok: true, groups: Array.from(groups.values()) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const body = await request.json().catch(() => ({}));
    const status = String(body.status || '') as ReportStatus;
    const ids = (Array.isArray(body.report_ids) ? body.report_ids : []).map(String).filter((id: string) => id && !id.includes('/')).slice(0, 50);
    if (!STATUSES.includes(status) || status === 'open' || ids.length === 0) {
      return Response.json({ ok: false, error: 'invalid request' }, { status: 400 });
    }
    const db = adminDb();
    const refs = ids.map((id: string) => db.collection('community_reports').doc(id));
    const snaps = await db.getAll(...refs);
    const existing = snaps.filter(snap => snap.exists);
    if (existing.length === 0) return Response.json({ ok: false, error: 'report not found' }, { status: 404 });
    const batch = db.batch();
    existing.forEach(snap => batch.set(snap.ref, {
      status,
      handled_by: user.uid,
      handled_at: FieldValue.serverTimestamp(),
    }, { merge: true }));
    await batch.commit();
    const first = existing[0].data() || {};
    await writeAuditLog({
      actor: user,
      action: 'community_report_review',
      target_type: 'community_report',
      target_id: String(first.target_id || ''),
      target_label: String(first.target_excerpt || '').slice(0, 80),
      details: { status, report_count: existing.length },
    });
    return Response.json({ ok: true, updated: existing.length });
  } catch (error) {
    return jsonError(error);
  }
}
