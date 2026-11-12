import 'server-only';

import { hasZoomPasswordToken, looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';

export async function getZoomServerAccessToken() {
  return (await requestZoomServerToken()).accessToken;
}

/** Server-to-Server OAuth のアクセストークンと有効秒数（使い回す側が期限を知るため）。 */
export async function requestZoomServerToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom APIの環境変数が未設定です。');
  }

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: accountId,
    }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    // Zoom の返した文言は画面に出さず、ログにだけ残す。
    console.error(JSON.stringify({ type: 'zoom_token_error', status: response.status, reason: String(data.reason || data.message || '').slice(0, 300) }));
    throw new Error('Zoom認証に失敗しました。時間をおいてもう一度お試しください。');
  }
  return { accessToken: String(data.access_token), expiresIn: Number(data.expires_in) || 3600 };
}

/** Zoomが返す、暗号化済みpwd付きの正式な参加URLだけを返す。 */
export async function fetchOfficialZoomJoinUrl(meetingId: unknown, accessToken?: string) {
  const cleanMeetingId = normalizeZoomMeetingId(meetingId);
  if (!cleanMeetingId) return '';

  const token = accessToken || await getZoomServerAccessToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(cleanMeetingId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data.message || data.reason || response.status);
    const scopeHint = /scope|permission/i.test(message)
      ? ' Zoom Marketplaceで Server-to-Server OAuth に meeting:read:admin を追加してください。'
      : '';
    console.error(JSON.stringify({ type: 'zoom_join_url_error', status: response.status, message: message.slice(0, 300) }));
    throw new Error(`Zoomの参加URLを取得できませんでした。${scopeHint}`.trim());
  }

  const joinUrl = String(data.join_url || '').trim();
  return looksLikeZoomUrl(joinUrl) && hasZoomPasswordToken(joinUrl) ? joinUrl : '';
}
