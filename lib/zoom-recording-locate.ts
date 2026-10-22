// 録画一覧の共有URL（startTime 付き）から、Zoom APIの録画ファイルを特定する純粋関数。
// 共有URLの文字列はZoom APIの share_url と一致しないことがあるため、
// 「録画したアカウント」と「録画ファイルの開始時刻」で照合する。

/** startTime と録画ファイルの開始時刻のずれの許容範囲。 */
export const ZOOM_FILE_START_TOLERANCE_MS = 2 * 60 * 1000;

const FILE_TYPE_RANK: Record<string, number> = {
  shared_screen_with_speaker_view: 0,
  active_speaker: 1,
  shared_screen_with_gallery_view: 2,
  shared_screen: 3,
  gallery_view: 4,
};

export const zoomFileTypeRank = (file: any) => FILE_TYPE_RANK[String(file?.recording_type || '').toLowerCase()] ?? 5;

const isPlayableMp4 = (file: any) => (
  (String(file?.file_type || '').toUpperCase() === 'MP4' || String(file?.file_extension || '').toUpperCase() === 'MP4') &&
  String(file?.status || 'completed').toLowerCase() === 'completed'
);

export type LocatedZoomFile = { meeting: any; file: any; differenceMs: number };

export function locateZoomRecordingFile(meetings: any[], startMs: number, hostEmail = ''): LocatedZoomFile | null {
  const host = String(hostEmail || '').trim().toLowerCase();
  const candidates: LocatedZoomFile[] = [];
  for (const meeting of meetings) {
    for (const file of Array.isArray(meeting?.recording_files) ? meeting.recording_files : []) {
      if (!isPlayableMp4(file)) continue;
      const fileStart = Date.parse(String(file.recording_start || ''));
      if (!Number.isFinite(fileStart)) continue;
      const differenceMs = Math.abs(fileStart - startMs);
      if (differenceMs <= ZOOM_FILE_START_TOLERANCE_MS) candidates.push({ meeting, file, differenceMs });
    }
  }
  if (candidates.length === 0) return null;
  const sameHost = host ? candidates.filter(item => String(item.meeting.host_email || '').trim().toLowerCase() === host) : [];
  const pool = sameHost.length > 0 ? sameHost : candidates;
  // 同じ時刻の録画（1つの区間）の中で、共有画面付きスピーカービューを最優先にする。
  const nearest = Math.min(...pool.map(item => item.differenceMs));
  return pool
    .filter(item => item.differenceMs <= nearest + 30 * 1000)
    .sort((a, b) => zoomFileTypeRank(a.file) - zoomFileTypeRank(b.file) || a.differenceMs - b.differenceMs)[0];
}
