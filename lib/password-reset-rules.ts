import { PASSWORD_SUPPORT_HOURS, PASSWORD_SUPPORT_PHONE } from '@/lib/password-reset-availability';

// パスワード再設定リンクのきまり（KDL診断 A.3.2・A.3.3 への対応）。画面とサーバーの両方で使う。
// リンクは10分で切れ、1回だけ使える。メールは GAS が1分ごとに送るため、受け取ってから使えるのは8分ほど。
export const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
export const PASSWORD_RESET_TTL_LABEL = '10分';

/** 日本時間の「2026年11月12日 14:05」。 */
export function formatJstDateTime(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
}

/** パスワードが変わったことを本人へ知らせる文面。パスワードやリンクは入れない。 */
export function passwordChangedNotice(changedAt: Date) {
  return {
    title: 'パスワードが変更されました',
    message: `${formatJstDateTime(changedAt)}（日本時間）に、あなたのアカウントのパスワードが再設定のリンクから変更されました。` +
      `心当たりがない場合は、すぐに通っている校舎か、サポートセンター（${PASSWORD_SUPPORT_PHONE}、${PASSWORD_SUPPORT_HOURS}）へ連絡してください。`,
  };
}
