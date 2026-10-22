'use client';

import { AlertTriangle, Plus, UserRound } from 'lucide-react';
import {
  SHIFT_CATEGORY_LABELS,
  type AttendanceShiftCategory,
  type AttendanceShiftPlan,
} from '@/lib/attendance-shift-plan';
import { overlappingShiftIds, shiftResourceLabel } from '@/lib/attendance-shift-weekly';

const dateLabel = (date: string) => new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

const tone: Record<AttendanceShiftCategory, string> = {
  group: 'border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-400',
  individual: 'border-sky-200 bg-sky-50 text-sky-950 hover:border-sky-400',
  office: 'border-violet-200 bg-violet-50 text-violet-950 hover:border-violet-400',
};

export default function AttendanceWeeklySchedule({
  days,
  shifts,
  category,
  selectedDate,
  today,
  onSelectDate,
  onSelectShift,
  onCreate,
  printOnly = false,
}: {
  days: string[];
  shifts: AttendanceShiftPlan[];
  category: AttendanceShiftCategory;
  selectedDate: string;
  today: string;
  onSelectDate?: (date: string) => void;
  onSelectShift?: (shift: AttendanceShiftPlan) => void;
  onCreate?: (date: string, room: string) => void;
  printOnly?: boolean;
}) {
  const visible = shifts.filter(shift => shift.category === category && days.includes(shift.date));
  const resources = Array.from(new Set(visible.map(shiftResourceLabel))).sort((left, right) => {
    if (left === '未割当') return 1;
    if (right === '未割当') return -1;
    return left.localeCompare(right, 'ja', { numeric: true });
  });
  if (!resources.length) resources.push('未割当');
  const conflicts = overlappingShiftIds(visible, category);
  const resourceName = category === 'group' ? '教室' : category === 'individual' ? 'ブース' : '業務場所';

  return <div className={printOnly ? 'text-black' : 'min-w-[1320px]'}>
    {printOnly && <div className="mb-4"><h1 className="text-xl font-black">{SHIFT_CATEGORY_LABELS[category]}・週次シフト</h1><p className="mt-1 text-sm font-bold">{days[0]} 〜 {days[days.length - 1]}</p></div>}
    <div className={`grid ${printOnly ? 'border-l border-t border-black' : 'border-l border-t border-slate-200'}`} style={{ gridTemplateColumns: `${printOnly ? '96px' : '112px'} repeat(7, minmax(${printOnly ? '108px' : '170px'}, 1fr))` }}>
      <div className={`sticky left-0 z-20 flex items-center justify-center p-2 text-xs font-bold ${printOnly ? 'border-b border-r border-black bg-white' : 'border-b border-r border-slate-200 bg-slate-100 text-slate-500'}`}>{resourceName}</div>
      {days.map(day => <button key={day} type="button" disabled={printOnly} onClick={() => onSelectDate?.(day)} className={`p-2 text-center text-xs font-bold ${printOnly ? 'border-b border-r border-black bg-white' : `border-b border-r border-slate-200 ${day === selectedDate ? 'bg-accent-soft text-accent' : 'bg-slate-50 text-slate-600'}`}`}>
        <span className={day === today && !printOnly ? 'rounded-full bg-accent px-2.5 py-1 text-accent-ink' : ''}>{dateLabel(day)}</span>
      </button>)}
      {resources.map(resource => <div key={resource} className="contents">
        <div className={`sticky left-0 z-10 flex min-h-28 items-start justify-center p-2 text-center text-xs font-bold ${printOnly ? 'border-b border-r border-black bg-white' : `border-b border-r border-slate-200 ${resource === '未割当' ? 'bg-amber-50 text-amber-800' : 'bg-white text-slate-700'}`}`}>{resource}</div>
        {days.map(day => {
          const items = visible.filter(shift => shift.date === day && shiftResourceLabel(shift) === resource).sort((left, right) => left.start.localeCompare(right.start));
          return <div key={`${resource}-${day}`} onDoubleClick={() => !printOnly && onCreate?.(day, resource === '未割当' ? '' : resource)} className={`min-h-28 space-y-1.5 p-1.5 ${printOnly ? 'border-b border-r border-black' : `border-b border-r border-slate-200 ${day === selectedDate ? 'bg-accent-soft/40' : 'bg-white'}`}`}>
            {items.map(shift => <button key={shift.id} type="button" disabled={printOnly} onClick={() => onSelectShift?.(shift)} className={`block w-full rounded-lg border p-2 text-left ${printOnly ? 'border-black bg-white text-black' : tone[shift.category]} ${conflicts.has(shift.id) ? 'ring-2 ring-rose-500' : ''}`}>
              <span className="flex items-center justify-between gap-1"><span className="font-mono text-xs font-bold">{shift.start}–{shift.end}</span>{conflicts.has(shift.id) && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-rose-700"><AlertTriangle size={10} />重複</span>}</span>
              <span className="mt-1 block truncate text-[11px] font-bold">{shift.teacher_name}</span>
              {category === 'group' && <span className="mt-0.5 block truncate text-xs font-bold opacity-75">{[shift.grade, shift.subject, shift.title].filter(Boolean).join('・') || '授業名未設定'}</span>}
              {category === 'individual' && <span className="mt-1 block text-xs font-bold leading-4 opacity-80">{shift.student_names?.length ? shift.student_names.join('・') : '生徒未割当'}{shift.individual_ratio ? `（${shift.individual_ratio}）` : ''}</span>}
              {category === 'office' && <span className="mt-0.5 block truncate text-xs font-bold opacity-75">{shift.title || '事務'}</span>}
            </button>)}
            {!items.length && !printOnly && <button type="button" onClick={() => onCreate?.(day, resource === '未割当' ? '' : resource)} className="flex min-h-20 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 text-xs font-bold text-slate-300 hover:border-accent/40 hover:bg-accent-soft hover:text-accent"><Plus size={13} />追加</button>}
          </div>;
        })}
      </div>)}
    </div>
    {!printOnly && conflicts.size > 0 && <div className="flex items-center gap-2 border-b border-slate-200 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700"><AlertTriangle size={15} />同じ{resourceName}で時間が重複しているシフトがあります。</div>}
    {!printOnly && category === 'individual' && <div className="flex items-center gap-2 border-b border-slate-200 bg-info-soft px-4 py-2 text-xs font-bold text-info"><UserRound size={15} />各ブースに講師と生徒を割り当てて表示します。空欄を押すと、そのブース・日付で登録できます。</div>}
  </div>;
}
