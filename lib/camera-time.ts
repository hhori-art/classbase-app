/**
 * 授業中にカメラがオンだった時間と、カメラON率・続けてオフの判定（純粋関数だけ。Zoom や Firestore には触れない）。
 * Zoom のダッシュボードの「参加者のQoS」は参加者ごとに1分ずつ記録があり、video_input（参加者が送っている映像）に
 * 値があればその1分はカメラがオンだったとみなす。カメラがオフの分は video_input が空になる。
 * カメラを隠してオンにすることもできるので、ご褒美には使わず、退塾の兆しの1つ（続けてオフ）として見るだけにする。
 * サーバー処理は lib/server/zoom-camera-time.ts。
 */

export type CameraMonitorRule = {
  enabled: boolean;
  /** ON率がこの値（%）より低い授業を「オフの授業」とみなす。 */
  off_rate_percent: number;
  /** オフの授業がこの回数続いたら、声かけリストに出す。 */
  streak_lessons: number;
  /** 参加していた分数がこれより短い授業は判定に入れない（途中から入った・すぐ抜けた）。 */
  min_present_minutes: number;
};

export const DEFAULT_CAMERA_MONITOR_RULE: CameraMonitorRule = { enabled: true, off_rate_percent: 20, streak_lessons: 3, min_present_minutes: 10 };

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeCameraMonitorRule(value: unknown): CameraMonitorRule {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    enabled: data.enabled !== false,
    off_rate_percent: clampInt(data.off_rate_percent, DEFAULT_CAMERA_MONITOR_RULE.off_rate_percent, 1, 100),
    streak_lessons: clampInt(data.streak_lessons, DEFAULT_CAMERA_MONITOR_RULE.streak_lessons, 2, 10),
    min_present_minutes: clampInt(data.min_present_minutes, DEFAULT_CAMERA_MONITOR_RULE.min_present_minutes, 1, 120),
  };
}

/** カメラON率（%）。参加していた分がなければ null。 */
export const cameraRate = (cameraMinutes: number, presentMinutes: number) =>
  presentMinutes > 0 ? Math.round((Math.min(cameraMinutes, presentMinutes) / presentMinutes) * 100) : null;

export type CameraLesson = { date: string; camera_minutes: number; present_minutes: number };

/** 判定に入れる授業か（参加していた分数が足りているか）。 */
export const isJudgedCameraLesson = (lesson: CameraLesson, rule: CameraMonitorRule) => lesson.present_minutes >= rule.min_present_minutes;

/** 「オフの授業」か。 */
export const isCameraOffLesson = (lesson: CameraLesson, rule: CameraMonitorRule) =>
  isJudgedCameraLesson(lesson, rule) && (cameraRate(lesson.camera_minutes, lesson.present_minutes) ?? 100) < rule.off_rate_percent;

/**
 * 直近から数えて、オフの授業が何回続いているか（lessons は古い順）。参加が短い授業は飛ばす。
 * since は続いているオフの最初の授業の日。
 */
export function cameraOffStreak(lessons: CameraLesson[], rule: CameraMonitorRule) {
  const judged = lessons.filter(lesson => isJudgedCameraLesson(lesson, rule));
  let streak = 0;
  for (let index = judged.length - 1; index >= 0; index -= 1) {
    if (!isCameraOffLesson(judged[index], rule)) break;
    streak += 1;
  }
  return { streak, since: streak ? judged[judged.length - streak].date : '' };
}

type VideoQos = { bitrate?: unknown; resolution?: unknown; frame_rate?: unknown } | null | undefined;
export type QosSample = { date_time?: unknown; video_input?: VideoQos };

const numberIn = (value: unknown) => {
  const match = String(value ?? '').match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
};

/** その1分、参加者が映像を送っていたか（ビットレートかフレームレートがある、または解像度が入っている）。 */
export function isCameraOnSample(sample: QosSample) {
  const video = sample.video_input;
  if (!video || typeof video !== 'object') return false;
  return numberIn(video.bitrate) > 0 || numberIn(video.frame_rate) > 0 || /\d+\s*[*x×]\s*\d+/.test(String(video.resolution ?? ''));
}

/**
 * 授業の時間（startMs〜endMs）の中で、カメラがオンだった分のキー（分単位の時刻）。
 * 入り直しなどで1人に記録が複数あっても、同じ1分は1回だけ数えるため Set で返す。
 */
export function cameraOnMinutes(samples: QosSample[], startMs: number, endMs: number) {
  const minutes = new Set<number>();
  samples.forEach(sample => {
    const at = Date.parse(String(sample.date_time || ''));
    if (!Number.isFinite(at) || at < startMs || at >= endMs || !isCameraOnSample(sample)) return;
    minutes.add(Math.floor(at / 60_000));
  });
  return minutes;
}

/** 授業の時間の中で、記録がある（参加していた）分のキー。 */
export function presentMinutes(samples: QosSample[], startMs: number, endMs: number) {
  const minutes = new Set<number>();
  samples.forEach(sample => {
    const at = Date.parse(String(sample.date_time || ''));
    if (Number.isFinite(at) && at >= startMs && at < endMs) minutes.add(Math.floor(at / 60_000));
  });
  return minutes;
}

/** Zoom の表示名を照らし合わせ用にそろえる（全角半角・空白・大文字小文字）。 */
export const normalizeZoomName = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();

export type CameraCandidate = { id: string; name: string; lifetimeId: string };

/**
 * Zoom の表示名から、その授業に授業ボタンで入った生徒を選ぶ。
 * 生徒番号（3桁以上）が名前に入っている → 名前が同じ → 名前の一部が同じ（2文字以上で、候補が1人だけ）の順。
 */
export function matchCameraCandidate(zoomName: unknown, candidates: CameraCandidate[]) {
  const name = normalizeZoomName(zoomName);
  if (!name) return null;
  const byId = candidates.filter(candidate => candidate.lifetimeId.length >= 3 && name.includes(normalizeZoomName(candidate.lifetimeId)));
  if (byId.length === 1) return byId[0];
  const exact = candidates.filter(candidate => normalizeZoomName(candidate.name) === name);
  if (exact.length === 1) return exact[0];
  const partial = candidates.filter(candidate => {
    const candidateName = normalizeZoomName(candidate.name);
    return candidateName.length >= 2 && (name.includes(candidateName) || (name.length >= 2 && candidateName.includes(name)));
  });
  return partial.length === 1 ? partial[0] : null;
}
