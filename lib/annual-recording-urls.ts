// 年度ごとの録画一覧（スプレッドシート）の「URL」列以降から、公開する録画URLを取り出す。
// - 「20250211」「250610」のような日付の後ろにあるURLは、その授業の差し替え録画。差し替えがあれば元のURLは使わない。
// - 「HR」「１時間目」などの印や、HR別で2本に分かれた録画は、HR と 授業 の2本として扱う。

export type AnnualRecordingUrlPart = 'HR' | '授業' | null;

export type AnnualRecordingUrl = {
  url: string;
  part: AnnualRecordingUrlPart;
  /** URLの startTime（ミリ秒）。Zoomの録画ファイルとの照合に使う。 */
  start_ms: number | null;
  replacement: boolean;
  /** 差し替え録画のとき、差し替え前（その日の授業）のURLの startTime。時限の判定に使う。 */
  original_start_ms?: number | null;
};

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);
const isDateLabel = (value: string) => /^(?:\d{6}|\d{8})$/.test(value.normalize('NFKC').trim());
const partLabel = (value: string): AnnualRecordingUrlPart => {
  const text = value.normalize('NFKC').replace(/[←\s]/g, '');
  if (/^HR$/i.test(text)) return 'HR';
  if (/時間目$/.test(text)) return '授業';
  return null;
};

export function recordingStartMillis(url?: string | null) {
  const match = String(url || '').match(/[?&]startTime=(\d{10,13})(?:&|$)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function extractAnnualRecordingUrls(cells: string[], note = ''): AnnualRecordingUrl[] {
  const values = cells.map(value => String(value || '').trim());
  const found: AnnualRecordingUrl[] = [];
  let replacementSeen = false;
  values.forEach((value, index) => {
    if (!isHttpUrl(value)) return;
    const before = values[index - 1] || '';
    const after = values[index + 1] || '';
    const replacement = isDateLabel(before) || (isDateLabel(values[index - 2] || '') && !isHttpUrl(before));
    if (replacement) replacementSeen = true;
    // 「←HR」のように矢印つきの印は、左隣（前）のURLの説明。
    const part = (before.startsWith('←') ? null : partLabel(before)) || (after.startsWith('←') ? partLabel(after) : null);
    found.push({ url: value, part, start_ms: recordingStartMillis(value), replacement });
  });

  const originalStart = found.find(item => !item.replacement)?.start_ms ?? null;
  const picked = replacementSeen
    ? found.filter(item => item.replacement).map(item => ({ ...item, original_start_ms: originalStart }))
    : found;
  if (picked.length <= 1) return picked.map(item => ({ ...item, part: null }));

  // HR と授業が別ファイルに分かれている（備考「HR別」など）。開始時刻順に HR → 授業 と並べる。
  const sorted = [...picked].sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));
  if (sorted.length === 2) {
    const looksLikeHrSplit = sorted.some(item => item.part) || /HR/i.test(note.normalize('NFKC'));
    if (looksLikeHrSplit || sorted.every(item => item.start_ms != null && Math.abs(item.start_ms - (sorted[0].start_ms ?? 0)) < 40 * 60 * 1000)) {
      return [
        { ...sorted[0], part: sorted[0].part || 'HR' },
        { ...sorted[1], part: sorted[1].part === 'HR' ? '授業' : sorted[1].part || '授業' },
      ];
    }
  }
  return sorted;
}
