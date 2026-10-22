// 録画の自動アップ判定（サーバー・管理画面の両方で使う純粋関数）。
// 講師配置（shift_assignments）の会議ID・日付・時限と、Zoomの録画ファイルを突き合わせ、
// システムで検知できる不具合が1つでもあれば自動アップしない。

/** アップに使うのは「共有画面付きスピーカービュー」だけ。 */
export const REQUIRED_RECORDING_TYPE = 'shared_screen_with_speaker_view';

export const PERIOD_WINDOWS: Record<string, { start: number; end: number }> = {
  '1限': { start: 19 * 60 + 20, end: 20 * 60 + 25 },
  '2限': { start: 20 * 60 + 35, end: 21 * 60 + 40 },
};

/** 授業時間（65分）のうち、録画と重なっていなければならない最小分数。 */
export const MIN_PERIOD_OVERLAP_MINUTES = 45;
/** 録画の最短時間（これより短いと途中で切れたとみなす）。 */
export const MIN_RECORDING_MINUTES = 40;
/** 授業開始からこれ以上遅れて録画が始まっていたら、冒頭が欠けているとみなす。 */
export const MAX_LATE_START_MINUTES = 15;
/**
 * 授業の終わりの時刻をこれ以上過ぎて録画が続いていたら、集会（グループミーティング・20分程度）が
 * 授業の前か後に同じ録画で入ったとみなす。前に入ると授業が後ろへずれるため、時刻だけでは前か後かを判断できない。
 */
// 1限の録画は2限の開始直前（終わりから15分ほど）まで続くことがあるため、それより長い場合だけにする。
export const MEETING_EXCESS_MINUTES = 18;
/** 集会の録画とみなす最短時間。これより短い切れ端（録画の止め忘れ・押し直し）は集会として扱わない。 */
export const MIN_MEETING_MINUTES = 3;
/** 授業の前の集会（別の録画）で授業が遅れて始まるときに、遅れとして扱わない分。 */
export const MEETING_SHIFT_ALLOWANCE_MINUTES = 30;
/** 授業が予定より延びることがあるため、「集会は前」で切り取るときに授業の前へ残す余裕。 */
const MEETING_TRIM_MARGIN_MINUTES = 5;

export type RecordingIssueCode =
  | 'no-speaker-view'
  | 'split-recording'
  | 'not-completed'
  | 'no-period'
  | 'no-start-time'
  | 'too-short'
  | 'late-start'
  | 'time-mismatch'
  | 'meeting-suspected'
  | 'host-mismatch';

export const RECORDING_ISSUE_LABELS: Record<RecordingIssueCode, string> = {
  'no-speaker-view': '共有画面付きスピーカービューの録画がありません（共有画面が別ファイルに分かれています）',
  'split-recording': '録画が途中で分割されています（複数のファイル）',
  'not-completed': 'Zoomで録画の処理が終わっていません',
  'no-period': '講師配置に時限がなく、時間を確認できません',
  'no-start-time': '録画の開始時刻を確認できません',
  'too-short': `録画が${MIN_RECORDING_MINUTES}分より短く、途中で切れたか、集会（グループミーティング）だけの録画の可能性があります`,
  'late-start': `授業開始から${MAX_LATE_START_MINUTES}分以上遅れて録画が始まっています`,
  'time-mismatch': `授業時間と${MIN_PERIOD_OVERLAP_MINUTES}分以上重なっていません`,
  'meeting-suspected': '授業の終わりの時刻を過ぎても録画が続いています。集会（グループミーティング）が授業の前か後に入った可能性があります。「集会は授業の前／後」で選ぶと切り取り位置を直して公開します',
  'host-mismatch': '講師配置のZoomアカウントと録画したアカウントが違います',
};

export type MeetingTrimOptions = {
  /** 集会が授業の前：録画の後ろ側を授業として残す。 */
  before: { start: number; end: number | null };
  /** 集会が授業の後：授業開始から授業時間ぶんを残す。 */
  after: { start: number; end: number | null };
};

/**
 * 集会と授業が1つの録画につながっているときの切り取り位置（秒、録画の先頭から）。
 * startMinutes / endMinutes は録画の開始・終了（日本時間の0時からの分）。
 */
