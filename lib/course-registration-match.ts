import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { weekdayFromDateKey } from '@/lib/date-key';
import { getCourseOptionStableKey } from '@/lib/course-registration-selection';
import { isTestPrepShift } from '@/lib/class-button-settings';

const normalize = normalizeCourseText;

const normalizeGrade = (value: any) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const subjectGroup = (value: any) => {
  return getCourseSubjectGroup(value);
};

export const fixedPeriodForGradeCourse = (gradeValue: any, courseValue: any): 1 | 2 | null => {
  const grade = normalizeGrade(gradeValue);
  const course = normalize(courseValue);
  if (grade === '中3' && (course.includes('物理') || course.includes('生物'))) return 1;
  // 登録上は同じ「公民」でも、配置表では枝番ごとに時限が分かれる。
  if (grade === '中3' && course.includes('公民')) {
    if (/公民(?:3|4)(?:$|[^0-9])/.test(course)) return 1;
    if (/公民(?:1|2)(?:$|[^0-9])/.test(course)) return 2;
  }
  return null;
};

export const canonicalPeriodForGradeSubject = (gradeValue: any, subjectValue: any, courseValue: any = ''): 1 | 2 | null => {
  const grade = normalizeGrade(gradeValue);
  const subject = subjectGroup(subjectValue);
  const fixedCoursePeriod = fixedPeriodForGradeCourse(gradeValue, courseValue || subjectValue);
  if (fixedCoursePeriod) return fixedCoursePeriod;
  if (grade === '中1' && subject === '社会') return 1;
  if (grade === '中1' && subject === '理科') return 2;
  if (grade === '中2' && subject === '理科') return 1;
  if (grade === '中2' && subject === '社会') return 2;
  return null;
};

const isMainShift = (shift: any) => {
  const role = normalize(shift.role_type || shift.role || shift.assignment_role);
  if (!role) return Boolean(getShiftGrade(shift) && (getShiftSubject(shift) || getShiftDetail(shift)));
  return role === 'main' || role === 'mainteacher' || role === 'teacher' || role.includes('担当') || role.includes('メイン');
};

const getShiftGrade = (shift: any) => normalizeGrade(
  shift.target_grade ||
  shift.grade ||
  shift.class_grade ||
  shift.student_grade ||
  shift.target_class
);

const getShiftSubject = (shift: any) => {
  const explicit = shift.target_subject || shift.subject || shift.class_subject || shift.course_subject;
  const explicitGroup = subjectGroup(explicit);
  if (explicitGroup) return explicitGroup;

  const detailGroup = subjectGroup(
    shift.target_detail_subject ||
    shift.detail_subject ||
    shift.course_name ||
    shift.class ||
    shift.title ||
    shift.unit
  );
  return detailGroup || String(explicit || '').trim();
};

const getShiftDetail = (shift: any) => String(
  shift.target_detail_subject ||
  shift.detail_subject ||
  shift.course_name ||
  shift.class ||
  shift.title ||
  shift.target_subject ||
  shift.subject ||
  ''
).trim();

const subjectMatchesShift = (rowSubject: any, shift: any) => {
  const rowNormalized = normalize(rowSubject);
  if (!rowNormalized) return true;

  const shiftSubject = getShiftSubject(shift) || getShiftDetail(shift);
  const shiftNormalized = normalize(shiftSubject);
  const rowGroup = subjectGroup(rowSubject);
  const shiftGroup = subjectGroup(shiftSubject);

  if (rowGroup && shiftGroup) return rowGroup === shiftGroup;
  return rowNormalized === shiftNormalized ||
    shiftNormalized.includes(rowNormalized) ||
    rowNormalized.includes(shiftNormalized);
};

const fallbackSlotsForClass = (gradeValue: any, subjectValue: any) => {
  const grade = normalizeGrade(gradeValue);
  // 中3は講師配置の実データから時限を決定するため、推測で補完しない。
  if (grade === '中3') return [];
  const canonicalPeriod = canonicalPeriodForGradeSubject(gradeValue, subjectValue);
  if (canonicalPeriod) return [`${canonicalPeriod}時間目`];
  return [];
};

