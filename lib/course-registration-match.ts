import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { weekdayFromDateKey } from '@/lib/date-key';

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
  const subject = subjectGroup(subjectValue);
  if (grade === '中3') return ['1時間目', '2時間目'];
  if (grade === '中1') {
    if (subject === '社会') return ['1時間目'];
    if (subject === '理科') return ['2時間目'];
  }
  if (grade === '中2') {
    if (subject === '理科') return ['1時間目'];
    if (subject === '社会') return ['2時間目'];
  }
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
  return '';
};

const hasSheetSource = (shift: any) => Boolean(
  String(shift.source_spreadsheet_id || '').trim() ||
  String(shift.sync_source || '').trim() ||
  String(shift.sync_key || '').trim()
);

const preferSheetSyncedShiftsByDatePeriod = (shifts: any[]) => {
  const groups = new Map<string, any[]>();
  shifts.forEach(shift => {
    const key = `${shift.target_date || ''}_${slotFromShift(shift) || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });
  return Array.from(groups.values()).flatMap(group => {
    const sheetSynced = group.filter(hasSheetSource);
    return sheetSynced.length > 0 ? sheetSynced : group;
  });
};

const expandShiftSlots = (shift: any, fallbackSource: any = {}) => {
  const day = weekdayFromDateKey(shift.target_date);
  if (!day) return [];
  const explicitSlot = slotFromShift(shift);
  const slots = explicitSlot
    ? [explicitSlot]
    : fallbackSlotsForClass(
      fallbackSource.grade || getShiftGrade(shift),
      fallbackSource.subject || getShiftSubject(shift) || getShiftDetail(shift)
    );
  return slots.map(slot => ({
    ...shift,
    _day: day,
    _slot: slot,
    _slot_source: explicitSlot ? 'shift_assignment' : 'grade_subject_fallback',
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

const isTestPrepCourse = (value: any) => normalize(value).includes('対策');

const normalizeRegistrationCourse = (value: any) => normalize(value)
  .replace(/^通常/, '')
  .replace(/[①②③④⑤⑥⑦⑧⑨⑩]+$/g, '');

const registrationCourseMatches = (curriculumCourse: any, shiftCourse: any) => {
  const curriculum = normalizeRegistrationCourse(curriculumCourse);
  const shift = normalizeRegistrationCourse(shiftCourse);
  if (!curriculum || !shift) return false;
  if (isTestPrepCourse(curriculumCourse) !== isTestPrepCourse(shiftCourse)) return false;
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
        _courseTypeStrong: isTestPrepCourse(course) === isTestPrepCourse(shiftCourse),
      }));
    })
    .filter(shift => shift._subjectStrong)
    .filter(shift => shift._courseTypeStrong)
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
  const course = normalize(source.course_name || getShiftDetail(source) || source.title);
  const unit = normalize(source.unit);
  const term = source.term || '';

  return curriculumRows
    .filter(row => !optionYear || !row.year || Number(row.year) === optionYear)
    .filter(row => normalizeGrade(row.grade) === grade)
    .filter(row => sameTerm(row.term, term))
    .filter(row => {
      const rowSubject = normalize(row.subject);
      const rowCourse = normalize(row.course_name || row.title);
      const rowUnit = normalize(row.unit);
      const subjectOk = !subject || rowSubject === subject;
      const courseOk = !course || rowCourse === course || course.includes(rowCourse) || rowCourse.includes(course);
      const unitOk = !unit || rowUnit === unit || rowUnit.includes(unit) || unit.includes(rowUnit);
      return subjectOk && (courseOk || unitOk);
    });
};

const findBaseOption = (shift: any, options: any[], relatedCurriculum: any[]) => {
  const grade = getShiftGrade(shift);
  const subject = normalize(getShiftSubject(shift));
  const detail = normalize(getShiftDetail(shift));
  const terms = new Set(relatedCurriculum.map(row => row.term).filter(Boolean));
  return options.find(option => {
    const optionCourse = normalize(option.course_name || option.title);
    const optionSubject = normalize(option.subject);
    const termOk = terms.size === 0 || !option.term || terms.has(option.term);
    return normalizeGrade(option.grade) === grade &&
      (!optionSubject || optionSubject === subject) &&
      (!optionCourse || optionCourse === detail || detail.includes(optionCourse) || optionCourse.includes(detail)) &&
      termOk;
  }) || options.find(option => normalizeGrade(option.grade) === grade && normalize(option.subject) === subject);
};

const buildShiftClassOptions = (options: any[], curriculumRows: any[], shifts: any[]) => {
  const mainShifts = shifts
    .filter(isMainShift)
    .filter(shift => getShiftGrade(shift) && getShiftSubject(shift) && getShiftDetail(shift))
    .flatMap(shift => expandShiftSlots(shift))
    .filter(shift => shift._day && shift._slot);

  const groups = new Map<string, any[]>();
  mainShifts.forEach(shift => {
    const relatedCurriculum = findRelatedCurriculum(shift, curriculumRows, 0);
    const term = relatedCurriculum[0]?.term || 'term';
    const year = Number(relatedCurriculum[0]?.year || new Date(`${shift.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear());
    const key = sanitizeId([
      year,
      term,
      getShiftGrade(shift),
      getShiftSubject(shift),
      getShiftDetail(shift),
      shift._day,
      shift._slot,
    ].join('_'));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });

  return Array.from(groups.entries()).map(([id, group]) => {
    const sorted = group.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
    const first = sorted[0];
    const relatedCurriculum = findRelatedCurriculum(first, curriculumRows, 0);
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

    return {
      ...(baseOption || {}),
      id: `shift_class_${id}`,
      parent_course_option_id: baseOption?.id || '',
      year,
      term,
      term_label: termLabel,
      grade: getShiftGrade(first),
      subject: getShiftSubject(first) || baseOption?.subject || '',
      course_name: getShiftDetail(first) || baseOption?.course_name || '講座',
      title: `${getShiftGrade(first)} ${getShiftSubject(first) || ''} ${getShiftDetail(first) || ''}`,
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
  });
};

export const buildRegistrationClassOptions = (
  options: any[],
  curriculumRows: any[],
  shifts: any[],
  termRanges: Record<string, { start: string; end: string }> = {},
) => {
  const scopedShifts = preferSheetSyncedShiftsByDatePeriod(shifts);
  const activeCurriculum = curriculumRows
    .filter(row => row && row.grade && row.subject && (row.course_name || row.unit))
    .sort((a, b) => {
      const scope = `${a.year || 0}_${a.term || ''}_${normalizeGrade(a.grade)}_${a.subject || ''}_${a.course_name || ''}`
        .localeCompare(`${b.year || 0}_${b.term || ''}_${normalizeGrade(b.grade)}_${b.subject || ''}_${b.course_name || ''}`, 'ja', { numeric: true });
      return scope || compareCurriculumOrder(a, b);
    });

  if (activeCurriculum.length > 0) {
    const curriculumOptions: any[] = [];
    activeCurriculum.forEach(row => {
      const matchedShifts = findShiftsForCurriculum(row, scopedShifts, termRanges);
      const baseOption = findCurriculumOption(row, options);

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

    return uniqueOptions.sort((a, b) => {
      const scope = `${a.year}_${a.term}_${a.grade}_${a.subject}_${a.course_name}_${a.resolved_day}_${a.resolved_slot}`
        .localeCompare(`${b.year}_${b.term}_${b.grade}_${b.subject}_${b.course_name}_${b.resolved_day}_${b.resolved_slot}`, 'ja', { numeric: true });
      return scope || compareCurriculumOrder(a, b);
    });
  }

  const classOptions = buildShiftClassOptions(options, curriculumRows, scopedShifts);

  if (classOptions.length > 0) {
    return classOptions.sort((a, b) => `${a.year}_${a.term}_${a.grade}_${a.resolved_day}_${a.resolved_slot}_${a.course_name}`.localeCompare(`${b.year}_${b.term}_${b.grade}_${b.resolved_day}_${b.resolved_slot}_${b.course_name}`));
  }

  return options.map(option => {
    const optionYear = Number(option.year || 0);
    const relatedCurriculum = findRelatedCurriculum(option, curriculumRows, optionYear);
    const units = Array.from(new Set(relatedCurriculum.map(row => String(row.unit || '').trim()).filter(Boolean)));
    return {
      ...option,
      curriculum_units: units,
      matched_units: units,
      matched_dates: [],
      resolved_day: option.day || option.day_of_week || '',
      resolved_slot: option.slot || option.time_slot || '',
      resolved_unit: units[0] || option.unit || '',
      shift_match_status: 'unmatched',
    };
  });
};

export const enrichCourseOptionsWithShifts = buildRegistrationClassOptions;
