export type LegacyCourseSelection = {
  year: number;
  grade: string;
  subject: string;
  course: string;
  day: string;
  slot: string;
};

const normalizeSelectionText = (value: any) => String(value || '')
  .normalize('NFKC')
  .replace(/[\s　]/g, '')
  .replace(/定期テスト対策|テスト対策|対策/g, '')
  .toLowerCase();

const normalizeSelectionSlot = (value: any) => {
  const text = String(value || '').normalize('NFKC');
  if (/1(?:時間目|時限|限|コマ)/.test(text)) return '1限';
  if (/2(?:時間目|時限|限|コマ)/.test(text)) return '2限';
  return text.trim();
};

const normalizeSelectionDay = (value: any) => String(value || '')
  .normalize('NFKC')
  .replace('曜日', '')
  .trim();

const normalizeCourseNameForStableKey = (value: any) => normalizeSelectionText(value)
  // 講師配置で「通常」が付いたり外れたりしても、同じ講座として扱う。
  .replace(/^通常(?:講座)?/, '');

const normalizeStoredStableKey = (value: any) => {
  const key = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!key.startsWith('course_')) return key;
  // course_{grade}_{subject}_{course}_{day}_{slot} の course 部分に残った
  // 旧「通常」接頭辞を除去する。既存登録を書き換えずに互換性を保つ。
  return key.replace(/^(course_[^_]+_[^_]+_)通常(?:講座)?/, '$1');
};

/** GASの行番号や期IDが変わっても変化しない、講座登録と参加判定の共通キー。 */
export const getCourseOptionStableKey = (option: any) => {
  const grade = normalizeSelectionText(option?.grade || option?.target_grade);
  const subject = normalizeSelectionText(option?.subject || option?.target_subject);
  const course = normalizeCourseNameForStableKey(
    option?.course_name || option?.title || option?.detail_subject || option?.target_detail_subject || subject,
  )
    .replace(/[【】\[\]「」]/g, '')
    .replace(/[0-9①②③④⑤⑥⑦⑧⑨⑩]+$/g, '');
  const day = normalizeSelectionDay(option?.resolved_day || option?.day || option?.day_of_week);
  const slot = normalizeSelectionSlot(option?.resolved_slot || option?.slot || option?.time_slot || option?.period);
  if (!grade || !subject || !course || !day || !slot) return '';
  return `course_${grade}_${subject}_${course}_${day}_${slot}`;
};

export const getCourseOptionIdentityIds = (option: any) => Array.from(new Set([
  option?.id,
  option?.stable_course_key,
  getCourseOptionStableKey(option),
].map(value => String(value || '').trim()).filter(Boolean)));

const getCourseOptionLegacyAliasIds = (option: any) => Array.from(new Set([
  option?.parent_course_option_id,
  option?.fallback_curriculum_option_id,
].map(value => String(value || '').trim()).filter(Boolean)));

export const parseLegacyCourseOptionId = (value: any): LegacyCourseSelection | null => {
  const id = String(value || '').normalize('NFKC').trim();
  if (!/^(?:shift_)?class_/.test(id)) return null;
  const schedule = id.match(/_([月火水木金土日])_([12])時間目$/);
  const scope = id.match(/_(中[123])_(理科|社会)_(.+)_([月火水木金土日])_[12]時間目$/);
  const year = Number(id.match(/^(?:shift_)?class_(\d{4})_/)?.[1] || 0);
  if (!schedule || !scope) return null;
  const course = String(scope[3] || '').split('_')[0]?.trim();
  if (!course) return null;
  return { year, grade: scope[1], subject: scope[2], course, day: schedule[1], slot: `${schedule[2]}限` };
};

const optionMatchesLegacySelection = (option: any, legacy: LegacyCourseSelection) => {
  const optionYear = Number(option.year || 0);
  if (legacy.year && optionYear && legacy.year !== optionYear) return false;
  if (normalizeSelectionText(option.grade) !== normalizeSelectionText(legacy.grade)) return false;
  if (normalizeSelectionText(option.subject || option.target_subject) !== normalizeSelectionText(legacy.subject)) return false;
  const optionCourse = normalizeSelectionText(option.course_name || option.title || option.detail_subject || option.target_detail_subject);
  const legacyCourse = normalizeSelectionText(legacy.course);
  if (!optionCourse || !legacyCourse || !(optionCourse === legacyCourse || optionCourse.includes(legacyCourse) || legacyCourse.includes(optionCourse))) return false;
  const optionDay = String(option.resolved_day || option.day || option.day_of_week || '').replace('曜日', '').trim();
  if (optionDay && optionDay !== legacy.day) return false;
  const fixedFirstPeriod = legacy.grade === '中3' && (legacyCourse.includes('物理') || legacyCourse.includes('生物'));
  return fixedFirstPeriod || !option.resolved_slot || normalizeSelectionSlot(option.resolved_slot || option.slot || option.period) === legacy.slot;
};

