'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, Download, FileUp,
  FileSpreadsheet, Filter, LayoutGrid, MoreVertical, Pencil, Plus, Printer, Search,
  Trash2, UserRound, X,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, EmptyState, ErrorState, IconButton, Modal, PageHeader, Spinner, useConfirm } from '@/app/components/ui';
import FiveMinuteTimePicker from '@/app/components/FiveMinuteTimePicker';
import AttendanceShiftRoomBoard from '@/app/components/AttendanceShiftRoomBoard';
import AttendanceShiftTimeline from '@/app/components/AttendanceShiftTimeline';
import AttendanceWeeklySchedule from '@/app/components/AttendanceWeeklySchedule';
import { INDIVIDUAL_LEVEL_OPTIONS, OFFICE_TASK_OPTIONS, type IndividualLevel } from '@/lib/attendance-work-detail';
import { downloadWeeklyShiftWorkbook } from '@/lib/client-attendance-shift-xlsx';
import {
  addDateDays,
  dateKeyInJapan,
  SHIFT_CATEGORY_LABELS,
  type AttendanceShiftCategory,
  type AttendanceShiftPlan,
  type AttendanceShiftView,
} from '@/lib/attendance-shift-plan';
import { minutesToShiftTime, movedShiftTimes, shiftTimeMinutes } from '@/lib/attendance-shift-timeline';

type Staff = {
  id: string;
  name: string;
  login_id: string;
  employment_category: 'dedicated' | 'semi_dedicated' | null;
  school_id: string;
};

type Student = {
  id: string;
  name: string;
  login_id: string;
  grade: string;
  classroom: string;
};

type ShiftForm = {
  id: string;
  date: string;
  start: string;
  end: string;
  category: AttendanceShiftCategory;
  teacherIds: string[];
  studentIds: string[];
  title: string;
  grade: string;
  subject: string;
  individualRatio: '1:1' | '1:2' | '1:3';
  individualLevel: IndividualLevel;
  officeTask: string;
  room: string;
  note: string;
  reflectToAttendance: boolean;
};

type CopyState = { mode: 'shift' | 'day' | 'week'; sourceDate: string; shiftId?: string } | null;

const pad = (value: number) => String(value).padStart(2, '0');
const toDateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const dateFromKey = (value: string) => new Date(`${value}T00:00:00+09:00`);
const startOfWeek = (value: string) => addDateDays(value, -((dateFromKey(value).getDay() + 6) % 7));
const endOfMonth = (value: string) => {
  const date = dateFromKey(value);
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};
const startOfMonth = (value: string) => `${value.slice(0, 7)}-01`;
const dateLabel = (value: string, options?: Intl.DateTimeFormatOptions) => dateFromKey(value).toLocaleDateString('ja-JP', options || { month: 'long', day: 'numeric', weekday: 'short' });
const defaultForm = (date = dateKeyInJapan(), category: AttendanceShiftCategory = 'individual'): ShiftForm => ({
  id: '', date, start: '16:00', end: '17:00', category, teacherIds: [], studentIds: [], title: '', grade: '', subject: '',
  individualRatio: '1:2', individualLevel: 'standard', officeTask: 'lesson_preparation', room: '', note: '', reflectToAttendance: true,
});

const categoryTone: Record<AttendanceShiftCategory, { chip: string; border: string }> = {
  group: { chip: 'bg-emerald-50 text-emerald-900 ring-emerald-200', border: 'border-l-emerald-500' },
  individual: { chip: 'bg-sky-50 text-sky-950 ring-sky-200', border: 'border-l-sky-500' },
  office: { chip: 'bg-violet-50 text-violet-950 ring-violet-200', border: 'border-l-violet-500' },
};

const employmentLabel = (value: Staff['employment_category']) => value === 'dedicated' ? '専任' : value === 'semi_dedicated' ? '準専任' : '区分未設定';

const CSV_HEADERS = ['日付', '開始', '終了', '区分', '職員ID', '職員名', '生徒ID', '生徒名', '雇用区分', 'タイトル', '学年', '科目', '個別人数', '個別単価', '事務内容', '教室・ブース', 'メモ', '勤怠反映'];

const escapeCsv = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift()?.map(item => item.trim()) || [];
  return rows.filter(items => items.some(Boolean)).map(items => Object.fromEntries(headers.map((header, index) => [header, items[index] || ''])));
};

