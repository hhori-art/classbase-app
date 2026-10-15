import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const status = request.nextUrl.searchParams.get('status') || 'all';
    if (!['all', 'open', 'answered'].includes(status)) return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    const snap = await adminDb().collection('parent_inquiries').orderBy('created_at', 'desc').limit(150).get();
    const inquiries = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => user.role === 'master' || canManageSchool(user, String(item.school_id || item.school_name || '')))
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
    if (status === 'answered' && !response) return Response.json({ ok: false, error: 'response is required' }, { status: 400 });

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
      messages.push({ sender_role: 'staff', sender_id: user.uid, sender_name: user.profile.name || user.profile.teacher_name || '担当者', text: response, created_at_iso: new Date().toISOString() });
      transaction.update(ref, {
        response: response || null,
        messages,
        message_count: FieldValue.increment(1),
        status,
        responded_by: user.uid,
        responded_by_name: user.profile.name || user.profile.student_name || '管理者',
        responded_at: response ? FieldValue.serverTimestamp() : null,
        unread_for_admin: false,
        unread_for_parent: status === 'answered',
        updated_at: FieldValue.serverTimestamp(),
      });
      if (status === 'answered') {
        transaction.set(db.collection('user_notifications').doc(`parent_inquiry_answered_${id}`), {
          user_id: parentId,
          role: 'parent',
          title: 'お問い合わせへの回答が届きました',
          message: response.slice(0, 500),
          kind: 'parent_inquiry_answered',
          inquiry_id: id,
          read: false,
          updated_at: FieldValue.serverTimestamp(),
          created_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { found: true };
    });
    if (!result.found) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
