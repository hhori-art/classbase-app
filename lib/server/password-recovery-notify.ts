import 'server-only';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { consumeRateLimit, requestFingerprint } from '@/lib/server/password-recovery';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';

// 「メールが使えない」からのパスワード再設定の依頼を管理者へ知らせる。
// 宛先：マスター全員（再設定リンクを発行できるのはマスターだけ）。
// 対象が講師などの職員なら、その校舎の勤怠の管理者にも、生徒・保護者なら、その校舎の理社講座の管理者にも知らせる。
// 登録と一致しなかった依頼は校舎が分からないため、マスターだけに送る。

const NOTIFY_WINDOW_MS = 6 * 60 * 60 * 1000;
const GLOBAL_NOTIFY_LIMIT_PER_HOUR = 30;
const STUDENT_SIDE_ROLES = ['student', 'parent', 'guardian'];

const ROLE_LABELS: Record<string, string> = {
  student: '生徒',
  parent: '保護者',
  guardian: '保護者',
  teacher: '講師',
};

const firstText = (...values: unknown[]) =>
  values.map(value => String(value ?? '').trim()).find(Boolean) || '';

const firstOf = (value: unknown) => Array.isArray(value) ? value[0] : undefined;

/** 依頼の対象アカウントの校舎（分からなければ空）。保護者は校舎がなければ最初のお子さまの校舎。 */
export async function recoveryTargetSchool(
  role: string,
  profile: FirebaseFirestore.DocumentData,
): Promise<string> {
  const own = firstText(
    profile.school_id, profile.school_code, profile.school,
    firstOf(profile.attendance_school_ids), firstOf(profile.school_ids),
  );
  if (own || !['parent', 'guardian'].includes(role)) return own;
  const childId = firstText(firstOf(profile.student_ids));
  if (!childId) return '';
  const child = (await adminDb().collection('users').doc(childId).get()).data() || {};
  return firstText(child.school_id, child.school_code, child.school);
}

export type RecoveryRequestNotice = {
  requestId: string;
  requestCode: string;
  fingerprint: string;
  submittedLoginId: string;
  submittedName: string;
  target: { role: string; name: string; loginId: string; school: string } | null;
};

/**
 * 管理者への通知。同じ入力（ID＋氏名）の依頼は6時間に1回だけ知らせ、通知のIDも固定して重ねない。
 * 失敗しても依頼の受付には影響させない（呼び出し側で catch する）。
 */
export async function notifyPasswordRecoveryRequest(notice: RecoveryRequestNotice) {
  const allowed = await consumeRateLimit(
    requestFingerprint(['support-notify', notice.fingerprint]), 1, NOTIFY_WINDOW_MS,
  );
  if (!allowed) return 0;
  const globalAllowed = await consumeRateLimit(
    requestFingerprint(['support-notify-all']), GLOBAL_NOTIFY_LIMIT_PER_HOUR, 60 * 60 * 1000,
  );
  if (!globalAllowed) return 0;

  const target = notice.target;
  const audience = target && STUDENT_SIDE_ROLES.includes(target.role) ? 'science_social' : 'attendance';
  const recipients = await loadSchoolStaffRecipients(target?.school || null, { audience });
  const masters = recipients.filter(item => item.isMaster);
  const staff = recipients.filter(item => !item.isMaster);

  const idPrefix = `password_recovery_${crypto.createHash('sha256').update(notice.fingerprint).digest('hex').slice(0, 24)}`;
  const title = 'パスワード再設定の依頼が届きました';
  const pushBody = '「メールが使えない」からパスワード再設定の依頼が届きました。管理画面で確認してください。';
  const extra = { request_id: notice.requestId, request_code: notice.requestCode };
  const who = target
    ? `${ROLE_LABELS[target.role] || '職員'} ${target.name}（ログインID ${target.loginId}）`
    : '';

  const masterMessage = target
    ? `受付番号 ${notice.requestCode}：${who}から「メールが使えない」で依頼がありました。登録電話への折り返しなどで本人確認をしてから、再設定リンクを発行してください。`
    : `受付番号 ${notice.requestCode}：入力されたログインID「${notice.submittedLoginId}」・氏名「${notice.submittedName}」は登録と一致しませんでした。入力内容を確認し、必要なら本人へ連絡してください。`;

  let sent = await notifyStaff(masters, {
    idPrefix, title, message: masterMessage, kind: 'password_recovery',
    masterLink: '/master/accounts/recovery', extra, pushBody,
  });
  if (target && staff.length) {
    // 再設定の画面はマスター専用のため、校舎の管理者には内容だけを知らせてマスターへの連絡を促す。
    sent += await notifyStaff(staff, {
      idPrefix, title,
      message: `受付番号 ${notice.requestCode}：${who}がパスワードを忘れ、「メールが使えない」から申し込みました。再設定リンクはマスターが本人確認のうえ発行します。本人から連絡があれば、受付番号を添えてマスターへ伝えてください。`,
      kind: 'password_recovery',
      masterLink: '/master/accounts/recovery',
      staffLink: '/master/notifications',
      extra, pushBody,
    });
  }
  return sent;
}