export function meetingTrimOptions(startMinutes: number, endMinutes: number, period: string): MeetingTrimOptions | null {
  const window = PERIOD_WINDOWS[period];
  if (!window || endMinutes <= startMinutes) return null;
  const lessonMinutes = window.end - window.start;
  const durationSeconds = (endMinutes - startMinutes) * 60;
  const afterStart = Math.max(0, window.start - startMinutes) * 60;
  const beforeStart = Math.max(afterStart, (endMinutes - lessonMinutes - MEETING_TRIM_MARGIN_MINUTES - startMinutes) * 60);
  return {
    before: { start: Math.min(beforeStart, durationSeconds), end: null },
    after: { start: afterStart, end: Math.min(durationSeconds, afterStart + lessonMinutes * 60) },
  };
}

/** 録画が授業の終わりを過ぎて続いている分（集会の疑い）。別の時限と重なる録画（1限・2限の通し録画）は対象外。 */
export function meetingExcessMinutes(startMinutes: number, endMinutes: number, period: string) {
  const window = PERIOD_WINDOWS[period];
  if (!window || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return 0;
  const overlapsOtherPeriod = Object.entries(PERIOD_WINDOWS).some(([key, other]) => (
    key !== period && Math.min(endMinutes, other.end) - Math.max(startMinutes, other.start) >= 15
  ));
  if (overlapsOtherPeriod) return 0;
  const excess = endMinutes - window.end;
  return excess >= MEETING_EXCESS_MINUTES ? excess : 0;
}

export type RecordingIssue = { code: RecordingIssueCode; label: string; detail?: string };

const jstMinutes = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return null;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
};

const clockLabel = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

const typeOf = (file: any) => String(file?.recording_type || '').toLowerCase();
const isMp4 = (file: any) => String(file?.file_type || '').toUpperCase() === 'MP4' || String(file?.file_extension || '').toUpperCase() === 'MP4';

/**
 * 生徒に公開できる録画ファイル（MP4）。
 * - 共有画面付きスピーカービューを使う。
 * - その区間に共有画面付きスピーカービューも、共有画面だけの録画もない場合は、アクティブスピーカーを使う。
 *   Zoomは共有画面を別に録画していないとき、共有画面をアクティブスピーカーの録画に映すため。
 */
export function speakerViewFiles(recording: any) {
  const files = (Array.isArray(recording?.recording_files) ? recording.recording_files : []).filter(isMp4);
  const startKey = (file: any) => Math.round(Date.parse(String(file?.recording_start || '')) / 60000);
  const segmentHasScreen = (file: any) => files.some((other: any) => (
    Math.abs(startKey(other) - startKey(file)) <= 1 && typeOf(other).includes('shared_screen')
  ));
  return files.filter((file: any) => (
    typeOf(file) === REQUIRED_RECORDING_TYPE || (typeOf(file) === 'active_speaker' && !segmentHasScreen(file))
  ));
}

const fileWindowMinutes = (file: any, recording: any) => {
  const start = jstMinutes(file?.recording_start || recording?.start_time);
  const end = jstMinutes(file?.recording_end || recording?.end_time);
  return start == null ? null : { start, end: end ?? start };
};

/**
 * 時限に当たる共有画面付きスピーカービューのMP4。
 * Zoomでは1つの会議の録画に1限・2限が別ファイルとして入るため、時限と重なるファイルだけを対象にする。
 * 時限が分からないときは会議内のすべてのファイルを返す。
 */
export function speakerViewFilesForPeriod(recording: any, period?: string) {
  const files = speakerViewFiles(recording);
  const window = period ? PERIOD_WINDOWS[period] : undefined;
  if (!window) return files;
  return files
    .map((file: any) => {
      const range = fileWindowMinutes(file, recording);
      const overlap = range ? Math.max(0, Math.min(range.end, window.end) - Math.max(range.start, window.start)) : 0;
      return { file, overlap };
    })
    .filter((item: { overlap: number }) => item.overlap > 0)
    .sort((a: { overlap: number }, b: { overlap: number }) => b.overlap - a.overlap)
    .map((item: { file: any }) => item.file);
}

/**
 * 録画を講師配置に自動アップしてよいかを判定する。問題がなければ空配列。
 * period は講師配置の時限（'1限' / '2限'）、shiftEmail は講師配置のZoomサインインアドレス。
 */
