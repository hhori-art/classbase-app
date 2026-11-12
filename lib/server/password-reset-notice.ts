import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isDeliverableEmail, sendEmail, stableEmailIdempotencyKey } from '@/lib/server/notify-channels';
import { queuePushToUsers } from '@/lib/server/web-push';
import { passwordChangedNotice } from '@/lib/password-reset-rules';

// 再設定リンクの使い回しを防ぐ処理と、パスワードが変わったことを本人へ知らせる処理（KDL診断 A.3.2・A.3.3）。

const TOKENS = 'password_reset_tokens';
// ログイン用の仮のアドレス（届く受信箱がない）には送らない。
const SYNTHETIC_EMAIL = [/@classbase\.local$/, /^\d+@sozogakuen\.co\.jp$/];

const millis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const resetTokensOf = (userId: string) => adminDb().collection(TOKENS).where('user_id', '==', userId);

/** まだ使える（未使用・取り消しなし・期限内）ほかのリンク。 */
export function openResetTokenRefs(snap: FirebaseFirestore.QuerySnapshot, keepId = '') {
  const now = Date.now();
  return snap.docs
    .filter(doc => {
      const data = doc.data() || {};
      return doc.id !== keepId && !data.used_at && !data.revoked_at && millis(data.expires_at) > now;
    })
    .map(doc => doc.ref);
}

export const revokedResetToken = (reason: 'reissued' | 'password_changed') => ({
  revoked_at: FieldValue.serverTimestamp(),
  revoked_reason: reason,
});

/** 新しいリンクを出したときは、同じアカウントの前のリンクを使えなくする。 */
export async function revokeOtherResetTokens(userId: string, keepId = '') {
  const refs = openResetTokenRefs(await resetTokensOf(userId).get(), keepId);
  if (!refs.length) return 0;
  const batch = adminDb().batch();
  refs.forEach(ref => batch.set(ref, revokedResetToken('reissued'), { merge: true }));
  await batch.commit();
  return refs.length;
}

/**
 * パスワードを再設定したあと、本人へ知らせる（アプリ内通知・端末通知・確認済みの再設定用メール）。
 * 安全のための知らせなので、通知の受け取り設定に関係なく送る。失敗しても再設定は取り消さない。
 */
export async function notifyPasswordChanged(input: {
  userId: string;
  tokenId: string;
  profile: FirebaseFirestore.DocumentData;
  changedAt: Date;
}) {
  const { title, message } = passwordChangedNotice(input.changedAt);
  const role = String(input.profile.role || '').toLowerCase();
  const link = role === 'student' ? '/student/settings' : ['parent', 'guardian'].includes(role) ? '/parent/settings' : role === 'teacher' ? '/teacher/settings' : '/';
  const result = { in_app: false, email: false };

  try {
    await adminDb().collection('user_notifications').doc(`password_changed_${input.tokenId}`).set({
      user_id: input.userId,
      role: role || null,
      title,
      message,
      kind: 'security',
      link,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    });
    result.in_app = true;
  } catch (error) {
    console.error('Password changed in-app notice failed:', error);
  }
  queuePushToUsers([input.userId], { title, body: message.slice(0, 90), link }, { kind: 'security' });

  const email = String(input.profile.recovery_email || '').normalize('NFKC').trim().toLowerCase();
  if (input.profile.recovery_email_verified_at && isDeliverableEmail(email) && !SYNTHETIC_EMAIL.some(pattern => pattern.test(email))) {
    const sent = await sendEmail(email, `【創造学園アプリ】${title}`, message, stableEmailIdempotencyKey('password_changed', input.tokenId, input.userId))
      .catch(() => ({ ok: false, error: 'email-exception' }));
    if (sent.ok) result.email = true;
    else console.error('Password changed email notice failed:', sent.error);
  }
  return result;
}
