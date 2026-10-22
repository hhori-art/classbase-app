'use client';

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { CheckCircle, Send, MessageSquare, Info, ListChecks } from 'lucide-react';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Spinner, useConfirm, useToast } from '@/app/components/ui';
import CourseRegistrationCalendar, { CourseOpeningMap, getCourseDay, getCourseSlot, getCourseSubject } from '@/app/components/CourseRegistrationCalendar';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { clearCourseRegistrationOptionsCache, loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { formatClassDays, parseClassDays } from '@/lib/class-days';
import {
  chooseCourseRegistrationTerm,
  courseOptionMatchesLegacyCourseSelection,
  courseOptionMatchesSelection,
  filterCourseOptionsForRegistrationRequest,
  getCourseOptionCourseKey,
  getCourseOptionScheduleKey,
  getCourseOptionStableKey,
  hasCourseOptionSelection,
  legacyCourseSelectionLabel,
  removeCourseOptionSelections,
  resolveSelectedCourseOptionIds,
  resolveSelectedCourseOptionIdsAcrossTerms,
} from '@/lib/course-registration-selection';

// 科目ごとの選択肢
const OPTIONS_SOCIAL = ['地理', '歴史', '公民'];
const OPTIONS_SCIENCE = ['物理', '化学', '生物', '地学'];

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const normalizeGrade = (value: any) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const getOptionTermKey = (option: any) => {
  if (!option) return '';
  const year = Number(option.year || new Date().getFullYear());
  const term = String(option.term || option.term_label || 'term').trim() || 'term';
  return `${year}__${term}`;
};

const termSortValue = (key: string) => {
  const [, term = ''] = key.split('__');
  const normalized = toAsciiDigits(term);
  const match = normalized.match(/(\d+)/);
  return match ? Number(match[1]) : 99;
};

const termLabel = (key: string, options: any[] = []) => {
  const [year, term = ''] = key.split('__');
  const option = options.find(item => getOptionTermKey(item) === key);
  const label = option?.term_label || option?.term || term;
  if (!key) return '期未設定';
  return `${year}年度 ${label}`;
};

const getTermChoices = (options: any[]) => Array.from(new Set(
  options.map(getOptionTermKey).filter(Boolean)
)).sort((a, b) => {
  const [yearA] = a.split('__');
  const [yearB] = b.split('__');
  if (yearA !== yearB) return Number(yearA) - Number(yearB);
  return termSortValue(a) - termSortValue(b);
});

const getTodayKey = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const normalizeDateKey = (value: any) => {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const getOptionDateKeys = (option: any) => Array.from(new Set([
  ...(Array.isArray(option.matched_dates) ? option.matched_dates : []),
  option.start_date,
  option.end_date,
  option.target_date,
  option.term_start_date,
].map(normalizeDateKey).filter(Boolean))).sort();

const getTermDateRange = (term: string, options: any[], termRanges: Record<string, { start: string; end: string }> = {}) => {
  if (termRanges[term]) return termRanges[term];
  const dates = options
    .filter(option => getOptionTermKey(option) === term)
    .flatMap(getOptionDateKeys)
    .sort();
  if (dates.length === 0) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
};

const getStudentSelectableTermChoices = (
  options: any[],
  today = getTodayKey(),
  termRanges: Record<string, { start: string; end: string }> = {}
) => getTermChoices(options).filter(term => {
  const termOptions = options.filter(option => getOptionTermKey(option) === term);
  const range = getTermDateRange(term, options, termRanges);
  const isCurrent = Boolean(range && range.start <= today && today <= range.end);
  const isRegistrationOpen = termOptions.some(option => {
    const opensAt = normalizeDateKey(option.registration_opens_at);
    const closesAt = normalizeDateKey(option.registration_closes_at) || normalizeDateKey(option.term_start_date) || range?.start || '';
    return Boolean(opensAt && closesAt && opensAt <= today && today <= closesAt);
  });
  return isCurrent || isRegistrationOpen;
});

const getCourseSubjectValue = (option: any) => String(getCourseSubject(option) || option.course_name || option.title || '');

const inferScienceFromSelections = (options: any[]) => {
  const joined = options.map(getCourseSubjectValue).join(' ');
  return OPTIONS_SCIENCE.find(item => joined.includes(item)) || '';
};

const inferSocialFromSelections = (options: any[]) => {
  const joined = options.map(getCourseSubjectValue).join(' ');
  return OPTIONS_SOCIAL.find(item => joined.includes(item)) || '';
};

/** 受講講座を登録・変更する対象の生徒。プロフィールのうち、いまの登録内容に関わる値だけを使う。 */
export type CourseChangeStudent = {
  id: string;
  grade?: string;
  day_of_week?: string;
  subject_science?: string;
  subject_social?: string;
  selected_course_ids?: string[];
  selected_course_keys?: string[];
  selected_test_prep_course_ids?: string[];
  selected_test_prep_course_keys?: string[];
  active_course_registration_id?: string;
  [key: string]: any;
};

/**
 * 受講講座の登録・変更（生徒本人・保護者で共通）。
 * viewer="student" はログイン中の生徒本人、viewer="parent" は保護者がお子さまの登録を変える。
 * 保存先は同じ /api/parent/course-registrations で、保存後は家族へ通知される（サーバー側）。
 */
export default function CourseChangeFlow({ student, viewer, header, studentName, className = 'mx-auto max-w-6xl space-y-5 px-4 py-6' }: {
  student: CourseChangeStudent | null;
  viewer: 'student' | 'parent';
  /** 画面上部の見出し（完了画面では出さない）。 */
  header?: ReactNode;
  /** 保護者向けの文言に使うお子さまの名前。 */
  studentName?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const authProfile = student;
  const isParent = viewer === 'parent';
  const targetStudentId = String(student?.id || '');
  const directRequestPrefix = isParent ? 'parent-direct-change' : 'student-direct-change';
  const optionStudentId = isParent ? targetStudentId : undefined;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [reloadKey, setReloadKey] = useState(0);

  const [profile, setProfile] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [termRanges, setTermRanges] = useState<Record<string, { start: string; end: string }>>({});
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [selectedCourseKeys, setSelectedCourseKeys] = useState<string[]>([]);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [activeRegistrationRequestId, setActiveRegistrationRequestId] = useState('');
  const [courseOptionsError, setCourseOptionsError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [historicalSelectionLabels, setHistoricalSelectionLabels] = useState<string[]>([]);

  // フォーム状態
  const [form, setForm] = useState({
    day: '',
    science: '', 
    social: '',
    reason: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user || !authProfile) return;
      try {
        setCourseOptionsError('');
        const data = authProfile;
        setProfile(data);
        setForm({
          day: data.day_of_week || '月',
          science: data.subject_science || OPTIONS_SCIENCE[0],
          social: data.subject_social || OPTIONS_SOCIAL[0],
          reason: ''
        });
        const studentGradeForRanges = normalizeGrade(data.grade);
        const optionData = await loadCourseRegistrationOptions({
          grade: studentGradeForRanges,
          studentId: optionStudentId,
          getToken: forceRefresh => user.getIdToken(forceRefresh),
        });
        const registrationSummaries = Array.isArray(optionData.registration_summaries) ? optionData.registration_summaries : [];
        const regularRegistrations = registrationSummaries.filter((item: any) => (
          String(item.registration_type || 'regular') === 'regular' &&
          !['cancelled', 'canceled', 'inactive', 'archived'].includes(String(item.status || 'active').toLowerCase())
        ));
        const activeRegistrationId = String(data.active_course_registration_id || '');
        const currentRegistration = regularRegistrations.find((item: any) => activeRegistrationId && item.id === activeRegistrationId)
          || regularRegistrations.find((item: any) => item.is_current)
          || regularRegistrations[0];
        const selectedIds = Array.from(new Set([
          ...(Array.isArray(data.selected_course_ids) ? data.selected_course_ids.map(String) : []),
          ...(Array.isArray(data.selected_course_keys) ? data.selected_course_keys.map(String) : []),
          ...(Array.isArray(currentRegistration?.selected_course_ids) ? currentRegistration.selected_course_ids.map(String) : []),
          ...(Array.isArray(currentRegistration?.selected_course_keys) ? currentRegistration.selected_course_keys.map(String) : []),
          ...(Array.isArray(data.selected_test_prep_course_ids) ? data.selected_test_prep_course_ids.map(String) : []),
          ...(Array.isArray(data.selected_test_prep_course_keys) ? data.selected_test_prep_course_keys.map(String) : []),
        ]));
        const savedLabels = Array.isArray(currentRegistration?.selected_course_labels)
          ? currentRegistration.selected_course_labels.map(String).filter(Boolean)
          : [];
        setHistoricalSelectionLabels(Array.from(new Set(
          savedLabels.length > 0 ? savedLabels : selectedIds.map(legacyCourseSelectionLabel).filter(Boolean),
        )));

        const enrichedOptions = Array.isArray(optionData.options) ? optionData.options : [];
        const nextTermRanges = optionData.term_ranges || {};
        setCourseOptions(enrichedOptions);
        setTermRanges(nextTermRanges);

        const studentGrade = normalizeGrade(data.grade);
        const gradeOptions = enrichedOptions.filter((option: any) => canStudentRegisterCourseOption(studentGrade, option));
        const resolvedSelectedIds = resolveSelectedCourseOptionIdsAcrossTerms(gradeOptions, selectedIds);
        setSelectedCourseIds(resolvedSelectedIds.length > 0 ? resolvedSelectedIds : selectedIds);
        const choices = getStudentSelectableTermChoices(gradeOptions, getTodayKey(), nextTermRanges);
        const today = getTodayKey();
        const requestedRegistrationId = new URLSearchParams(window.location.search).get('request') || '';
        const openRegistrationOption = requestedRegistrationId ? gradeOptions.find((option: any) => {
          const opensAt = normalizeDateKey(option.registration_opens_at);
          const closesAt = normalizeDateKey(option.registration_closes_at);
          const requestMatches = String(option.registration_request_id || '') === requestedRegistrationId;
          return requestMatches && opensAt && closesAt && opensAt <= today && today <= closesAt;
        }) : null;
        // 古い通知リンクの request ID で現在期の講座が0件にならないようにする。
        setActiveRegistrationRequestId(openRegistrationOption ? requestedRegistrationId : '');
        const openRegistrationTerm = getOptionTermKey(openRegistrationOption);
        const selectedIdSet = new Set(selectedIds);
        const selectedOptionTerm = getOptionTermKey(gradeOptions.find((option: any) => courseOptionMatchesSelection(option, selectedIdSet)));
        setSelectedTerm(chooseCourseRegistrationTerm(choices, selectedOptionTerm, openRegistrationTerm));
      } catch (e) {
        console.error('Profile fetch error:', e);
        setCourseOptionsError('受講講座を読み込めませんでした。通信状況を確認して画面を再読み込みしてください。');
      } finally {
        setFetching(false);
      }
    };
    fetchProfile();
  }, [user, authProfile, optionStudentId, reloadKey]);

  const gradeCourseOptions = useMemo(() => {
    const studentGrade = normalizeGrade(profile?.grade);
    return courseOptions
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentRegisterCourseOption(studentGrade, option));
  }, [courseOptions, profile?.grade]);

  const todayKey = useMemo(() => getTodayKey(), []);
  const termChoices = useMemo(() => getStudentSelectableTermChoices(gradeCourseOptions, todayKey, termRanges), [gradeCourseOptions, todayKey, termRanges]);
  const activeTerm = termChoices.includes(selectedTerm) ? selectedTerm : termChoices[0] || '';
  const visibleCourseOptions = useMemo(() => {
    if (!activeTerm) return [];
    const termOptions = gradeCourseOptions.filter((option: any) => getOptionTermKey(option) === activeTerm);
    return filterCourseOptionsForRegistrationRequest(termOptions, activeRegistrationRequestId);
  }, [activeRegistrationRequestId, activeTerm, gradeCourseOptions]);
  const activeRegistrationType = visibleCourseOptions.some((option: any) => option.registration_type === 'test_prep') ? 'test_prep' : 'regular';

  const courseKey = (option: any) => [
    option.grade || '',
    getCourseSubject(option) || '',
    option.course_name || option.title || getCourseSubject(option) || '講座',
  ].join('__');
  const timeKey = getCourseOptionScheduleKey;
  const courseChoices = useMemo(() => (Object.values(visibleCourseOptions.reduce((acc, option: any) => {
    const key = courseKey(option);
    if (!acc[key]) acc[key] = { key, option, count: 0, daySlots: new Set<string>(), units: new Set<string>() };
    acc[key].count += 1;
    const day = getCourseDay(option);
    const slot = getCourseSlot(option);
    if (day || slot) acc[key].daySlots.add([day && `${day}曜`, slot].filter(Boolean).join(' '));
    [
      option.resolved_unit,
      option.unit,
      ...(Array.isArray(option.matched_units) ? option.matched_units : []),
      ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
    ].forEach((unit: any) => {
      const value = String(unit || '').trim();
      if (value) acc[key].units.add(value);
    });
    return acc;
  }, {} as Record<string, { key: string; option: any; count: number; daySlots: Set<string>; units: Set<string> }>)) as {
    key: string;
    option: any;
    count: number;
    daySlots: Set<string>;
    units: Set<string>;
  }[]).sort((a, b) => `${getCourseSubject(a.option) || ''}_${a.option.course_name || a.option.title || ''}`.localeCompare(`${getCourseSubject(b.option) || ''}_${b.option.course_name || b.option.title || ''}`, 'ja', { numeric: true })), [visibleCourseOptions]);

  useEffect(() => {
    const selectedKeys = Array.from(new Set(
      visibleCourseOptions
        .filter((option: any) => (
          courseOptionMatchesSelection(option, selectedCourseIds) ||
          courseOptionMatchesLegacyCourseSelection(option, selectedCourseIds)
        ))
        .map(courseKey)
    ));
    setSelectedCourseKeys(prev => {
      const validKeys = new Set(courseChoices.map(choice => choice.key));
      const kept = prev.filter(key => validKeys.has(key));
      const merged = Array.from(new Set([...kept, ...selectedKeys]));
      return merged.length > 0 ? merged : kept;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerm, visibleCourseOptions.length]);

  const stepCourseOptions = useMemo(() => (
    selectedCourseKeys.length > 0
      ? visibleCourseOptions.filter((option: any) => selectedCourseKeys.includes(courseKey(option)))
      : []
  ), [selectedCourseKeys, visibleCourseOptions]);
  const activeTermOptionIds = useMemo(() => new Set(visibleCourseOptions.map((option: any) => option.id)), [visibleCourseOptions]);
  const stepOptionIds = useMemo(() => new Set(stepCourseOptions.map((option: any) => option.id)), [stepCourseOptions]);
  const visibleSelectedCourseIds = resolveSelectedCourseOptionIds(visibleCourseOptions, selectedCourseIds)
    .filter(id => activeTermOptionIds.has(id));
  const stepSelectedCourseIds = selectedCourseIds.filter(id => stepOptionIds.has(id));
  const selectedVisibleOptions = visibleCourseOptions.filter(option => visibleSelectedCourseIds.includes(option.id));
  const currentSelectionSummary = useMemo(() => {
    const days = Array.from(new Set(selectedVisibleOptions.map(getCourseDay).filter(Boolean)));
    return {
      days,
      science: inferScienceFromSelections(selectedVisibleOptions),
      social: inferSocialFromSelections(selectedVisibleOptions),
    };
  }, [selectedVisibleOptions]);
  const selectedVisibleGroups = useMemo(() => Object.values(selectedVisibleOptions.reduce((acc, option: any) => {
      const key = [
        option.grade || '',
        getCourseSubject(option) || '',
        option.course_name || option.title || '',
        getCourseDay(option) || '',
        option.resolved_slot || option.slot || option.time_slot || '',
    ].join('__');
    if (!acc[key]) acc[key] = { option, units: [] as string[] };
    [
      option.resolved_unit,
      option.unit,
      ...(Array.isArray(option.matched_units) ? option.matched_units : []),
      ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
    ].forEach(unit => {
      const value = String(unit || '').trim();
      if (value && !acc[key].units.includes(value)) acc[key].units.push(value);
    });
    return acc;
  }, {} as Record<string, { option: any; units: string[] }>)), [selectedVisibleOptions]);

  const toggleCourseKey = (key: string) => {
    const targetOptions = visibleCourseOptions.filter((option: any) => courseKey(option) === key);
    const selected = selectedCourseKeys.includes(key);
    setSelectedCourseKeys(prev => selected ? prev.filter(item => item !== key) : [...prev, key]);
    if (selected) {
      setSelectedCourseIds(current => removeCourseOptionSelections(current, targetOptions));
      return;
    }
    // 日時候補が1つだけなら、科目選択だけで登録まで完了させる。
    const scheduleKeys = new Set(targetOptions.map(timeKey));
    const targetCourseKeys = new Set(targetOptions.map(getCourseOptionCourseKey));
    if (scheduleKeys.size === 1) {
      setSelectedCourseIds(prev => {
        const currentTermIds = new Set(visibleCourseOptions.map((option: any) => option.id));
        const outsideActiveTerm = prev.filter(id => !currentTermIds.has(id));
        const activeTermSelected = new Set(prev.filter(id => currentTermIds.has(id)));
        visibleCourseOptions
          .filter((option: any) => scheduleKeys.has(timeKey(option)) || targetCourseKeys.has(getCourseOptionCourseKey(option)))
          .forEach((option: any) => activeTermSelected.delete(option.id));
        targetOptions.forEach((option: any) => activeTermSelected.add(option.id));
        return Array.from(new Set([...outsideActiveTerm, ...Array.from(activeTermSelected)]));
      });
    }
  };

  const toggleCourse = (id: string) => {
    toggleCourseGroup([id]);
  };

  const toggleCourseGroup = (ids: string[]) => {
    const cleanIds = Array.from(new Set(ids.filter(Boolean)));
    if (cleanIds.length === 0) return;
    setSelectedCourseIds(prev => {
      const currentTermIds = new Set(visibleCourseOptions.map((option: any) => option.id));
      const outsideActiveTerm = prev.filter(id => !currentTermIds.has(id));
      const activeTermSelected = new Set(prev.filter(id => currentTermIds.has(id)));
      const targetOptions = visibleCourseOptions.filter((option: any) => cleanIds.includes(option.id));
      const hasSelected = hasCourseOptionSelection(activeTermSelected, targetOptions);
      if (hasSelected) {
        return removeCourseOptionSelections(prev, targetOptions);
      } else {
        const conflictKeys = new Set(targetOptions.map(timeKey));
        const duplicateCourseKeys = new Set(targetOptions.map(getCourseOptionCourseKey));
        visibleCourseOptions
          .filter((option: any) => conflictKeys.has(timeKey(option)) || duplicateCourseKeys.has(getCourseOptionCourseKey(option)))
          .forEach((option: any) => activeTermSelected.delete(option.id));
        cleanIds.forEach(id => activeTermSelected.add(id));
      }
      return Array.from(new Set([...outsideActiveTerm, ...Array.from(activeTermSelected)]));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSubmitting(true);
    setSubmitError('');
    try {
      if (!activeTerm || visibleCourseOptions.length === 0) {
        toast.error('受付中または現在実施中の期に、登録できる講座候補がありません');
        return;
      }
      if (visibleSelectedCourseIds.length === 0 && !(await confirmDialog({
        title: '登録済みの講座をすべて解除しますか？',
        message: `${termLabel(activeTerm, gradeCourseOptions)}の受講登録がすべて解除されます。`,
        confirmLabel: 'すべて解除する',
        tone: 'danger',
      }))) return;

      if (visibleSelectedCourseIds.length === 0) {
        const [yearText, ...termParts] = activeTerm.split('__');
        const token = await user.getIdToken(true);
        const registrationRes = await fetch('/api/parent/course-registrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            student_id: targetStudentId,
            year: Number(yearText),
            term: termParts.join('__'),
            selected_course_ids: [],
            registration_tokens: [],
            request_id: String(activeRegistrationRequestId || `${directRequestPrefix}-${activeTerm}`),
            registration_type: activeRegistrationType,
          }),
        });
        const registrationData = await registrationRes.json().catch(() => ({}));
        if (!registrationRes.ok || registrationData.ok === false) throw new Error(registrationData.error || '講座登録の解除に失敗しました');
        if (isParent) {
          // 保護者のログイン情報ではなくお子さまの登録が変わったので、次に開いたときの候補を取り直す。
          clearCourseRegistrationOptionsCache();
        } else {
          window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
            detail: activeRegistrationType === 'test_prep'
              ? { selected_test_prep_course_ids: [], selected_test_prep_course_keys: [] }
              : { selected_course_ids: [], selected_course_keys: [] },
          }));
        }
        setCompleted(true);
        return;
      }

      const selectedBeforeRefresh = visibleCourseOptions.filter(option => visibleSelectedCourseIds.includes(option.id));
      const selectedIdentityIds = new Set([
        ...visibleSelectedCourseIds,
        ...selectedBeforeRefresh.map(getCourseOptionStableKey).filter(Boolean),
      ]);

      // 保存許可トークンは短時間で失効するため、保存直前に最新候補を取得する。
      // 講座IDが再生成されていても、安定講座キーで同じ曜日・時限へ復元する。
      const refreshed = await loadCourseRegistrationOptions({
        grade: normalizeGrade(profile.grade),
        studentId: optionStudentId,
        getToken: () => user.getIdToken(true),
        force: true,
      });
      const refreshedTermOptions = (Array.isArray(refreshed.options) ? refreshed.options : [])
        .filter((option: any) => option.is_active !== false)
        .filter((option: any) => canStudentRegisterCourseOption(normalizeGrade(profile.grade), option))
        .filter((option: any) => getOptionTermKey(option) === activeTerm);
      const refreshedVisibleOptions = filterCourseOptionsForRegistrationRequest(
        refreshedTermOptions,
        activeRegistrationRequestId,
      );
      const selected = refreshedVisibleOptions.filter((option: any) => (
        courseOptionMatchesSelection(option, selectedIdentityIds)
      ));
      if (selected.length === 0 || selected.some((option: any) => !option.registration_token)) {
        throw new Error('講座候補が更新されました。画面を再読み込みして選択内容を確認してください。');
      }

      const freshSelectedCourseIds = Array.from(new Set(
        selected.map((option: any) => String(option.id || '')).filter(Boolean),
      ));
      const token = await user.getIdToken(true);
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const first = selected[0] || {};
      const selectedDays = parseClassDays(selected.map(getCourseDay));
      const effectiveDay = formatClassDays(selectedDays.length > 0 ? selectedDays : form.day, '、');
      const inferredScience = inferScienceFromSelections(selected) || form.science;
      const inferredSocial = inferSocialFromSelections(selected) || form.social;
      if (freshSelectedCourseIds.length > 0) {
        const registrationRes = await fetch('/api/parent/course-registrations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            student_id: targetStudentId,
            year: Number(first.year || new Date().getFullYear()),
            term: String(first.term || 'direct'),
            selected_course_ids: freshSelectedCourseIds,
            selected_course_keys: selected.map(getCourseOptionStableKey).filter(Boolean),
            registration_tokens: selected.map(option => option.registration_token).filter(Boolean),
            request_id: String(first.registration_request_id || `${directRequestPrefix}-${activeTerm || 'term'}`),
            registration_type: activeRegistrationType,
            course_settings: {
              day_of_week: effectiveDay,
              subject_science: inferredScience,
              subject_social: inferredSocial,
            },
          }),
        });
        const registrationData = await registrationRes.json().catch(() => ({}));
        if (!registrationRes.ok || registrationData.ok === false) throw new Error(registrationData.error || '講座登録の更新に失敗しました');
      }

      if (isParent) {
        clearCourseRegistrationOptionsCache();
      } else window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
        detail: activeRegistrationType === 'test_prep' ? {
          selected_test_prep_course_ids: freshSelectedCourseIds,
          selected_test_prep_course_keys: selected.map(getCourseOptionStableKey).filter(Boolean),
        } : {
          day_of_week: effectiveDay,
          subject_science: inferredScience,
          subject_social: inferredSocial,
          selected_course_ids: freshSelectedCourseIds,
          selected_course_keys: selected.map(getCourseOptionStableKey).filter(Boolean),
        },
      }));

      setCompleted(true);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message
        ? err.message
        : '受講講座の保存に失敗しました。';
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (fetching) return <div className="flex items-center justify-center px-4 py-20"><Spinner size={40} /></div>;
  if (!profile) return <div className="mx-auto max-w-6xl px-4 py-10"><EmptyState title="ユーザー情報が見つかりません" /></div>;

  if (completed) {
    return (
      <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-10">
        <div className="cb-card w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success-soft text-success motion-safe:animate-bounce">
            <CheckCircle size={48} strokeWidth={3} aria-hidden />
          </div>
          <h2 className="mb-2 text-2xl font-black text-fg">変更完了！</h2>
          {isParent ? (
            <>
              <p className="mb-8 font-medium leading-relaxed text-fg-muted">
                {studentName ? `${studentName}さん` : 'お子さま'}の受講講座を保存しました。<br/>お子さまにも変更をお知らせしています。
              </p>
              <div className="space-y-2">
                <ButtonLink href="/parent/timetable" size="lg" fullWidth>
                  時間割を見る
                </ButtonLink>
                <ButtonLink href="/parent" variant="secondary" size="lg" fullWidth>
                  ホームへ戻る
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <p className="mb-8 font-medium leading-relaxed text-fg-muted">
                受講設定を反映しました。<br/>ホーム画面の表示も更新されます。
              </p>
              <ButtonLink href="/student" size="lg" fullWidth>
                ホームへ戻る
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    );
  }

  const emptyBox = 'rounded-card border-2 border-dashed border-line p-6 text-center text-sm font-bold text-fg-muted';

  return (
    <div className={className}>
      {header}

      <ol className="cb-card grid grid-cols-3 overflow-hidden" aria-label="登録の手順">
        {([
          ['1', '科目を選ぶ', selectedCourseKeys.length > 0],
          ['2', '曜日・時間', visibleSelectedCourseIds.length > 0],
          ['3', '内容を保存', false],
        ] as const).map(([number, label, done]) => (
          <li key={String(number)} className={`flex min-h-14 items-center justify-center gap-2 border-r border-line px-2 text-center last:border-r-0 ${done ? 'bg-success-soft text-success' : 'text-fg-muted'}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-success text-white' : 'bg-canvas text-fg-muted'}`}>{done ? '✓' : number}</span>
            <span className="text-xs font-bold sm:text-sm">{label}</span>
          </li>
        ))}
      </ol>

      {courseOptionsError && (
        <ErrorState title="受講講座を読み込めませんでした" message={courseOptionsError} onRetry={() => setReloadKey(value => value + 1)} />
      )}

      {/* フォームエリア */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-start gap-5 md:gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* 左カラム */}
        <div className="space-y-5">

          {/* 現在の状況 */}
          <div className="rounded-card bg-accent p-5 text-accent-ink shadow-card">
            <div className="flex items-center gap-3">
              <Info size={24} className="mt-1 shrink-0 text-accent-ink/80" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-accent-ink/80">現在の受講登録</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentSelectionSummary.days.length > 0 && <span className="rounded-input bg-white/20 px-3 py-1 text-xs font-bold">曜日 {currentSelectionSummary.days.join('・')}</span>}
                  {currentSelectionSummary.science && <span className="rounded-input bg-white/20 px-3 py-1 text-xs font-bold">理科 {currentSelectionSummary.science}</span>}
                  {currentSelectionSummary.social && <span className="rounded-input bg-white/20 px-3 py-1 text-xs font-bold">社会 {currentSelectionSummary.social}</span>}
                  {selectedVisibleOptions.length === 0 && historicalSelectionLabels.length > 0 && (
                    <>
                      {historicalSelectionLabels.slice(0, 3).map(label => (
                        <span key={label} className="rounded-input bg-white/20 px-3 py-1 text-xs font-bold">前の期: {label}</span>
                      ))}
                      <span className="w-full text-xs font-medium text-accent-ink/90">現在期の曜日・時間を下から選び直して保存できます</span>
                    </>
                  )}
                  {selectedVisibleOptions.length === 0 && historicalSelectionLabels.length === 0 && <span className="rounded-input bg-white/20 px-3 py-1 text-xs font-bold">講座を選んで登録できます</span>}
                </div>
              </div>
            </div>
          </div>

          {gradeCourseOptions.length > 0 && (
            <Card>
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold text-fg">
                    <span className="rounded-input bg-accent-soft p-1.5 text-accent"><ListChecks size={18} strokeWidth={3} aria-hidden /></span>
                    登録できる期
                  </p>
                  <p className="mt-2 text-xs font-medium text-fg-muted">
                    現在実施中の期と、受付期間中の次期講座を表示します。{isParent ? 'お子さまが受講する講座を選んですぐに登録できます。' : '自分が受講する講座を選んですぐに登録できます。'}
                  </p>
                </div>
                <div className="rounded-btn bg-canvas px-4 py-3 text-xs font-bold text-fg-muted">
                  {normalizeGrade(profile.grade) || '学年未設定'} / {activeTerm ? termLabel(activeTerm, gradeCourseOptions) : '現在期なし'}
                </div>
              </div>

              {termChoices.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {termChoices.map(term => {
                    const active = term === activeTerm;
                    const termOptions = gradeCourseOptions.filter(option => getOptionTermKey(option) === term);
                    const courseCount = new Set(termOptions.map(option => [
                      option.grade,
                      getCourseSubject(option),
                      option.course_name || option.title,
                      option.resolved_day,
                      option.resolved_slot,
                    ].join('__'))).size;
                    const unitCount = new Set(termOptions.flatMap(option => [
                      option.resolved_unit,
                      option.unit,
                      ...(Array.isArray(option.matched_units) ? option.matched_units : []),
                      ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
                    ]).filter(Boolean)).size;
                    return (
                      <button
                        key={term}
                        type="button"
                        onClick={() => setSelectedTerm(term)}
                        aria-pressed={active}
                        className={`shrink-0 rounded-btn border-2 px-4 py-3 text-left transition-colors ${
                          active
                            ? 'border-accent bg-accent text-accent-ink shadow-card'
                            : 'border-line bg-canvas text-fg hover:border-accent/30 hover:bg-surface'
                        }`}
                      >
                        <span className="block text-sm font-bold">{termLabel(term, gradeCourseOptions)}</span>
                        <span className={`mt-1 block text-xs font-medium ${active ? 'text-accent-ink/80' : 'text-fg-muted'}`}>
                          {courseCount}講座 / {unitCount}単元
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={emptyBox}>
                  現在実施中の期に登録できる講座候補がありません
                </div>
              )}
            </Card>
          )}

          {gradeCourseOptions.length > 0 && activeTerm && (
            <Card>
              <div className="space-y-5">
                {activeRegistrationType === 'test_prep' && (
                  <div className="rounded-card border border-warning/30 bg-warning-soft p-4 text-sm font-medium text-fg">
                    <p className="font-bold text-warning">対策講座の受講登録</p>
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted">通常講座の登録とは別に保存されます。管理者が設定した対策単元と開講日時から選択してください。</p>
                  </div>
                )}
                <CourseOpeningMap
                  options={visibleCourseOptions}
                  selectedIds={visibleSelectedCourseIds}
                  title={`${termLabel(activeTerm, gradeCourseOptions)}の開講状況`}
                  description="週のどこで理科・社会が開講されているかを先に確認できます。"
                />
                <div className="rounded-card border border-accent/20 bg-accent-soft p-4">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-accent">1. 科目</p>
                      <h2 className="text-base font-bold text-fg">受講したい講座を選ぶ</h2>
                      <p className="mt-1 text-xs font-medium text-fg-muted">
                        先に受講する科目を選ぶと、次に選べる開講曜日・時間だけが表示されます。
                      </p>
                    </div>
                    <span className="w-fit rounded-full bg-surface px-3 py-1 text-xs font-bold text-accent">{selectedCourseKeys.length}科目</span>
                  </div>

                  {courseChoices.length === 0 ? (
                    <div className={`${emptyBox} bg-surface/70`}>
                      {termLabel(activeTerm, gradeCourseOptions)}に登録できる講座候補がありません
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {courseChoices.map(choice => {
                        const active = selectedCourseKeys.includes(choice.key);
                        const option = choice.option;
                        const units = Array.from(choice.units);
                        const daySlots = Array.from(choice.daySlots);
                        return (
                          <button
                            key={choice.key}
                            type="button"
                            onClick={() => toggleCourseKey(choice.key)}
                            aria-pressed={active}
                            className={`rounded-btn border-2 bg-surface p-4 text-left transition-colors ${
                              active
                                ? 'border-accent text-accent shadow-sm'
                                : 'border-transparent text-fg hover:border-accent/30'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold">{[option.grade, getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}</p>
                                <p className="mt-1 text-xs font-medium text-fg-muted">
                                  {daySlots.slice(0, 4).join(' / ') || '曜日・時間未設定'}
                                  {daySlots.length > 4 ? ` ほか${daySlots.length - 4}件` : ''}
                                </p>
                                <p className="mt-2 text-xs font-bold text-success">
                                  {daySlots.length === 1 ? '選ぶだけで曜日・時間も確定' : `${daySlots.length}個の曜日・時間から選択`}
                                  {units.length > 0 ? ` ・ 全${units.length}単元` : ''}
                                </p>
                              </div>
                              {active && <CheckCircle size={18} className="shrink-0 text-accent" strokeWidth={3} aria-hidden />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-card border border-line bg-surface p-4">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-bold text-fg-muted">2. 曜日・時間</p>
                      <h2 className="text-base font-bold text-fg">通える曜日・時間を決める</h2>
                      <p className="mt-1 text-xs font-medium text-fg-muted">
                        同じ曜日・時限は1講座のみ、同じ講座は別の曜日・時限と重複して選べません。
                      </p>
                    </div>
                    <div className="inline-flex w-fit items-center gap-2 rounded-btn bg-success-soft px-4 py-2 text-xs font-bold text-success">
                      <CheckCircle size={16} strokeWidth={3} aria-hidden />
                      {selectedVisibleGroups.filter((group: any) => stepOptionIds.has(group.option.id)).length}講座選択中
                    </div>
                  </div>
                  {selectedCourseKeys.length === 0 ? (
                    <div className={emptyBox}>
                      先に受講したい科目を選択してください
                    </div>
                  ) : (
                    <CourseRegistrationCalendar
                      options={stepCourseOptions}
                      selectedIds={stepSelectedCourseIds}
                      onToggle={toggleCourse}
                      onToggleGroup={toggleCourseGroup}
                      compact
                      showMeta
                      emptyMessage="選択した科目に開講曜日がありません。別の科目を選択してください。"
                    />
                  )}
                </div>
              </div>
            </Card>
          )}

        </div>

        {/* 右カラム */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-fg">保存される講座</p>
                <p className="mt-1 text-xs font-medium text-fg-muted">{termLabel(activeTerm, gradeCourseOptions)}の選択内容</p>
              </div>
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{selectedVisibleGroups.length}講座</span>
            </div>
            <div className="mt-4 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
              {selectedVisibleGroups.length > 0 ? selectedVisibleGroups.map((group: any) => {
                const option = group.option;
                return (
                <div key={`${option.id}_${getCourseDay(option)}_${option.resolved_slot || option.slot || option.time_slot}`} className="rounded-btn border border-accent/20 bg-accent-soft px-4 py-3">
                  <p className="text-sm font-bold text-fg">
                    {[getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}
                  </p>
                  <p className="mt-1 text-xs font-bold text-accent">
                    {[getCourseDay(option) && `${getCourseDay(option)}曜`, option.resolved_slot || option.slot || option.time_slot, group.units.length ? `${group.units.length}単元` : ''].filter(Boolean).join(' / ')}
                  </p>
                  {group.units.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs font-medium text-fg-muted">
                      {group.units.slice(0, 4).join(' / ')}{group.units.length > 4 ? ` ほか${group.units.length - 4}件` : ''}
                    </p>
                  )}
                </div>
              );}) : (
                <EmptyState title="まだ講座が選択されていません" className="py-6" />
              )}
            </div>
          </Card>

          <Card>
            <label htmlFor="change-request-memo" className="mb-3 flex items-center gap-2 text-sm font-bold text-fg">
              <span className="rounded-input bg-accent-soft p-1.5 text-accent"><MessageSquare size={16} strokeWidth={3} aria-hidden /></span>
              メモ（任意）
            </label>
            <textarea
              id="change-request-memo"
              value={form.reason}
              onChange={e => setForm({...form, reason: e.target.value})}
              placeholder="必要な場合だけ入力してください。"
              className="h-24 w-full resize-none rounded-input border-2 border-line bg-canvas p-4 text-sm font-medium text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15"
            />
          </Card>

          {submitError && (
            <div role="alert" className="rounded-card border border-danger/20 bg-danger-soft p-4 text-sm font-bold leading-relaxed text-danger">
              {submitError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={visibleSelectedCourseIds.length === 0}
              icon={<Send size={20} strokeWidth={3} aria-hidden />}
            >
              {activeRegistrationType === 'test_prep' ? '対策講座を登録する' : '登録する'}
            </Button>
            <button
              type="submit"
              disabled={submitting || visibleSelectedCourseIds.length > 0}
              className="min-h-12 w-full rounded-btn border-2 border-danger/30 bg-surface px-4 text-base font-bold text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
            >
              すべて解除する
            </button>
          </div>

        </div>

      </form>
    </div>
  );
}
