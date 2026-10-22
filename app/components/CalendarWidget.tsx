'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2, BookOpen, Megaphone, CalendarPlus, Download, Clock, MapPin, CalendarX2, HelpCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { parseClassDays } from '@/lib/class-days';
import { selectDisplayShiftAssignments } from '@/lib/shift-assignment-display';
import { loadStudentCalendar } from '@/lib/client-student-homework';
import { calendarScheduleKind, calendarScheduleLabel } from '@/lib/calendar-schedule-display';
import { formatDate, jstDateKey } from '@/lib/format';
import { ErrorState, IconButton, useToast } from '@/app/components/ui';

// 曜日の数値変換マップ
const DAY_MAP: { [key: string]: number } = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
const scheduleStart = (item: any) => item.start_date || item.target_date || '';
const scheduleEnd = (item: any) => item.end_date || item.target_date || scheduleStart(item);
const scheduleCoversDate = (item: any, date: string) => scheduleStart(item) <= date && date <= scheduleEnd(item);

interface Props {
  classDay?: string | string[]; // 生徒の授業曜日 (例: "月" または ["月", "木"])
  grade?: string;    // 生徒の学年 (例: "中1") ★追加
  role?: 'student' | 'parent' | 'teacher';
  profile?: any;
  studentShiftIds?: string[] | null;
  studentShiftDates?: string[] | null;
}

type TeacherShiftEvent = {
  id: string;
  title: string;
  date: string;
  period: string;
  startTime: string;
  endTime: string;
  location: string;
  details: string;
};

const TIME_MAP: Record<string, { start: string; end: string }> = {
  '1限': { start: '192000', end: '202500' },
  '2限': { start: '203500', end: '214000' },
};

const normalizeName = (value: unknown) => String(value || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
const periodFromNote = (note: unknown) => {
  const text = String(note || '').normalize('NFKC');
  if (text.includes('1限')) return '1限';
  if (text.includes('2限')) return '2限';
  return '時間未定';
};
const dateCompact = (date: string) => date.replace(/-/g, '');
const escapeIcsText = (value: string) => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

type CalendarMonthData = {
  shifts: any[];
  homeworks: any[];
  schedules: any[];
};

const CALENDAR_CACHE_TTL_MS = 15 * 60 * 1000;
const calendarMonthCache = new Map<string, { expiresAt: number; data: CalendarMonthData }>();
const calendarMonthRequests = new Map<string, Promise<CalendarMonthData>>();

const loadCalendarMonth = async (startStr: string, endStr: string, includeShifts: boolean, role: Props['role']) => {
  const cacheKey = `${role}_${startStr}_${endStr}_${includeShifts ? 'with-shifts' : 'without-shifts'}`;
  const cached = calendarMonthCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const pending = calendarMonthRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const shiftQuery = query(
      collection(db, 'shift_assignments'),
      where('target_date', '>=', startStr),
      where('target_date', '<=', endStr)
    );
    const homeworkQuery = query(collection(db, 'homework_assignments'), where('deadline', '>=', startStr), where('deadline', '<=', endStr));
    const rangeScheduleQuery = query(
      collection(db, 'monthly_schedules'),
      where('start_date', '<=', endStr),
      orderBy('start_date', 'asc')
    );
    const legacyScheduleQuery = query(
      collection(db, 'monthly_schedules'),
      where('target_date', '>=', startStr),
      where('target_date', '<=', endStr)
    );

    const studentDataPromise = role === 'student'
      ? loadStudentCalendar(startStr, endStr)
      : Promise.resolve({ homeworks: [] as any[], schedules: [] as any[] });
    const [shiftSnap, homeworkSnap, rangeScheduleSnap, legacyScheduleSnap, studentData] = await Promise.all([
      includeShifts ? getDocs(shiftQuery) : Promise.resolve({ docs: [] as any[] }),
      role === 'teacher' ? getDocs(homeworkQuery) : Promise.resolve({ docs: [] as any[] }),
      role === 'teacher' ? getDocs(rangeScheduleQuery).catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
      role === 'teacher' ? getDocs(legacyScheduleQuery).catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
      studentDataPromise,
    ]);
    const scheduleMap = new Map<string, any>();
    [...rangeScheduleSnap.docs, ...legacyScheduleSnap.docs].forEach((snapshot: any) => {
      const item = { id: snapshot.id, ...snapshot.data() };
      if (scheduleStart(item) <= endStr && scheduleEnd(item) >= startStr) scheduleMap.set(item.id, item);
    });
    const data = {
      shifts: selectDisplayShiftAssignments(
        shiftSnap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      ),
      homeworks: role === 'student' ? studentData.homeworks : homeworkSnap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      schedules: role === 'student' ? studentData.schedules : Array.from(scheduleMap.values()),
    };
    calendarMonthCache.set(cacheKey, { expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS, data });
    return data;
  })();

  calendarMonthRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    calendarMonthRequests.delete(cacheKey);
  }
};

