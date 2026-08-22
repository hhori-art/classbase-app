const ROMAN_NUMBER_MAP: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
};

const COURSE_PREFIX_PATTERN = /(理科|社会|地理|歴史|公民|物理|化学|生物|地学)(vi|iv|iii|ii|v|i)/g;

export const toAsciiDigits = (value: string) =>
  value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

export const normalizeCourseText = (value: unknown) => {
  let text = toAsciiDigits(String(value || '').normalize('NFKC'))
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()【】\[\]第・,，、]/g, '')
    .trim();

  text = text.replace(COURSE_PREFIX_PATTERN, (_, prefix: string, roman: string) => {
    return `${prefix}${ROMAN_NUMBER_MAP[roman] || roman}`;
  });

  return ROMAN_NUMBER_MAP[text] || text;
};

export const getCourseSubjectGroup = (value: unknown) => {
  const normalized = normalizeCourseText(value);
  if (!normalized) return '';
  if (normalized.includes('理科') || ['物理', '化学', '生物', '地学'].some(subject => normalized.includes(subject))) return '理科';
  if (normalized.includes('社会') || ['地理', '歴史', '公民'].some(subject => normalized.includes(subject))) return '社会';
  return '';
};
