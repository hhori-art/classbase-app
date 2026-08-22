'use client';

import { Check, Info } from 'lucide-react';
import { getCourseSubjectGroup, normalizeCourseText } from '@/lib/course-text';

const DAYS = ['月', '火', '水', '木', '金', '土'];

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const normalizeDay = (value: any) => {
  const raw = String(value || '').trim();
  const match = raw.match(/[月火水木金土日]/);
  return match ? match[0] : '';
};

const normalizeSlot = (value: any) => {
  const raw = toAsciiDigits(String(value || '').trim());
  if (/1\s*(時間目|限|コマ|時限)?/.test(raw)) return '1時間目';
  if (/2\s*(時間目|限|コマ|時限)?/.test(raw)) return '2時間目';
  return '';
};

export const getCourseDay = (option: any) => (
  normalizeDay(option.resolved_day) ||
  normalizeDay(option.day) ||
  normalizeDay(option.day_of_week) ||
  normalizeDay(option.weekday) ||
  normalizeDay(option.class_day) ||
  normalizeDay(option.raw?.day) ||
  normalizeDay(option.raw?.weekday) ||
  normalizeDay(option.title) ||
  normalizeDay(option.course_name)
);

export const getCourseSlot = (option: any) => (
  normalizeSlot(option.resolved_slot) ||
  normalizeSlot(option.slot) ||
  normalizeSlot(option.time_slot) ||
  normalizeSlot(option.period) ||
  normalizeSlot(option.class_period) ||
  normalizeSlot(option.raw?.slot) ||
  normalizeSlot(option.raw?.time_slot) ||
  normalizeSlot(option.title) ||
  normalizeSlot(option.course_name)
);

export const getCourseSubject = (option: any) => {
  const explicit = String(option?.subject || '').trim();
  const explicitGroup = getCourseSubjectGroup(explicit);
  if (explicitGroup) return explicitGroup;
  if (explicit) return explicit;

  const haystack = [
    option?.course_name,
    option?.title,
    option?.target_subject,
    option?.target_detail_subject,
    option?.resolved_unit,
    option?.unit,
    ...(Array.isArray(option?.matched_units) ? option.matched_units : []),
    ...(Array.isArray(option?.curriculum_units) ? option.curriculum_units : []),
  ].map(value => String(value || '')).join(' ');

  const inferredGroup = getCourseSubjectGroup(haystack);
  if (inferredGroup) return inferredGroup;
  return '';
};

const optionDescription = (option: any) => [option.month_label, option.resolved_unit || option.unit]
  .filter(Boolean)
  .join(' / ');
const subjectOrder = (subject: string) => subject === '理科' ? 0 : subject === '社会' ? 1 : 2;
const slotLabel = (slot: string) => slot.replace('時間目', '限');
const weekLabel = (week: string) => week === 'SS' ? '夏期講習' : `${week}週`;

type CurriculumEntry = {
  unit: string;
  month: string;
  week: string;
  order: number | null;
};

const numberFromLabel = (value: any, fallback: number) => {
  const match = toAsciiDigits(String(value || '')).match(/\d+/);
  return match ? Number(match[0]) : fallback;
};

const compareCurriculumOption = (a: any, b: any) => {
  const rowA = a.curriculum_order === null || a.curriculum_order === undefined ? Number.NaN : Number(a.curriculum_order);
  const rowB = b.curriculum_order === null || b.curriculum_order === undefined ? Number.NaN : Number(b.curriculum_order);
  if (Number.isFinite(rowA) && Number.isFinite(rowB) && rowA !== rowB) return rowA - rowB;
  const monthDiff = numberFromLabel(a.month_label, 99) - numberFromLabel(b.month_label, 99);
  if (monthDiff !== 0) return monthDiff;
  const weekDiff = numberFromLabel(a.week_no, a.week_no === 'SS' ? 999 : 9999) - numberFromLabel(b.week_no, b.week_no === 'SS' ? 999 : 9999);
  if (weekDiff !== 0) return weekDiff;
  return String(a.resolved_unit || a.unit || '').localeCompare(String(b.resolved_unit || b.unit || ''), 'ja', { numeric: true });
};

