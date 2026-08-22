export const normalizeZoomMeetingId = (value: unknown) => {
  const text = String(value || '').normalize('NFKC');
  const match =
    text.match(/(?:\/j\/|\/wc\/join\/|confno=|meetingId=)(\d[\d\s-]{7,}\d)/i) ||
    text.match(/(\d[\d\s-]{7,}\d)/);
  const digits = String(match?.[1] || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 12 ? digits : '';
};

export const looksLikeZoomUrl = (value: unknown) => /https?:\/\/[^\s]*zoom\.us\//i.test(String(value || ''));

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
  if (joinUrl && looksLikeZoomUrl(joinUrl)) {
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
