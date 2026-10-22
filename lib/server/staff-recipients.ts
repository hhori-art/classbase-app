import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { hasAdminAppPermission, type AdminAppId } from '@/lib/admin-app-permissions';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { queuePushToUsers } from '@/lib/server/web-push';

// 保護者連絡・安全アラートの宛先になる管理者（マスター＋担当校舎の理社講座管理者）を求める。
// users 全件を読まないよう、管理者ロールだけを role の in 条件で絞る。

const ADMIN_RECIPIENT_ROLES = [
  'master',
  'admin',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
];
// 勤怠の管理アカウント（勤怠アプリだけの権限）。audience が attendance のときだけ宛先候補に足す。
const ATTENDANCE_ACCOUNT_ROLES = ['attendance_admin', 'attendance_only', 'attendance_manager'];
const INACTIVE = ['suspended', 'withdrawn', 'archived'];
const MAX_ADMIN_RECIPIENTS = 300;

export type StaffRecipient = { id: string; data: FirebaseFirestore.DocumentData; isMaster: boolean };

const canonicalSchool = (value: unknown) => resolveAttendanceSchoolCode(value) || String(value || '').trim();

function staffSchoolCodes(data: FirebaseFirestore.DocumentData) {
  const stored = Array.isArray(data.school_ids)
    ? data.school_ids
    : Array.isArray(data.attendance_school_ids) ? data.attendance_school_ids : [];
  // getServerUser の school_ids と同じく、主校舎は最初に設定されている項目だけを使う。
  const values = [data.school_id || data.school_code || data.school_name || data.school, ...stored];
  return new Set(values.map(canonicalSchool).filter(Boolean));
}

/**
 * マスター全員と、対象校舎を担当する管理者。
 * audience は担当分野：science_social（既定）＝理社講座の管理者、attendance＝勤怠の管理者
 * （attendance_admin などの勤怠アカウントと、勤怠の権限を付けた管理者）。
 * 校舎が分からない場合は担当範囲を判定できないため、マスターだけに送る。
 * 校舎未設定の attendance_admin は全校担当として扱う（canManageAttendanceSchool と同じ）。
 */
export async function loadSchoolStaffRecipients(
  targetSchool?: string | null,
  options: { audience?: Extract<AdminAppId, 'science_social' | 'attendance'> } = {},
): Promise<StaffRecipient[]> {
  const audience = options.audience || 'science_social';
  const roles = audience === 'attendance' ? [...ADMIN_RECIPIENT_ROLES, ...ATTENDANCE_ACCOUNT_ROLES] : ADMIN_RECIPIENT_ROLES;
  const snap = await adminDb().collection('users')
    .where('role', 'in', roles)
    .limit(MAX_ADMIN_RECIPIENTS)
    .get();
  const target = canonicalSchool(targetSchool);
  return snap.docs
    .map(doc => ({ id: doc.id, data: doc.data() || {} }))
    .filter(item => !INACTIVE.some(status => item.data.account_status === status || item.data.status === status))
    .map(item => ({ ...item, isMaster: String(item.data.role || '').toLowerCase() === 'master' }))
    .filter(item => {
      if (item.isMaster) return true;
      if (!target) return false;
      if (!hasAdminAppPermission(item.data.role, item.data, audience)) return false;
      const schools = staffSchoolCodes(item.data);
      if (audience === 'attendance' && schools.size === 0 && String(item.data.role || '').toLowerCase() === 'attendance_admin') return true;
      return schools.has(target);
    });
}

type StaffNotification = {
  idPrefix: string;
  title: string;
  message: string;
  kind: string;
  /** マスター向けの遷移先。校舎管理者は個別画面に入れないため通知一覧へ誘導する。 */
  masterLink: string;
  staffLink?: string;
  extra?: Record<string, unknown>;
  /** 端末通知（Web Push）の本文。ロック画面に出るため個人名や相談内容を含めない。省略時は定型文。 */
  pushBody?: string;
};

/** 管理者へのアプリ内通知。ID を固定し、同じ事象の再送では最新内容で未読に戻す。 */
export async function notifyStaff(recipients: StaffRecipient[], notification: StaffNotification) {
  if (!recipients.length) return 0;
  const db = adminDb();
  let batch = db.batch();
  let pending = 0;
  const pushMasters: string[] = [];
  const pushStaff: string[] = [];
  for (const recipient of recipients) {
    if (recipient.data.notification_preferences?.in_app === false) continue;
    (recipient.isMaster ? pushMasters : pushStaff).push(recipient.id);
    batch.set(db.collection('user_notifications').doc(`${notification.idPrefix}_${recipient.id}`), {
      user_id: recipient.id,
      role: 'admin',
      title: notification.title,
      message: notification.message,
      kind: notification.kind,
      link: recipient.isMaster ? notification.masterLink : (notification.staffLink || '/master/notifications'),
      read: false,
      ...(notification.extra || {}),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    pending++;
    if (pending % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (pending % 400) await batch.commit();
  // 端末通知は応答の後に送る。失敗してもアプリ内通知の結果には影響させない。
  const push = { title: notification.title, body: notification.pushBody || '管理画面の通知から確認してください。' };
  queuePushToUsers(pushMasters, { ...push, link: notification.masterLink }, { kind: notification.kind });
  queuePushToUsers(pushStaff, { ...push, link: notification.staffLink || '/master/notifications' }, { kind: notification.kind });
  return pending;
}
