import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { queuePushToUsers } from '@/lib/server/web-push';

export const runtime = 'nodejs';

const PAGE_SIZE = 100;

const staffDisplayName = (profile: FirebaseFirestore.DocumentData) =>
  String(profile.name || profile.display_name || profile.teacher_name || profile.admin_name || '').trim() || '教室担当者';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const status = request.nextUrl.searchParams.get('status') || 'all';
    if (!['all', 'open', 'answered'].includes(status)) return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    // 更新が新しいスレッド（保護者の追加返信を含む）を先頭に、1ページ PAGE_SIZE 件ずつ読む。
    const db = adminDb();
    const collection = db.collection('parent_inquiries');
    let query: FirebaseFirestore.Query = status === 'all' ? collection : collection.where('status', '==', status);
    query = query.orderBy('updated_at', 'desc');
    const cursorId = String(request.nextUrl.searchParams.get('cursor') || '').trim().slice(0, 200);
    if (cursorId && !cursorId.includes('/')) {
      const cursor = await collection.doc(cursorId).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }
    const snap = await query.limit(PAGE_SIZE).get();
    const inquiries = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => user.role === 'master' || canManageSchool(user, String(item.school_id || item.school_name || '')))
      .filter((item: any) => status === 'all' || item.status === status);
    const nextCursor = snap.size === PAGE_SIZE ? snap.docs.at(-1)?.id || null : null;
    return Response.json({ ok: true, inquiries, next_cursor: nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const body = await request.json();
    const action = String(body.action || 'reply');
    const id = String(body.id || '');
    const response = String(body.response || '').trim();
    const status = String(body.status || (response ? 'answered' : 'open'));
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    if (!['reply', 'mark_read'].includes(action)) return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    if (!['open', 'answered'].includes(status)) return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    if (response.length > 5000) return Response.json({ ok: false, error: 'response is too long' }, { status: 400 });
    if (action === 'reply' && !response) return Response.json({ ok: false, error: 'response is required' }, { status: 400 });

    const db = adminDb();
    const ref = db.collection('parent_inquiries').doc(id);
    const result = await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return { found: false };
      const inquiry = snap.data() || {};
      if (user.role !== 'master' && !canManageSchool(user, String(inquiry.school_id || inquiry.school_name || ''))) throw new Error('forbidden');
      if (action === 'mark_read') {
        transaction.update(ref, { unread_for_admin: false, admin_read_at: FieldValue.serverTimestamp() });
        return { found: true };
      }
      const parentId = String(inquiry.parent_id || '').trim();
      if (!parentId) throw new Error('inquiry-parent-not-found');
      const messages = Array.isArray(inquiry.messages) ? inquiry.messages.slice(-99) : [{ sender_role: 'parent', sender_id: parentId, sender_name: inquiry.parent_name || '保護者', text: String(inquiry.content || ''), created_at_iso: new Date().toISOString() }];
      const staffName = staffDisplayName(user.profile);
      messages.push({ sender_role: 'staff', sender_id: user.uid, sender_name: staffName, text: response, created_at_iso: new Date().toISOString() });
      transaction.update(ref, {
        response: response || null,
        messages,
        message_count: FieldValue.increment(1),
        status,
        responded_by: user.uid,
        responded_by_name: staffName,
        responded_at: FieldValue.serverTimestamp(),
        unread_for_admin: false,
        unread_for_parent: true,
        updated_at: FieldValue.serverTimestamp(),
      });
      // 1スレッド1件の通知を最新の返信で上書きし、未読に戻す（返信のたびに通知が増えすぎないようにする）。
      transaction.set(db.collection('user_notifications').doc(`parent_inquiry_answered_${id}`), {
        user_id: parentId,
        role: 'parent',
        title: `教室から返信が届きました：${String(inquiry.subject || 'お問い合わせ').slice(0, 60)}`,
        message: response.slice(0, 500),
        kind: 'parent_inquiry_answered',
        inquiry_id: id,
        link: '/parent/contact',
        read: false,
        read_at: null,
        updated_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { found: true, inquiry };
    });
    if (!result.found) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    if (action === 'reply' && 'inquiry' in result && result.inquiry) {
      await writeAuditLog({
        actor: user,
        action: 'parent_inquiry_reply',
        target_type: 'parent_inquiry',
        target_id: id,
        target_label: String(result.inquiry.subject || result.inquiry.parent_name || ''),
        school_id: String(result.inquiry.school_id || result.inquiry.school_name || ''),
        details: { status, response_length: response.length },
      });
      // 端末通知には件名・返信内容を出さない。
      const parentId = String(result.inquiry.parent_id || '').trim();
      if (parentId) queuePushToUsers([parentId], { title: '教室から返信が届きました', body: 'アプリで内容を確認してください。', link: '/parent/contact' }, { kind: 'parent_inquiry_answered' });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