const slotFromShift = (shift: any) => {
  const values = [
    shift.period,
    shift.target_period,
    shift.time_period,
    shift.class_period,
    shift.period_number,
    shift.lesson_period,
    shift.slot,
    shift.time_slot,
    shift.note,
  ];
  for (const value of values) {
    const raw = toAsciiDigits(String(value || '').trim());
    if (!raw) continue;
    if (/^1$/.test(raw) || raw.includes('1限') || raw.includes('1時間目') || raw.includes('1時限') || raw.includes('1コマ')) return '1時間目';
    if (/^2$/.test(raw) || raw.includes('2限') || raw.includes('2時間目') || raw.includes('2時限') || raw.includes('2コマ')) return '2時間目';
  }
  // 同期元が明示した時限を正とし、固定時間割は時限が欠損した旧データだけに使う。
  const fixedCoursePeriod = fixedPeriodForGradeCourse(getShiftGrade(shift), getShiftDetail(shift));
  if (fixedCoursePeriod) return `${fixedCoursePeriod}時間目`;
  const canonicalPeriod = canonicalPeriodForGradeSubject(
    getShiftGrade(shift),
    getShiftSubject(shift) || getShiftDetail(shift),
    getShiftDetail(shift),
  );
  if (canonicalPeriod) return `${canonicalPeriod}時間目`;
  return '';
};

const hasSheetSource = (shift: any) => Boolean(
  String(shift.source_spreadsheet_id || '').trim() ||
  ['google_sheet', 'google_sheets', 'gas'].includes(String(shift.sync_source || '').trim().toLowerCase())
);

const preferSheetSyncedShiftsByDatePeriod = (shifts: any[]) => {
  // Google配置表同期が1件でもある年度では、登録候補の基準をその同期元へ
  // 完全に統一する。旧CSV・手動取込を混在させると、同期済み期間の外側や
  // 誤った別時限の旧配置が講座登録へ復活してしまう。
  const sheetSynced = shifts.filter(hasSheetSource);
  return sheetSynced.length > 0 ? sheetSynced : shifts;
};

const canonicalTermAliases = (options: any[]) => {
  const termsByLabel = new Map<string, Map<string, number>>();
  options.forEach(option => {
    const term = String(option.term || '').trim();
    const label = normalize(option.term_label || term);
    if (!term || !label) return;
    if (!termsByLabel.has(label)) termsByLabel.set(label, new Map());
    const counts = termsByLabel.get(label)!;
    counts.set(term, (counts.get(term) || 0) + 1);
  });

  const aliases = new Map<string, string>();
  termsByLabel.forEach(counts => {
    const canonical = Array.from(counts.entries()).sort((a, b) => {
      const countDiff = b[1] - a[1];
      if (countDiff) return countDiff;
      const stableDiff = Number(/^term\d+$/.test(b[0])) - Number(/^term\d+$/.test(a[0]));
      return stableDiff || a[0].localeCompare(b[0]);
    })[0]?.[0];
    if (canonical) counts.forEach((_count, term) => aliases.set(term, canonical));
  });
  return aliases;
};

const expandShiftSlots = (shift: any, fallbackSource: any = {}) => {
  const day = weekdayFromDateKey(shift.target_date);
  if (!day) return [];
  const explicitSlot = slotFromShift(shift);
  const fallbackSlots = fallbackSlotsForClass(
    fallbackSource.grade || getShiftGrade(shift),
    fallbackSource.subject || getShiftSubject(shift) || getShiftDetail(shift)
  );
  const slots = explicitSlot ? [explicitSlot] : fallbackSlots;
  return slots.map(slot => ({
    ...shift,
    _day: day,
    _slot: slot,
    _slot_source: explicitSlot === slot ? 'shift_assignment' : 'grade_subject_fallback',
  }));
};

const sameTerm = (a: any, b: any) => {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return true;
  return left === right;
};

const sanitizeId = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 180);

const curriculumFallbackOptionId = (row: any) => `curriculum_${sanitizeId([
  row.id || '',
  row.year || '',
  row.term || '',
  normalizeGrade(row.grade),
  row.subject || '',
  row.course_name || '',
  row.unit || '',
].join('_'))}`;

const subjectMatches = (option: any, shift: any) => {
  const optionCourse = normalize(option.course_name || option.title);
  const optionSubject = normalize(option.subject);
  const shiftSubject = normalize(getShiftSubject(shift));
  const shiftDetail = normalize(getShiftDetail(shift));
  return (
    (optionCourse && (optionCourse === shiftDetail || optionCourse === shiftSubject || shiftDetail.includes(optionCourse) || optionCourse.includes(shiftDetail))) ||
    (optionSubject && (optionSubject === shiftSubject || optionSubject === shiftDetail))
  );
};

