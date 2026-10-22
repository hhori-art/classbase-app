/**
 * Monoxer（モノグサ）のアプリを開く。
 *
 * Monoxer は「https のリンクからアプリを開く」仕組み（iOS のユニバーサルリンク・Android の App Links）を
 * 公開していない（monoxer.com の apple-app-site-association はパスワード自動入力用だけ。2026-10 確認）。
 * また独自のURLスキーム（monoxer://）は公開されておらず、iPhone では登録のないスキームを開くと
 * 「アドレスが無効です」と出て止まる。そのため端末ごとに、確実に開ける方法を使う。
 *  - iPhone・iPad：App Store の Monoxer のページを開く（入っていれば「開く」でアプリが起動する）
 *  - Android：Android の起動用リンク（intent）でアプリを直接開く。開けなければ Google Play のページ（「開く」）へ
 *  - パソコン：ブラウザ版を新しいタブで開く
 * 学校向けに起動用のURLスキームが案内された場合は、NEXT_PUBLIC_MONOXER_APP_URL で指定すると最初にそれを試す。
 */

export const MONOXER_WEB_URL = process.env.NEXT_PUBLIC_MONOXER_WEB_URL || 'https://app.monoxer.com/';
export const MONOXER_IOS_APP_ID = '1288435689';
export const MONOXER_ANDROID_PACKAGE = 'com.monoxer';
export const MONOXER_APP_STORE_URL = `https://apps.apple.com/jp/app/id${MONOXER_IOS_APP_ID}`;
export const MONOXER_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${MONOXER_ANDROID_PACKAGE}`;
/** 学校向けに案内された起動用のURLスキーム（例：monoxer://）。未設定なら使わない。 */
const CONFIGURED_APP_URL = (process.env.NEXT_PUBLIC_MONOXER_APP_URL || '').trim();

export type MonoxerPlatform = 'ios' | 'android' | 'desktop';

export function monoxerPlatform(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent, maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): MonoxerPlatform {
  if (/Android/i.test(userAgent)) return 'android';
  // iPadOS は「Macintosh」を名乗るので、タッチ対応かどうかで見分ける。
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

/** Android の起動用リンク。アプリがあれば直接開き、なければ Google Play のページを開く。 */
export function monoxerAndroidIntentUrl(scheme = CONFIGURED_APP_URL.replace(/:\/\/.*$/, '') || 'monoxer') {
  return `intent://open#Intent;scheme=${scheme};package=${MONOXER_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(MONOXER_PLAY_STORE_URL)};end`;
}

/** 端末に合った方法で Monoxer を開く。 */
export function openMonoxerApp(platform: MonoxerPlatform = monoxerPlatform()) {
  if (platform === 'android') {
    window.location.href = monoxerAndroidIntentUrl();
    return;
  }
  if (platform === 'ios') {
    if (!CONFIGURED_APP_URL) {
      window.location.href = MONOXER_APP_STORE_URL;
      return;
    }
    // 起動用のURLスキームが指定されているときだけ試し、開かなければ App Store へ。
    let left = false;
    const onHide = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!left) window.location.href = MONOXER_APP_STORE_URL;
    }, 1500);
    window.location.href = CONFIGURED_APP_URL;
    return;
  }
  window.open(MONOXER_WEB_URL, '_blank', 'noopener,noreferrer');
}

export function openMonoxerWeb() {
  window.open(MONOXER_WEB_URL, '_blank', 'noopener,noreferrer');
}
