export const normalizeZoomMeetingId = (value: unknown) => {
  const text = String(value || '').normalize('NFKC');
  const match =
    text.match(/(?:\/j\/|\/wc\/join\/|confno=|meetingId=)(\d[\d\s-]{7,}\d)/i) ||
    text.match(/(\d[\d\s-]{7,}\d)/);
  const digits = String(match?.[1] || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 12 ? digits : '';
};

export const looksLikeZoomUrl = (value: unknown) => /https?:\/\/[^\s]*zoom\.us\//i.test(String(value || ''));

/**
 * ホストとして開始するURL（Zoom API の start_url など）。`/s/<会議ID>` や `zak=`（ホストのトークン）を含む。
 * これを開いた人は、誰でもホストのアカウントの名前で入ってしまう（Zoom の仕様。名前は変えられない）。
 * 生徒・保護者に渡す参加URLには、けっして使わない。
 */
export const isZoomHostStartUrl = (value: unknown) => {
  const text = String(value || '').trim();
  if (!looksLikeZoomUrl(text)) return false;
  try {
    const url = new URL(text);
    return /^\/s\//i.test(url.pathname) || /\/start(\/|$)/i.test(url.pathname) || url.searchParams.has('zak');
  } catch {
    return /zoom\.us\/s\/|[?&]zak=/i.test(text);
  }
};

/** 参加用の Zoom のURL（ホスト開始用のURLは除く）。 */
export const looksLikeZoomJoinUrl = (value: unknown) => looksLikeZoomUrl(value) && !isZoomHostStartUrl(value);

export const hasZoomPasswordToken = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    return /(^|\.)zoom\.us$/i.test(url.hostname) && Boolean(url.searchParams.get('pwd'));
  } catch {
    return false;
  }
};

/**
 * Zoomが発行した参加URLを優先する。
 * `pwd` はZoom独自の暗号化済みトークンであり、平文パスコードから生成してはいけない。
 */
export const buildZoomJoinUrl = (params: {
  meetingId?: unknown;
  joinUrl?: unknown;
}) => {
  const meetingId = normalizeZoomMeetingId(params.meetingId || params.joinUrl);
  const joinUrl = String(params.joinUrl || '').trim();

  let url: URL | null = null;
  // ホスト開始用のURLが紛れていたら使わず、会議IDから参加URLを作る。
  if (joinUrl && looksLikeZoomJoinUrl(joinUrl)) {
    try {
      url = new URL(joinUrl);
    } catch {
      url = null;
    }
  }

  if (!url && meetingId) {
    url = new URL(`https://zoom.us/j/${meetingId}`);
  }
  if (!url) return '';

  return url.toString();
};

/**
 * スマホ・タブレットでは `zoommtg://` を開かず、Zoom の https の参加URLを開く。
 * `zoommtg://` はスマホで受け取れないことがあり、iPhone・iPad では「アドレスが無効です」になる。
 * https の参加URLなら、Zoomアプリが入っていればアプリで開き、なければZoomのページから参加できる。
 * iPadOS はパソコン（Macintosh）と名乗るので、タッチ操作できるかで見分ける。
 */
export const isMobileOrTabletDevice = (userAgent: string, maxTouchPoints = 0) =>
  /iPhone|iPad|iPod|Android|Mobile|Tablet|Line|CriOS|FxiOS|EdgiOS/i.test(userAgent) ||
  (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
