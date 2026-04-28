const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const normalize = (value: any) => toAsciiDigits(String(value || '').normalize('NFKC'))
  .toLowerCase()
  .replace(/\s+/g, '')
  .replace(/[（）()【】\[\]第・,，、]/g, '')
  .trim();

const normalizeGrade = (value: any) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const slotFromShift = (shift: any) => {
  const raw = toAsciiDigits(String(shift.note || shift.time_slot || shift.slot || ''));
  if (raw.includes('1限') || raw.includes('1時間目')) return '1時間目';
  if (raw.includes('2限') || raw.includes('2時間目')) return '2時間目';
  return '';
};

const dayFromDate = (value: any) => {
  const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? '' : DAYS[date.getDay()];
};

const sameTerm = (a: any, b: any) => {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return true;
  return left === right;
};

const sanitizeId = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 180);

const subjectMatches = (option: any, shift: any) => {
  const optionCourse = normalize(option.course_name || option.title);
  const optionSubject = normalize(option.subject);
  const shiftSubject = normalize(shift.target_subject);
  const shiftDetail = normalize(shift.target_detail_subject);
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

const findShiftsForCurriculum = (row: any, shifts: any[]) => {
  const grade = normalizeGrade(row.grade);
  const subject = normalize(row.subject);
  const course = row.course_name || row.title || '';
  const unit = row.unit || '';

  const candidates = shifts
    .filter(shift => shift.role_type === 'main')
    .filter(shift => normalizeGrade(shift.target_grade) === grade)
    .filter(shift => {
      const shiftSubject = normalize(shift.target_subject);
      return !subject || shiftSubject === subject || courseMatches(row.subject, shift.target_subject);
    })
    .filter(shift => courseMatches(course, shift.target_detail_subject || shift.target_subject))
    .map(shift => ({
      ...shift,
      _day: dayFromDate(shift.target_date),
      _slot: slotFromShift(shift),
      _unitStrong: unitMatches(unit, shift.unit),
    }))
    .filter(shift => shift._day && shift._slot);

  const strong = candidates.filter(shift => shift._unitStrong);
  return strong.length > 0 ? strong : candidates;
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
  const grade = normalizeGrade(source.grade || source.target_grade);
  const subject = normalize(source.subject || source.target_subject);
  const course = normalize(source.course_name || source.target_detail_subject || source.title);
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
  const grade = normalizeGrade(shift.target_grade);
  const subject = normalize(shift.target_subject);
  const detail = normalize(shift.target_detail_subject);
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

export const buildRegistrationClassOptions = (options: any[], curriculumRows: any[], shifts: any[]) => {
  const activeCurriculum = curriculumRows
    .filter(row => row && row.grade && row.subject && (row.course_name || row.unit))
    .sort((a, b) => {
      const left = `${a.year || 0}_${a.term || ''}_${normalizeGrade(a.grade)}_${monthSortValue(a.month_label)}_${a.week_no || ''}_${a.subject || ''}_${a.course_name || ''}_${a.unit || ''}`;
      const right = `${b.year || 0}_${b.term || ''}_${normalizeGrade(b.grade)}_${monthSortValue(b.month_label)}_${b.week_no || ''}_${b.subject || ''}_${b.course_name || ''}_${b.unit || ''}`;
      return left.localeCompare(right, 'ja');
    });

  if (activeCurriculum.length > 0) {
    const curriculumOptions: any[] = [];
    activeCurriculum.forEach(row => {
      const matchedShifts = findShiftsForCurriculum(row, shifts);
      const baseOption = findCurriculumOption(row, options);

      if (matchedShifts.length === 0) {
        const id = `curriculum_${sanitizeId([
          row.id || '',
          row.year || '',
          row.term || '',
          normalizeGrade(row.grade),
          row.subject || '',
          row.course_name || '',
          row.unit || '',
        ].join('_'))}`;
        curriculumOptions.push({
          ...(baseOption || {}),
          id,
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
          resolved_day: '',
          resolved_slot: '',
          resolved_unit: row.unit || '',
          shift_match_status: 'unmatched',
          source: 'curriculum_unmatched',
        });
        return;
      }

      const first = pickRepresentativeShift(row, matchedShifts);
      if (first) {
        const sorted = matchedShifts.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
        const id = `class_${sanitizeId([
          row.year || '',
          row.term || '',
          normalizeGrade(row.grade),
          row.subject || '',
          row.course_name || '',
          row.unit || '',
        ].join('_'))}`;
        const dates = Array.from(new Set(sorted.map(shift => String(shift.target_date || '').trim()).filter(Boolean)));
        const units = Array.from(new Set([row.unit, ...sorted.map(shift => shift.unit)].map(v => String(v || '').trim()).filter(Boolean)));
        curriculumOptions.push({
          ...(baseOption || {}),
          id,
          parent_course_option_id: baseOption?.id || '',
          year: Number(row.year || baseOption?.year || new Date(`${first.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear()),
          term: row.term || baseOption?.term || 'term',
          term_label: row.term_label || baseOption?.term_label || '',
          grade: normalizeGrade(row.grade),
          subject: row.subject || baseOption?.subject || first.target_subject || '',
          course_name: row.course_name || first.target_detail_subject || baseOption?.course_name || '講座',
          title: `${normalizeGrade(row.grade)} ${row.subject || ''} ${row.course_name || first.target_detail_subject || ''}`,
          curriculum_row_id: row.id || '',
          curriculum_units: units,
          matched_shift_ids: sorted.map(shift => shift.id).filter(Boolean),
          matched_units: units,
          matched_dates: dates,
          month_label: row.month_label || '',
          week_no: row.week_no || '',
          resolved_day: first._day,
          resolved_slot: first._slot,
          resolved_unit: row.unit || units[0] || '',
          shift_match_status: first._unitStrong ? 'matched' : 'course_matched',
          representative_policy: 'one_day_per_term_unit',
          source: 'curriculum_shift_class',
        });
      }
    });

    const uniqueOptions = Array.from(curriculumOptions.reduce((map: Map<string, any>, option: any) => {
      const key = `${option.year}_${option.term}_${option.grade}_${normalize(option.subject)}_${normalize(option.course_name)}_${normalize(option.resolved_unit)}`;
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
      const left = `${a.year}_${a.term}_${a.grade}_${monthSortValue(a.month_label)}_${a.week_no || ''}_${a.subject}_${a.course_name}_${a.resolved_day}_${a.resolved_slot}_${a.resolved_unit}`;
      const right = `${b.year}_${b.term}_${b.grade}_${monthSortValue(b.month_label)}_${b.week_no || ''}_${b.subject}_${b.course_name}_${b.resolved_day}_${b.resolved_slot}_${b.resolved_unit}`;
      return left.localeCompare(right, 'ja');
    });
  }

  const mainShifts = shifts
    .filter(shift => shift.role_type === 'main')
    .filter(shift => shift.target_grade && shift.target_subject && shift.target_detail_subject)
    .map(shift => ({
      ...shift,
      _day: dayFromDate(shift.target_date),
      _slot: slotFromShift(shift),
    }))
    .filter(shift => shift._day && shift._slot);

  const groups = new Map<string, any[]>();
  mainShifts.forEach(shift => {
    const relatedCurriculum = findRelatedCurriculum(shift, curriculumRows, 0);
    const term = relatedCurriculum[0]?.term || 'term';
    const year = Number(relatedCurriculum[0]?.year || new Date(`${shift.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear());
    const key = sanitizeId([
      year,
      term,
      normalizeGrade(shift.target_grade),
      shift.target_subject,
      shift.target_detail_subject,
      shift._day,
      shift._slot,
    ].join('_'));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });

  const classOptions = Array.from(groups.entries()).map(([id, group]) => {
    const sorted = group.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
    const first = sorted[0];
    const relatedCurriculum = findRelatedCurriculum(first, curriculumRows, 0);
    const baseOption = findBaseOption(first, options, relatedCurriculum);
    const units = Array.from(new Set([
      ...sorted.map(shift => String(shift.unit || '').trim()),
      ...relatedCurriculum.map(row => String(row.unit || '').trim()),
    ].filter(Boolean)));
    const dates = Array.from(new Set(sorted.map(shift => String(shift.target_date || '').trim()).filter(Boolean)));
    const term = baseOption?.term || relatedCurriculum[0]?.term || 'term';
    const termLabel = baseOption?.term_label || relatedCurriculum[0]?.term_label || relatedCurriculum[0]?.notes?.split(' / ')[0] || '';
    const year = Number(baseOption?.year || relatedCurriculum[0]?.year || new Date(`${first.target_date}T00:00:00+09:00`).getFullYear() || new Date().getFullYear());

    return {
      ...(baseOption || {}),
      id: `class_${id}`,
      parent_course_option_id: baseOption?.id || '',
      year,
      term,
      term_label: termLabel,
      grade: normalizeGrade(first.target_grade),
      subject: first.target_subject || baseOption?.subject || '',
      course_name: first.target_detail_subject || baseOption?.course_name || '講座',
      title: `${normalizeGrade(first.target_grade)} ${first.target_subject || ''} ${first.target_detail_subject || ''}`,
      curriculum_units: units,
      matched_shift_ids: sorted.map(shift => shift.id).filter(Boolean),
      matched_units: units,
      matched_dates: dates,
      resolved_day: first._day,
      resolved_slot: first._slot,
      resolved_unit: units[0] || '',
      shift_match_status: 'matched',
      source: 'shift_class',
    };
  });

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