export const legacyCourseSelectionLabel = (value: any) => {
  const legacy = parseLegacyCourseOptionId(value);
  if (!legacy) return '';
  const normalizedCourse = normalizeSelectionText(legacy.course);
  const slot = legacy.grade === '中3' && (normalizedCourse.includes('物理') || normalizedCourse.includes('生物'))
    ? '1限'
    : legacy.slot;
  return `${legacy.grade} ${legacy.subject} ${legacy.course} / ${legacy.day}曜 ${slot}`;
};

export const courseOptionMatchesSelection = (option: any, selectedIds: Iterable<string>) => {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.from(selectedIds, String));
  const identities = getCourseOptionIdentityIds(option);
  if (identities.some(id => selected.has(id))) return true;

  // 旧登録の stable key に「通常」が含まれていても、現在の講師配置と
  // 学年・科目・講座・曜日・時限が同じなら一致させる。
  const normalizedSelectedStableKeys = new Set(Array.from(selected)
    .filter(id => String(id).startsWith('course_'))
    .map(normalizeStoredStableKey));
  if (identities.some(id => String(id).startsWith('course_') && normalizedSelectedStableKeys.has(normalizeStoredStableKey(id)))) return true;

  return Array.from(selected).some(id => {
    const legacy = parseLegacyCourseOptionId(id);
    return legacy ? optionMatchesLegacySelection(option, legacy) : false;
  });
};

export const resolveSelectedCourseOptionIds = (options: any[], selectedIds: Iterable<string>) => {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.from(selectedIds, String));
  const resolved = new Set(options
    .filter(option => courseOptionMatchesSelection(option, selected))
    .map(option => String(option.id || '').trim())
    .filter(Boolean));

  // 旧データには曜日・時限別IDではなく、元講座IDだけが保存されている場合がある。
  // 元講座IDが複数の曜日・時限へ分岐している場合は自動で全件選ばず、候補が
  // 1枠だけに特定できる場合に限って互換復元する。
  const selectedAliases = new Set(Array.from(selected).filter(value => options.some(option => (
    getCourseOptionLegacyAliasIds(option).includes(String(value))
  ))));
  selectedAliases.forEach(alias => {
    const candidates = options.filter(option => getCourseOptionLegacyAliasIds(option).includes(String(alias)));
    const scheduleKeys = new Set(candidates.map(option => [
      normalizeSelectionDay(option?.resolved_day || option?.day || option?.day_of_week),
      normalizeSelectionSlot(option?.resolved_slot || option?.slot || option?.time_slot || option?.period),
    ].join('__')));
    if (scheduleKeys.size !== 1) return;
    candidates.forEach(option => {
      const id = String(option?.id || '').trim();
      if (id) resolved.add(id);
    });
  });
  return Array.from(resolved);
};

/**
 * 保存形式が現在ID・安定キー・旧IDのどれでも、指定した講座候補に対応する選択を取り除く。
 * 1つの曜日・時限が複数の単元IDで構成される場合も、最初の解除操作で確実に0件にできる。
 */
export const removeCourseOptionSelections = (
  selectedIds: Iterable<string>,
  targetOptions: any[],
) => Array.from(selectedIds, String).filter(selection => !targetOptions.some(option => (
  courseOptionMatchesSelection(option, [selection])
)));

export const hasCourseOptionSelection = (
  selectedIds: Iterable<string>,
  targetOptions: any[],
) => {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.from(selectedIds, String));
  return targetOptions.some(option => courseOptionMatchesSelection(option, selected));
};

const normalizedCourseValue = (value: any) => normalizeCourseNameForStableKey(value)
  .replace(/[【】\[\]「」]/g, '')
  .replace(/[0-9①②③④⑤⑥⑦⑧⑨⑩]+$/g, '');

/** 曜日・時限を除いた講座の同一性。別日程に同じ講座を二重登録しないために使う。 */
export const getCourseOptionCourseKey = (option: any) => [
  normalizeSelectionText(option?.grade || option?.target_grade),
  normalizeSelectionText(option?.subject || option?.target_subject),
  normalizedCourseValue(option?.course_name || option?.title || option?.detail_subject || option?.target_detail_subject || option?.subject),
].join('__');