const curriculumEntries = (options: any[]): CurriculumEntry[] => {
  const entries = options
    .slice()
    .sort(compareCurriculumOption)
    .reduce((map: Map<string, CurriculumEntry>, option: any) => {
      const unit = String(option.resolved_unit || option.unit || option.matched_units?.[0] || '').trim();
      if (!unit) return map;
      const month = String(option.month_label || '').trim();
      const week = String(option.week_no || '').trim();
      const key = String(option.curriculum_row_id || `${month}_${week}_${unit}`);
      if (!map.has(key)) map.set(key, {
        unit,
        month,
        week,
        order: option.curriculum_order !== null && option.curriculum_order !== undefined && Number.isFinite(Number(option.curriculum_order))
          ? Number(option.curriculum_order)
          : null,
      });
      return map;
    }, new Map<string, CurriculumEntry>());
  return Array.from(entries.values());
};

const normalizeLabelText = (value: any) => String(value || '')
  ? normalizeCourseText(value)
  : '';

const compactLabelParts = (...values: any[]) => {
  const parts: string[] = [];
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    const normalized = normalizeLabelText(text);
    if (!normalized || normalized === '講座') return;
    if (parts.some(part => normalizeLabelText(part) === normalized)) return;
    parts.push(text);
  });
  return parts;
};

const courseDisplayLabel = (option: any) => compactLabelParts(
  getCourseSubject(option),
  option.course_name || option.title || getCourseSubject(option) || '講座',
).join(' ') || '講座';

const courseFullDisplayLabel = (option: any) => compactLabelParts(
  option.grade,
  getCourseSubject(option),
  option.course_name || option.title || getCourseSubject(option) || '講座',
).join(' ') || '講座';

