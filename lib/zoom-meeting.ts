import 'server-only';

import { hasZoomPasswordToken, looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';

export async function getZoomServerAccessToken() {
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
    throw new Error(`Zoom認証に失敗しました: ${data.reason || data.message || response.status}`);
  }
  return String(data.access_token);
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
    throw new Error(`Zoomの参加URLを取得できませんでした: ${message}${scopeHint}`);
  }

  const joinUrl = String(data.join_url || '').trim();
  return looksLikeZoomUrl(joinUrl) && hasZoomPasswordToken(joinUrl) ? joinUrl : '';
}
