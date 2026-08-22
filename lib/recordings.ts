export type RecordingType = 'regular' | 'test_prep';
export type RecordingYearScope = 'current' | 'past';

export function getSchoolYearFromDate(targetDate?: string) {
  if (!targetDate) return getCurrentSchoolYear();
  const date = new Date(`${targetDate}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return getCurrentSchoolYear();
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export function getCurrentSchoolYear(date = new Date()) {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export function getRecordingYearScope(schoolYear?: number | string): RecordingYearScope {
  const parsed = Number(schoolYear);
  const normalized = Number.isFinite(parsed) ? parsed : getCurrentSchoolYear();
  return normalized === getCurrentSchoolYear() ? 'current' : 'past';
}

export function normalizeRecordingType(value?: string | null): RecordingType {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized.includes('test') ||
    normalized.includes('exam') ||
    normalized.includes('テスト') ||
    normalized.includes('定期') ||
    normalized.includes('対策')
  ) {
    return 'test_prep';
  }
  return 'regular';
}

export function recordingTypeLabel(type?: string | null) {
  return normalizeRecordingType(type) === 'test_prep' ? 'テスト対策' : '通常授業';
}

export function normalizeSchoolYear(targetDate?: string, value?: string | number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 2000 ? parsed : getSchoolYearFromDate(targetDate);
}

export function isZoomRecordingShareUrl(value?: string | null) {
  return /^https?:\/\/(?:[^/]+\.)?zoom\.us\/rec\//i.test(String(value || '').trim());
}
