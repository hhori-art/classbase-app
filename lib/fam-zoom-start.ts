/**
 * FAMキャンパスの席から Zoom をホストとして開始する中継（/zoom/start?room=教室キー）。
 *   教室キー → ミーティングID（fam_zoom_rooms）→ Zoom API の start_url → 302 リダイレクト。
 * start_url の中のトークン（ZAK）は約2時間で切れるので、毎回 Zoom から取り直して保存しない。
 * アクセストークンだけは期限の5分前まで使い回し、Zoom が 401 を返したら取り直して1回だけやり直す。
 * ログインは不要（開いた人がホストになる合意済み）。推測されにくい教室キーで守る。
 * Zoom への接続や Firestore は引数で受け取る（テストで差し替えるため）。
 */

import { createErrorReference } from '@/lib/api-error';

export const FAM_ZOOM_ROOMS_COLLECTION = 'fam_zoom_rooms';

/** 教室キーに使える文字（Firestore のドキュメントIDにそのまま使う）。 */
export const FAM_ROOM_KEY_PATTERN = /^[A-Za-z0-9_-]{4,100}$/;

export const normalizeFamMeetingId = (value: unknown) => String(value ?? '').replace(/\s/g, '');

export type ZoomServerToken = { accessToken: string; expiresIn: number };

export type FamZoomStartDeps = {
  /** 教室キーに対応するミーティングID。未登録なら空。 */
  lookupMeetingId: (roomKey: string) => Promise<string>;
  requestToken: () => Promise<ZoomServerToken>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const TOKEN_MARGIN_MS = 5 * 60_000;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
));

export function famErrorPage(title: string, message: string, status: number) {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#f8fafc;color:#0f172a}
main{max-width:560px;margin:15vh auto;padding:32px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px}
h1{font-size:20px;margin:0 0 12px}
p{line-height:1.7;margin:0;color:#334155;overflow-wrap:anywhere}
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

// message は画面に出す日本語、detail は Zoom の返した文言（ログにだけ残す）。
class ZoomStartError extends Error {
  constructor(message: string, public detail = '') {
    super(message);
  }
}

export function createFamZoomStarter(deps: FamZoomStartDeps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now;
  let tokenCache: { token: string; expiresAt: number } | null = null;

  const accessToken = async () => {
    if (tokenCache && now() < tokenCache.expiresAt) return tokenCache.token;
    const { accessToken: token, expiresIn } = await deps.requestToken();
    tokenCache = { token, expiresAt: now() + Math.max(0, expiresIn * 1000 - TOKEN_MARGIN_MS) };
    return token;
  };

  const getMeeting = async (meetingId: string) => fetchImpl(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    cache: 'no-store',
  });

  const fetchStartUrl = async (meetingId: string) => {
    let response = await getMeeting(meetingId);
    if (response.status === 401) {
      tokenCache = null;
      response = await getMeeting(meetingId);
    }
    const body = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      throw new ZoomStartError(`Zoom API エラー (${response.status})`, String(body?.message || body?.reason || '').slice(0, 300));
    }
    const startUrl = String(body?.start_url || '');
    if (!/^https:\/\//.test(startUrl)) throw new ZoomStartError('start_url が取得できませんでした');
    return startUrl;
  };

  return async function handle(request: Request): Promise<Response> {
    const roomKey = (new URL(request.url).searchParams.get('room') || '').trim();
    if (!roomKey) return famErrorPage('教室が指定されていません', 'URLの末尾に ?room=教室キー を付けてください。', 400);

    let rawMeetingId = '';
    try {
      rawMeetingId = FAM_ROOM_KEY_PATTERN.test(roomKey) ? await deps.lookupMeetingId(roomKey) : '';
    } catch (error) {
      console.error('[zoom/start] room lookup failed', error instanceof Error ? error.message : error);
      return famErrorPage('教室の情報を読み込めませんでした', '少し待ってから、もう一度開いてください。', 500);
    }
    const meetingId = normalizeFamMeetingId(rawMeetingId);
    if (!meetingId) return famErrorPage('教室が見つかりません', `教室キー「${roomKey}」は登録されていません。`, 404);

    try {
      const startUrl = await fetchStartUrl(meetingId);
      return new Response(null, { status: 302, headers: { Location: startUrl, 'Cache-Control': 'no-store' } });
    } catch (error) {
      // start_url・トークン・Zoom の返した文言は出さない。ステータスと受付番号だけを出し、中身はログへ。
      const ref = createErrorReference();
      const message = error instanceof ZoomStartError ? error.message : 'Zoom に接続できませんでした';
      const detail = error instanceof ZoomStartError ? error.detail : (error instanceof Error ? error.message : String(error)).slice(0, 300);
      // 教室キーも開けば誰でもホストになれる値なので、ログにはミーティングIDだけを残す。
      console.warn('[zoom/start] failed', { ref, meetingId, message, detail });
      return famErrorPage('Zoomを開始できませんでした', `${message}（受付番号: ${ref}）`, 502);
    }
  };
}
