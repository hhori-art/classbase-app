'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, CheckCircle, Loader2, Send, MessageSquare, Info, ListChecks } from 'lucide-react';
import Link from 'next/link';
import CourseRegistrationCalendar, { getCourseDay, getCourseSlot, getCourseSubject } from '@/app/components/CourseRegistrationCalendar';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { formatClassDays, parseClassDays } from '@/lib/class-days';

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

const getCurrentTermChoices = (
  options: any[],
  today = getTodayKey(),
  termRanges: Record<string, { start: string; end: string }> = {}
) => getTermChoices(options)
  .filter(term => {
    const range = getTermDateRange(term, options, termRanges);
    return Boolean(range && range.start <= today && today <= range.end);
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

export default function StudentChangeRequestPage() {
  const { user, profile: authProfile } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [termRanges, setTermRanges] = useState<Record<string, { start: string; end: string }>>({});
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [selectedCourseKeys, setSelectedCourseKeys] = useState<string[]>([]);
  const [selectedTerm, setSelectedTerm] = useState('');

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
        const data = authProfile;
        setProfile(data);
        setForm({
          day: data.day_of_week || '月',
          science: data.subject_science || OPTIONS_SCIENCE[0],
          social: data.subject_social || OPTIONS_SOCIAL[0],
          reason: ''
        });
        const selectedIds = Array.isArray(data.selected_course_ids) ? data.selected_course_ids.map(String) : [];
        setSelectedCourseIds(selectedIds);

        const studentGradeForRanges = normalizeGrade(data.grade);
        const optionData = await loadCourseRegistrationOptions({
          grade: studentGradeForRanges,
          getToken: () => user.getIdToken(),
        });
        const enrichedOptions = Array.isArray(optionData.options) ? optionData.options : [];
        const nextTermRanges = optionData.term_ranges || {};
        setCourseOptions(enrichedOptions);
        setTermRanges(nextTermRanges);

        const studentGrade = normalizeGrade(data.grade);
        const gradeOptions = enrichedOptions.filter((option: any) => canStudentRegisterCourseOption(studentGrade, option));
        const choices = getCurrentTermChoices(gradeOptions, getTodayKey(), nextTermRanges);
        const selectedOptionTerm = selectedIds
          .map((id: string) => gradeOptions.find((option: any) => option.id === id))
          .map(getOptionTermKey)
          .find(term => choices.includes(term));
        setSelectedTerm(selectedOptionTerm || choices[0] || '');
      } catch (e) {
        console.error('Profile fetch error:', e);
      } finally {
        setFetching(false);
      }
    };
    fetchProfile();
  }, [user, authProfile]);

  const gradeCourseOptions = useMemo(() => {
    const studentGrade = normalizeGrade(profile?.grade);
    return courseOptions
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentRegisterCourseOption(studentGrade, option));
  }, [courseOptions, profile?.grade]);

  const todayKey = useMemo(() => getTodayKey(), []);
  const termChoices = useMemo(() => getCurrentTermChoices(gradeCourseOptions, todayKey, termRanges), [gradeCourseOptions, todayKey, termRanges]);
  const activeTerm = termChoices.includes(selectedTerm) ? selectedTerm : termChoices[0] || '';
  const visibleCourseOptions = useMemo(() => {
    if (!activeTerm) return [];
    return gradeCourseOptions.filter((option: any) => getOptionTermKey(option) === activeTerm);
  }, [activeTerm, gradeCourseOptions]);

  const courseKey = (option: any) => [
    option.grade || '',
    getCourseSubject(option) || '',
    option.course_name || option.title || getCourseSubject(option) || '講座',
  ].join('__');
  const timeKey = (option: any) => [
    getCourseDay(option) || '曜日未設定',
    getCourseSlot(option) || '時間未設定',
  ].join('__');
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
        .filter((option: any) => selectedCourseIds.includes(option.id))
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
  const visibleSelectedCourseIds = selectedCourseIds.filter(id => activeTermOptionIds.has(id));
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
    const targetOptionIds = new Set(visibleCourseOptions.filter((option: any) => courseKey(option) === key).map((option: any) => option.id));
    setSelectedCourseKeys(prev => {
      const selected = prev.includes(key);
      const next = selected ? prev.filter(item => item !== key) : [...prev, key];
      if (selected) {
        setSelectedCourseIds(current => current.filter(id => !targetOptionIds.has(id)));
      }
      return next;
    });
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
      const allSelected = cleanIds.every(id => activeTermSelected.has(id));
      if (allSelected) {
        cleanIds.forEach(id => activeTermSelected.delete(id));
      } else {
        const selectedOptions = visibleCourseOptions.filter((option: any) => cleanIds.includes(option.id));
        const conflictKeys = new Set(selectedOptions.map(timeKey));
        visibleCourseOptions
          .filter((option: any) => conflictKeys.has(timeKey(option)))
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
    try {
      const token = await user.getIdToken();
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      if (!activeTerm || visibleCourseOptions.length === 0) {
        alert('現在実施中の期に登録できる講座候補がありません');
        setSubmitting(false);
        return;
      }
      if (visibleCourseOptions.length > 0 && visibleSelectedCourseIds.length === 0) {
        alert(`${termLabel(activeTerm, gradeCourseOptions)}に受講する曜日・時間の講座を1つ以上選択してください`);
        setSubmitting(false);
        return;
      }
      const selected = visibleCourseOptions.filter(option => visibleSelectedCourseIds.includes(option.id));
      const first = selected[0] || {};
      const selectedDays = parseClassDays(selected.map(getCourseDay));
      const effectiveDay = formatClassDays(selectedDays.length > 0 ? selectedDays : form.day, '、');
      const inferredScience = inferScienceFromSelections(selected) || form.science;
      const inferredSocial = inferSocialFromSelections(selected) || form.social;
      if (visibleSelectedCourseIds.length > 0) {
        const registrationRes = await fetch('/api/parent/course-registrations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            student_id: user.uid,
            year: Number(first.year || new Date().getFullYear()),
            term: String(first.term || 'direct'),
            selected_course_ids: visibleSelectedCourseIds,
            request_id: `student-direct-change-${activeTerm || 'term'}`,
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

      window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
        detail: {
          day_of_week: effectiveDay,
          subject_science: inferredScience,
          subject_social: inferredSocial,
          selected_course_ids: visibleSelectedCourseIds,
        },
      }));

      setCompleted(true);
    } catch (err) {
      console.error(err);
      alert('送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (fetching) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-400" size={40}/></div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center text-gray-400">ユーザー情報が見つかりません</div>;

  if (completed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 p-6 font-sans">
        <div className="bg-white p-10 rounded-[40px] shadow-xl shadow-indigo-100 text-center max-w-sm w-full animate-in zoom-in-95 border-4 border-white">
          <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <CheckCircle size={48} strokeWidth={3} />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2 tracking-tight">変更完了！</h2>
          <p className="text-gray-500 font-bold mb-8 leading-relaxed">
            受講設定を反映しました。<br/>ホーム画面の表示も更新されます。
          </p>
          <Link href="/student" className="block w-full bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-1 transition-all">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 pb-32 font-sans flex flex-col items-center sm:p-6">
      <div className="w-full max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition-all">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-xl font-black leading-tight text-gray-800 sm:text-2xl">
              受講講座・曜日時間の変更
            </h1>
            <p className="text-xs font-bold text-gray-400">変更内容は保存後すぐに反映されます</p>
          </div>
        </div>

        {/* フォームエリア */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 md:gap-8 items-start">
          
          {/* 左カラム */}
          <div className="space-y-6">
            
            {/* 現在の状況 */}
            <div className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white p-5 rounded-[28px] shadow-lg shadow-indigo-200 relative overflow-hidden">
              <div className="relative z-10 flex gap-3 items-center">
                <Info size={24} className="mt-1 shrink-0 text-indigo-100"/>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold opacity-70">現在の受講登録</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentSelectionSummary.days.length > 0 && <span className="bg-white/20 px-3 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">曜日 {currentSelectionSummary.days.join('・')}</span>}
                    {currentSelectionSummary.science && <span className="bg-white/20 px-3 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">理科 {currentSelectionSummary.science}</span>}
                    {currentSelectionSummary.social && <span className="bg-white/20 px-3 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">社会 {currentSelectionSummary.social}</span>}
                    {selectedVisibleOptions.length === 0 && <span className="bg-white/20 px-3 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">現在の期の登録はありません</span>}
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
            </div>

            {gradeCourseOptions.length > 0 && (
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-black text-gray-800">
                      <span className="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg"><ListChecks size={18} strokeWidth={3}/></span>
                      現在実施中の期
                    </p>
                    <p className="mt-2 text-xs font-bold text-gray-400">
                      今日が含まれる期だけを表示します。過去や今後の期は選択肢に出さず、単元ごとの細かい処理は裏側でまとめます。
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black text-slate-600">
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
                          className={`shrink-0 rounded-2xl border-2 px-4 py-3 text-left transition ${
                            active
                              ? 'border-indigo-500 bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                              : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-indigo-200 hover:bg-white'
                          }`}
                        >
                          <span className="block text-sm font-black">{termLabel(term, gradeCourseOptions)}</span>
                          <span className={`mt-1 block text-[11px] font-bold ${active ? 'text-indigo-100' : 'text-slate-400'}`}>
                            {courseCount}講座 / {unitCount}単元
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-black text-slate-400">
                    現在実施中の期に登録できる講座候補がありません
                  </div>
                )}
              </div>
            )}

            {gradeCourseOptions.length > 0 && activeTerm && (
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
                <div className="space-y-5">
                  <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-black text-indigo-500">Step 1</p>
                        <h2 className="text-base font-black text-gray-900">受講したい科目を選択</h2>
                        <p className="mt-1 text-xs font-bold text-gray-500">
                          先に受講する科目を選ぶと、次に選べる開講曜日・時間だけが表示されます。
                        </p>
                      </div>
                      <span className="w-fit rounded-full bg-white px-3 py-1 text-[11px] font-black text-indigo-600">{selectedCourseKeys.length}科目</span>
                    </div>

                    {courseChoices.length === 0 ? (
                      <div className="rounded-2xl border-2 border-dashed border-indigo-100 bg-white/70 p-5 text-center text-sm font-black text-slate-400">
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
                              className={`rounded-2xl border-2 p-4 text-left transition ${
                                active
                                  ? 'border-indigo-500 bg-white text-indigo-700 shadow-sm'
                                  : 'border-white bg-white/80 text-slate-700 hover:border-indigo-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-black">{[option.grade, getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}</p>
                                  <p className="mt-1 text-[11px] font-bold text-slate-400">
                                    {daySlots.slice(0, 4).join(' / ') || '曜日・時間未設定'}
                                    {daySlots.length > 4 ? ` ほか${daySlots.length - 4}件` : ''}
                                  </p>
                                  {units.length > 0 && (
                                    <p className="mt-1 line-clamp-2 text-[11px] font-bold text-emerald-600">
                                      単元: {units.slice(0, 3).join(' / ')}{units.length > 3 ? ` ほか${units.length - 3}件` : ''}
                                    </p>
                                  )}
                                </div>
                                {active && <CheckCircle size={18} className="shrink-0 text-indigo-600" strokeWidth={3} />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-slate-100 bg-white p-4">
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs font-black text-slate-500">Step 2</p>
                        <h2 className="text-base font-black text-gray-900">開講曜日・時間を選択</h2>
                        <p className="mt-1 text-xs font-bold text-gray-400">
                          同じ曜日・同じ時限は1つだけ選べます。別の講座を選ぶと前の選択は自動で外れます。
                        </p>
                      </div>
                      <div className="inline-flex w-fit items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">
                        <CheckCircle size={16} strokeWidth={3} />
                        {selectedVisibleGroups.filter((group: any) => stepOptionIds.has(group.option.id)).length}講座選択中
                      </div>
                    </div>
                    {selectedCourseKeys.length === 0 ? (
                      <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-black text-slate-400">
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
              </div>
            )}

          </div>

          {/* 右カラム */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-6">
            <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-gray-800">保存される講座</p>
                  <p className="mt-1 text-xs font-bold text-gray-400">{termLabel(activeTerm, gradeCourseOptions)}の選択内容</p>
                </div>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-black text-indigo-600">{selectedVisibleGroups.length}講座</span>
              </div>
              <div className="mt-4 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {selectedVisibleGroups.length > 0 ? selectedVisibleGroups.map((group: any) => {
                  const option = group.option;
                  return (
                  <div key={`${option.id}_${getCourseDay(option)}_${option.resolved_slot || option.slot || option.time_slot}`} className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                    <p className="text-sm font-black text-indigo-800">
                      {[getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}
                    </p>
                    <p className="mt-1 text-xs font-bold text-indigo-500">
                      {[getCourseDay(option) && `${getCourseDay(option)}曜`, option.resolved_slot || option.slot || option.time_slot, group.units.length ? `${group.units.length}単元` : ''].filter(Boolean).join(' / ')}
                    </p>
                    {group.units.length > 0 && (
                      <p className="mt-1 line-clamp-2 text-[11px] font-bold text-indigo-400">
                        {group.units.slice(0, 4).join(' / ')}{group.units.length > 4 ? ` ほか${group.units.length - 4}件` : ''}
                      </p>
                    )}
                  </div>
                );}) : (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-xs font-black text-slate-400">
                    まだ講座が選択されていません
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3">
                <span className="bg-green-100 text-green-600 p-1.5 rounded-lg"><MessageSquare size={16} strokeWidth={3}/></span>
                メモ任意
              </label>
              <textarea
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
                placeholder="必要な場合だけ入力してください。"
                className="h-24 w-full resize-none rounded-2xl border-2 border-transparent bg-gray-50 p-4 text-sm font-bold text-gray-800 outline-none transition-all placeholder:font-medium placeholder:text-gray-400 focus:border-green-400 focus:bg-white focus:ring-4 focus:ring-green-100"
              />
            </div>

            <button 
              type="submit" 
              disabled={submitting || visibleSelectedCourseIds.length === 0}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-base hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95"
            >
              {submitting ? <Loader2 className="animate-spin" size={24}/> : <Send size={24} strokeWidth={3}/>}
              すぐに変更する
            </button>

          </div>

        </form>
      </div>
    </div>
  );
}
