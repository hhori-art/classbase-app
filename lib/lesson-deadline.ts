/** 欠席・遅刻の連絡ができるかどうか（授業が終わった日は連絡できない）。日付・時刻はすべて日本時間。 */

export const jstTodayKey = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

const jstMinutesNow = (now = new Date()) => {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now).split(':').map(Number);
  return (hour % 24) * 60 + minute;
};

const toMinutes = (time: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60;
};

/** その日の授業がすでに終わっているか。lessonEnd はその日いちばん遅い授業の終了時刻（例 "21:40"）。 */
export function lessonDayEnded(dateKey: string, lessonEnd: string, now = new Date()) {
  const today = jstTodayKey(now);
  if (dateKey < today) return true;
  if (dateKey > today) return false;
  return jstMinutesNow(now) >= toMinutes(lessonEnd);
}

export const LESSON_ENDED_MESSAGE = 'この日の授業はすでに終わっているため、欠席・遅刻の連絡はできません。';
