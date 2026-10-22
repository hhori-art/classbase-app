// Zoom のホスト開始（ZAK）をブラウザから呼ぶ共通処理。講師ホームの授業カードと「次回担当授業」で使う。
// /api/get-zoom-zak は「今日の授業」かつ Zoom 情報が一致する場合だけ ZAK を返す。

export type ZoomHostStartResult =
  | { ok: true; url: string }
  | { ok: false; error: string; detail?: string };

export async function requestZoomHostStart(input: {
  token: string;
  email: string;
  meetingId: string;
  shiftId?: string;
  name: string;
}): Promise<ZoomHostStartResult> {
  const response = await fetch('/api/get-zoom-zak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ email: input.email, meetingId: input.meetingId, shiftId: input.shiftId, name: input.name }),
  });
  const data = await response.json().catch(() => ({}));
  if (data.success && (data.zak || data.start_url)) {
    const webUrl = data.start_url || `https://zoom.us/s/${input.meetingId}?zak=${encodeURIComponent(data.zak)}&uname=${encodeURIComponent(input.name)}`;
    const appUrl = data.app_start_url || (data.zak ? `zoommtg://zoom.us/start?confno=${input.meetingId}&zak=${encodeURIComponent(data.zak)}` : '');
    return { ok: true, url: webUrl || appUrl };
  }
  return { ok: false, error: String(data.error || 'ホスト権限を取得できませんでした。'), detail: data.detail ? String(data.detail) : undefined };
}

/** API待ちの間にポップアップ制限で開けなくならないよう、クリック直後に空のタブを用意する。 */
export function prepareZoomWindow() {
  const popup = typeof window === 'undefined' ? null : window.open('', '_blank');
  if (popup) {
    popup.document.write('<p style="font-family: sans-serif; padding: 24px;">Zoomホスト開始を準備しています...</p>');
    popup.document.close();
  }
  return popup;
}

export function launchZoomUrl(url: string, targetWindow?: Window | null) {
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.replace(url);
    return;
  }
  // Safari などで window.open が null を返しても、ホスト開始URLを失わないよう現在のタブで開く。
  const opened = window.open(url, '_blank');
  if (!opened) window.location.assign(url);
}