type CourseRegistrationCalendarProps = {
  options: any[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleGroup?: (ids: string[]) => void;
  disabledIds?: string[];
  compact?: boolean;
  showMeta?: boolean;
  emptyMessage?: string;
};

export default function CourseRegistrationCalendar({
  options,
  selectedIds,
  onToggle,
  onToggleGroup,
  disabledIds = [],
  compact = false,
  showMeta = true,
  emptyMessage = '表示できる講座がありません',
}: CourseRegistrationCalendarProps) {
  const disabledSet = new Set(disabledIds);
  const dayOptions = options.filter(option => getCourseDay(option) && getCourseSlot(option));
  const unsetOptions = options.filter(option => !getCourseDay(option) || !getCourseSlot(option));
  const selectedSet = new Set(selectedIds);

  if (options.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-black text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const groups = dayOptions.reduce((acc, option) => {
    const subject = getCourseSubject(option) || 'その他';
    const grade = option.grade || '';
    const course = option.course_name || option.title || subject || '講座';
    const key = `${grade}__${subject}__${normalizeLabelText(course)}`;
    if (!acc[key]) acc[key] = { subject, grade, course, options: [] as any[] };
    acc[key].options.push(option);
    return acc;
  }, {} as Record<string, { subject: string; grade: string; course: string; options: any[] }>);

  const groupedSubjects = (Object.values(groups) as { subject: string; grade: string; course: string; options: any[] }[])
    .sort((a, b) => {
      if (subjectOrder(a.subject) !== subjectOrder(b.subject)) return subjectOrder(a.subject) - subjectOrder(b.subject);
      return `${a.grade}_${a.course}`.localeCompare(`${b.grade}_${b.course}`, 'ja', { numeric: true });
    })
    .reduce((acc, group) => {
      const key = [group.grade, group.subject].filter(Boolean).join(' ') || group.subject;
      if (!acc[key]) acc[key] = [];
      acc[key].push(group);
      return acc;
    }, {} as Record<string, { subject: string; grade: string; course: string; options: any[] }[]>);

  const selectedOptions = options.filter(option => selectedSet.has(option.id));
  const selectedGroups = Object.values(selectedOptions.reduce((acc, option) => {
    const key = [
      option.grade || '',
      getCourseSubject(option) || '',
      option.course_name || option.title || '',
      getCourseDay(option) || '曜日未設定',
      getCourseSlot(option) || '時間未設定',
    ].join('__');
    if (!acc[key]) acc[key] = { option, ids: [] as string[], units: [] as string[] };
    acc[key].ids.push(option.id);
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
  }, {} as Record<string, { option: any; ids: string[]; units: string[] }>)) as { option: any; ids: string[]; units: string[] }[];

  const toggleGroup = (ids: string[]) => {
    const cleanIds = Array.from(new Set(ids.filter(Boolean)));
    if (cleanIds.length === 0) return;
    if (onToggleGroup) {
      onToggleGroup(cleanIds);
      return;
    }
    cleanIds.forEach(id => onToggle(id));
  };

  const renderLooseOption = (option: any) => {
    const selected = selectedIds.includes(option.id);
    const disabled = disabledSet.has(option.id);
    return (
      <button
        key={option.id}
        type="button"
        onClick={() => !disabled && onToggle(option.id)}
        disabled={disabled}
        className={`group relative w-full rounded-md border px-2 py-2 text-left text-[11px] font-black leading-snug transition ${
          selected
            ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
            : 'border-sky-200 bg-white text-sky-700 hover:border-sky-400 hover:bg-sky-50'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span className="flex items-start justify-between gap-1">
          <span className="break-words">{courseFullDisplayLabel(option)}</span>
          {selected && <Check size={13} strokeWidth={4} className="mt-0.5 shrink-0" />}
        </span>
        {showMeta && (optionDescription(option) || option.term_label || option.matched_dates?.length > 0) && (
          <span className="mt-1 block text-[10px] font-bold text-slate-400">
            {[option.term_label || option.term, optionDescription(option)].filter(Boolean).join(' / ')}
          </span>
        )}
        {showMeta && option.matched_units?.length > 1 && (
          <span className="mt-1 block text-[10px] font-bold text-emerald-600">
            単元 {option.matched_units.length}件
          </span>
        )}
        {showMeta && option.matched_dates?.length > 0 && (
          <span className="mt-1 block text-[10px] font-bold text-slate-400">
            初回 {option.matched_dates[0]}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {selectedGroups.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
          <p className="mb-2 text-xs font-black text-indigo-700">選択中の講座</p>
          <div className="flex flex-wrap gap-2">
            {selectedGroups.map(group => {
              const option = group.option;
              return (
              <button
                key={`${option.id}_${getCourseDay(option)}_${getCourseSlot(option)}`}
                type="button"
                onClick={() => toggleGroup(group.ids)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-black text-indigo-700 shadow-sm ring-1 ring-indigo-100"
              >
                <Check size={12} strokeWidth={4} />
                {courseFullDisplayLabel(option)} / {getCourseDay(option)}曜 {slotLabel(getCourseSlot(option))}
                {group.units.length > 0 ? ` / ${group.units.length}単元` : ''}
              </button>
            );})}
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${compact ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
        {Object.entries(groupedSubjects).map(([sectionLabel, courseGroups]) => {
          const subject = courseGroups[0]?.subject || sectionLabel;
          return (
          <section key={sectionLabel} className={`rounded-2xl border bg-white p-4 shadow-sm ${subject === '理科' ? 'border-emerald-100' : subject === '社会' ? 'border-orange-100' : 'border-slate-100'}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-black ${subject === '理科' ? 'text-emerald-600' : subject === '社会' ? 'text-orange-600' : 'text-slate-500'}`}>{sectionLabel}</p>
                <h3 className="text-base font-black text-slate-900">受講したい科目を選択</h3>
              </div>
              <span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-500">{courseGroups.length}科目</span>
            </div>
            <div className="space-y-3">
              {courseGroups.map(group => {
                const groupSelected = group.options.some(option => selectedSet.has(option.id));
                const orderedCurriculum = curriculumEntries(group.options);
                const units = orderedCurriculum.map(item => item.unit);
                const months = Array.from(new Set(group.options.map(option => option.month_label).filter(Boolean)));
                return (
                  <div key={`${group.subject}-${group.course}`} className={`rounded-2xl border p-3 transition ${groupSelected ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="text-sm font-black text-slate-800">
                          {compactLabelParts(group.grade, group.subject, group.course).join(' ') || group.course}
                        </h4>
                        {showMeta && months.length > 0 && (
                          <p className="mt-1 text-[11px] font-black text-sky-600">
                            期内の時期: {months.slice(0, 4).join(' / ')}
                          </p>
                        )}
                        {showMeta && units.length > 0 && (
                          <div className="mt-3 rounded-xl border border-slate-100 bg-white p-3">
                            <p className="mb-2 text-[11px] font-black text-slate-600">この期のカリキュラム</p>
                            <ol className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                              {orderedCurriculum.map((item, index) => (
                                <li key={`${item.month}_${item.week}_${item.unit}_${index}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1.5 text-[11px] font-bold text-slate-500">
                                  <span className="text-right text-indigo-400">{index + 1}.</span>
                                  <span className="break-words">
                                    <span className="mr-1 text-slate-400">{[item.month, item.week && weekLabel(item.week)].filter(Boolean).join(' / ')}</span>
                                    {item.unit}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                      {groupSelected && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-1 text-[10px] font-black text-white"><Check size={11} />選択中</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DAYS.map(day => {
                        const dayItems = group.options
                          .filter(option => getCourseDay(option) === day)
                          .sort((a, b) => getCourseSlot(a).localeCompare(getCourseSlot(b), 'ja'));
                        if (dayItems.length === 0) return null;
                        const slotGroups = dayItems.reduce((map: Record<string, any[]>, option: any) => {
                          const slot = getCourseSlot(option) || '時間未設定';
                          if (!map[slot]) map[slot] = [];
                          map[slot].push(option);
                          return map;
                        }, {});
                        return Object.entries(slotGroups).map(([slot, slotOptions]) => {
                          const ids = slotOptions.map((option: any) => option.id).filter(Boolean);
                          const selected = ids.length > 0 && ids.every(id => selectedSet.has(id));
                          const partiallySelected = !selected && ids.some(id => selectedSet.has(id));
                          const disabled = ids.every(id => disabledSet.has(id));
                          const units = Array.from(new Set(slotOptions.flatMap((option: any) => [
                            option.resolved_unit,
                            option.unit,
                            ...(Array.isArray(option.matched_units) ? option.matched_units : []),
                            ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
                          ]).map((value: any) => String(value || '').trim()).filter(Boolean)));
                          const dates = Array.from(new Set(slotOptions.flatMap((option: any) => (
                            Array.isArray(option.matched_dates) ? option.matched_dates : []
                          )).map((value: any) => String(value || '').trim()).filter(Boolean))).sort();
                          return (
                            <button
                              key={`${group.subject}-${group.course}-${day}-${slot}`}
                              type="button"
                              onClick={() => !disabled && toggleGroup(ids)}
                              disabled={disabled}
                              className={`rounded-xl border-2 px-3 py-2 text-left transition ${
                                selected
                                  ? 'border-indigo-500 bg-white text-indigo-700 shadow-sm'
                                  : partiallySelected
                                    ? 'border-indigo-200 bg-indigo-50/70 text-indigo-700'
                                    : 'border-white bg-white text-slate-700 hover:border-indigo-200'
                              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                            >
                              <span className="flex items-center justify-between gap-2 text-sm font-black">
                                {day}曜 {slotLabel(slot)}
                                {selected && <Check size={14} strokeWidth={4} />}
                              </span>
                              {showMeta && dates[0] && (
                                <span className="mt-1 block text-[10px] font-bold text-slate-400">初回 {dates[0]}</span>
                              )}
                              {showMeta && units.length > 0 && (
                                <span className="mt-1 block text-[10px] font-black text-emerald-600">
                                  この期で扱う単元: {units.length}件
                                </span>
                              )}
                              {showMeta && slotOptions.some((option: any) => option.shift_match_status === 'course_matched' || option.shift_match_status === 'subject_matched') && (
                                <span className="mt-1 block text-[10px] font-black text-amber-600">
                                  {slotOptions.some((option: any) => option.shift_match_status === 'subject_matched') ? '講師配置から開講確認' : '講座名一致'}
                                </span>
                              )}
                            </button>
                          );
                        });
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );})}
      </div>

      {unsetOptions.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-black text-amber-700">
            <Info size={14} /> 曜日・時間が未設定の講座
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unsetOptions.map(renderLooseOption)}
          </div>
        </div>
      )}
    </div>
  );
}
