export type ClassButtonSettings = {
  period1_start: string;
  period1_end: string;
  period2_start: string;
  period2_end: string;
  show_before_minutes: number;
  show_after_minutes: number;
};

export const DEFAULT_CLASS_BUTTON_SETTINGS: ClassButtonSettings = {
  period1_start: '19:20',
  period1_end: '20:25',
  period2_start: '20:35',
  period2_end: '21:40',
  show_before_minutes: 45,
  show_after_minutes: 0,
};

export function normalizeClassButtonSettings(data: Partial<ClassButtonSettings> = {}): ClassButtonSettings {
  const timePattern = /^\d{2}:\d{2}$/;
  const normalizeTime = (value: unknown, fallback: string) => {
    const text = String(value || '').trim();
    return timePattern.test(text) ? text : fallback;
  };
  const normalizeMinutes = (value: unknown, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(180, Math.round(num)));
  };

  return {
    period1_start: normalizeTime(data.period1_start, DEFAULT_CLASS_BUTTON_SETTINGS.period1_start),
    period1_end: normalizeTime(data.period1_end, DEFAULT_CLASS_BUTTON_SETTINGS.period1_end),
    period2_start: normalizeTime(data.period2_start, DEFAULT_CLASS_BUTTON_SETTINGS.period2_start),
    period2_end: normalizeTime(data.period2_end, DEFAULT_CLASS_BUTTON_SETTINGS.period2_end),
    show_before_minutes: normalizeMinutes(data.show_before_minutes, DEFAULT_CLASS_BUTTON_SETTINGS.show_before_minutes),
    show_after_minutes: normalizeMinutes(data.show_after_minutes, DEFAULT_CLASS_BUTTON_SETTINGS.show_after_minutes),
  };
}

export function isClassButtonVisible(now: Date | null, start: string, end: string, settings: ClassButtonSettings) {
  if (!now) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const showStartMinutes = (startH * 60 + startM) - settings.show_before_minutes;
  const showEndMinutes = (endH * 60 + endM) + settings.show_after_minutes;
  return currentMinutes >= showStartMinutes && currentMinutes <= showEndMinutes;
}
