import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { normalizeRole, type ServerUser } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { queuePushToUsers, webPushConfig } from '@/lib/server/web-push';
import {
  announcementLinkedStudentIds, announcementRoleTargets, canReadAnnouncement, cleanAnnouncementList, serializeAnnouncement, withAnnouncementLinkedStudents,
} from '@/lib/server/announcement-access';

// お知らせを配信した時に、対象者の登録済み端末へも知らせる（Web Push だけ。user_notifications は作らない）。
// 対象者の判定はお知らせ一覧と同じ canReadAnnouncement を使う。1件のお知らせにつき1回だけ送る。

/** 端末への通知を既定でオンにするラベル（重要・緊急）。 */
export const ANNOUNCEMENT_PUSH_DEFAULT_LABELS = new Set(['important', 'alert']);
/** 1件のお知らせで端末へ知らせる上限人数。 */
export const MAX_ANNOUNCEMENT_PUSH_RECIPIENTS = 2000;
/** 役割ごとに読む利用者の上限（全校の生徒数より十分大きい値）。 */
const MAX_SCAN_PER_ROLE = 5000;
const PUSH_CHUNK = 500; // sendPushToUsers が1回で扱う人数の上限
const INACTIVE = ['suspended', 'withdrawn', 'archived'];
const USER_FIELDS = [
  'role', 'school', 'school_id', 'school_code', 'school_name', 'school_ids', 'attendance_school_ids',
  'grade', 'student_ids', 'account_status', 'status',
];

/**
 * 通知を開いた時に表示するお知らせの画面がある役割だけに送る。
 * 校舎管理者・マスター・勤怠管理者はお知らせを読む画面がないため送らない。
 */
const AUDIENCES = [
  { key: 'student', roles: ['student'], newsBase: '/student/news' },
  { key: 'parent', roles: ['parent', 'guardian'], newsBase: '/parent/news' },
  { key: 'teacher', roles: ['teacher'], newsBase: '/teacher/news' },
] as const;
type AudienceKey = typeof AUDIENCES[number]['key'];

export type AnnouncementPushResult =
  | { status: 'sent'; recipients: number; by_role: Record<string, number>; truncated: boolean }
  | { status: 'already-notified' | 'disabled' | 'not-found' | 'not-published' };

const clip = (value: unknown, max: number) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function announcementPushMessage(announcement: { title?: unknown; label?: unknown }) {
  return {
    title: `お知らせ：${clip(announcement.title, 40)}`,
    body: announcement.label === 'alert'
      ? '緊急のお知らせがあります。アプリで内容を確認してください。'
      : '新しいお知らせがあります。アプリで内容を確認してください。',
  };
}

/** フォームの「端末にも通知する」。未指定なら重要・緊急のときだけオン。 */
export function wantsAnnouncementPush(value: unknown, label: string) {
  const text = String(value ?? '').trim();
  if (text === '1' || text === 'true' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'off') return false;
  return ANNOUNCEMENT_PUSH_DEFAULT_LABELS.has(label);
}

const isPublished = (announcement: Record<string, unknown>) => {
  if (announcement.archived === true || announcement.is_active === false) return false;
  const raw = announcement.publish_at as any;
  const publishAt = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
  return !publishAt || Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= Date.now();
};

/** getServerUser と同じ形の閲覧者（canReadAnnouncement が見る項目だけ）。 */
function viewerFrom(id: string, data: FirebaseFirestore.DocumentData) {
  const schoolIds = Array.isArray(data.school_ids) ? data.school_ids : Array.isArray(data.attendance_school_ids) ? data.attendance_school_ids : [];
  return {
    uid: id,
    role: normalizeRole(data.role),
    school: data.school_name || data.school || data.school_id || data.school_code || '',
    school_ids: schoolIds,
    profile: data,
  };
}

async function scanUsers(roles: readonly string[]) {
  const snap = await adminDb().collection('users').where('role', 'in', [...roles]).select(...USER_FIELDS).limit(MAX_SCAN_PER_ROLE).get();
  return {
    full: snap.docs.length >= MAX_SCAN_PER_ROLE,
    users: snap.docs
      .map(doc => ({ id: doc.id, data: doc.data() || {} }))
      .filter(item => !INACTIVE.some(status => item.data.account_status === status || item.data.status === status)),
  };
}

