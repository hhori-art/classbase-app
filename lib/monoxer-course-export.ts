import { getCourseSubjectGroup } from './course-text';

/**
 * 受講曜日・分野の登録状況を、Monoxer の講座登録用シート（Monoxer_講座登録用 の Monoxer_List、G〜N列）と
 * 同じ形で出力する。
 *   理社_曜日①「木曜」／理社_科目①「中1化学Ⅲ」… を最大4組（それ以上の登録があれば列を足す）。
 * 分野名のきまり（シートの値に合わせる）
 *   中1・中2の理科：学年＋講座名＋期（中1化学Ⅲ）
 *   中1・中2の社会：講座名＋期（地理BⅢ・歴史AⅢ）
 *   中3：学年＋講座名＋期（中3物理Ⅳ・中3公民②Ⅳ）
 *   中3公民の①〜④は、人数を分けるための番号（シートの割り振りと同じ）
 *     2時間目：①（神戸・三田・創造学園の校舎）／②（垂水・須磨海浜より西の校舎）
 *     1時間目：③（同上）／④（同上）
 *   期は登録した期と今の期のうち新しい方。
 */

export type CourseSlot = {
  day: string;
  slot?: string;
  grade: string;
  subject: string;
  course: string;
  term?: string;
  term_label?: string;
  /** 今の期の名前。登録が前の期のままなら、こちらの数字で出す。 */
  current_term_label?: string;
};

type MonoxerStudent = {
  school_id?: string;
  lifetime_id?: string;
  student_name?: string;
  grade?: string;
  selected_course_slots?: CourseSlot[];
};

const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
const ASCII_ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

/** 「第III期」「第Ⅲ期」「3期」「term3」→「Ⅲ」。読み取れなければ空。 */
export function termNumeral(termLabel?: string, term?: string) {
  const label = String(termLabel || '').trim();
  const fullWidth = label.match(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/)?.[0];
  if (fullWidth) return fullWidth;
  const ascii = label.match(/第?\s*([IVX]+)\s*期/i)?.[1]?.toUpperCase();
  if (ascii && ASCII_ROMAN[ascii]) return ROMAN[ASCII_ROMAN[ascii]];
  const digit = label.normalize('NFKC').match(/第?\s*(\d{1,2})\s*期/)?.[1] || String(term || '').match(/^term(\d{1,2})$/i)?.[1];
  const n = Number(digit || 0);
  return n >= 1 && n <= 10 ? ROMAN[n] : '';
}

const normalizeGrade = (value: unknown) => {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, '');
  const match = text.match(/([小中高])学?(\d)/);
  return match ? `${match[1]}${match[2]}` : text;
};

/** 講座名から「通常」「【対策】」や空白を除く。①などの丸数字は分野名の一部なので残す。 */
const cleanCourseName = (value: unknown) => String(value || '')
  .replace(/【[^】]*】/g, '')
  .replace(/[\s　]+/g, '')
  .replace(/^通常(?:講座)?/, '');

export const normalizeDay = (value: unknown) => String(value || '').normalize('NFKC').replace(/曜日?$/, '').trim().slice(0, 1);

/** 中3公民で②・④（2つ目の組）になる校舎。ここにない校舎は①・③。 */
const CIVICS_SECOND_GROUP_SCHOOLS = [
  '舞子坂', '霞ヶ丘', '須磨海浜', '青山台', '垂水本部',
  '明石本部', '魚住', '西明石', '大久保本部', '播磨', '浜の宮', '東加古川', '野口', '土山', '小野', '加古川本部', '宝殿', '高砂', '曽根',
  '手柄本部', '姫路本部', '安室', '花北', '姫路白浜', 'ひめじ別所', '西飾磨',
];

const normalizeSchool = (value: unknown) => String(value || '').normalize('NFKC').replace(/[\s　]+/g, '').replace(/ケ/g, 'ヶ');

/** 中3公民の組番号（①〜④）。時限が読めなければ空。 */
export function civicsGroupNumber(slot: CourseSlot, school?: string) {
  const period = String(slot.slot || '').normalize('NFKC').match(/[12]/)?.[0];
  if (!period) return '';
  const name = normalizeSchool(school);
  const second = CIVICS_SECOND_GROUP_SCHOOLS.some(core => name.includes(normalizeSchool(core)));
  if (period === '2') return second ? '②' : '①';
  return second ? '④' : '③';
}

export function monoxerFieldName(slot: CourseSlot, school?: string) {
  const grade = normalizeGrade(slot.grade);
  const course = cleanCourseName(slot.course) || cleanCourseName(slot.subject);
  if (!course) return '';
  // 登録した期と今の期のうち新しい方（前の期の登録が続いている生徒は今の期、次の期を先に登録した生徒はその期）。
  const registered = termNumeral(slot.term_label, slot.term);
  const current = termNumeral(slot.current_term_label);
  const numeral = ROMAN.indexOf(current) > ROMAN.indexOf(registered) ? current : registered;
  const science = getCourseSubjectGroup(`${slot.subject} ${course}`) === '理科';
  const withGrade = (grade === '中3' || science) && grade && !course.startsWith(grade);
  const civicsNumber = grade === '中3' && course === '公民' ? civicsGroupNumber(slot, school) : '';
  return `${withGrade ? grade : ''}${course}${civicsNumber}${numeral}`;
}

const slotOrder = (slot: CourseSlot) => {
  const day = DAY_ORDER.indexOf(normalizeDay(slot.day));
  const period = Number(String(slot.slot || '').normalize('NFKC').match(/\d/)?.[0] || 9);
  return (day < 0 ? 9 : day) * 10 + period;
};

/** 生徒ごとの「曜日・分野」の組（曜日→時限の順、同じ分野・曜日は1つにまとめる）。 */
export function monoxerCoursePairs(slots: CourseSlot[] = [], school?: string) {
  const seen = new Set<string>();
  return [...slots]
    .sort((a, b) => slotOrder(a) - slotOrder(b))
    .map(slot => ({ day: normalizeDay(slot.day) ? `${normalizeDay(slot.day)}曜` : '', field: monoxerFieldName(slot, school) }))
    .filter(pair => pair.field)
    .filter(pair => {
      const key = `${pair.day}|${pair.field}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  // 表計算ソフトが数式として扱わないようにする。
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function buildMonoxerCourseCsv(students: MonoxerStudent[], school: string) {
  const pairsByStudent = students.map(student => monoxerCoursePairs(student.selected_course_slots || [], student.school_id || school));
  const columns = Math.max(4, ...pairsByStudent.map(pairs => pairs.length));
  const headers = [
    '生徒番号', '表示名', '校舎', '学年',
    ...Array.from({ length: columns }, (_, index) => [`理社_曜日${CIRCLED[index] || index + 1}`, `理社_科目${CIRCLED[index] || index + 1}`]).flat(),
  ];
  const rows = students.map((student, index) => {
    const pairs = pairsByStudent[index];
    return [
      student.lifetime_id || '',
      student.student_name || '',
      student.school_id || school,
      student.grade || '',
      ...Array.from({ length: columns }, (_, column) => [pairs[column]?.day || '', pairs[column]?.field || '']).flat(),
    ];
  });
  return `﻿${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}
