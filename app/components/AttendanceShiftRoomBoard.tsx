'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { AttendanceShiftPlan } from '@/lib/attendance-shift-plan';
import { shiftTimeMinutes } from '@/lib/attendance-shift-timeline';

const dateLabel = (value: string) => new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
  month: 'long', day: 'numeric', weekday: 'short',
});
const surname = (value: string) => value.trim().split(/[\s　]+/)[0] || value;
const DEFAULT_SLOTS = ['16:40', '17:50', '19:10', '20:25'];

const tone = {
  group: 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
  individual: 'border-sky-300 bg-sky-50 text-sky-950 hover:bg-sky-100',
  office: 'border-violet-300 bg-violet-50 text-violet-950 hover:bg-violet-100',
};

export default function AttendanceShiftRoomBoard({
  days, shifts, rooms, selectedDate, today, onSelectDate, onSelectShift, onCreate, onMoveShift,
}: {
  days: string[];
  shifts: AttendanceShiftPlan[];
  rooms: string[];
  selectedDate: string;
  today: string;
  onSelectDate: (date: string) => void;
  onSelectShift: (shift: AttendanceShiftPlan) => void;
  onCreate: (date: string, room: string, start: string) => void;
  onMoveShift: (shift: AttendanceShiftPlan, date: string, targetMinutes: number, room: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(days.filter(day => !shifts.some(shift => shift.date === day))));
  const [draggingId, setDraggingId] = useState('');
  const roomColumns = useMemo(() => {
    const values = Array.from(new Set([...rooms, ...(shifts.some(shift => !shift.room) ? ['未割当'] : [])]));
    return values.length ? values : ['未割当'];
  }, [rooms, shifts]);
  const slots = useMemo(() => Array.from(new Set([...DEFAULT_SLOTS, ...shifts.map(shift => shift.start).filter(Boolean)])).sort(), [shifts]);
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, AttendanceShiftPlan[]>();
    days.forEach(day => map.set(day, []));
    shifts.forEach(shift => map.get(shift.date)?.push(shift));
    return map;
  }, [days, shifts]);
  const shiftsByCell = useMemo(() => {
    const map = new Map<string, AttendanceShiftPlan[]>();
    shifts.forEach(shift => {
      const key = `${shift.date}\u0000${shift.room || ''}\u0000${shift.start}`;
      const values = map.get(key) || [];
      values.push(shift);
      map.set(key, values);
    });
    return map;
  }, [shifts]);
  const columns = `72px repeat(${roomColumns.length}, minmax(132px, 1fr))`;
  const minimumWidth = 72 + roomColumns.length * 132;

  const toggleDay = (day: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });

  const dropIntoCell = (event: DragEvent<HTMLDivElement>, date: string, room: string, start: string) => {
    event.preventDefault();
    const id = draggingId || event.dataTransfer.getData('text/plain');
    const shift = shifts.find(item => item.id === id);
    setDraggingId('');
    if (shift) onMoveShift(shift, date, shiftTimeMinutes(start), room === '未割当' ? '' : room);
  };

  return <div className="space-y-3 bg-slate-100 p-2 sm:p-3">
    {days.map(day => {
      const dayShifts = shiftsByDay.get(day) || [];
      const isCollapsed = collapsed.has(day);
      return <section key={day} className={`overflow-hidden rounded-card border bg-white shadow-sm ${day === selectedDate ? 'border-accent/40 ring-2 ring-accent/15' : 'border-slate-200'}`}>
        <div className={`flex items-center gap-2 border-b px-3 py-2 ${day === today ? 'bg-accent-soft' : 'bg-slate-50'}`}>
          <button type="button" onClick={() => toggleDay(day)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-white" aria-label={`${dateLabel(day)}を${isCollapsed ? '開く' : '閉じる'}`}>{isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
          <button type="button" onClick={() => onSelectDate(day)} className="min-w-0 flex-1 text-left"><span className="text-sm font-bold text-slate-800">{dateLabel(day)}</span><span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200">{dayShifts.length}件</span></button>
          <button type="button" onClick={() => onCreate(day, roomColumns[0] === '未割当' ? '' : roomColumns[0], slots[0])} className="inline-flex min-h-9 items-center gap-1 rounded-btn bg-accent px-3 text-xs font-bold text-accent-ink"><Plus size={12} />追加</button>
        </div>
        {!isCollapsed ? <div className="overflow-x-auto">
          <div style={{ minWidth: minimumWidth }}>
            <div className="sticky top-0 z-20 grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: columns }}>
              <div className="sticky left-0 z-30 bg-slate-50 px-2 py-2 text-center text-xs font-bold text-slate-400">時間</div>
              {roomColumns.map(room => <div key={room} className="truncate border-l border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-700" title={room}>{room}</div>)}
            </div>
            {slots.map(start => <div key={start} className="grid border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: columns }}>
              <div className="sticky left-0 z-10 flex min-h-16 items-start justify-center bg-white px-1 pt-2 font-mono text-xs font-bold text-slate-500">{start}</div>
              {roomColumns.map(room => {
                const actualRoom = room === '未割当' ? '' : room;
                const cellShifts = shiftsByCell.get(`${day}\u0000${actualRoom}\u0000${start}`) || [];
                return <div key={room} onDragOver={event => event.preventDefault()} onDrop={event => dropIntoCell(event, day, room, start)} className={`group min-h-16 border-l border-slate-200 p-1 ${draggingId ? 'hover:bg-amber-50' : ''}`}>
                  <div className="space-y-1">{cellShifts.map(shift => <button key={shift.id} type="button" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', shift.id); setDraggingId(shift.id); }} onDragEnd={() => setDraggingId('')} onClick={() => onSelectShift(shift)} className={`block w-full cursor-grab rounded-lg border px-2 py-1.5 text-left shadow-sm active:cursor-grabbing ${tone[shift.category]} ${draggingId === shift.id ? 'opacity-40' : ''}`} title={`${shift.start}–${shift.end} ${shift.teacher_name} ${shift.grade || ''} ${shift.subject || shift.title || ''}`}>
                    <span className="flex items-center justify-between gap-1"><span className="truncate text-[11px] font-bold">{surname(shift.teacher_name)}</span><span className="shrink-0 font-mono text-[11px] font-bold opacity-60">〜{shift.end}</span></span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold opacity-70">{[shift.grade, shift.subject || shift.title].filter(Boolean).join('・') || '詳細なし'}</span>
                  </button>)}</div>
                  {!cellShifts.length ? <button type="button" onClick={() => onCreate(day, actualRoom, start)} className="grid min-h-14 w-full place-items-center rounded-md text-slate-300 opacity-0 motion-safe:transition hover:bg-accent-soft hover:text-accent group-hover:opacity-100 focus:opacity-100" aria-label={`${day} ${start} ${room}に追加`}><Plus size={14} /></button> : null}
                </div>;
              })}
            </div>)}
          </div>
        </div> : null}
      </section>;
    })}
  </div>;
}
