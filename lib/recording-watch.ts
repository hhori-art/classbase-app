/** 録画視聴のコイン判定（サーバー・テスト共通）。 */

/** 「見た範囲」を数える区切り（秒） */
export const RECORDING_BUCKET_SECONDS = 60;
/** 画面から送る視聴中の合図の間隔（秒） */
export const RECORDING_HEARTBEAT_SECONDS = 30;
/** コインに必要な視聴時間の上限（長い録画でも15分見ればよい） */
export const RECORDING_REWARD_MAX_SECONDS = 15 * 60;
/** 録画の長さに対して必要な割合 */
export const RECORDING_REWARD_RATIO = 0.7;

const MIN_BEAT_GAP_SECONDS = 10;
const MAX_BEAT_GAP_SECONDS = 90;
const MAX_CREDIT_PER_BEAT_SECONDS = 45;

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** 録画の長さ（秒）。トリミング範囲 → 録画情報 → 再生画面が最初に報告した長さ の順に使う。 */
export function recordingDurationSeconds(recording: Record<string, any>, reportedSeconds = 0) {
  const start = positive(recording.trim_start_seconds);
  const end = positive(recording.trim_end_seconds);
  if (end > start) return Math.round(end - start);
  const stored = positive(recording.recording_duration_seconds) || positive(recording.duration_seconds);
  if (stored) return Math.round(Math.max(0, stored - start));
  return Math.round(positive(reportedSeconds));
}

/** コインに必要な「再生していた時間」と「見た範囲」。長さ不明なら15分。 */
export function recordingRewardRequirement(recording: Record<string, any>, reportedSeconds = 0) {
  const durationSeconds = recordingDurationSeconds(recording, reportedSeconds);
  const requiredSeconds = durationSeconds > 0
    ? Math.max(60, Math.min(RECORDING_REWARD_MAX_SECONDS, Math.ceil(durationSeconds * RECORDING_REWARD_RATIO)))
    : RECORDING_REWARD_MAX_SECONDS;
  // 1分区切りなので、区切りの端数ぶん1つ分だけ甘くする。
  const requiredCoverageSeconds = Math.max(RECORDING_BUCKET_SECONDS, requiredSeconds - RECORDING_BUCKET_SECONDS);
  return { durationSeconds, requiredSeconds, requiredCoverageSeconds };
}

/**
 * 視聴中の合図1回ぶんで、何秒を「見た」と数えるか。
 * 前回の合図からの経過時間と再生位置の進みが合わないとき（早送り・巻き戻し・放置・連打）は数えない。
 */
export function creditHeartbeat(input: { nowMs: number; lastBeatMs: number; lastPosition: number | null; position: number | null }) {
  const gap = (input.nowMs - input.lastBeatMs) / 1000;
  const none = { creditedSeconds: 0, buckets: [] as number[], position: input.position };
  if (input.position === null || input.lastPosition === null || !input.lastBeatMs) return none;
  if (gap < MIN_BEAT_GAP_SECONDS || gap > MAX_BEAT_GAP_SECONDS) return none;
  const delta = input.position - input.lastPosition;
  // 等倍〜2倍速くらいまでを「普通に再生していた」とみなす。
  if (delta < gap * 0.5 - 2 || delta > gap * 2.2 + 2) return none;
  const creditedSeconds = Math.round(Math.min(gap, MAX_CREDIT_PER_BEAT_SECONDS));
  const from = Math.floor(input.lastPosition / RECORDING_BUCKET_SECONDS);
  const to = Math.floor(input.position / RECORDING_BUCKET_SECONDS);
  const buckets: number[] = [];
  for (let bucket = from; bucket <= to && buckets.length < 10; bucket += 1) buckets.push(bucket);
  return { creditedSeconds, buckets, position: input.position };
}