export default function CalendarWidget({ classDay, grade, role = 'student', profile, studentShiftIds, studentShiftDates }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState<string[]>([]);
  const [teacherShiftEvents, setTeacherShiftEvents] = useState<TeacherShiftEvent[]>([]);
  const [homeworks, setHomeworks] = useState<string[]>([]); // 宿題の期限日リスト
  const [monthlySchedules, setMonthlySchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const toast = useToast();
  const profileId = String(profile?.id || profile?.uid || '');
  const profileName = String(profile?.student_name || profile?.teacher_name || profile?.name || '');
  const classDayIndexes = new Set(parseClassDays(classDay).map(day => DAY_MAP[day]));
  const registeredShiftIdSet = useMemo(
    () => new Set((studentShiftIds || []).map(String)),
    [studentShiftIds],
  );

  // 表示月が変わったらデータを取得
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;
      const includeShifts = role === 'teacher';
      const cached = calendarMonthCache.get(`${role}_${startStr}_${endStr}_${includeShifts ? 'with-shifts' : 'without-shifts'}`);
      setLoading(!(cached && cached.expiresAt > Date.now()));
      setLoadError(false);

      try {
        const monthData = await loadCalendarMonth(startStr, endStr, includeShifts, role);
        if (cancelled) return;
        const rawShifts = monthData.shifts;
        const teacherName = normalizeName(profileName);
        const teacherEvents = rawShifts
          .filter(data => {
            if (role !== 'teacher') return false;
            if (profileId && data.user_id === profileId) return true;
            const shiftTeacherName = normalizeName(data.teacher_name);
            return Boolean(teacherName && shiftTeacherName && (shiftTeacherName.includes(teacherName) || teacherName.includes(shiftTeacherName)));
          })
          .map(data => {
            const period = periodFromNote(data.note);
            const times = TIME_MAP[period] || { start: '090000', end: '100000' };
            const titleParts = [
              data.target_grade,
              data.target_subject,
              data.target_detail_subject,
            ].filter(Boolean);
            const title = titleParts.length ? titleParts.join(' ') : '講師配置';
            const details = [
              data.unit ? `単元: ${data.unit}` : '',
              data.note ? `備考: ${data.note}` : '',
              data.target_meeting_id ? `Zoom ID: ${data.target_meeting_id}` : '',
            ].filter(Boolean).join('\n');
            return {
              id: data.id,
              title,
              date: String(data.target_date || '').replace(/\//g, '-').split('T')[0].split(' ')[0],
              period,
              startTime: times.start,
              endTime: times.end,
              location: data.target_place || 'オンライン',
              details,
            } as TeacherShiftEvent;
          })
          .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        setTeacherShiftEvents(teacherEvents);

        const shiftDates = role === 'teacher'
          ? teacherEvents.map(event => event.date)
          : studentShiftDates !== undefined
            ? (studentShiftDates || []).filter(date => startStr <= date && date <= endStr)
          : studentShiftIds !== undefined
            ? rawShifts
              .filter((shift: any) => registeredShiftIdSet.has(String(shift.id)))
              .map((shift: any) => String(shift.target_date || ''))
              .filter(Boolean)
            : rawShifts
              .filter((shift: any) => String(shift.role_type || 'main') === 'main')
              .filter((shift: any) => !grade || !shift.target_grade || String(shift.target_grade) === String(grade))
              .map((shift: any) => String(shift.target_date || ''))
              .filter(Boolean);
        setShifts(shiftDates);

        const hwDates = monthData.homeworks
          .filter((data: any) => role === 'student' || !grade || data.target_grade === grade)
          .map((data: any) => String(data.deadline || ''))
          .filter(Boolean);
        setHomeworks([...new Set<string>(hwDates)]);

        setMonthlySchedules(monthData.schedules
          .filter((data: any) => !data.archived)
          .filter((data: any) => {
            const audience = data.audience || 'all';
            if (role === 'teacher') return ['all', 'teacher', 'staff', 'student_parent'].includes(audience);
            if (role === 'parent') return ['all', 'student_parent', 'parent'].includes(audience);
            return ['all', 'student_parent', 'student'].includes(audience) && data.category !== 'curriculum';
          })
          .filter((data: any) => !grade || !Array.isArray(data.grades) || data.grades.length === 0 || data.grades.includes(grade))
        );

      } catch (e) {
        console.error(e);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [currentDate, grade, role, profileId, profileName, registeredShiftIdSet, studentShiftDates, studentShiftIds, reloadKey]);

  // カレンダー生成ロジック
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay();

  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const calendarDays = [];
  
  // 前月分
  for (let i = 0; i < startingDay; i++) {
    calendarDays.push({ day: prevMonthLastDay - startingDay + 1 + i, type: 'prev' });
  }
  // 今月分
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push({ day: i, type: 'current' });
  }
  // 翌月分
  const totalSlots = 42; 
  const remainingSlots = totalSlots - calendarDays.length;
  for (let i = 1; i <= remainingSlots; i++) {
    calendarDays.push({ day: i, type: 'next' });
  }

  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  const changeMonth = (diff: number) => {
    setCurrentDate(new Date(year, month + diff, 1));
    setSelectedDate('');
  };

  const getGoogleCalendarUrl = (event: TeacherShiftEvent) => {
    const day = dateCompact(event.date);
    const url = new URL('https://www.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', `${event.title} ${event.period}`);
    url.searchParams.set('dates', `${day}T${event.startTime}/${day}T${event.endTime}`);
    url.searchParams.set('details', event.details || 'オンライン理社講座 講師配置');
    url.searchParams.set('location', event.location);
    return url.toString();
  };

  const exportEventsAsIcs = (events: TeacherShiftEvent[], filename: string) => {
    if (!events.length) {
      toast.info('書き出せる講師配置がありません。');
      return;
    }
    const body = events.map(event => {
      const day = dateCompact(event.date);
      return [
        'BEGIN:VEVENT',
        `UID:${event.id}@classbase-app`,
        `SUMMARY:${escapeIcsText(`${event.title} ${event.period}`)}`,
        `DTSTART:${day}T${event.startTime}`,
        `DTEND:${day}T${event.endTime}`,
        `LOCATION:${escapeIcsText(event.location)}`,
        `DESCRIPTION:${escapeIcsText(event.details || 'オンライン理社講座 講師配置')}`,
        'END:VEVENT',
      ].join('\n');
    }).join('\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Classbase//Teacher Shifts//JA', 'CALSCALE:GREGORIAN', body, 'END:VCALENDAR'].join('\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const todayKey = jstDateKey();

  const selectedTeacherEvents = role === 'teacher' && selectedDate
    ? teacherShiftEvents.filter(event => event.date === selectedDate)
    : [];

  return (
    <div className="w-full min-w-0 overflow-hidden">
      {/* ヘッダー */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2 px-1 py-2 sm:px-2">
        <h3 className="min-w-0 text-base font-bold text-fg sm:text-xl">
          {year}年 <span className="text-accent">{month + 1}月</span>
        </h3>
        <div className="flex shrink-0 gap-1.5 sm:gap-2">
          <IconButton label="前の月" variant="secondary" onClick={() => changeMonth(-1)}>
            <ChevronLeft size={20} aria-hidden/>
          </IconButton>
          <IconButton label="次の月" variant="secondary" onClick={() => changeMonth(1)}>
            <ChevronRight size={20} aria-hidden/>
          </IconButton>
        </div>
      </div>

      {loadError && (
        <ErrorState title="カレンダーを読み込めませんでした" onRetry={() => setReloadKey(key => key + 1)} className="mb-4" />
      )}

      {/* 曜日行 */}
      <div className="mb-2 grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] text-center">
        {weekDays.map((day, i) => (
          <div key={i} className={`min-w-0 pb-2 text-xs font-bold ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : 'text-fg-muted'}`}>
            {day}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="relative grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] gap-0.5 text-center sm:gap-1.5">
        {loading && (
          <div role="status" aria-label="読み込み中" className="absolute inset-0 z-20 flex items-center justify-center rounded-card bg-surface/60 backdrop-blur-[1px]">
            <Loader2 className="animate-spin text-accent" size={32} aria-hidden />
          </div>
        )}

        {calendarDays.map((dateObj, idx) => {
          if (dateObj.type !== 'current') {
            return <div key={idx} className="min-h-[58px] min-w-0 sm:min-h-[70px]"></div>;
          }

          const currentDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
          const currentDayOfWeek = new Date(year, month, dateObj.day).getDay();
          
          const isToday = currentDayStr === todayKey;

          // 判定
          const isMyClassDay = classDayIndexes.has(currentDayOfWeek);
          const hasShift = shifts.includes(currentDayStr);
          const dayTeacherEvents = role === 'teacher' ? teacherShiftEvents.filter(event => event.date === currentDayStr) : [];
          const hasHomework = homeworks.includes(currentDayStr); // 宿題あり判定
          const daySchedules = monthlySchedules.filter(item => scheduleCoversDate(item, currentDayStr));
          const hasImportedLesson = daySchedules.some(item => calendarScheduleKind(item) === 'lesson');
          const hasImportedClosed = daySchedules.some(item => calendarScheduleKind(item) === 'closed');

          let shiftStatus = 'none';
          if (isMyClassDay) {
            shiftStatus = hasShift ? 'class' : 'closed';
          }

          return (
            <button
              type="button"
              key={idx}
              onClick={() => role === 'teacher' && setSelectedDate(currentDayStr)}
              className={`flex min-h-[58px] min-w-0 flex-col items-center justify-start overflow-hidden rounded-input border py-1 text-center transition-all sm:min-h-[70px] sm:rounded-btn sm:py-1.5 ${
              isToday 
                ? 'bg-accent-soft border-accent/30 shadow-inner'
                : selectedDate === currentDayStr
                  ? 'bg-slate-900 border-slate-900 shadow-md'
                  : hasImportedClosed
                    ? 'bg-rose-50 border-rose-200'
                    : hasImportedLesson
                      ? 'bg-sky-50 border-sky-200'
                  : 'bg-surface border-transparent hover:border-line'
            } ${role === 'teacher' ? 'cursor-pointer hover:shadow-sm active:scale-[0.98]' : 'cursor-default'}`}>
              {/* 日付 */}
              <span className={`text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                isToday ? 'bg-accent text-accent-ink shadow-sm' : selectedDate === currentDayStr ? 'text-white' : 'text-fg'
              }`}>
                {dateObj.day}
              </span>

              <div className="flex w-full min-w-0 flex-col gap-1 px-0.5">
                {/* 授業マーカー */}
                {shiftStatus === 'class' && (
                  <div className="min-w-0 truncate rounded border border-accent/30 bg-accent-soft py-0.5 text-[11px] font-bold text-accent shadow-sm">
                    授業
                  </div>
                )}
                {shiftStatus === 'closed' && (
                  <div className="min-w-0 truncate rounded border border-line bg-slate-100 py-0.5 text-[11px] font-bold text-slate-400">
                    なし
                  </div>
                )}

                {role === 'teacher' && dayTeacherEvents.length > 0 && (
                  <div className={`${selectedDate === currentDayStr ? 'bg-white text-slate-900 border-white' : 'bg-violet-100 text-violet-700 border-violet-200'} min-w-0 truncate rounded border py-0.5 text-[11px] font-bold shadow-sm`}>
                    配置 {dayTeacherEvents.length}
                  </div>
                )}

                {/* 宿題マーカー (追加) */}
                {hasHomework && (
                  <div className="flex items-center justify-center gap-0.5 truncate rounded border border-amber-200 bg-amber-100 py-0.5 text-[11px] font-bold text-amber-700 shadow-sm">
                    <BookOpen size={9} className="shrink-0" aria-hidden/> 提出
                  </div>
                )}
                {daySchedules.slice(0, 2).map(item => {
                  const kind = calendarScheduleKind(item);
                  const style = kind === 'closed'
                    ? 'border-rose-300 bg-rose-100 text-rose-700'
                    : kind === 'lesson'
                      ? 'border-sky-300 bg-sky-100 text-sky-800'
                      : 'border-emerald-200 bg-emerald-100 text-emerald-700';
                  const Icon = kind === 'closed' ? CalendarX2 : kind === 'lesson' ? BookOpen : Megaphone;
                  return (
                    <div key={item.id} className={`${style} flex min-w-0 items-center justify-center gap-0.5 truncate rounded border py-0.5 text-[11px] font-bold shadow-sm`} title={calendarScheduleLabel(item)}>
                      <Icon size={9} className="shrink-0" aria-hidden/> {calendarScheduleLabel(item)}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {role === 'teacher' && (
        <div className="mt-4 rounded-card border border-line bg-canvas p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold text-fg">
                {selectedDate ? `${formatDate(selectedDate)} の講師配置` : '日付を選ぶと講師配置を確認できます'}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Googleカレンダーには予定ごとに追加できます。月まとめはICSで出力します。
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportEventsAsIcs(teacherShiftEvents, `teacher_shifts_${year}_${String(month + 1).padStart(2, '0')}.ics`)}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-btn border border-accent/20 bg-surface px-3 text-xs font-bold text-accent shadow-sm hover:bg-accent-soft disabled:opacity-40"
              disabled={teacherShiftEvents.length === 0}
            >
              <Download size={14} aria-hidden /> 月まとめ出力
            </button>
          </div>

          {selectedDate && selectedTeacherEvents.length === 0 && (
            <div className="rounded-btn border border-dashed border-line bg-surface py-5 text-center text-xs font-bold text-fg-muted">
              この日の講師配置はありません
            </div>
          )}

          {selectedTeacherEvents.length > 0 && (
            <div className="space-y-2">
              {selectedTeacherEvents.map(event => (
                <div key={event.id} className="rounded-btn border border-line bg-surface p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">{event.period}</span>
                        <span className="flex items-center gap-1 text-xs text-fg-muted"><Clock size={11} aria-hidden />{event.startTime.slice(0, 2)}:{event.startTime.slice(2, 4)} - {event.endTime.slice(0, 2)}:{event.endTime.slice(2, 4)}</span>
                      </div>
                      <p className="truncate text-sm font-bold text-fg">{event.title}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted"><MapPin size={12} aria-hidden />{event.location}</p>
                      {event.details && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">{event.details}</p>}
                    </div>
                    <a
                      href={getGoogleCalendarUrl(event)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-btn bg-accent px-3 text-xs font-bold text-accent-ink shadow-sm hover:bg-accent-hover"
                    >
                      <CalendarPlus size={13} aria-hidden /> 追加
                    </a>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => exportEventsAsIcs(selectedTeacherEvents, `teacher_shifts_${selectedDate}.ics`)}
                className="min-h-9 w-full rounded-btn border border-line bg-surface px-3 text-xs font-bold text-fg hover:bg-canvas"
              >
                この日の予定をICSで出力
              </button>
            </div>
          )}
        </div>
      )}
      
      <details className="mt-4 rounded-btn border border-info/20 bg-info-soft px-4 py-2 text-left">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs font-bold text-info"><HelpCircle size={15} aria-hidden />カレンダーの見方</summary>
        <p className="mt-1 pb-1 text-xs leading-6 text-fg">一括登録した年間予定は、授業実施日を青、休み・休講・休館日を赤で表示します。緑は模試などのその他予定です。「授業」は自分の登録講座、「配置」は講師配置を表します。</p>
      </details>

      {/* 凡例 */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-btn border border-line bg-canvas px-2 py-3">
        {classDay && (
          <>
            <div className="flex items-center gap-1">
              <div className="rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent">授業</div>
              <span className="text-xs text-fg-muted">授業あり</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="rounded border border-line bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-400">なし</div>
              <span className="text-xs text-fg-muted">休み</span>
            </div>
          </>
        )}
        {role === 'teacher' && (
          <div className="flex items-center gap-1">
            <div className="rounded border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">配置</div>
            <span className="text-xs text-fg-muted">講師配置</span>
          </div>
        )}
        {/* 宿題凡例 */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700"><BookOpen size={9} aria-hidden/> 提出</div>
          <span className="text-xs text-fg-muted">宿題期限</span>
        </div>
        <div className="flex items-center gap-1"><div className="flex items-center gap-0.5 rounded border border-sky-300 bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold text-sky-800"><BookOpen size={9} aria-hidden/> 実施</div><span className="text-xs text-fg-muted">授業実施日</span></div>
        <div className="flex items-center gap-1"><div className="flex items-center gap-0.5 rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700"><CalendarX2 size={9} aria-hidden/> 休み</div><span className="text-xs text-fg-muted">休み・休講</span></div>
        <div className="flex items-center gap-1"><div className="flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700"><Megaphone size={9} aria-hidden/> 予定</div><span className="text-xs text-fg-muted">その他予定</span></div>
      </div>
    </div>
  );
}