/** 同じ曜日・時限に異なる講座を重ねないための共通キー。 */
export const getCourseOptionScheduleKey = (option: any) => [
  normalizeSelectionDay(option?.resolved_day || option?.day || option?.day_of_week),
  normalizeSelectionSlot(option?.resolved_slot || option?.slot || option?.time_slot || option?.period),
].join('__');

export const findCourseSelectionConflict = (options: any[]) => {
  const schedulesByCourse = new Map<string, Set<string>>();
  const coursesBySchedule = new Map<string, Set<string>>();
  for (const option of options) {
    const courseKey = getCourseOptionCourseKey(option);
    const scheduleKey = getCourseOptionScheduleKey(option);
    if (!courseKey || !scheduleKey || scheduleKey === '__') continue;
    if (!schedulesByCourse.has(courseKey)) schedulesByCourse.set(courseKey, new Set());
    schedulesByCourse.get(courseKey)!.add(scheduleKey);
    if (schedulesByCourse.get(courseKey)!.size > 1) return 'duplicate-course' as const;
    if (!coursesBySchedule.has(scheduleKey)) coursesBySchedule.set(scheduleKey, new Set());
    coursesBySchedule.get(scheduleKey)!.add(courseKey);
    if (coursesBySchedule.get(scheduleKey)!.size > 1) return 'duplicate-schedule' as const;
  }
  return null;
};

/** 旧期の登録から講座名だけを引き継ぎ、現在期の曜日・時限を選び直せるようにする。 */
export const courseOptionMatchesLegacyCourseSelection = (option: any, selectedIds: Iterable<string>) => {
  const optionIdentity = [
    normalizeSelectionText(option?.grade || option?.target_grade),
    normalizeSelectionText(option?.subject || option?.target_subject),
    normalizedCourseValue(option?.course_name || option?.title || option?.detail_subject || option?.target_detail_subject),
  ].join('__');
  return Array.from(selectedIds, String).some(value => {
    const legacy = parseLegacyCourseOptionId(value);
    if (!legacy) return false;
    return optionIdentity === [
      normalizeSelectionText(legacy.grade),
      normalizeSelectionText(legacy.subject),
      normalizedCourseValue(legacy.course),
    ].join('__');
  });
};

/**
 * 保存済みIDの期と現在期が違う場合、学年・科目・講座を引き継ぐ。
 * 曜日・時限が変わった場合は、同じ曜日、または唯一の開講枠だけを安全に選ぶ。
 */
export const resolveSelectedCourseOptionIdsAcrossTerms = (options: any[], selectedIds: Iterable<string>) => {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.from(selectedIds, String));
  const exactIds = new Set(resolveSelectedCourseOptionIds(options, selected));
  const legacySelections = Array.from(selected).map(parseLegacyCourseOptionId).filter(Boolean) as LegacyCourseSelection[];
  if (legacySelections.length === 0) return Array.from(exactIds);

  const legacyGroups = new Map<string, LegacyCourseSelection[]>();
  legacySelections.forEach(legacy => {
    const key = [
      normalizeSelectionText(legacy.grade),
      normalizeSelectionText(legacy.subject),
      normalizedCourseValue(legacy.course),
    ].join('__');
    if (!legacyGroups.has(key)) legacyGroups.set(key, []);
    legacyGroups.get(key)!.push(legacy);
  });

  legacyGroups.forEach((legacyGroup, key) => {
    const candidates = options.filter(option => [
      normalizeSelectionText(option.grade || option.target_grade),
      normalizeSelectionText(option.subject || option.target_subject),
      normalizedCourseValue(option.course_name || option.title || option.detail_subject || option.target_detail_subject),
    ].join('__') === key);
    if (candidates.length === 0 || candidates.some(option => exactIds.has(String(option.id || '')))) return;

    const scheduleKey = (option: any) => [
      normalizeSelectionDay(option.resolved_day || option.day || option.day_of_week),
      normalizeSelectionSlot(option.resolved_slot || option.slot || option.time_slot || option.period),
    ].join('__');
    const schedules = new Map<string, any[]>();
    candidates.forEach(option => {
      const schedule = scheduleKey(option);
      if (!schedules.has(schedule)) schedules.set(schedule, []);
      schedules.get(schedule)!.push(option);
    });
    const preferredExact = Array.from(schedules.entries()).find(([schedule]) => legacyGroup.some(legacy => schedule === `${legacy.day}__${legacy.slot}`));
    const sameDaySchedules = Array.from(schedules.entries()).filter(([schedule]) => legacyGroup.some(legacy => schedule.startsWith(`${legacy.day}__`)));
    const chosen = preferredExact?.[1]
      || (sameDaySchedules.length === 1 ? sameDaySchedules[0][1] : null)
      || (schedules.size === 1 ? Array.from(schedules.values())[0] : null);
    chosen?.forEach(option => {
      const id = String(option.id || '').trim();
      if (id) exactIds.add(id);
    });
  });

  return Array.from(exactIds);
};

