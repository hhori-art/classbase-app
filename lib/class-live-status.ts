/** 授業の時刻（"HH:mm"、日本時間）から、いまが開始前・授業中・終了後のどれかを判定する。 */
export type ClassLiveStatus = 'before' | 'live' | 'ended' | 'unknown';

const toMinutes = (time: unknown) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 24 && minute < 60 ? hour * 60 + minute : null;
};

export const jstMinutesOfDay = (now = new Date()) => {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now).split(':').map(Number);
  return hour * 60 + minute;
};

export function classLiveStatus(startTime: unknown, endTime: unknown, now = new Date()): ClassLiveStatus {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start == null && end == null) return 'unknown';
  const current = jstMinutesOfDay(now);
  if (start != null && current < start) return 'before';
  if (end != null && current >= end) return 'ended';
  return 'live';
}
