import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { normalizeReplyTemplateInput, REPLY_TEMPLATE_MAX_COUNT } from '@/lib/reply-templates';

export const runtime = 'nodejs';

// 教室への連絡の「返信のひな形」。マスターだけが読み書きする（firestore.rules ではクライアントから直接触れない）。
const COLLECTION = 'reply_templates';

const validId = (value: unknown) => {
  const id = String(value ?? '').trim();
  return id && id.length <= 200 && !id.includes('/') ? id : '';
};

const serialize = (doc: FirebaseFirestore.DocumentSnapshot) => {
  const data = doc.data() || {};
  return { id: doc.id, title: String(data.title || ''), body: String(data.body || ''), updated_at: String(data.updated_at_iso || '') || null };
};

export async function GET(request: NextRequest) {
  try {
    requireMaster(await getServerUser(request));
    const snap = await adminDb().collection(COLLECTION).limit(REPLY_TEMPLATE_MAX_COUNT).get();
    const templates = snap.docs.map(serialize).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    return Response.json({ ok: true, templates, max: REPLY_TEMPLATE_MAX_COUNT });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const input = normalizeReplyTemplateInput(await request.json().catch(() => ({})));
    if (!input.ok) return Response.json({ ok: false, error: input.error }, { status: 400 });
    const collection = adminDb().collection(COLLECTION);
    const existing = await collection.limit(REPLY_TEMPLATE_MAX_COUNT).get();
    if (existing.size >= REPLY_TEMPLATE_MAX_COUNT) {
      return Response.json({ ok: false, error: `ひな形は${REPLY_TEMPLATE_MAX_COUNT}件までです。使わないものを削除してください。` }, { status: 400 });
    }
    const now = new Date().toISOString();
    const ref = await collection.add({
      title: input.title,
      body: input.body,
      created_by: user.uid,
      updated_by: user.uid,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      updated_at_iso: now,
    });
    return Response.json({ ok: true, template: { id: ref.id, title: input.title, body: input.body, updated_at: now } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const body = await request.json().catch(() => ({}));
    const id = validId(body.id);
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    const input = normalizeReplyTemplateInput(body);
    if (!input.ok) return Response.json({ ok: false, error: input.error }, { status: 400 });
    const ref = adminDb().collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    const now = new Date().toISOString();
    await ref.update({ title: input.title, body: input.body, updated_by: user.uid, updated_at: FieldValue.serverTimestamp(), updated_at_iso: now });
    return Response.json({ ok: true, template: { id, title: input.title, body: input.body, updated_at: now } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireMaster(await getServerUser(request));
    const id = validId(request.nextUrl.searchParams.get('id'));
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    const ref = adminDb().collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    await ref.delete();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