const downloadCsv = (rows: unknown[][], filename: string) => {
  const csv = `\uFEFF${rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function AttendanceShiftCalendar() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const today = dateKeyInJapan();
  const [focusDate, setFocusDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<AttendanceShiftView>('week');
  const [weekLayout, setWeekLayout] = useState<'rooms' | 'compact'>('rooms');
  const [category, setCategory] = useState<AttendanceShiftCategory>('group');
  const [school, setSchool] = useState<{ id: string; name: string; mode: 'group' | 'individual' }>({ id: '', name: '', mode: 'group' });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [shifts, setShifts] = useState<AttendanceShiftPlan[]>([]);
  const [rooms, setRooms] = useState<Record<AttendanceShiftCategory, string[]>>({ group: [], individual: [], office: [] });
  const [selectedRoom, setSelectedRoom] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [staffQuery, setStaffQuery] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState({ dedicated: true, semi_dedicated: true });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<ShiftForm | null>(null);
  const [copyState, setCopyState] = useState<CopyState>(null);
  const [copyTarget, setCopyTarget] = useState(today);
  const [moreOpen, setMoreOpen] = useState(false);
  const [printShifts, setPrintShifts] = useState<AttendanceShiftPlan[]>([]);
  const [printDays, setPrintDays] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryInitialized = useRef(false);

  const range = useMemo(() => {
    if (view === 'day') return { start: focusDate, end: focusDate };
    if (view === 'week') { const start = startOfWeek(focusDate); return { start, end: addDateDays(start, 6) }; }
    return { start: startOfMonth(focusDate), end: endOfMonth(focusDate) };
  }, [focusDate, view]);

  const api = useCallback(async (payload?: Record<string, unknown>, query?: URLSearchParams) => {
    if (!user) throw new Error('ログイン情報を確認できません。');
    const token = await user.getIdToken();
    const response = await fetch(query ? `/api/attendance-shifts?${query}` : '/api/attendance-shifts', {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({ start: range.start, end: range.end, include_students: category === 'individual' ? 'true' : 'false' });
      const body = await api(undefined, params);
      const nextSchool = body.school || { id: '', name: '', mode: 'group' };
      setSchool(nextSchool);
      if (!categoryInitialized.current) {
        setCategory(nextSchool.mode === 'individual' ? 'individual' : 'group');
        categoryInitialized.current = true;
      }
      setStaff(body.staff || []);
      setStudents(body.students || []);
      setShifts((body.shifts || []).sort((left: AttendanceShiftPlan, right: AttendanceShiftPlan) => `${left.date} ${left.start}`.localeCompare(`${right.date} ${right.start}`)));
      setRooms({ group: body.rooms?.group || [], individual: body.rooms?.individual || [], office: body.rooms?.office || [] });
    } catch (error) {
      setLoadError(true);
      setMessage(error instanceof Error ? error.message : 'シフトを読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api, category, range.end, range.start, user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedDate(focusDate); }, [focusDate, view]);

  const visibleStaff = useMemo(() => staff.filter(item => {
    if (item.employment_category === 'dedicated' && !employmentFilter.dedicated) return false;
    if (item.employment_category === 'semi_dedicated' && !employmentFilter.semi_dedicated) return false;
    const query = staffQuery.normalize('NFKC').toLowerCase().trim();
    return !query || `${item.name} ${item.login_id}`.normalize('NFKC').toLowerCase().includes(query);
  }), [employmentFilter, staff, staffQuery]);
  const visibleStaffIds = useMemo(() => new Set(visibleStaff.map(item => item.id)), [visibleStaff]);
  const filteredShifts = useMemo(() => shifts.filter(item => item.category === category && visibleStaffIds.has(item.teacher_id)), [category, shifts, visibleStaffIds]);
  const roomOptions = useMemo(() => Array.from(new Set([
    ...(rooms[category] || []),
    ...shifts.filter(item => item.category === category).map(item => item.room || '').filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })), [category, rooms, shifts]);
  const displayedShifts = useMemo(() => selectedRoom ? filteredShifts.filter(item => item.room === selectedRoom) : filteredShifts, [filteredShifts, selectedRoom]);
  const selectedShifts = useMemo(() => displayedShifts.filter(item => item.date === selectedDate).sort((a, b) => a.start.localeCompare(b.start)), [displayedShifts, selectedDate]);

  const periodLabel = useMemo(() => {
    if (view === 'day') return dateLabel(focusDate, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    if (view === 'week') return `${dateLabel(range.start, { month: 'numeric', day: 'numeric' })} 〜 ${dateLabel(range.end, { month: 'numeric', day: 'numeric' })}`;
    return dateLabel(focusDate, { year: 'numeric', month: 'long' });
  }, [focusDate, range.end, range.start, view]);

  const movePeriod = (direction: -1 | 1) => {
    const base = dateFromKey(focusDate);
    if (view === 'day') setFocusDate(addDateDays(focusDate, direction));
    else if (view === 'week') setFocusDate(addDateDays(focusDate, direction * 7));
    else setFocusDate(toDateKey(new Date(base.getFullYear(), base.getMonth() + direction, 1)));
  };

  const openCreate = (date = selectedDate, room = '', start = '') => {
    const base = defaultForm(date, category);
    const timed = start ? { start, end: minutesToShiftTime(shiftTimeMinutes(start) + 65) } : {};
    setForm({ ...base, ...timed, room, teacherIds: visibleStaff[0] ? [visibleStaff[0].id] : [] });
  };
  const openEdit = (shift: AttendanceShiftPlan) => setForm({
    id: shift.id, date: shift.date, start: shift.start, end: shift.end, category: shift.category,
    teacherIds: [shift.teacher_id], studentIds: shift.student_ids || [], title: shift.title || '', grade: shift.grade || '', subject: shift.subject || '',
    individualRatio: shift.individual_ratio || '1:2', individualLevel: shift.individual_level || 'standard',
    officeTask: shift.office_task || 'lesson_preparation', room: shift.room || '', note: shift.note || '',
    reflectToAttendance: shift.reflect_to_attendance !== false,
  });

  const formPayload = (teacherId: string) => form ? {
    action: form.id ? 'update' : 'create', id: form.id || undefined, school_id: school.id,
    teacher_id: teacherId, student_ids: form.category === 'individual' ? form.studentIds : [], date: form.date, start: form.start, end: form.end, category: form.category,
    title: form.title, grade: form.grade, subject: form.subject, individual_ratio: form.individualRatio,
    individual_level: form.individualLevel, office_task: form.officeTask, room: form.room, note: form.note,
    reflect_to_attendance: form.reflectToAttendance,
  } : {};

  const saveShift = async () => {
    if (!form || !form.teacherIds.length) return setMessage('職員を1名以上選択してください。');
    setSaving(true); setMessage('');
    try {
      if (form.id) await api(formPayload(form.teacherIds[0]));
      else for (const teacherId of form.teacherIds) await api(formPayload(teacherId));
      setForm(null);
      setSelectedDate(form.date);
      await load();
      setMessage(`${form.teacherIds.length}件のシフトを保存しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存できませんでした。'); }
    finally { setSaving(false); }
  };

  const createRoom = async () => {
    const room = newRoomName.trim();
    if (!room) return setMessage('教室名を入力してください。');
    setSaving(true); setMessage('');
    try {
      await api({ action: 'create_room', school_id: school.id, category, room });
      setRooms(previous => ({ ...previous, [category]: Array.from(new Set([...(previous[category] || []), room])) }));
      setSelectedRoom(room); setNewRoomName(''); setAddingRoom(false);
      setMessage(`${room}を追加しました。この教室にコマを配置できます。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '教室を追加できませんでした。'); }
    finally { setSaving(false); }
  };

  const moveShift = async (shift: AttendanceShiftPlan, date: string, targetMinutes: number, room?: string) => {
    const times = movedShiftTimes(shift.start, shift.end, targetMinutes);
    const nextRoom = room || shift.room || '';
    const original = shifts;
    setShifts(current => current.map(item => item.id === shift.id ? { ...item, date, ...times, room: nextRoom } : item));
    setSelectedDate(date); setDetailOpen(true); setSaving(true); setMessage('');
    try {
      await api({
        action: 'update', id: shift.id, school_id: school.id, teacher_id: shift.teacher_id,
        student_ids: shift.student_ids || [], date, ...times, category: shift.category,
        title: shift.title || '', grade: shift.grade || '', subject: shift.subject || '',
        individual_ratio: shift.individual_ratio, individual_level: shift.individual_level,
        office_task: shift.office_task, room: nextRoom, note: shift.note || '',
        reflect_to_attendance: shift.reflect_to_attendance !== false,
      });
      setMessage(`${shift.teacher_name}さんのコマを${date} ${times.start}へ移動しました。`);
    } catch (error) {
      setShifts(original);
      setMessage(error instanceof Error ? error.message : 'コマを移動できませんでした。');
    } finally { setSaving(false); }
  };

  const selectDate = (date: string) => { setSelectedDate(date); setDetailOpen(true); };

  const deleteShift = async (shift: AttendanceShiftPlan) => {
    const ok = await confirm({
      title: 'シフトを削除しますか？',
      message: `${shift.teacher_name}さんの${shift.date} ${shift.start}〜${shift.end}`,
      tone: 'danger',
      confirmLabel: '削除する',
    });
    if (!ok) return;
    setSaving(true);
    try { await api({ action: 'delete', id: shift.id, school_id: school.id }); await load(); setMessage('シフトを削除しました。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '削除できませんでした。'); }
    finally { setSaving(false); }
  };

  const startCopy = (mode: 'shift' | 'day' | 'week', shift?: AttendanceShiftPlan) => {
    const sourceDate = shift?.date || selectedDate;
    setCopyTarget(mode === 'week' ? addDateDays(startOfWeek(sourceDate), 7) : addDateDays(sourceDate, 1));
    setCopyState({ mode, sourceDate, shiftId: shift?.id });
  };

  const executeCopy = async () => {
    if (!copyState) return;
    setSaving(true);
    try {
      const body = await api({ action: 'copy', mode: copyState.mode, id: copyState.shiftId, source_date: copyState.sourceDate, target_date: copyTarget, school_id: school.id });
      setCopyState(null); setFocusDate(copyTarget); setSelectedDate(copyTarget); await load(); setMessage(`${body.copied}件をコピーしました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'コピーできませんでした。'); }
    finally { setSaving(false); }
  };

  const exportCsv = () => {
    const values = filteredShifts.map(item => [item.date, item.start, item.end, item.category, item.teacher_id, item.teacher_name, (item.student_ids || []).join('|'), (item.student_names || []).join('|'), item.employment_category || '', item.title || '', item.grade || '', item.subject || '', item.individual_ratio || '', item.individual_level || '', item.office_task || '', item.room || '', item.note || '', item.reflect_to_attendance ? 'する' : 'しない']);
    downloadCsv([CSV_HEADERS, ...values], `勤怠シフト_${range.start}_${range.end}.csv`);
  };

  const downloadCsvTemplate = () => {
    downloadCsv([CSV_HEADERS], '勤怠シフト_CSV取込テンプレート.csv');
    setMessage('CSVテンプレートをダウンロードしました。複数の生徒IDは「|」で区切って入力してください。');
  };

  const importCsv = async (file: File) => {
    const rawRows = parseCsv(await file.text());
    const staffById = new Map(staff.map(item => [item.id, item]));
    const staffByLogin = new Map(staff.map(item => [item.login_id, item]));
    const studentById = new Map(students.flatMap(item => [[item.id, item], ...(item.login_id ? [[item.login_id, item] as const] : [])]));
    const rows = rawRows.map(row => {
      const target = staffById.get(row['職員ID']) || staffByLogin.get(row['職員ID']);
      const categoryMap: Record<string, AttendanceShiftCategory> = { '集団': 'group', '個別': 'individual', '事務': 'office', group: 'group', individual: 'individual', office: 'office' };
      const studentIds = String(row['生徒ID'] || '').split('|').map(value => value.trim()).filter(Boolean).map(value => studentById.get(value)?.id || value);
      return { teacher_id: target?.id || row['職員ID'], login_id: target?.login_id || row['職員ID'], teacher_name: row['職員名'], student_ids: studentIds, date: row['日付'], start: row['開始'], end: row['終了'], category: categoryMap[row['区分']] || row['区分'], title: row['タイトル'], grade: row['学年'], subject: row['科目'], individual_ratio: row['個別人数'], individual_level: row['個別単価'] || 'standard', office_task: row['事務内容'] || 'lesson_preparation', room: row['教室・ブース'] || row['教室'], note: row['メモ'], reflect_to_attendance: row['勤怠反映'] !== 'しない' };
    });
    setSaving(true);
    try { const body = await api({ action: 'import', school_id: school.id, rows }); await load(); setMessage(`${body.count}件を取り込みました。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'CSVを取り込めませんでした。'); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const monthDays = useMemo(() => {
    const first = startOfMonth(focusDate);
    const offset = (dateFromKey(first).getDay() + 6) % 7;
    const gridStart = addDateDays(first, -offset);
    return Array.from({ length: 42 }, (_, index) => addDateDays(gridStart, index));
  }, [focusDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDateDays(startOfWeek(focusDate), index)), [focusDate]);

  const loadWeekForOutput = async () => {
    const start = startOfWeek(focusDate);
    const end = addDateDays(start, 6);
    const body = await api(undefined, new URLSearchParams({ start, end }));
    const allowedStaff = new Set(visibleStaff.map(item => item.id));
    return (body.shifts || []).filter((item: AttendanceShiftPlan) => item.category === category && allowedStaff.has(item.teacher_id));
  };

  const exportWeeklySpreadsheet = async () => {
    setSaving(true); setMessage('');
    try {
      const output = await loadWeekForOutput();
      const start = startOfWeek(focusDate);
      await downloadWeeklyShiftWorkbook({ schoolName: school.name, start, end: addDateDays(start, 6), category, shifts: output });
      setMessage('現在の1週間をExcelファイルに変換しました。Googleスプレッドシートにも取り込めます。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '週次表を出力できませんでした。'); }
    finally { setSaving(false); }
  };

  const printWeeklySchedule = async () => {
    setSaving(true); setMessage('');
    try {
      const output = await loadWeekForOutput();
      setPrintShifts(output);
      setPrintDays(Array.from({ length: 7 }, (_, index) => addDateDays(startOfWeek(focusDate), index)));
      setTimeout(() => window.print(), 100);
    } catch (error) { setMessage(error instanceof Error ? error.message : '印刷データを準備できませんでした。'); }
    finally { setSaving(false); }
  };

  const categoryOptions: AttendanceShiftCategory[] = ['group', 'individual', 'office'];

  return (
    <>
    <main className="px-3 pb-32 pt-3 text-fg print:hidden sm:px-5 lg:px-7">
      <PageHeader
        tone="plain"
        title="勤怠承認シフト管理"
        icon={CalendarDays}
        description={`${school.name || '所属校舎'}の勤務予定を作成・管理`}
        className="mx-auto max-w-[1600px]"
        actions={<Button icon={<Plus size={18} />} onClick={() => openCreate(selectedDate, selectedRoom)}>新規シフト</Button>}
      />

      <section className="cb-card mx-auto mt-4 max-w-[1600px] overflow-visible">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 sm:p-4">
          <IconButton label="前へ" variant="secondary" onClick={() => movePeriod(-1)}><ChevronLeft size={19} /></IconButton>
          <button type="button" onClick={() => { setFocusDate(today); setSelectedDate(today); }} className="h-10 rounded-btn border border-slate-200 px-4 text-xs font-bold hover:bg-slate-50">今日</button>
          <IconButton label="次へ" variant="secondary" onClick={() => movePeriod(1)}><ChevronRight size={19} /></IconButton>
          <h2 className="min-w-[180px] px-2 text-base font-bold sm:text-lg">{periodLabel}</h2>
          <div className="flex rounded-btn bg-slate-100 p-1">
            {(['month', 'week', 'day'] as AttendanceShiftView[]).map(item => <button key={item} type="button" onClick={() => { setView(item); if (item === 'day') { setFocusDate(today); setSelectedDate(today); } }} className={`min-h-9 rounded-lg px-4 text-xs font-bold motion-safe:transition ${view === item ? 'bg-white text-accent shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{item === 'month' ? '月' : item === 'week' ? '1週間' : '今日'}</button>)}
          </div>
          <div className="ml-auto flex rounded-btn border border-slate-200 bg-white p-1">
            {categoryOptions.map(item => <button key={item} type="button" onClick={() => { setCategory(item); setSelectedRoom(''); }} className={`min-h-9 rounded-lg px-4 text-xs font-bold motion-safe:transition ${category === item ? 'bg-accent text-accent-ink shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>{SHIFT_CATEGORY_LABELS[item]}</button>)}
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            <button type="button" onClick={() => startCopy('day')} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50"><Copy size={14} />この日をコピー</button>
            <button type="button" onClick={() => startCopy('week')} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50"><LayoutGrid size={14} />この週をコピー</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50"><FileUp size={14} />CSV取込</button>
            <button type="button" onClick={downloadCsvTemplate} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50"><Download size={14} />CSVテンプレート</button>
            <button type="button" onClick={exportCsv} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50"><Download size={14} />CSV出力</button>
            <button type="button" onClick={() => void exportWeeklySpreadsheet()} disabled={saving} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"><FileSpreadsheet size={14} />週次表をExcel</button>
            <button type="button" onClick={() => void printWeeklySchedule()} disabled={saving} className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-slate-200 px-3 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"><Printer size={14} />週次表を印刷</button>
          </div>
          <div className="relative xl:hidden">
            <IconButton label="その他の操作" variant="secondary" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><MoreVertical size={18} /></IconButton>
            {moreOpen && <div className="absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-btn border border-slate-200 bg-white p-1 shadow-xl">
              <button type="button" onClick={() => { setMoreOpen(false); startCopy('day'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><Copy size={15} />この日をコピー</button>
              <button type="button" onClick={() => { setMoreOpen(false); startCopy('week'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><LayoutGrid size={15} />この週をコピー</button>
              <button type="button" onClick={() => { setMoreOpen(false); fileRef.current?.click(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><FileUp size={15} />CSV取込</button>
              <button type="button" onClick={() => { setMoreOpen(false); downloadCsvTemplate(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><Download size={15} />CSVテンプレートをダウンロード</button>
              <button type="button" onClick={() => { setMoreOpen(false); exportCsv(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><Download size={15} />CSV出力</button>
              <button type="button" onClick={() => { setMoreOpen(false); void exportWeeklySpreadsheet(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-emerald-50"><FileSpreadsheet size={15} />週次表をExcelに変換</button>
              <button type="button" onClick={() => { setMoreOpen(false); void printWeeklySchedule(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-50"><Printer size={15} />週次表を印刷</button>
            </div>}
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void importCsv(file); }} />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-3 py-3 sm:px-4">
          <label className="flex min-h-10 min-w-[220px] flex-1 items-center gap-2 rounded-input border border-slate-200 bg-white px-3 sm:max-w-sm"><Search size={16} className="text-slate-400" /><input value={staffQuery} onChange={event => setStaffQuery(event.target.value)} placeholder="職員名・IDで検索" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500"><Filter size={14} />表示</span>
          {(['dedicated', 'semi_dedicated'] as const).map(item => <label key={item} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-btn border border-slate-200 bg-white px-3 text-xs font-bold"><input type="checkbox" checked={employmentFilter[item]} onChange={event => setEmploymentFilter(previous => ({ ...previous, [item]: event.target.checked }))} className="h-4 w-4 accent-accent" />{item === 'dedicated' ? '専任' : '準専任'}</label>)}
          <span className="ml-auto text-xs font-bold text-slate-400">表示中 {visibleStaff.length}名・{displayedShifts.length}件</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <span className="mr-1 text-xs font-bold text-slate-500">{category === 'individual' ? 'ブース' : category === 'office' ? '場所' : '教室'}</span>
          <button type="button" onClick={() => setSelectedRoom('')} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${selectedRoom === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>すべて</button>
          {roomOptions.map(room => <button key={room} type="button" onClick={() => setSelectedRoom(room)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const shift = shifts.find(item => item.id === event.dataTransfer.getData('text/plain')); if (shift) void moveShift(shift, shift.date, shiftTimeMinutes(shift.start), room); }} className={`min-h-9 max-w-32 truncate rounded-lg px-3 text-xs font-bold ${selectedRoom === room ? 'bg-accent text-accent-ink' : 'border border-slate-200 bg-white text-slate-600 hover:border-accent/40'}`} title={`${room}（コマをここへドロップして教室変更）`}>{room}</button>)}
          {addingRoom ? <div className="flex min-w-0 items-center gap-1">
            <input autoFocus value={newRoomName} onChange={event => setNewRoomName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createRoom(); if (event.key === 'Escape') setAddingRoom(false); }} placeholder={category === 'individual' ? 'ブース名' : '教室名'} className="h-9 w-28 rounded-input border border-accent/40 px-2 text-xs outline-none ring-accent/30 focus:ring-2" />
            <button type="button" onClick={() => void createRoom()} disabled={saving} className="h-9 rounded-input bg-accent px-3 text-xs font-bold text-accent-ink disabled:opacity-50">追加</button>
            <IconButton label="教室追加を閉じる" size="sm" onClick={() => { setAddingRoom(false); setNewRoomName(''); }}><X size={14} /></IconButton>
          </div> : <button type="button" onClick={() => setAddingRoom(true)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-dashed border-accent/40 px-2.5 text-xs font-bold text-accent hover:bg-accent-soft"><Plus size={12} />{category === 'individual' ? 'ブース追加' : '教室追加'}</button>}
          {selectedRoom ? <button type="button" onClick={() => openCreate(selectedDate, selectedRoom)} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg bg-accent-soft px-3 text-xs font-bold text-accent hover:bg-accent-soft"><Plus size={12} />この{category === 'individual' ? 'ブース' : '教室'}にコマ追加</button> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/15 bg-accent-soft px-4 py-2">
          <p className="text-xs font-bold text-accent">コマはドラッグして曜日・時刻・教室を変更できます。</p>
          {view === 'week' ? <div className="flex rounded-lg border border-accent/30 bg-white p-0.5" aria-label="週間表示形式">
            <button type="button" onClick={() => setWeekLayout('rooms')} className={`min-h-8 rounded-md px-3 text-xs font-bold ${weekLayout === 'rooms' ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-accent-soft'}`}>教室別</button>
            <button type="button" onClick={() => setWeekLayout('compact')} className={`min-h-8 rounded-md px-3 text-xs font-bold ${weekLayout === 'compact' ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-accent-soft'}`}>1週間一覧</button>
          </div> : <p className="text-xs font-bold text-accent">時間軸表示</p>}
        </div>

        {message && <div className="border-b border-accent/15 bg-accent-soft px-4 py-2 text-xs font-bold text-accent">{message}</div>}
        <div className={`min-h-[660px] ${detailOpen ? 'grid xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
          <div className={`min-w-0 ${view === 'month' ? 'overflow-auto' : 'overflow-hidden'}`}>
            {loading ? <div className="grid min-h-[620px] place-items-center"><Spinner size={32} /></div> : loadError ? <ErrorState className="m-4" onRetry={() => void load()} /> : view === 'month' ? (
              <div className="min-w-[840px]">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-bold text-slate-500">{['月', '火', '水', '木', '金', '土', '日'].map((day, index) => <div key={day} className={`py-3 ${index === 5 ? 'text-sky-600' : index === 6 ? 'text-rose-600' : ''}`}>{day}</div>)}</div>
                <div className="grid grid-cols-7">{monthDays.map(day => {
                  const dayShifts = displayedShifts.filter(item => item.date === day);
                  const outside = day.slice(0, 7) !== focusDate.slice(0, 7);
                  const selected = day === selectedDate;
                  return <button type="button" key={day} onClick={() => selectDate(day)} onDoubleClick={() => openCreate(day, selectedRoom)} className={`min-h-[132px] border-b border-r border-slate-200 p-1.5 text-left align-top motion-safe:transition hover:bg-accent-soft/40 ${outside ? 'bg-slate-50/70 text-slate-300' : 'bg-white'} ${selected ? 'ring-2 ring-inset ring-accent' : ''}`}>
                    <span className={`mb-1 grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${day === today ? 'bg-accent text-accent-ink' : ''}`}>{Number(day.slice(-2))}</span>
                    <span className="space-y-1">{dayShifts.slice(0, 5).map(shift => <span key={shift.id} className={`block truncate rounded-md border-l-4 px-1.5 py-1 text-xs font-bold ring-1 ${categoryTone[shift.category].chip} ${categoryTone[shift.category].border}`}><span className="font-mono">{shift.start}-{shift.end}</span> {shift.teacher_name.split(/[ 　]/)[0]} {shift.category === 'individual' ? shift.individual_ratio : ''}</span>)}</span>
                    {dayShifts.length > 5 && <span className="mt-1 block text-center text-xs font-bold text-accent">+{dayShifts.length - 5}件</span>}
                  </button>;
                })}</div>
              </div>
            ) : view === 'week' ? weekLayout === 'rooms' ? (
              <AttendanceShiftRoomBoard key={`${category}-${range.start}-${selectedRoom}`} days={weekDays} shifts={displayedShifts} rooms={selectedRoom ? [selectedRoom] : roomOptions} selectedDate={selectedDate} today={today} onSelectDate={selectDate} onSelectShift={openEdit} onCreate={openCreate} onMoveShift={(shift, date, minutes, room) => void moveShift(shift, date, minutes, room)} />
            ) : (
              <AttendanceShiftTimeline days={weekDays} shifts={displayedShifts} selectedDate={selectedDate} selectedRoom={selectedRoom} today={today} onSelectDate={selectDate} onSelectShift={openEdit} onCreate={openCreate} onMoveShift={(shift, date, minutes, room) => void moveShift(shift, date, minutes, room)} />
            ) : (
              <AttendanceShiftTimeline days={[focusDate]} shifts={displayedShifts} selectedDate={selectedDate} selectedRoom={selectedRoom} today={today} onSelectDate={selectDate} onSelectShift={openEdit} onCreate={openCreate} onMoveShift={(shift, date, minutes, room) => void moveShift(shift, date, minutes, room)} />
            )}
          </div>

          {detailOpen ? <aside className="border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
            <div className="sticky top-0">
              <div className="flex items-start justify-between border-b border-slate-200 p-4"><div><p className="text-xs font-bold text-accent">{dateLabel(selectedDate, { weekday: 'long' })}</p><h3 className="mt-1 text-xl font-black">{dateLabel(selectedDate, { year: 'numeric', month: 'long', day: 'numeric' })}</h3><p className="mt-1 text-xs font-bold text-slate-400">この日の{SHIFT_CATEGORY_LABELS[category]}シフト {selectedShifts.length}件</p></div><div className="flex gap-1"><IconButton label="シフトを追加" variant="primary" onClick={() => openCreate(selectedDate, selectedRoom)}><Plus size={19} /></IconButton><IconButton label="この日のシフトを閉じる" variant="secondary" onClick={() => setDetailOpen(false)}><X size={18} /></IconButton></div></div>
              <div className="max-h-[560px] space-y-2 overflow-y-auto p-4">{selectedShifts.length ? selectedShifts.map(shift => <article key={shift.id} className={`rounded-btn border border-slate-200 border-l-4 bg-white p-3 shadow-sm ${categoryTone[shift.category].border}`}>
                <div className="flex items-start gap-3"><div className="min-w-14 font-mono text-xs font-bold text-slate-600"><p>{shift.start}</p><p className="mt-1 text-slate-400">{shift.end}</p></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><h4 className="font-bold">{shift.teacher_name}</h4><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{employmentLabel(shift.employment_category)}</span>{shift.category === 'individual' && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">{shift.individual_ratio}</span>}</div><p className="mt-1 truncate text-xs font-bold text-slate-500">{[shift.title, shift.subject, shift.room].filter(Boolean).join(' ／ ') || SHIFT_CATEGORY_LABELS[shift.category]}</p><p className={`mt-2 text-xs font-bold ${shift.reflect_to_attendance ? 'text-emerald-700' : 'text-amber-700'}`}>{shift.reflect_to_attendance ? '● 勤怠予定へ反映' : '● 勤怠へ未反映'}</p></div><div className="flex gap-1"><IconButton label="編集" size="sm" onClick={() => openEdit(shift)}><Pencil size={14} /></IconButton><IconButton label="コピー" size="sm" onClick={() => startCopy('shift', shift)}><Copy size={14} /></IconButton><IconButton label="削除" size="sm" className="hover:bg-danger-soft hover:text-danger" onClick={() => void deleteShift(shift)}><Trash2 size={14} /></IconButton></div></div>
              </article>) : <EmptyState icon={Clock3} title="この日のシフトはありません" action={<Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => openCreate(selectedDate)}>シフトを追加</Button>} />}</div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-4"><button type="button" onClick={() => startCopy('day')} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-btn border border-slate-200 text-xs font-bold hover:bg-slate-50"><Copy size={14} />この日をコピー</button><button type="button" onClick={() => startCopy('week')} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-btn border border-slate-200 text-xs font-bold hover:bg-slate-50"><LayoutGrid size={14} />この週をコピー</button></div>
            </div>
          </aside> : null}
        </div>
      </section>

      {form && <ShiftEditor form={form} setForm={setForm} staff={visibleStaff} students={students} categoryOptions={categoryOptions} roomOptions={Array.from(new Set([...(rooms[form.category] || []), ...(shifts.filter(item => item.category === form.category).map(item => item.room).filter(Boolean) as string[])])).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))} saving={saving} onClose={() => setForm(null)} onSave={() => void saveShift()} />}
      <Modal
        open={!!copyState}
        onClose={() => setCopyState(null)}
        size="sm"
        title={`${copyState?.mode === 'shift' ? 'このコマ' : copyState?.mode === 'day' ? 'この日' : 'この週'}をコピー`}
        description={`コピー先の${copyState?.mode === 'week' ? '週の開始日' : '日付'}を選択してください。`}
        footer={<Button fullWidth loading={saving} icon={<Copy size={17} />} onClick={() => void executeCopy()}>コピーする</Button>}
      >
        <label className="block text-xs font-bold text-slate-600">コピー先<input type="date" value={copyTarget} onChange={event => setCopyTarget(event.target.value)} className="mt-2 h-12 w-full rounded-input border border-line px-3 text-sm font-bold" /></label>
      </Modal>
    </main>
    <section className="hidden p-5 print:block">
      <div className="mb-3"><p className="text-sm font-bold">{school.name}</p></div>
      {printDays.length > 0 && <AttendanceWeeklySchedule days={printDays} shifts={printShifts} category={category} selectedDate="" today={today} printOnly />}
    </section>
    <style jsx global>{`@media print { @page { size: A4 landscape; margin: 8mm; } body { background: white !important; } }`}</style>
    </>
  );
}

function ShiftEditor({ form, setForm, staff, students, categoryOptions, roomOptions, saving, onClose, onSave }: { form: ShiftForm; setForm: (value: ShiftForm) => void; staff: Staff[]; students: Student[]; categoryOptions: AttendanceShiftCategory[]; roomOptions: string[]; saving: boolean; onClose: () => void; onSave: () => void }) {
  const toggleTeacher = (id: string) => setForm({ ...form, teacherIds: form.teacherIds.includes(id) ? form.teacherIds.filter(item => item !== id) : [...form.teacherIds, id] });
  const [studentQuery, setStudentQuery] = useState('');
  const visibleStudents = students.filter(student => {
    const query = studentQuery.normalize('NFKC').toLowerCase().trim();
    return !query || `${student.name} ${student.login_id} ${student.grade} ${student.classroom}`.normalize('NFKC').toLowerCase().includes(query);
  });
  const toggleStudent = (id: string) => {
    const maximum = Number(form.individualRatio.split(':')[1] || 1);
    setForm({ ...form, studentIds: form.studentIds.includes(id) ? form.studentIds.filter(item => item !== id) : [...form.studentIds, id].slice(0, maximum) });
  };
  return <Modal
    open
    onClose={onClose}
    size="lg"
    title={form.id ? 'シフトを編集' : 'シフトを追加'}
    description="5分単位で勤務予定を登録します。"
    footer={<Button fullWidth size="lg" loading={saving} icon={<Plus size={18} />} onClick={onSave}>{form.id ? '変更を保存' : `${form.teacherIds.length || ''}件のシフトを登録`}</Button>}
  ><div className="space-y-5">
    <div className={`grid gap-2 ${categoryOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>{categoryOptions.map(item => <button type="button" key={item} onClick={() => setForm({ ...form, category: item, studentIds: item === 'individual' ? form.studentIds : [] })} className={`min-h-11 rounded-btn border text-sm font-bold ${form.category === item ? 'border-accent bg-accent text-accent-ink' : 'border-slate-200 text-slate-600'}`}>{SHIFT_CATEGORY_LABELS[item]}</button>)}</div>
    <label className="block text-xs font-bold text-slate-600">日付<input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm font-bold" /></label>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">開始<FiveMinuteTimePicker value={form.start} onChange={value => setForm({ ...form, start: value })} className="mt-2 h-12 rounded-input border border-slate-200 bg-white px-2 text-sm font-bold" label="開始時刻" /></label><label className="text-xs font-bold text-slate-600">終了<FiveMinuteTimePicker value={form.end} onChange={value => setForm({ ...form, end: value })} className="mt-2 h-12 rounded-input border border-slate-200 bg-white px-2 text-sm font-bold" label="終了時刻" /></label></div>
    <div><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-600">職員 {form.id ? '（1名）' : '（複数選択可）'}</p><span className="text-xs font-bold text-slate-400">{form.teacherIds.length}名選択</span></div><div className="mt-2 max-h-52 overflow-y-auto rounded-input border border-slate-200 p-2">{staff.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50"><input type={form.id ? 'radio' : 'checkbox'} checked={form.teacherIds.includes(item.id)} onChange={() => form.id ? setForm({ ...form, teacherIds: [item.id] }) : toggleTeacher(item.id)} className="h-4 w-4 accent-accent" /><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500"><UserRound size={15} /></span><span className="min-w-0 flex-1 truncate text-sm font-bold">{item.name}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{employmentLabel(item.employment_category)}</span></label>)}</div></div>
    {form.category === 'individual' && <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">指導人数<select value={form.individualRatio} onChange={event => { const ratio = event.target.value as ShiftForm['individualRatio']; setForm({ ...form, individualRatio: ratio, studentIds: form.studentIds.slice(0, Number(ratio.split(':')[1])) }); }} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm font-bold"><option>1:1</option><option>1:2</option><option>1:3</option></select></label><label className="text-xs font-bold text-slate-600">単価区分<select value={form.individualLevel} onChange={event => setForm({ ...form, individualLevel: event.target.value as ShiftForm['individualLevel'] })} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm font-bold">{INDIVIDUAL_LEVEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>}
    {form.category === 'individual' && <div><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-600">担当生徒（複数選択可）</p><span className="text-xs font-bold text-slate-400">{form.studentIds.length}名選択</span></div><label className="mt-2 flex h-11 items-center gap-2 rounded-input border border-slate-200 px-3"><Search size={15} className="text-slate-400"/><input value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="生徒名・ID・学年で検索" className="min-w-0 flex-1 text-sm outline-none" /></label><div className="mt-2 max-h-52 overflow-y-auto rounded-input border border-slate-200 p-2">{visibleStudents.map(student => <label key={student.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-sky-50"><input type="checkbox" checked={form.studentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} className="h-4 w-4 accent-sky-600" /><span className="min-w-0 flex-1 truncate text-sm font-bold">{student.name}</span><span className="text-xs font-bold text-slate-400">{[student.grade, student.classroom].filter(Boolean).join(' / ')}</span></label>)}{!visibleStudents.length && <p className="p-4 text-center text-xs font-bold text-slate-400">該当する生徒がいません</p>}</div></div>}
    {form.category === 'group' && <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">学年<input value={form.grade} onChange={event => setForm({ ...form, grade: event.target.value })} placeholder="中2" className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm" /></label><label className="text-xs font-bold text-slate-600">科目<input value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} placeholder="英語" className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm" /></label></div>}
    {form.category === 'office' && <label className="block text-xs font-bold text-slate-600">事務内容<select value={form.officeTask} onChange={event => setForm({ ...form, officeTask: event.target.value })} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm font-bold">{OFFICE_TASK_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
    <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">授業・業務名<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder={form.category === 'individual' ? '個別指導' : form.category === 'group' ? '中2 英語' : '教室運営'} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm" /></label><label className="text-xs font-bold text-slate-600">{form.category === 'group' ? '実施教室' : form.category === 'individual' ? 'ブース' : '業務場所'}<input list="attendance-shift-room-options" value={form.room} onChange={event => setForm({ ...form, room: event.target.value })} placeholder={form.category === 'group' ? 'A教室' : form.category === 'individual' ? 'ブース1' : '事務室'} className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm" /><datalist id="attendance-shift-room-options">{roomOptions.map(room => <option key={room} value={room} />)}</datalist></label></div>
    {form.category === 'individual' && <label className="block text-xs font-bold text-slate-600">科目（任意）<input value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} placeholder="英語" className="mt-2 h-12 w-full rounded-input border border-slate-200 px-3 text-sm" /></label>}
    <label className="block text-xs font-bold text-slate-600">メモ<textarea value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} className="mt-2 min-h-24 w-full rounded-input border border-slate-200 p-3 text-sm" /></label>
    <label className="flex cursor-pointer items-start gap-3 rounded-btn border border-emerald-200 bg-emerald-50 p-4"><input type="checkbox" checked={form.reflectToAttendance} onChange={event => setForm({ ...form, reflectToAttendance: event.target.checked })} className="mt-0.5 h-5 w-5 accent-emerald-600" /><span><span className="block text-sm font-bold text-emerald-900">勤務予定として勤怠に反映</span><span className="mt-1 block text-xs font-bold leading-5 text-emerald-700">職員の勤怠画面と、承認者が実績を作る際の勤務詳細ベースに表示します。</span></span></label>
  </div></Modal>;
}