export function inspectRecordingForShift(recording: any, input: { period: string; shiftEmail?: string; meetingBefore?: boolean }): RecordingIssue[] {
  const issues: RecordingIssue[] = [];
  const add = (code: RecordingIssueCode, detail?: string) => issues.push({ code, label: RECORDING_ISSUE_LABELS[code], ...(detail ? { detail } : {}) });

  const allFiles = speakerViewFiles(recording);
  if (allFiles.length === 0) {
    add('no-speaker-view');
    return issues;
  }
  const periodFiles = speakerViewFilesForPeriod(recording, input.period);
  const periodWindow = PERIOD_WINDOWS[input.period];
  if (periodWindow && periodFiles.length === 0) {
    // その時限にはスピーカービュー以外の録画しかない（例：アクティブスピーカーのみ）。
    const otherFiles = (Array.isArray(recording?.recording_files) ? recording.recording_files : []).filter((file: any) => {
      const range = isMp4(file) ? fileWindowMinutes(file, recording) : null;
      return Boolean(range && Math.min(range.end, periodWindow.end) > Math.max(range.start, periodWindow.start));
    });
    if (otherFiles.length > 0) {
      add('no-speaker-view');
      return issues;
    }
  }
  // 時限と重なるファイルがなければ、会議内の最初のファイルで時間のずれを報告する。
  const files = periodFiles.length > 0 ? periodFiles : allFiles.slice(0, 1);
  if (files.length > 1) add('split-recording', `${files.length}ファイル`);
  const file = files[0];
  if (String(file.status || 'completed').toLowerCase() !== 'completed') add('not-completed');

  const startMinutes = jstMinutes(file.recording_start || recording.start_time);
  const endMinutes = jstMinutes(file.recording_end || recording.end_time);
  const durationMinutes = startMinutes != null && endMinutes != null
    ? Math.max(0, endMinutes - startMinutes)
    : Number(recording.duration || 0);
  if (startMinutes == null) add('no-start-time');
  if (durationMinutes < MIN_RECORDING_MINUTES) add('too-short', `${Math.round(durationMinutes)}分`);

  const scheduled = PERIOD_WINDOWS[input.period];
  // 授業の前の集会が別の録画にあるときは、授業が遅れて始まった分だけ授業時間をずらして確かめる。
  const delay = scheduled && input.meetingBefore && startMinutes != null
    ? Math.min(MEETING_SHIFT_ALLOWANCE_MINUTES, Math.max(0, startMinutes - scheduled.start))
    : 0;
  const window = scheduled ? { start: scheduled.start + delay, end: scheduled.end + delay } : undefined;
  if (!window) {
    add('no-period');
  } else if (startMinutes != null) {
    const end = endMinutes ?? startMinutes + durationMinutes;
    const overlap = Math.max(0, Math.min(end, window.end) - Math.max(startMinutes, window.start));
    if (overlap < MIN_PERIOD_OVERLAP_MINUTES) add('time-mismatch', `${clockLabel(startMinutes)}〜${clockLabel(end)}の録画（重なり${Math.round(overlap)}分）`);
    else if (startMinutes > window.start + MAX_LATE_START_MINUTES) add('late-start', `${clockLabel(startMinutes)}開始`);
    const excess = overlap >= MIN_PERIOD_OVERLAP_MINUTES && !input.meetingBefore ? meetingExcessMinutes(startMinutes, end, input.period) : 0;
    if (excess > 0) add('meeting-suspected', `${clockLabel(startMinutes)}〜${clockLabel(end)}の録画（授業の終わりから${Math.round(excess)}分）`);
  }

  const shiftEmail = String(input.shiftEmail || '').trim().toLowerCase();
  const hostEmail = String(recording.host_email || '').trim().toLowerCase();
  if (shiftEmail && hostEmail && shiftEmail !== hostEmail) add('host-mismatch');

  return issues;
}

/** 講師配置ごとのアップ状況（管理画面の表示用）。 */
export type RecordingUploadState = 'published' | 'replaced' | 'stopped' | 'blocked' | 'pending' | 'waiting' | 'missing';

export const RECORDING_UPLOAD_STATE_LABELS: Record<RecordingUploadState, string> = {
  published: '公開中',
  replaced: '公開中（差し替え）',
  stopped: '停止中',
  blocked: '保留（要確認）',
  pending: '確認待ち',
  waiting: '録画待ち',
  missing: '録画なし',
};