/** お知らせの対象者（お知らせ一覧と同じ判定）。役割ごとに上限付きで読み、合計 MAX_ANNOUNCEMENT_PUSH_RECIPIENTS 人まで。 */
export async function announcementPushRecipients(announcement: Record<string, any>) {
  const target = String(announcement.target || 'all').trim() || 'all';
  const narrowed = cleanAnnouncementList(announcement.school_ids || announcement.target_school_ids || announcement.school_id || announcement.target_school_id).length > 0
    || cleanAnnouncementList(announcement.grades || announcement.target_grades || announcement.grade || announcement.target_grade).length > 0;
  const audiences = AUDIENCES.filter(audience => (announcementRoleTargets[audience.key] || []).includes(target));
  const scanned = new Map<AudienceKey, Awaited<ReturnType<typeof scanUsers>>>();
  for (const audience of audiences) scanned.set(audience.key, await scanUsers(audience.roles));
  // 校舎・学年で絞る時は、保護者を紐づく生徒の校舎・学年でも判定する（生徒はまとめて1回だけ読む）。
  if (narrowed && scanned.has('parent') && !scanned.has('student')) scanned.set('student', await scanUsers(['student']));
  const students = new Map((scanned.get('student')?.users || []).map(item => [item.id, item.data]));

  const byAudience: Partial<Record<AudienceKey, string[]>> = {};
  let total = 0;
  let truncated = false;
  for (const audience of audiences) {
    const result = scanned.get(audience.key);
    if (!result) continue;
    if (result.full) truncated = true;
    for (const item of result.users) {
      const base = viewerFrom(item.id, item.data);
      const viewer = withAnnouncementLinkedStudents(base, announcementLinkedStudentIds(base).map(id => students.get(id)));
      if (!canReadAnnouncement(viewer, announcement)) continue;
      if (total >= MAX_ANNOUNCEMENT_PUSH_RECIPIENTS) { truncated = true; break; }
      (byAudience[audience.key] ||= []).push(item.id);
      total++;
    }
  }
  return { byAudience, total, truncated };
}

/**
 * お知らせを対象者の端末へ知らせる。1件につき1回だけ（push_notified_at を先に記録してから送る）。
 * VAPID の鍵が未設定なら何も記録せず disabled を返す（鍵を設定した後に送り直せる）。
 * 呼び出し元でマスターであることを確認しておくこと。
 */
export async function notifyAnnouncementPush(announcementId: string, actor: ServerUser): Promise<AnnouncementPushResult> {
  if (!webPushConfig()) return { status: 'disabled' };
  const db = adminDb();
  const ref = db.collection('announcements').doc(announcementId);
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return 'not-found' as const;
    const data = snapshot.data() || {};
    if (data.push_notified_at) return 'already-notified' as const;
    if (!isPublished(data)) return 'not-published' as const;
    transaction.update(ref, { push_notified_at: FieldValue.serverTimestamp(), push_notified_by: actor.uid });
    return snapshot;
  });
  if (typeof claimed === 'string') return { status: claimed };

  const announcement = serializeAnnouncement(claimed) as Record<string, any>;
  let recipients: Awaited<ReturnType<typeof announcementPushRecipients>>;
  try {
    recipients = await announcementPushRecipients(announcement);
  } catch (error) {
    // まだ1件も送っていないため、送り直せるように記録を戻す。
    await ref.update({ push_notified_at: FieldValue.delete(), push_notified_by: FieldValue.delete() }).catch(() => undefined);
    throw error;
  }

  const message = announcementPushMessage(announcement);
  const byRole: Record<string, number> = {};
  for (const audience of AUDIENCES) {
    const ids = recipients.byAudience[audience.key] || [];
    if (!ids.length) continue;
    byRole[audience.key] = ids.length;
    const link = `${audience.newsBase}/${encodeURIComponent(announcementId)}`;
    for (let index = 0; index < ids.length; index += PUSH_CHUNK) {
      queuePushToUsers(ids.slice(index, index + PUSH_CHUNK), { ...message, link }, { kind: 'announcement' });
    }
  }
  await ref.update({ push_recipient_count: recipients.total }).catch(() => undefined);
  await writeAuditLog({
    actor, action: 'announcement_push', target_type: 'announcement', target_id: announcementId, target_label: String(announcement.title || ''),
    details: { recipients: recipients.total, by_role: byRole, truncated: recipients.truncated, label: announcement.label || null },
  });
  return { status: 'sent', recipients: recipients.total, by_role: byRole, truncated: recipients.truncated };
}
