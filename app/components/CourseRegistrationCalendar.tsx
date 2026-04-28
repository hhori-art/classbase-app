'use client';

import { Check, Info } from 'lucide-react';

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

const optionLabel = (option: any) => option.course_name || option.title || option.subject || '講座';
const gradeSubjectLabel = (option: any) => [option.grade, option.subject].filter(Boolean).join(' ');
const optionDescription = (option: any) => [option.month_label, option.resolved_unit || option.unit]
  .filter(Boolean)
  .join(' / ');
const subjectOrder = (subject: string) => subject === '理科' ? 0 : subject === '社会' ? 1 : 2;
const slotLabel = (slot: string) => slot.replace('時間目', '限');

type CourseRegistrationCalendarProps = {
  options: any[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabledIds?: string[];
  compact?: boolean;
  showMeta?: boolean;
  emptyMessage?: string;
};

export default function CourseRegistrationCalendar({
  options,
  selectedIds,
  onToggle,
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
    const subject = option.subject || 'その他';
    const grade = option.grade || '';
    const course = option.course_name || option.title || '講座';
    const key = `${grade}__${subject}__${course}`;
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
          <span className="break-words">{[gradeSubjectLabel(option), optionLabel(option)].filter(Boolean).join(' ')}</span>
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
      {selectedOptions.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
          <p className="mb-2 text-xs font-black text-indigo-700">選択中の講座</p>
          <div className="flex flex-wrap gap-2">
            {selectedOptions.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-black text-indigo-700 shadow-sm ring-1 ring-indigo-100"
              >
                <Check size={12} strokeWidth={4} />
                {gradeSubjectLabel(option)} {optionLabel(option)} / {getCourseDay(option)}曜 {slotLabel(getCourseSlot(option))}
              </button>
            ))}
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
                const units = Array.from(new Set(group.options.flatMap(option => option.matched_units || option.curriculum_units || []).filter(Boolean)));
                const months = Array.from(new Set(group.options.map(option => option.month_label).filter(Boolean)));
                return (
                  <div key={`${group.subject}-${group.course}`} className={`rounded-2xl border p-3 transition ${groupSelected ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="text-sm font-black text-slate-800">{[group.grade, group.subject, group.course].filter(Boolean).join(' ')}</h4>
                        {showMeta && months.length > 0 && (
                          <p className="mt-1 text-[11px] font-black text-sky-600">
                            実施月: {months.slice(0, 4).join(' / ')}
                          </p>
                        )}
                        {showMeta && units.length > 0 && (
                          <p className="mt-1 line-clamp-2 text-[11px] font-bold text-slate-400">
                            単元例: {units.slice(0, 3).join(' / ')}
                          </p>
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
                        return dayItems.map(option => {
                          const selected = selectedSet.has(option.id);
                          const disabled = disabledSet.has(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => !disabled && onToggle(option.id)}
                              disabled={disabled}
                              className={`rounded-xl border-2 px-3 py-2 text-left transition ${
                                selected
                                  ? 'border-indigo-500 bg-white text-indigo-700 shadow-sm'
                                  : 'border-white bg-white text-slate-700 hover:border-indigo-200'
                              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                            >
                              <span className="flex items-center justify-between gap-2 text-sm font-black">
                                {day}曜 {slotLabel(getCourseSlot(option))}
                                {selected && <Check size={14} strokeWidth={4} />}
                              </span>
                              {showMeta && option.matched_dates?.[0] && (
                                <span className="mt-1 block text-[10px] font-bold text-slate-400">初回 {option.matched_dates[0]}</span>
                              )}
                              {showMeta && (option.month_label || option.resolved_unit) && (
                                <span className="mt-1 line-clamp-2 block text-[10px] font-bold text-slate-400">
                                  {[option.month_label, option.resolved_unit].filter(Boolean).join(' / ')}
                                </span>
                              )}
                              {showMeta && option.shift_match_status === 'course_matched' && (
                                <span className="mt-1 block text-[10px] font-black text-amber-600">講座名一致</span>
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