export const chooseCourseRegistrationTerm = (
  choices: string[],
  selectedTerm = '',
  requestedTerm = '',
) => {
  if (requestedTerm && choices.includes(requestedTerm)) return requestedTerm;
  if (selectedTerm && choices.includes(selectedTerm)) return selectedTerm;
  return choices[0] || '';
};

/**
 * URLの受付IDが古い・無効でも、現在期の通常講座まで非表示にしない。
 * 有効な受付に紐づく候補が実際にある場合だけ受付範囲へ絞り込む。
 */
export const filterCourseOptionsForRegistrationRequest = (options: any[], requestId = '') => {
  if (!requestId) return options;
  const requested = options.filter(option => String(option?.registration_request_id || '') === requestId);
  return requested.length > 0 ? requested : options;
};

/** その年度に開始済みの最も新しい期。同じ開始日の通常・カスタム期は併記する。 */
export const currentCourseTermIds = (options: any[], year: number, today: string) => {
  const startDate = (option: any) => String(option.term_start_date || option.start_date || '');
  const dated = options.filter(option =>
    Number(option.year) === year &&
    option.is_active !== false &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate(option)) &&
    startDate(option) <= today,
  );
  const latestStart = dated.reduce((latest, option) => startDate(option) > latest ? startDate(option) : latest, '');
  return new Set(dated
    .filter(option => startDate(option) === latestStart)
    .map(option => String(option.term || option.term_id || '').trim())
    .filter(Boolean));
};

/** 古い is_current やユーザー側ポインタより、今期・有効な登録を優先する。 */
export const selectCurrentCourseRegistration = (
  registrations: any[], year: number, termIds: Set<string>, preferredId = '',
) => {
  const candidates = registrations.filter(registration =>
    Number(registration.year) === year &&
    termIds.has(String(registration.term || '').trim()) &&
    String(registration.status || 'active') === 'active',
  );
  const timestamp = (item: any) => {
    const value = item.updated_at || item.created_at;
    return typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value || 0).getTime() || 0;
  };
  candidates.sort((a, b) => timestamp(b) - timestamp(a));
  return candidates.find(item => item.id === preferredId) ||
    candidates.find(item => item.is_current || item.current) ||
    candidates[0] || null;
};

/**
 * 管理者・生徒が最後に確定した登録を優先する。
 * 旧データの残存 active/is_current は、明示的なポインタがない場合のみ今期判定に使う。
 */
export const selectEffectiveCourseRegistration = (
  registrations: any[],
  year: number,
  termIds: Set<string>,
  profile: any,
) => {
  const preferredId = String(profile?.active_course_registration_id || '').trim();
  const preferred = registrations.find(registration => registration.id === preferredId);
  if (preferred) {
    const status = String(preferred.status || 'active').toLowerCase();
    const inactive = ['cancelled', 'canceled', 'rejected', 'withdrawn', 'inactive', 'archived'].includes(status);
    const declaredYear = Number(profile?.course_registration_year || 0);
    const declaredTerm = String(profile?.course_registration_term || '').trim();
    const pointerMatchesProfile = (!declaredYear || Number(preferred.year || 0) === declaredYear) &&
      (!declaredTerm || String(preferred.term || '').trim() === declaredTerm);
    if (!inactive && pointerMatchesProfile) return preferred;
  }
  return selectCurrentCourseRegistration(registrations, year, termIds, preferredId);
};

/** 単元名の羅列を除き、登録済みの講座と曜日・時限を一度ずつ表示する。 */
export const summarizeSelectedCourseLabels = (labels: Iterable<string>) => {
  const seen = new Set<string>();
  return Array.from(labels).map(label => String(label || '').trim())
    .filter(Boolean)
    .map(label => label.split(/\s+\/\s+/).slice(0, 2).join(' / '))
    .filter(label => {
      const key = label.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
