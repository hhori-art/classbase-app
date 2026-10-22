'use client';

import { useState, type DragEvent } from 'react';
import type { AttendanceShiftPlan } from '@/lib/attendance-shift-plan';
import { attendanceTimelineBounds, layoutAttendanceTimeline, shiftTimeMinutes } from '@/lib/attendance-shift-timeline';

const pad = (value: number) => String(value).padStart(2, '0');
const dateLabel = (value: string) => new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
  month: 'numeric', day: 'numeric', weekday: 'short',
});
const surname = (value: string) => value.trim().split(/[\s　]+/)[0] || value;

const tone = {
  group: 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-emerald-200',
  individual: 'border-sky-500 bg-sky-50 text-sky-950 ring-sky-200',
  office: 'border-violet-500 bg-violet-50 text-violet-950 ring-violet-200',
};

export default function AttendanceShiftTimeline({
  days, shifts, selectedDate, selectedRoom, today,
  onSelectDate, onSelectShift, onCreate, onMoveShift,
}: {
  days: string[];
  shifts: AttendanceShiftPlan[];
  selectedDate: string;
  selectedRoom: string;
  today: string;
  onSelectDate: (date: string) => void;
  onSelectShift: (shift: AttendanceShiftPlan) => void;
  onCreate: (date: string, room?: string) => void;
  onMoveShift: (shift: AttendanceShiftPlan, date: string, targetMinutes: number, room?: string) => void;
}) {
  const [draggingId, setDraggingId] = useState('');
  const { startHour, endHour } = attendanceTimelineBounds(shifts);
  const hourHeight = days.length === 1 ? 80 : 70;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => index + startHour);
  const totalHeight = (endHour - startHour) * hourHeight;
  const columns = days.length === 1 ? '44px minmax(0, 1fr)' : `40px repeat(${days.length}, minmax(0, 1fr))`;
  const shiftsByDay = new Map(days.map(day => [day, shifts.filter(item => item.date === day)]));

  const handleDrop = (event: DragEvent<HTMLDivElement>, day: string) => {
    event.preventDefault();
    const shiftId = draggingId || event.dataTransfer.getData('text/plain');
    const shift = shifts.find(item => item.id === shiftId);
    setDraggingId('');
    if (!shift) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const targetMinutes = startHour * 60 + ((event.clientY - bounds.top) / hourHeight) * 60;
    onMoveShift(shift, day, targetMinutes, selectedRoom || shift.room);
  };

  return <div className="w-full min-w-0 overflow-hidden bg-white">
    <div className="sticky top-0 z-30 grid border-b border-slate-200 bg-slate-50/95 shadow-sm backdrop-blur" style={{ gridTemplateColumns: columns }}>
      <div className="flex items-center justify-center text-xs font-bold text-slate-400">時刻</div>
      {days.map(day => <button key={day} type="button" onClick={() => onSelectDate(day)} className={`min-w-0 border-l border-slate-200 px-0.5 py-2 text-xs font-bold ${day === selectedDate ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-accent-soft'}`}>
        <span className={`inline-block max-w-full truncate ${day === today ? 'rounded-full bg-accent px-1.5 py-0.5 text-accent-ink' : ''}`}>{dateLabel(day)}</span>
        <span className="block text-[11px] font-bold opacity-60">{shiftsByDay.get(day)?.length || 0}件</span>
      </button>)}
    </div>
    <div className="relative grid w-full" style={{ gridTemplateColumns: columns, height: totalHeight }}>
      <div className="relative z-20 bg-white">{hours.slice(0, -1).map((hour, index) => <span key={hour} className="absolute right-1 font-mono text-[11px] font-bold text-slate-400" style={{ top: index * hourHeight - 6 }}>{pad(hour)}:00</span>)}</div>
      {days.map(day => {
        const positioned = layoutAttendanceTimeline(shiftsByDay.get(day) || []);
        return <div
          key={day}
          onClick={() => onSelectDate(day)}
          onDoubleClick={() => onCreate(day, selectedRoom)}
          onDragOver={event => event.preventDefault()}
          onDrop={event => handleDrop(event, day)}
          className={`relative min-w-0 border-l border-slate-200 text-left ${day === selectedDate ? 'bg-accent-soft/40' : 'bg-white'} ${draggingId ? 'hover:bg-amber-50' : ''}`}
        >
          {hours.slice(0, -1).map((hour, index) => <span key={hour} className="pointer-events-none absolute left-0 right-0 border-t border-slate-200" style={{ top: index * hourHeight }}><span className="absolute left-0 right-0 border-t border-dashed border-slate-100" style={{ top: hourHeight / 2 }} /></span>)}
          {positioned.map(({ shift, lane, laneCount }) => {
            const start = shiftTimeMinutes(shift.start);
            const end = shiftTimeMinutes(shift.end);
            const top = Math.max(0, (start - startHour * 60) / 60 * hourHeight + 2);
            const height = Math.max(30, (end - start) / 60 * hourHeight - 4);
            const width = 100 / laneCount;
            return <button
              type="button"
              draggable
              key={shift.id}
              onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', shift.id); setDraggingId(shift.id); }}
              onDragEnd={() => setDraggingId('')}
              onClick={event => { event.stopPropagation(); onSelectShift(shift); }}
              className={`absolute z-10 min-w-0 cursor-grab overflow-hidden rounded-md border-l-2 px-1 py-1 text-left font-bold shadow-sm ring-1 motion-safe:transition hover:z-20 hover:brightness-95 active:cursor-grabbing ${tone[shift.category]} ${draggingId === shift.id ? 'opacity-40' : ''}`}
              style={{ top, height, left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
              title={`${shift.start}–${shift.end} ${shift.teacher_name} ${shift.room || ''} ${shift.subject || shift.title || ''}`}
            >
              <span className="block truncate font-mono text-[11px] leading-tight">{shift.start}</span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight">{surname(shift.teacher_name)}</span>
              {!selectedRoom && shift.room ? <span className="mt-0.5 block truncate text-[11px] font-bold leading-tight opacity-65">{shift.room}</span> : null}
            </button>;
          })}
          {!positioned.length ? <button type="button" onClick={event => { event.stopPropagation(); onCreate(day, selectedRoom); }} className="absolute inset-x-1 top-3 rounded-lg border border-dashed border-slate-200 py-2 text-xs font-bold text-slate-400 hover:border-accent/40 hover:text-accent">＋</button> : null}
        </div>;
      })}
    </div>
  </div>;
}
