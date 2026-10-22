import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { announcementLinkedStudentIds, canReadAnnouncement, cleanAnnouncementList, serializeAnnouncement, withAnnouncementLinkedStudents } from '@/lib/server/announcement-access';
import { notifyAnnouncementPush, wantsAnnouncementPush, type AnnouncementPushResult } from '@/lib/server/announcement-push';
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
  const ids = announcementLinkedStudentIds(user);
  if (!ids.length) return withAnnouncementLinkedStudents(user, []);
  const db = adminDb();
  const students = await db.getAll(...ids.map(id => db.collection('users').doc(id)));
  return withAnnouncementLinkedStudents(user, students.map(student => student.data()));
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
      if (action === 'notify_push') {
        // 予約配信が始まった後や、配信時に通知しなかったお知らせを後から端末へ知らせる（1件につき1回だけ）。
        const id = clean(body.id, 160);
        if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
        const push = await notifyAnnouncementPush(id, user);
        if (push.status === 'not-found') return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        if (push.status === 'not-published') return Response.json({ ok: false, error: '配信前・取り下げ済みのお知らせは端末に通知できません' }, { status: 409 });
        return Response.json({ ok: true, push });
      }
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
    const pushRequested = wantsAnnouncementPush(form.get('push'), label);
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
      read_count: 0, archived: false, push_requested: pushRequested, created_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    // 端末への通知は補助的な経路のため、失敗してもお知らせの配信は成功として返す。
    // 予約配信は配信時刻を過ぎてから一覧の「端末に通知」で送る（cron で決まった時刻に送る仕組みはない）。
    let push: AnnouncementPushResult | { status: 'not-requested' | 'scheduled' | 'failed' } = { status: pushRequested ? 'scheduled' : 'not-requested' };
    if (pushRequested && publishDate.getTime() <= Date.now()) {
      push = await notifyAnnouncementPush(ref.id, user).catch(error => {
        console.warn('[announcements] push failed', error instanceof Error ? error.message : 'unknown');
        return { status: 'failed' as const };
      });
    }
    return Response.json({ ok: true, id: ref.id, push });
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
    await writeAuditLog({ actor: user, action: 'announcement_archive', target_type: 'announcement', target_id: id });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
