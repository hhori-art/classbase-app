import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { canReadAnnouncement, cleanAnnouncementList, serializeAnnouncement } from '@/lib/server/announcement-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 保護者ホームの「ご対応のお願い」に出す、教室からの返信の未読数と、まだ読んでいない重要・緊急のお知らせ。
// どちらも本人の分だけを上限つきで読む。
const URGENT_LABELS = new Set(['important', 'alert']);
const ANNOUNCEMENT_SCAN = 50;
const ANNOUNCEMENT_MAX = 3;
const ANNOUNCEMENT_WINDOW_DAYS = 30;
const INQUIRY_FALLBACK_SCAN = 30;

const clean = (value: unknown, max = 200) => String(value || '').normalize('NFKC').trim().slice(0, max);

/** 教室から返信があり、まだ開いていない連絡の数（parent_id と unread_for_parent の等価条件だけなので複合インデックスは不要）。 */
async function unreadReplyCount(db: FirebaseFirestore.Firestore, parentId: string) {
  const unread = db.collection('parent_inquiries').where('parent_id', '==', parentId).where('unread_for_parent', '==', true);
  try {
    const snap = await unread.count().get();
    return Number(snap.data().count) || 0;
  } catch (error) {
    console.warn('[parent/home-summary] unread count fallback', error);
    const snap = await unread.limit(INQUIRY_FALLBACK_SCAN).get();
    return snap.docs.filter(doc => doc.data()?.parent_id === parentId && doc.data()?.unread_for_parent === true).length;
  }
}

/** 重要・緊急のお知らせのうち、この保護者が読める・まだ開いていない新しいもの（最大3件）。 */
async function unreadUrgentNews(db: FirebaseFirestore.Firestore, user: Awaited<ReturnType<typeof getServerUser>>) {
  // お知らせの宛先（校舎・学年）は、つながっているお子さまの情報で判定する（/api/announcements と同じ）。
  const ids = cleanAnnouncementList(user.profile?.student_ids).slice(0, 20);
  const [students, snapshot] = await Promise.all([
    ids.length ? db.getAll(...ids.map(id => db.collection('users').doc(id))) : Promise.resolve([]),
    db.collection('announcements').orderBy('created_at', 'desc').limit(ANNOUNCEMENT_SCAN).get(),
  ]);
  const viewer = {
    ...user,
    linked_schools: students.flatMap(student => { const data = student.data() || {}; return [data.school_id, data.school_code, data.school].filter(Boolean); }),
    linked_grades: students.map(student => student.data()?.grade).filter(Boolean),
  };
  const since = Date.now() - ANNOUNCEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const candidates = snapshot.docs
    .map(serializeAnnouncement)
    .filter((item: any) => URGENT_LABELS.has(clean(item.label, 30)))
    .filter((item: any) => {
      const time = Date.parse(String(item.publish_at || item.created_at || ''));
      return !Number.isFinite(time) || time >= since;
    })
    .filter(item => canReadAnnouncement(viewer, item))
    .slice(0, ANNOUNCEMENT_MAX);
  if (candidates.length === 0) return [];
  // 既読はお知らせを開いた時に announcement_reads/{お知らせID}_{利用者ID} が作られる。
  const receipts = await db.getAll(...candidates.map(item => db.collection('announcement_reads').doc(`${item.id}_${user.uid}`)));
  return candidates
    .filter((_, index) => !receipts[index]?.exists)
    .map((item: any) => ({
      id: item.id,
      title: clean(item.title, 120) || 'お知らせ',
      label: clean(item.label, 30),
      published_at: String(item.publish_at || item.created_at || ''),
    }));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent']);
    const db = adminDb();
    const [replies, news] = await Promise.all([
      unreadReplyCount(db, user.uid),
      unreadUrgentNews(db, user).catch(error => { console.warn('[parent/home-summary] news', error); return null; }),
    ]);
    return Response.json({ ok: true, unread_replies: replies, urgent_news: news || [], news_error: news === null }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
