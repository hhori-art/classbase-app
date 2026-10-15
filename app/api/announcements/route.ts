import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { canReadAnnouncement, cleanAnnouncementList, serializeAnnouncement } from '@/lib/server/announcement-access';
import { ATTENDANCE_SCHOOL_DIRECTORY, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';

export const runtime = 'nodejs';
const TARGETS = new Set(['all', 'student', 'parent', 'teacher', 'admin']);
const LABELS = new Set(['important', 'event', 'info', 'alert']);
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const clean = (value: unknown, max: number) => String(value || '').normalize('NFKC').trim().slice(0, max);
const safeName = (name: string) => name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'attachment';
const normalizeSchoolIds = (value: unknown) => {
  const source = cleanAnnouncementList(value).slice(0, 50);
  const normalized = source.map(resolveAttendanceSchoolCode);
  return normalized.some((value, index) => !value && source[index])
    ? { ok: false as const, values: [], invalid: source.filter((_, index) => !normalized[index]) }
    : { ok: true as const, values: Array.from(new Set(normalized.filter(Boolean))), invalid: [] };
};
const parsePublishDate = (value: string) => {
  if (!value) return new Date();
  // datetime-local はタイムゾーンを持たないため、管理画面の入力を日本時間として固定する。
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return new Date(`${value.length === 16 ? `${value}:00` : value}+09:00`);
  return new Date(value);
};

async function audienceUser(user: any) {
  if (!['parent', 'guardian'].includes(user.role)) return user;
  const db = adminDb();
  const ids = cleanAnnouncementList(user.profile?.student_ids).slice(0, 20);
  const students = ids.length ? await db.getAll(...ids.map(id => db.collection('users').doc(id))) : [];
  return { ...user,
    linked_schools: students.flatMap(student => { const data = student.data() || {}; return [data.school_id, data.school_code, data.school].filter(Boolean); }),
    linked_grades: students.map(student => student.data()?.grade).filter(Boolean),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const db = adminDb();
    if (request.nextUrl.searchParams.get('manage') === '1') {
      requireMaster(user);
      const [snapshot, configDocs] = await Promise.all([
        db.collection('announcements').orderBy('created_at', 'desc').limit(100).get(),
        db.getAll(db.collection('settings').doc('announcement_config')),
      ]);
      const config = configDocs[0];
      return Response.json({
        ok: true,
        announcements: snapshot.docs.map(serializeAnnouncement),
        templates: config.data()?.templates || [],
        groups: config.data()?.groups || [],
        schools: ATTENDANCE_SCHOOL_DIRECTORY,
      });
    }
    const id = clean(request.nextUrl.searchParams.get('id'), 160);
    const max = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 30) || 30, 1), 100);
    const viewer = await audienceUser(user);
    if (id) {
      const snapshot = await db.collection('announcements').doc(id).get();
      if (!snapshot.exists) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      const announcement = serializeAnnouncement(snapshot);
      if (!canReadAnnouncement(viewer, announcement)) throw new Error('forbidden');
      const receipt = db.collection('announcement_reads').doc(`${id}_${user.uid}`);
      await db.runTransaction(async transaction => {
        const existing = await transaction.get(receipt);
        if (existing.exists) return;
        transaction.create(receipt, { announcement_id: id, user_id: user.uid, role: user.role, read_at: FieldValue.serverTimestamp() });
        transaction.update(snapshot.ref, { read_count: FieldValue.increment(1) });
      });
      return Response.json({ ok: true, announcement });
    }
    const snapshot = await db.collection('announcements').orderBy('created_at', 'desc').limit(300).get();
    return Response.json({ ok: true, announcements: snapshot.docs.map(serializeAnnouncement).filter(item => canReadAnnouncement(viewer, item)).slice(0, max) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  const uploaded: string[] = [];
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const action = clean(body.action, 40);
      if (!['save_template', 'save_group', 'delete_template', 'delete_group'].includes(action)) return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
      const groupSchools = action === 'save_group' ? normalizeSchoolIds(body.school_ids) : null;
      if (groupSchools && !groupSchools.ok) return Response.json({ ok: false, error: `存在しない校舎が含まれています: ${groupSchools.invalid.join(', ')}` }, { status: 400 });
      const db = adminDb();
      const ref = db.collection('settings').doc('announcement_config');
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.data() || {};
        if (action.includes('template')) {
          let items = Array.isArray(data.templates) ? data.templates : [];
          if (action === 'delete_template') items = items.filter((item: any) => item.id !== clean(body.id, 80));
          else {
            const item = { id: clean(body.id, 80) || crypto.randomUUID(), name: clean(body.name, 80), title: clean(body.title, 120), content: clean(body.content, 5000), label: LABELS.has(body.label) ? body.label : 'info' };
            if (!item.name || !item.content) throw new Error('template-name-and-content-required');
            items = [...items.filter((existing: any) => existing.id !== item.id), item].slice(-30);
          }
          transaction.set(ref, { templates: items, updated_at: FieldValue.serverTimestamp() }, { merge: true });
        } else {
          let items = Array.isArray(data.groups) ? data.groups : [];
          if (action === 'delete_group') items = items.filter((item: any) => item.id !== clean(body.id, 80));
          else {
            const item = { id: clean(body.id, 80) || crypto.randomUUID(), name: clean(body.name, 80), target: TARGETS.has(body.target) ? body.target : 'all', school_ids: groupSchools?.values || [], grades: cleanAnnouncementList(body.grades).slice(0, 30) };
            if (!item.name) throw new Error('group-name-required');
            items = [...items.filter((existing: any) => existing.id !== item.id), item].slice(-30);
          }
          transaction.set(ref, { groups: items, updated_at: FieldValue.serverTimestamp() }, { merge: true });
        }
      });
      return Response.json({ ok: true });
    }

    const form = await request.formData();
    const title = clean(form.get('title'), 120), content = clean(form.get('content'), 5000);
    const target = clean(form.get('target'), 30) || 'all', label = clean(form.get('label'), 30) || 'info';
    const normalizedSchools = normalizeSchoolIds(form.get('school_ids'));
    const schoolIds = normalizedSchools.values, grades = cleanAnnouncementList(form.get('grades')).slice(0, 30);
    const publishText = clean(form.get('publish_at'), 80), publishDate = parsePublishDate(publishText);
    const files = form.getAll('files').filter((item): item is File => item instanceof File && item.size > 0);
    if (!title || !content) return Response.json({ ok: false, error: 'タイトルと本文を入力してください' }, { status: 400 });
    if (!TARGETS.has(target) || !LABELS.has(label)) return Response.json({ ok: false, error: '配信先またはラベルが不正です' }, { status: 400 });
    if (!normalizedSchools.ok) return Response.json({ ok: false, error: `存在しない校舎が含まれています: ${normalizedSchools.invalid.join(', ')}` }, { status: 400 });
    if (Number.isNaN(publishDate.getTime())) return Response.json({ ok: false, error: '配信日時が不正です' }, { status: 400 });
    if (files.length > 3) return Response.json({ ok: false, error: '添付ファイルは3件までです' }, { status: 400 });
    if (files.some(file => file.size > 10 * 1024 * 1024 || !FILE_TYPES.has(file.type))) return Response.json({ ok: false, error: '添付はPDF・画像・Word・Excel、1件10MBまでです' }, { status: 400 });
    const db = adminDb(), ref = db.collection('announcements').doc();
    const attachments = [];
    for (const file of files) {
      const attachmentId = crypto.randomUUID(), path = `announcement_attachments/${ref.id}/${attachmentId}-${safeName(file.name)}`;
      await adminBucket().file(path).save(Buffer.from(await file.arrayBuffer()), { resumable: false, metadata: { contentType: file.type, cacheControl: 'private,max-age=300' } });
      uploaded.push(path);
      attachments.push({ id: attachmentId, name: clean(file.name, 160), content_type: file.type, size: file.size, path });
    }
    await ref.create({ title, content, target, label, school_ids: schoolIds, grades, attachments,
      publish_at: Timestamp.fromDate(publishDate), status: publishDate.getTime() > Date.now() ? 'scheduled' : 'published',
      read_count: 0, archived: false, created_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    await Promise.all(uploaded.map(path => adminBucket().file(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireMaster(user);
    const id = clean((await request.json()).id, 160);
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    try {
      await adminDb().collection('announcements').doc(id).update({ archived: true, archived_by: user.uid, archived_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === '5' || code === 'not-found') return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
