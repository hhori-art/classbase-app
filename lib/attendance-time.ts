export type RoundedWorkTimeResult = {
  roundedStart: string;
  roundedEnd: string;
  grossMinutes: number;
  breakMinutes: number;
  workMinutes: number;
};

const FIVE_MINUTES = 5;

const toValidDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid time');
  return date;
};

const roundDateByMinutes = (value: string | Date, mode: 'ceil' | 'floor', unitMinutes = FIVE_MINUTES) => {
  const date = toValidDate(value);
  const unitMs = unitMinutes * 60 * 1000;
  const roundedMs = mode === 'ceil'
    ? Math.ceil(date.getTime() / unitMs) * unitMs
    : Math.floor(date.getTime() / unitMs) * unitMs;
  return new Date(roundedMs);
};

export const roundUpTo5Minutes = (value: string | Date) => roundDateByMinutes(value, 'ceil');

export const roundDownTo5Minutes = (value: string | Date) => roundDateByMinutes(value, 'floor');

export const calculateRoundedWorkMinutes = (
  startTime: string | Date,
  endTime: string | Date,
  breakMinutes = 0,
): RoundedWorkTimeResult => {
  const roundedStartDate = roundUpTo5Minutes(startTime);
  const roundedEndDate = roundDownTo5Minutes(endTime);
  const grossMinutes = Math.max(0, Math.floor((roundedEndDate.getTime() - roundedStartDate.getTime()) / 60000));
  const normalizedBreak = Math.max(0, Math.floor(Number(breakMinutes) || 0));
  const workMinutes = Math.max(0, grossMinutes - normalizedBreak);

  return {
    roundedStart: roundedStartDate.toISOString(),
    roundedEnd: roundedEndDate.toISOString(),
    grossMinutes,
    breakMinutes: normalizedBreak,
    workMinutes,
  };
};

