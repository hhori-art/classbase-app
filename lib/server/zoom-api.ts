import 'server-only';

// Zoom API（Server-to-Server OAuth）の共通処理。

let cachedToken = '';
let cachedTokenExpiresAt = 0;

export async function zoomApiAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) throw new Error('zoom-api-env-missing');

  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`zoom-token-failed:${data.reason || data.message || response.status}`);
  cachedToken = String(data.access_token);
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
  return cachedToken;
}

/** アカウント全体のクラウド録画を日付（日本時間の日付キー）の範囲で取得する。 */
export async function listAccountRecordings(accessToken: string, from: string, to: string) {
  const meetings: any[] = [];
  let nextPageToken = '';
  let pages = 0;
  do {
    const url = new URL('https://api.zoom.us/v2/accounts/me/recordings');
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('page_size', '300');
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`zoom-recording-list-failed:${body.message || body.reason || response.status}`);
    meetings.push(...(Array.isArray(body.meetings) ? body.meetings : []));
    nextPageToken = String(body.next_page_token || '');
    pages += 1;
  } while (nextPageToken && pages < 10);
  return meetings;
}
