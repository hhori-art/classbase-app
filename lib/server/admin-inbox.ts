import 'server-only';

import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, type ServerUser } from '@/lib/server-auth';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { jstDateKey } from '@/lib/date-key';
import { visibleAdminMenu } from '@/app/components/master/admin-menu';

/** 「今日の対応」とサイドバーの件数のキー（admin-menu の項目キーと同じ名前）。 */
export const INBOX_COUNT_KEYS = [
  'parentInquiries',
  'requests',
  'safetyAlerts',
  'detailApprovals',
  'recordings',
  'substitutions',
  'rewards',
  'passwordRecovery',
] as const;

export type InboxCountKey = typeof INBOX_COUNT_KEYS[number];
/** null は「数えられなかった」（0件と区別する）。 */
export type InboxCounts = Partial<Record<InboxCountKey, number | null>>;

type Query = FirebaseFirestore.Query;

const loadAdminVisibility = unstable_cache(async () => {
  const snap = await adminDb().collection('settings').doc('portal_visibility').get();
  return (snap.data()?.admin || {}) as Record<string, boolean | undefined>;
}, ['admin-portal-visibility-v1'], { revalidate: 60, tags: ['portal-visibility'] });

/** この利用者のメニューに出ている件数キー（画面に入れない分野の件数は数えない）。 */
export async function visibleInboxKeys(user: ServerUser): Promise<Set<InboxCountKey>> {
  const visibility = await loadAdminVisibility().catch(() => ({}));
  const keys = new Set(visibleAdminMenu({ ...user.profile, role: user.profile?.role || user.role }, visibility)
    .flatMap(section => section.items.map(item => item.key)));
  return new Set(INBOX_COUNT_KEYS.filter(key => keys.has(key)));
}

/** 担当校舎のコード（マスターと、校舎未設定の勤怠管理アカウントは null＝全校）。 */
function schoolScope(user: ServerUser, options: { allWhenEmpty?: boolean } = {}): string[] | null {
  if (user.role === 'master') return null;
  const values = [user.school, ...user.school_ids]
    .flatMap(value => [resolveAttendanceSchoolCode(value), String(value || '').trim()])
    .filter(Boolean) as string[];
  const unique = Array.from(new Set(values)).slice(0, 30);
  if (unique.length === 0 && options.allWhenEmpty) return null;
  return unique;
}

const scoped = (query: Query, field: string, schools: string[] | null) =>
  schools === null ? query : query.where(field, 'in', schools);

async function countOf(query: Query) {
  const snap = await query.count().get();
  return Number(snap.data().count || 0);
}

const monthRange = () => {
  const today = jstDateKey();
  const month = today.slice(0, 7);
  return { start: `${month}-01`, end: `${month}-31` };
};

