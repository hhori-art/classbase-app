export type CalendarScheduleKind = 'lesson' | 'closed' | 'event';

const CLOSED_WORDS = /(?:お休み|休み|休館日?|休講|閉室|調休)/;
const LESSON_WORDS = /(?:授業実施日|通常授業|授業日|講習|\d+週)/;

export function calendarScheduleKind(item: any): CalendarScheduleKind {
  const category = String(item?.category || '').normalize('NFKC').toLowerCase();
  const title = String(item?.title || '').normalize('NFKC');
  if (category === 'closed' || CLOSED_WORDS.test(title)) return 'closed';
  if (category === 'lesson' || LESSON_WORDS.test(title)) return 'lesson';
  return 'event';
}

export function calendarScheduleLabel(item: any) {
  const kind = calendarScheduleKind(item);
  if (kind === 'closed') return String(item?.title || '休み');
  if (kind === 'lesson') return String(item?.title || '授業実施日');
  return String(item?.title || '予定');
}
