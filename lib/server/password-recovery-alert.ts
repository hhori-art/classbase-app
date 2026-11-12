import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isDeliverableEmail, pushLine, sendEmail, stableEmailIdempotencyKey, stableLineRetryKey } from '@/lib/server/notify-channels';
import { queuePushToUsers } from '@/lib/server/web-push';
import { maskEmail } from '@/lib/password-recovery-match';

// 生徒・保護者が「登録情報の照合」で再設定リンクを受け取ったとき、本人と保護者へ知らせる（乗っ取りに気づけるように）。
// 安全のための知らせなので、通知の受け取り設定に関係なく送る。失敗しても再設定の受付には影響させない。

type Recipient = { id: string; role: string; data: FirebaseFirestore.DocumentData };

const clean = (value: unknown) => String(value ?? '').trim();

export async function notifyInfoMatchPasswordReset(input: {
  tokenId: string;
  target: Recipient;
  /** 生徒なら、つながっている保護者。保護者なら、つながっているお子さま（アプリ内通知だけ）。 */
  related: Recipient[];
  deliveryEmail: string;
  targetName: string;
}) {
  const db = adminDb();
  const masked = maskEmail(input.deliveryEmail);
  const who = input.target.role === 'student' ? `${input.targetName}さん（生徒）` : `${input.targetName}さん（保護者）`;
  const title = 'パスワード再設定の申し込みがありました';
  const message = `${who}のアカウントで、パスワードを忘れたときの再設定が申し込まれ、${masked} に再設定のリンクを送りました。心当たりがない場合は、すぐに教室へ連絡してください。`;
  const recipients = [input.target, ...input.related];

  const batch = db.batch();
  recipients.forEach(recipient => {
    batch.set(db.collection('user_notifications').doc(`password_reset_${input.tokenId}_${recipient.id}`), {
      user_id: recipient.id,
      role: recipient.role,
      title,
      message,
      kind: 'security',
      link: recipient.role === 'student' ? '/student/settings' : '/parent/settings',
      read: false,
      created_at: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  queuePushToUsers(recipients.map(recipient => recipient.id), { title, body: message.slice(0, 90), link: '/' }, { kind: 'security' });

  // LINE と確認済みメール：本人と保護者だけ（保護者の申し込みでお子さまへは送らない）。リンクを送った宛先へは重ねて送らない。
  const outside = input.target.role === 'student' ? recipients : [input.target];
  const sentEmails = new Set([input.deliveryEmail.toLowerCase()]);
  const results = await Promise.all(outside.flatMap(recipient => {
    const tasks: Array<Promise<{ ok: boolean }>> = [];
    const lineUserId = clean(recipient.data.line_user_id);
    if (lineUserId) tasks.push(pushLine(lineUserId, `【創造学園アプリ】${title}\n${message}`, stableLineRetryKey('password_reset', input.tokenId, recipient.id)));
    const email = clean(recipient.data.recovery_email).toLowerCase();
    if (recipient.data.recovery_email_verified_at && isDeliverableEmail(email) && !sentEmails.has(email)) {
      sentEmails.add(email);
      tasks.push(sendEmail(email, `【創造学園アプリ】${title}`, message, stableEmailIdempotencyKey('password_reset_alert', input.tokenId, recipient.id)));
    }
    return tasks;
  }));
  return { in_app: recipients.length, outside_sent: results.filter(result => result.ok).length, outside_failed: results.filter(result => !result.ok).length };
}