const daysAgoKey = (days: number) => jstDateKey(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

/**
 * 件数を数える。どれも count() の集計クエリで、文書そのものは読まない。
 * 校舎で絞れない集計（申請・教室への連絡・安全アラート・録画・代行）はマスター専用画面の分だけで、
 * メニューに出ない人には数えない。
 */
export async function loadInboxCounts(user: ServerUser): Promise<InboxCounts> {
  const keys = await visibleInboxKeys(user);
  const db = adminDb();
  const isMaster = user.role === 'master';
  const tasks: Array<[InboxCountKey, () => Promise<number>]> = [];

  if (keys.has('parentInquiries') && isMaster) {
    tasks.push(['parentInquiries', () => countOf(db.collection('parent_inquiries').where('status', '==', 'open'))]);
  }
  if (keys.has('requests') && isMaster) {
    // 申請画面の「未対応」と同じ条件：未処理のうち、欠席・振替の連絡を除く。
    tasks.push(['requests', async () => {
      const pending = db.collection('requests').where('status', '==', 'pending');
      const [all, notices] = await Promise.all([
        countOf(pending),
        countOf(pending.where('type', 'in', ['absence', 'transfer'])),
      ]);
      return Math.max(0, all - notices);
    }]);
  }
  if (keys.has('safetyAlerts') && isMaster) {
    tasks.push(['safetyAlerts', () => countOf(db.collection('safety_alerts').where('status', 'in', ['open', 'in_progress']))]);
  }
  if (keys.has('detailApprovals') && canManageAttendance(user)) {
    // 勤務実績の承認画面の初期表示（今月）と同じ範囲：承認待ちの実績＋承認待ちの打刻修正。
    // 目安の件数：承認画面は実績の中の明細（work_segments）ごとに、明細の勤務校舎と承認できるかを
    // 講師のプロフィールまで読んで数える（明細未登録の実績も1件）。count() では配列の中身・講師の校舎を
    // 見られないため、ここでは実績単位の detail_approval_status と実績の school_id で近似する
    // （画面の「目安」表記はこのため。正確に数えるには今月の実績と講師を全件読む必要がある）。
    const schools = schoolScope(user, { allWhenEmpty: user.role === 'attendance_admin' });
    tasks.push(['detailApprovals', async () => {
      if (schools && schools.length === 0) return 0;
      const { start, end } = monthRange();
      const [records, corrections] = await Promise.all([
        countOf(scoped(db.collection('work_records').where('detail_approval_status', '==', 'pending'), 'school_id', schools)
          .where('date', '>=', start).where('date', '<=', end)),
        countOf(scoped(db.collection('attendance_correction_requests').where('status', '==', 'pending'), 'school_id', schools)),
      ]);
      return records + corrections;
    }]);
  }
  if (keys.has('recordings') && isMaster) {
    // 録画画面の初期表示（直近7日）で「保留（要確認）」になっている授業。
    tasks.push(['recordings', () => countOf(db.collection('shift_assignments')
      .where('recording_status', '==', 'blocked')
      .where('target_date', '>=', daysAgoKey(6)))]);
  }
  if (keys.has('substitutions') && isMaster) {
    tasks.push(['substitutions', () => countOf(db.collection('teacher_substitution_posts').where('status', '==', 'open'))]);
  }
  if (keys.has('rewards')) {
    // 実物景品の発送待ち（受付・準備中）。マスター以外は担当校舎の生徒分だけ。
    const schools = schoolScope(user);
    tasks.push(['rewards', async () => {
      if (schools && schools.length === 0) return 0;
      // in の組み合わせは30通りまでのため、状態ごとに分けて数える。
      const counts = await Promise.all(['pending', 'preparing'].map(status =>
        countOf(scoped(db.collection('requests').where('type', '==', 'exchange').where('status', '==', status), 'school', schools))));
      return counts.reduce((sum, value) => sum + value, 0);
    }]);
  }

  if (keys.has('passwordRecovery') && isMaster) {
    // 「メールが使えない」からのパスワード再設定の依頼（未対応）。再設定画面はマスター専用。
    tasks.push(['passwordRecovery', () => countOf(db.collection('password_recovery_requests').where('status', '==', 'pending'))]);
  }

  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const counts: InboxCounts = {};
  results.forEach((result, index) => {
    const key = tasks[index][0];
    if (result.status === 'fulfilled') counts[key] = result.value;
    else {
      console.error('[admin-inbox] count failed', key, result.reason);
      counts[key] = null;
    }
  });
  return counts;
}

export type InboxItem = {
  id: string;
  status: string;
  title: string;
  summary: string;
  at: string | null;
  href: string;
};

export type InboxGroupKey = 'parentInquiries' | 'requests' | 'safetyAlerts' | 'community' | 'rewardShipments' | 'passwordRecovery';
export type InboxGroup = { key: InboxGroupKey; items: InboxItem[]; error?: boolean };

const ITEMS_PER_GROUP = 10;
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
const short = (value: unknown, max = 80) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const REQUEST_TYPE_LABELS: Record<string, string> = { change: '受講内容の変更', exchange: '景品交換' };
const RECOVERY_ROLE_LABELS: Record<string, string> = { student: '生徒', parent: '保護者', guardian: '保護者', teacher: '講師' };

/** 対応待ち一覧（マスター専用画面）。種類ごとに新しい順に最大10件。読取は種類ごとに上限付き。 */
export async function loadInboxItems(): Promise<InboxGroup[]> {
  const db = adminDb();
  const loaders: Array<[InboxGroupKey, () => Promise<InboxItem[]>]> = [
    ['parentInquiries', async () => {
      const snap = await db.collection('parent_inquiries').where('status', '==', 'open').orderBy('updated_at', 'desc').limit(ITEMS_PER_GROUP).get();
      return snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          status: data.unread_for_admin === true ? 'unread' : 'open',
          title: short(data.subject || 'お問い合わせ', 60),
          summary: short([data.parent_name, data.student_name ? `（${data.student_name}）` : '', data.school_name ? ` ${data.school_name}` : ''].join('')) || short(data.content),
          at: iso(data.updated_at || data.created_at),
          href: '/master/parent-inquiries',
        };
      });
    }],
    ['requests', async () => {
      // 欠席・振替の連絡を除くため多めに読み、未対応の申請だけを10件にする。
      const snap = await db.collection('requests').where('status', '==', 'pending').orderBy('created_at', 'desc').limit(40).get();
      const docs = snap.docs.filter(doc => !['absence', 'transfer'].includes(String(doc.data().type || ''))).slice(0, ITEMS_PER_GROUP);
      const uids = Array.from(new Set(docs.map(doc => String(doc.data().user_id || doc.data().userId || '')).filter(Boolean)));
      const profiles = uids.length ? await db.getAll(...uids.map(uid => db.collection('users').doc(uid))) : [];
      const names = new Map(profiles.map(snap => [snap.id, String(snap.data()?.student_name || snap.data()?.name || '')]));
      return docs.map(doc => {
        const data = doc.data();
        const uid = String(data.user_id || data.userId || '');
        const type = String(data.type || '');
        return {
          id: doc.id,
          status: 'pending',
          title: `${names.get(uid) || data.userName || '生徒'}さん`,
          summary: [REQUEST_TYPE_LABELS[type] || '申請', type === 'exchange' ? data.rewardName : short(data.reason || data.content, 50)].filter(Boolean).join('：'),
          at: iso(data.created_at),
          href: '/master/requests',
        };
      });
    }],
    ['safetyAlerts', async () => {
      const snap = await db.collection('safety_alerts').where('status', 'in', ['open', 'in_progress']).orderBy('created_at', 'desc').limit(ITEMS_PER_GROUP).get();
      return snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          status: String(data.status || 'open'),
          title: `${data.student_name || '生徒'}さん`,
          summary: [data.category_label, data.severity === 'high' ? '緊急度 高' : '', data.school_name].filter(Boolean).join('・'),
          at: iso(data.last_detected_at || data.created_at),
          href: '/master/safety-alerts',
        };
      });
    }],
    ['community', async () => {
      // 取り下げた投稿も is_approved=false のため、多めに読んで取り下げ分を除く。
      const snap = await db.collection('community_topics').where('is_approved', '==', false).orderBy('created_at', 'desc').limit(30).get();
      return snap.docs.filter(doc => doc.data().archived !== true).slice(0, ITEMS_PER_GROUP).map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          status: 'pending',
          title: short(data.title || '無題の投稿', 60),
          summary: short(data.creator_name || data.description || ''),
          at: iso(data.created_at),
          href: '/master/community',
        };
      });
    }],
    ['rewardShipments', async () => {
      const snap = await db.collection('requests').where('type', '==', 'exchange').where('status', 'in', ['pending', 'preparing']).orderBy('created_at', 'desc').limit(ITEMS_PER_GROUP).get();
      return snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          status: String(data.status || 'pending'),
          title: `${data.userName || '生徒'}さん`,
          summary: [data.rewardName || data.reward_name, data.origin === 'gacha' ? 'ガチャ当選' : ''].filter(Boolean).join('・'),
          at: iso(data.created_at),
          href: '/master/rewards?tab=shipments',
        };
      });
    }],
    ['passwordRecovery', async () => {
      // 状態＋日時の複合インデックスを増やさないよう、新しい順に多めに読んで未対応だけを残す。
      const snap = await db.collection('password_recovery_requests').orderBy('created_at', 'desc').limit(40).get();
      return snap.docs.filter(doc => doc.data().status === 'pending').slice(0, ITEMS_PER_GROUP).map(doc => {
        const data = doc.data();
        const matched = Boolean(data.target_user_id);
        return {
          id: doc.id,
          status: 'pending',
          title: matched
            ? `${short(data.target_name || '利用者', 40)}さん`
            : `${short(data.submitted_name || '氏名なし', 40)}（登録と一致しませんでした）`,
          summary: [
            data.request_code,
            matched ? RECOVERY_ROLE_LABELS[String(data.target_role || '')] || '職員' : '',
            `ID ${short(data.target_login_id || data.submitted_login_id || '-', 30)}`,
          ].filter(Boolean).join('・'),
          at: iso(data.created_at),
          href: '/master/accounts/recovery',
        };
      });
    }],
  ];
  const results = await Promise.allSettled(loaders.map(([, load]) => load()));
  return results.map((result, index) => {
    const key = loaders[index][0];
    if (result.status === 'fulfilled') return { key, items: result.value };
    console.error('[admin-inbox] items failed', key, result.reason);
    return { key, items: [], error: true };
  });
}