const courseMatches = (left: any, right: any) => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
};

const normalizeRegistrationCourse = (value: any) => normalize(value)
  .replace(/^通常/, '')
  // 講師配置の「対策」は別講座ではなく、通常講座の実施区分として扱う。
  .replace(/定期テスト対策|テスト対策|対策/g, '')
  .replace(/[①②③④⑤⑥⑦⑧⑨⑩]+$/g, '');

const registrationCourseDisplayName = (value: any) => String(value || '')
  .replace(/[【\[]\s*(?:定期テスト|テスト)?対策\s*[】\]]/g, '')
  .replace(/^(?:定期テスト|テスト)?対策[\s・:：-]*/, '')
  .replace(/^通常[\s・:：-]*/, '')
  // 公民①/公民②、生物I/生物IIなどの末尾番号は実施枝番とし、
  // 受講登録上は同一講座名にまとめる。
  .replace(/[①②③④⑤⑥⑦⑧⑨⑩ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+$/g, '')
  .replace(/[０-９0-9]+$/g, '')
  .trim();

const registrationCourseMatches = (curriculumCourse: any, shiftCourse: any) => {
  const curriculum = normalizeRegistrationCourse(curriculumCourse);
  const shift = normalizeRegistrationCourse(shiftCourse);
  if (!curriculum || !shift) return false;
  if (curriculum === shift) return true;

  const suffix = shift.startsWith(curriculum) ? shift.slice(curriculum.length) : '';
  return Boolean(suffix && /^[a-d1-9]+$/.test(suffix));
};

const unitMatches = (left: any, right: any) => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

const monthSortValue = (value: any) => {
  const raw = toAsciiDigits(String(value || ''));
  const match = raw.match(/(\d{1,2})/);
  return match ? Number(match[1]) : 99;
};

const weekSortValue = (value: any) => {
  const raw = toAsciiDigits(String(value || '').normalize('NFKC')).trim().toUpperCase();
  if (raw === 'SS') return 999;
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : 9999;
};

const curriculumSourceRow = (row: any) => {
  const value = Number(row.curriculum_order ?? row.raw?.row ?? row.source_row);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const compareCurriculumOrder = (a: any, b: any) => {
  const sourceRowA = curriculumSourceRow(a);
  const sourceRowB = curriculumSourceRow(b);
  if (sourceRowA !== null && sourceRowB !== null && sourceRowA !== sourceRowB) return sourceRowA - sourceRowB;
  const monthDiff = monthSortValue(a.month_label) - monthSortValue(b.month_label);
  if (monthDiff !== 0) return monthDiff;
  const weekDiff = weekSortValue(a.week_no || a.lesson_no) - weekSortValue(b.week_no || b.lesson_no);
  if (weekDiff !== 0) return weekDiff;
  return `${a.course_name || ''}_${a.unit || a.resolved_unit || ''}`.localeCompare(`${b.course_name || ''}_${b.unit || b.resolved_unit || ''}`, 'ja', { numeric: true });
};

const findCurriculumOption = (row: any, options: any[]) => {
  const grade = normalizeGrade(row.grade);
  const subject = normalize(row.subject);
  const course = normalize(row.course_name || row.title);
  const term = row.term || '';
  return options.find(option => (
    normalizeGrade(option.grade) === grade &&
    (!subject || normalize(option.subject) === subject) &&
    sameTerm(option.term, term) &&
    courseMatches(option.course_name || option.title, row.course_name || row.title)
  )) || null;
};

const getTermRangeKey = (row: any) => `${Number(row.year || 0)}__${String(row.term || '').trim()}`;

const shiftIsInsideTerm = (
  row: any,
  shift: any,
  termRanges: Record<string, { start: string; end: string }>,
) => {
  const range = termRanges[getTermRangeKey(row)];
  if (!range) return true;
  const date = String(shift.target_date || '').slice(0, 10);
  return Boolean(date && range.start <= date && date <= range.end);
};

const findShiftsForCurriculum = (
  row: any,
  shifts: any[],
  termRanges: Record<string, { start: string; end: string }>,
) => {
  const grade = normalizeGrade(row.grade);
  const course = row.course_name || row.title || '';
  const unit = row.unit || '';

  const candidates = shifts
    .filter(isMainShift)
    .filter(shift => getShiftGrade(shift) === grade)
    .filter(shift => shiftIsInsideTerm(row, shift, termRanges))
    .flatMap(shift => {
      const shiftCourse = getShiftDetail(shift) || getShiftSubject(shift);
      return expandShiftSlots(shift, row).map(expanded => ({
        ...expanded,
        _unitStrong: unitMatches(unit, shift.unit),
        _courseStrong: registrationCourseMatches(course, shiftCourse),
        _subjectStrong: subjectMatchesShift(row.subject, shift),
      }));
    })
    .filter(shift => shift._subjectStrong)
    .filter(shift => shift._unitStrong || shift._courseStrong)
    .filter(shift => shift._day && shift._slot);

  return candidates.map(shift => ({
    ...shift,
    _match_level: shift._unitStrong ? 'unit' : shift._courseStrong ? 'course' : 'subject',
  }));
};

const pickRepresentativeShift = (row: any, shifts: any[]) => {
  const sorted = [...shifts].sort((a, b) => {
    const strongDiff = Number(Boolean(b._unitStrong)) - Number(Boolean(a._unitStrong));
    if (strongDiff !== 0) return strongDiff;
    return `${a.target_date || ''}_${a._slot || ''}_${a._day || ''}`.localeCompare(`${b.target_date || ''}_${b._slot || ''}_${b._day || ''}`, 'ja');
  });
  return sorted[0] || null;
};

const findRelatedCurriculum = (source: any, curriculumRows: any[], optionYear = 0) => {
  const grade = normalizeGrade(source.grade || getShiftGrade(source));
  const subject = normalize(source.subject || getShiftSubject(source));
  const course = source.course_name || getShiftDetail(source) || source.title || '';
  const unit = normalize(source.unit);
  const term = source.term || '';

  return curriculumRows
    .filter(row => !optionYear || !row.year || Number(row.year) === optionYear)
    .filter(row => normalizeGrade(row.grade) === grade)
    .filter(row => sameTerm(row.term, term))
    .filter(row => {
      const rowSubject = normalize(row.subject);
      const rowCourse = row.course_name || row.title || '';
      const rowUnit = normalize(row.unit);
      const subjectOk = !subject || rowSubject === subject;
      const courseOk = !course || registrationCourseMatches(rowCourse, course);
      const unitOk = !unit || rowUnit === unit || rowUnit.includes(unit) || unit.includes(rowUnit);
      return subjectOk && (courseOk || unitOk);
    });
};

const findBaseOption = (shift: any, options: any[], relatedCurriculum: any[]) => {
  const grade = getShiftGrade(shift);
  const subject = normalize(getShiftSubject(shift));
  const detail = getShiftDetail(shift);
  const terms = new Set(relatedCurriculum.map(row => row.term).filter(Boolean));
  return options.find(option => {
    const optionCourse = option.course_name || option.title;
    const optionSubject = normalize(option.subject);
    const termOk = terms.size === 0 || !option.term || terms.has(option.term);
    return normalizeGrade(option.grade) === grade &&
      (!optionSubject || optionSubject === subject) &&
      (!optionCourse || registrationCourseMatches(optionCourse, detail)) &&
      termOk;
  }) || options.find(option => (
    normalizeGrade(option.grade) === grade &&
    normalize(option.subject) === subject &&
    (terms.size === 0 || !option.term || terms.has(option.term))
  ));
};

const buildShiftClassOptions = (
  options: any[],
  curriculumRows: any[],
  shifts: any[],
  termRanges: Record<string, { start: string; end: string }> = {},
) => {
  const mainShifts = shifts
    .filter(isMainShift)
    .filter(shift => getShiftGrade(shift) && getShiftSubject(shift))
    .filter(shift => {
      if (Object.keys(termRanges).length === 0 || curriculumRows.length === 0) return true;
      const relatedScopes = curriculumRows
        .filter(row => normalizeGrade(row.grade) === getShiftGrade(shift))
        .filter(row => subjectMatchesShift(row.subject, shift));
      return relatedScopes.some(row => shiftIsInsideTerm(row, shift, termRanges));
    })
    .flatMap(shift => expandShiftSlots(shift))
    .filter(shift => shift._day && shift._slot);

  const groups = new Map<string, any[]>();
  mainShifts.forEach(shift => {
    const stronglyRelated = findRelatedCurriculum(shift, curriculumRows, 0)
      .filter(row => shiftIsInsideTerm(row, shift, termRanges));
    const relatedCurriculum = stronglyRelated.length > 0 ? stronglyRelated : curriculumRows
      .filter(row => normalizeGrade(row.grade) === getShiftGrade(shift))
      .filter(row => subjectMatchesShift(row.subject, shift))
      .filter(row => shiftIsInsideTerm(row, shift, termRanges));
    const term = relatedCurriculum[0]?.term || 'term';
    const year = Number(relatedCurriculum[0]?.year || new Date(`${shift.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear());
    const key = sanitizeId([
      year,
      term,
      getShiftGrade(shift),
      getShiftSubject(shift),
      registrationCourseDisplayName(getShiftDetail(shift)),
      shift._day,
      shift._slot,
    ].join('_'));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });

  return Array.from(groups.entries()).map(([id, group]) => {
    const sorted = group.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
    const first = sorted[0];
    const stronglyRelated = findRelatedCurriculum(first, curriculumRows, 0)
      .filter(row => shiftIsInsideTerm(row, first, termRanges));
    const relatedCurriculum = stronglyRelated.length > 0 ? stronglyRelated : curriculumRows
      .filter(row => normalizeGrade(row.grade) === getShiftGrade(first))
      .filter(row => subjectMatchesShift(row.subject, first))
      .filter(row => shiftIsInsideTerm(row, first, termRanges));
    const baseOption = findBaseOption(first, options, relatedCurriculum);
    const units = Array.from(new Set([
      ...sorted.map(shift => String(shift.unit || '').trim()),
      ...relatedCurriculum.map(row => String(row.unit || '').trim()),
    ].filter(Boolean)));
    const detailSubjects = Array.from(new Set(sorted.map(shift => getShiftDetail(shift)).filter(Boolean)));
    const dates = Array.from(new Set(sorted.map(shift => String(shift.target_date || '').trim()).filter(Boolean)));
    const term = baseOption?.term || relatedCurriculum[0]?.term || 'term';
    const termLabel = baseOption?.term_label || relatedCurriculum[0]?.term_label || relatedCurriculum[0]?.notes?.split(' / ')[0] || '';
    const year = Number(baseOption?.year || relatedCurriculum[0]?.year || new Date(`${first.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear());

    const result = {
      ...(baseOption || {}),
      id: `shift_class_${id}`,
      parent_course_option_id: baseOption?.id || '',
      year,
      term,
      term_label: termLabel,
      grade: getShiftGrade(first),
      subject: getShiftSubject(first) || baseOption?.subject || '',
      course_name: registrationCourseDisplayName(getShiftDetail(first)) || baseOption?.course_name || getShiftSubject(first) || '講座',
      title: `${getShiftGrade(first)} ${getShiftSubject(first) || ''} ${registrationCourseDisplayName(getShiftDetail(first)) || ''}`.trim(),
      curriculum_units: units,
      matched_shift_ids: sorted.map(shift => shift.id).filter(Boolean),
      matched_detail_subjects: detailSubjects,
      matched_units: units,
      matched_dates: dates,
      resolved_day: first._day,
      resolved_slot: first._slot,
      resolved_slot_source: first._slot_source || 'shift_assignment',
      resolved_unit: units[0] || '',
      shift_match_status: 'matched',
      representative_policy: 'shift_class_day_slot',
      source: 'shift_class',
    };
    return { ...result, stable_course_key: getCourseOptionStableKey(result) };
  });
};

export const buildRegistrationClassOptions = (
  options: any[],
  curriculumRows: any[],
  shifts: any[],
  termRanges: Record<string, { start: string; end: string }> = {},
) => {
  // 通常受講登録に対策配置を混ぜない。対策は
  // test_prep_course_options と buildTestPrepRegistrationOptions で別管理する。
  const scopedShifts = preferSheetSyncedShiftsByDatePeriod(shifts).filter(shift => !isTestPrepShift(shift));
  const termAliases = canonicalTermAliases(options);
  const canonicalOptions = options.filter(option => {
    const term = String(option.term || '').trim();
    return !term || !termAliases.has(term) || termAliases.get(term) === term;
  });
  const canonicalRanges = Object.entries(termRanges).reduce((result, [key, range]) => {
    const separator = key.indexOf('__');
    const year = separator >= 0 ? key.slice(0, separator) : '';
    const term = separator >= 0 ? key.slice(separator + 2) : key;
    const canonicalTerm = termAliases.get(term) || term;
    const canonicalKey = `${year}__${canonicalTerm}`;
    const current = result[canonicalKey];
    result[canonicalKey] = current
      ? { start: current.start < range.start ? current.start : range.start, end: current.end > range.end ? current.end : range.end }
      : range;
    return result;
  }, {} as Record<string, { start: string; end: string }>);
  const activeCurriculum = curriculumRows
    .filter(row => row && row.grade && row.subject && (row.course_name || row.unit))
    .map(row => ({ ...row, term: termAliases.get(String(row.term || '').trim()) || row.term }))
    .sort((a, b) => {
      const scope = `${a.year || 0}_${a.term || ''}_${normalizeGrade(a.grade)}_${a.subject || ''}_${a.course_name || ''}`
        .localeCompare(`${b.year || 0}_${b.term || ''}_${normalizeGrade(b.grade)}_${b.subject || ''}_${b.course_name || ''}`, 'ja', { numeric: true });
      return scope || compareCurriculumOrder(a, b);
    });

  // 曜日・時限・講座の組み合わせは講師配置だけを正とする。カリキュラムは
  // 期・単元・既存option IDを補うために利用し、未配置の講座を登録候補にはしない。
  const placementOptions = buildShiftClassOptions(canonicalOptions, activeCurriculum, scopedShifts, canonicalRanges);
  if (placementOptions.length > 0) {
    return placementOptions.sort((a, b) => `${a.year}_${a.term}_${a.grade}_${a.subject}_${a.resolved_day}_${a.resolved_slot}_${a.course_name}`
      .localeCompare(`${b.year}_${b.term}_${b.grade}_${b.subject}_${b.resolved_day}_${b.resolved_slot}_${b.course_name}`, 'ja', { numeric: true }));
  }

  if (activeCurriculum.length > 0) {
    const curriculumOptions: any[] = [];
    activeCurriculum.forEach(row => {
      const matchedShifts = findShiftsForCurriculum(row, scopedShifts, canonicalRanges);
      const baseOption = findCurriculumOption(row, canonicalOptions);

      if (matchedShifts.length === 0) {
        const id = curriculumFallbackOptionId(row);
        curriculumOptions.push({
          ...(baseOption || {}),
          id,
          fallback_curriculum_option_id: id,
          parent_course_option_id: baseOption?.id || '',
          year: Number(row.year || baseOption?.year || new Date().getFullYear()),
          term: row.term || baseOption?.term || 'term',
          term_label: row.term_label || baseOption?.term_label || '',
          grade: normalizeGrade(row.grade),
          subject: row.subject || baseOption?.subject || '',
          course_name: row.course_name || baseOption?.course_name || row.subject || '講座',
          title: `${normalizeGrade(row.grade)} ${row.subject || ''} ${row.course_name || row.subject || ''}`,
          curriculum_row_id: row.id || '',
          curriculum_units: [row.unit].filter(Boolean),
          matched_units: [row.unit].filter(Boolean),
          matched_dates: [],
          month_label: row.month_label || '',
          week_no: row.week_no || '',
          curriculum_order: curriculumSourceRow(row),
          resolved_day: '',
          resolved_slot: '',
          resolved_unit: row.unit || '',
          shift_match_status: 'unmatched',
          source: 'curriculum_unmatched',
        });
        return;
      }

      const shiftGroups = matchedShifts.reduce((map: Map<string, any[]>, shift: any) => {
        const key = `${shift._day || ''}_${shift._slot || ''}`;
        if (!key.trim()) return map;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(shift);
        return map;
      }, new Map<string, any[]>());

      Array.from(shiftGroups.values()).forEach(groupedShifts => {
        const first = pickRepresentativeShift(row, groupedShifts);
        if (!first) return;
        const sorted = groupedShifts.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
        const id = `class_${sanitizeId([
          row.year || '',
          row.term || '',
          normalizeGrade(row.grade),
          row.subject || '',
          row.course_name || '',
          row.unit || '',
          first._day || '',
          first._slot || '',
        ].join('_'))}`;
        const dates = Array.from(new Set(sorted.map(shift => String(shift.target_date || '').trim()).filter(Boolean)));
        const units = [String(row.unit || '').trim()].filter(Boolean);
        const matchedShiftUnits = Array.from(new Set(sorted.map(shift => String(shift.unit || '').trim()).filter(Boolean)));
        const detailSubjects = Array.from(new Set(sorted.map(shift => getShiftDetail(shift)).filter(Boolean)));
        curriculumOptions.push({
          ...(baseOption || {}),
          id,
          fallback_curriculum_option_id: curriculumFallbackOptionId(row),
          parent_course_option_id: baseOption?.id || '',
          year: Number(row.year || baseOption?.year || new Date(`${first.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear()),
          term: row.term || baseOption?.term || 'term',
          term_label: row.term_label || baseOption?.term_label || '',
          grade: normalizeGrade(row.grade),
          subject: row.subject || baseOption?.subject || getShiftSubject(first) || '',
          course_name: row.course_name || getShiftDetail(first) || baseOption?.course_name || '講座',
          title: `${normalizeGrade(row.grade)} ${row.subject || ''} ${row.course_name || getShiftDetail(first) || ''}`,
          curriculum_row_id: row.id || '',
          curriculum_units: units,
          matched_shift_ids: sorted.map(shift => shift.id).filter(Boolean),
          matched_detail_subjects: detailSubjects,
          matched_units: units,
          matched_shift_units: matchedShiftUnits,
          matched_dates: dates,
          month_label: row.month_label || '',
          week_no: row.week_no || '',
          curriculum_order: curriculumSourceRow(row),
          resolved_day: first._day,
          resolved_slot: first._slot,
          resolved_slot_source: first._slot_source || 'shift_assignment',
          resolved_unit: row.unit || units[0] || '',
          shift_match_status: first._match_level === 'unit' ? 'matched' : first._match_level === 'course' ? 'course_matched' : 'subject_matched',
          representative_policy: 'day_slot_per_term_unit',
          source: 'curriculum_shift_class',
        });
      });
    });

    const uniqueOptions = Array.from(curriculumOptions.reduce((map: Map<string, any>, option: any) => {
      const key = `${option.year}_${option.term}_${option.grade}_${normalize(option.subject)}_${normalize(option.course_name)}_${normalize(option.resolved_unit)}_${normalize(option.resolved_day)}_${normalize(option.resolved_slot)}`;
      const current = map.get(key);
      if (!current) {
        map.set(key, option);
        return map;
      }
      const currentRank = current.shift_match_status === 'matched' ? 2 : current.shift_match_status === 'course_matched' ? 1 : 0;
      const nextRank = option.shift_match_status === 'matched' ? 2 : option.shift_match_status === 'course_matched' ? 1 : 0;
      if (nextRank > currentRank) map.set(key, option);
      return map;
    }, new Map<string, any>()).values()) as any[];

    return uniqueOptions.map(option => ({
      ...option,
      stable_course_key: getCourseOptionStableKey(option),
    })).sort((a, b) => {
      const scope = `${a.year}_${a.term}_${a.grade}_${a.subject}_${a.course_name}_${a.resolved_day}_${a.resolved_slot}`
        .localeCompare(`${b.year}_${b.term}_${b.grade}_${b.subject}_${b.course_name}_${b.resolved_day}_${b.resolved_slot}`, 'ja', { numeric: true });
      return scope || compareCurriculumOrder(a, b);
    });
  }

  const classOptions = buildShiftClassOptions(canonicalOptions, curriculumRows, scopedShifts, canonicalRanges);

  if (classOptions.length > 0) {
    return classOptions.sort((a, b) => `${a.year}_${a.term}_${a.grade}_${a.resolved_day}_${a.resolved_slot}_${a.course_name}`.localeCompare(`${b.year}_${b.term}_${b.grade}_${b.resolved_day}_${b.resolved_slot}_${b.course_name}`));
  }

  return canonicalOptions.map(option => {
    const optionYear = Number(option.year || 0);
    const relatedCurriculum = findRelatedCurriculum(option, curriculumRows, optionYear);
    const units = Array.from(new Set(relatedCurriculum.map(row => String(row.unit || '').trim()).filter(Boolean)));
    const result = {
      ...option,
      curriculum_units: units,
      matched_units: units,
      matched_dates: [],
      resolved_day: option.day || option.day_of_week || '',
      resolved_slot: option.slot || option.time_slot || '',
      resolved_unit: units[0] || option.unit || '',
      shift_match_status: 'unmatched',
    };
    return { ...result, stable_course_key: getCourseOptionStableKey(result) };
  });
};

export const enrichCourseOptionsWithShifts = buildRegistrationClassOptions;
