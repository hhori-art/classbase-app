'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Loader2, BookOpen, Megaphone, CalendarPlus, Download, Clock, MapPin } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { parseClassDays } from '@/lib/class-days';

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

const CALENDAR_CACHE_TTL_MS = 3 * 60 * 1000;
const calendarMonthCache = new Map<string, { expiresAt: number; data: CalendarMonthData }>();
const calendarMonthRequests = new Map<string, Promise<CalendarMonthData>>();

const loadCalendarMonth = async (startStr: string, endStr: string) => {
  const cacheKey = `${startStr}_${endStr}`;
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
    const homeworkQuery = query(
      collection(db, 'homework_assignments'),
      where('deadline', '>=', startStr),
      where('deadline', '<=', endStr)
    );
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

    const [shiftSnap, homeworkSnap, rangeScheduleSnap, legacyScheduleSnap] = await Promise.all([
      getDocs(shiftQuery),
      getDocs(homeworkQuery),
      getDocs(rangeScheduleQuery).catch(() => ({ docs: [] as any[] })),
      getDocs(legacyScheduleQuery).catch(() => ({ docs: [] as any[] })),
    ]);
    const scheduleMap = new Map<string, any>();
    [...rangeScheduleSnap.docs, ...legacyScheduleSnap.docs].forEach((snapshot: any) => {
      const item = { id: snapshot.id, ...snapshot.data() };
      if (scheduleStart(item) <= endStr && scheduleEnd(item) >= startStr) scheduleMap.set(item.id, item);
    });
    const data = {
      shifts: shiftSnap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      homeworks: homeworkSnap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      schedules: Array.from(scheduleMap.values()),
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

export default function CalendarWidget({ classDay, grade, role = 'student', profile, studentShiftIds }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState<string[]>([]);
  const [teacherShiftEvents, setTeacherShiftEvents] = useState<TeacherShiftEvent[]>([]);
  const [homeworks, setHomeworks] = useState<string[]>([]); // 宿題の期限日リスト
  const [monthlySchedules, setMonthlySchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const profileId = String(profile?.id || profile?.uid || '');
  const profileName = String(profile?.student_name || profile?.teacher_name || profile?.name || '');
  const classDayIndexes = new Set(parseClassDays(classDay).map(day => DAY_MAP[day]));
  const registeredShiftIdSet = new Set((studentShiftIds || []).map(String));

  // 表示月が変わったらデータを取得
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;
      const cached = calendarMonthCache.get(`${startStr}_${endStr}`);
      setLoading(!(cached && cached.expiresAt > Date.now()));

      try {
        const monthData = await loadCalendarMonth(startStr, endStr);
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
          .filter(data => !grade || data.target_grade === grade) // 学年で絞り込み
          .map(data => data.deadline as string);
        setHomeworks([...new Set(hwDates)]);

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
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [currentDate, grade, role, profileId, profileName, studentShiftIds]);

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
      alert('書き出せる講師配置がありません。');
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

  const selectedTeacherEvents = role === 'teacher' && selectedDate
    ? teacherShiftEvents.filter(event => event.date === selectedDate)
    : [];

  return (
    <div className="w-full min-w-0 overflow-hidden">
      {/* ヘッダー */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2 px-1 py-2 sm:px-2">
        <h3 className="min-w-0 text-base font-extrabold text-gray-800 sm:text-xl">
          {year}年 <span className="text-indigo-600">{month + 1}月</span>
        </h3>
        <div className="flex shrink-0 gap-1.5 sm:gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 bg-gray-100 hover:bg-white rounded-xl text-gray-500 hover:text-indigo-600 transition-all shadow-sm border border-transparent hover:border-gray-200">
            <ChevronLeft size={20}/>
          </button>
          <button onClick={() => changeMonth(1)} className="p-2 bg-gray-100 hover:bg-white rounded-xl text-gray-500 hover:text-indigo-600 transition-all shadow-sm border border-transparent hover:border-gray-200">
            <ChevronRight size={20}/>
          </button>
        </div>
      </div>

      {/* 曜日行 */}
      <div className="mb-2 grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] text-center">
        {weekDays.map((day, i) => (
          <div key={i} className={`min-w-0 pb-2 text-xs font-black ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
            {day}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="relative grid w-full min-w-0 grid-cols-[repeat(7,minmax(0,1fr))] gap-0.5 text-center sm:gap-1.5">
        {loading && (
          <div className="absolute inset-0 bg-white/60 z-20 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
          </div>
        )}

        {calendarDays.map((dateObj, idx) => {
          if (dateObj.type !== 'current') {
            return <div key={idx} className="min-h-[58px] min-w-0 sm:min-h-[70px]"></div>;
          }

          const currentDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
          const currentDayOfWeek = new Date(year, month, dateObj.day).getDay();
          
          const isToday = 
            new Date().getDate() === dateObj.day && 
            new Date().getMonth() === month && 
            new Date().getFullYear() === year;

          // 判定
          const isMyClassDay = classDayIndexes.has(currentDayOfWeek);
          const hasShift = shifts.includes(currentDayStr);
          const dayTeacherEvents = role === 'teacher' ? teacherShiftEvents.filter(event => event.date === currentDayStr) : [];
          const hasHomework = homeworks.includes(currentDayStr); // 宿題あり判定
          const daySchedules = monthlySchedules.filter(item => scheduleCoversDate(item, currentDayStr));

          let shiftStatus = 'none';
          if (isMyClassDay) {
            shiftStatus = hasShift ? 'class' : 'closed';
          }

          return (
            <button
              type="button"
              key={idx}
              onClick={() => role === 'teacher' && setSelectedDate(currentDayStr)}
              className={`flex min-h-[58px] min-w-0 flex-col items-center justify-start overflow-hidden rounded-lg border py-1 text-center transition-all sm:min-h-[70px] sm:rounded-xl sm:py-1.5 ${
              isToday 
                ? 'bg-indigo-50 border-indigo-200 shadow-inner' 
                : selectedDate === currentDayStr
                  ? 'bg-slate-900 border-slate-900 shadow-md'
                  : 'bg-white border-transparent hover:border-gray-100'
            } ${role === 'teacher' ? 'cursor-pointer hover:shadow-sm active:scale-[0.98]' : 'cursor-default'}`}>
              {/* 日付 */}
              <span className={`text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                isToday ? 'bg-indigo-600 text-white shadow-sm' : selectedDate === currentDayStr ? 'text-white' : 'text-gray-700'
              }`}>
                {dateObj.day}
              </span>

              <div className="flex w-full min-w-0 flex-col gap-1 px-0.5">
                {/* 授業マーカー */}
                {shiftStatus === 'class' && (
                  <div className="min-w-0 truncate rounded border border-indigo-200 bg-indigo-100 py-0.5 text-[9px] font-black text-indigo-700 shadow-sm">
                    授業
                  </div>
                )}
                {shiftStatus === 'closed' && (
                  <div className="min-w-0 truncate rounded border border-gray-200 bg-gray-100 py-0.5 text-[9px] font-bold text-gray-400">
                    なし
                  </div>
                )}

                {role === 'teacher' && dayTeacherEvents.length > 0 && (
                  <div className={`${selectedDate === currentDayStr ? 'bg-white text-slate-900 border-white' : 'bg-violet-100 text-violet-700 border-violet-200'} min-w-0 truncate rounded border py-0.5 text-[9px] font-black shadow-sm`}>
                    配置 {dayTeacherEvents.length}
                  </div>
                )}

                {/* 宿題マーカー (追加) */}
                {hasHomework && (
                  <div className="bg-orange-100 text-orange-700 text-[9px] font-black py-0.5 rounded shadow-sm border border-orange-200 flex items-center justify-center gap-0.5 truncate">
                    <BookOpen size={8} className="shrink-0"/> 提出
                  </div>
                )}
                {daySchedules.slice(0, 2).map(item => (
                  <div key={item.id} className="bg-emerald-100 text-emerald-700 text-[9px] font-black py-0.5 rounded shadow-sm border border-emerald-200 flex items-center justify-center gap-0.5 truncate" title={item.title}>
                    <Megaphone size={8} className="shrink-0"/> {item.title}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {role === 'teacher' && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black text-slate-700">
                {selectedDate ? `${selectedDate.replace(/-/g, '/')} の講師配置` : '日付を選ぶと講師配置を確認できます'}
              </p>
              <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                Googleカレンダーには予定ごとに追加できます。月まとめはICSで出力します。
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportEventsAsIcs(teacherShiftEvents, `teacher_shifts_${year}_${String(month + 1).padStart(2, '0')}.ics`)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm border border-indigo-100 hover:bg-indigo-50 disabled:opacity-40"
              disabled={teacherShiftEvents.length === 0}
            >
              <Download size={14} /> 月まとめ出力
            </button>
          </div>

          {selectedDate && selectedTeacherEvents.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white py-5 text-center text-xs font-bold text-slate-400">
              この日の講師配置はありません
            </div>
          )}

          {selectedTeacherEvents.length > 0 && (
            <div className="space-y-2">
              {selectedTeacherEvents.map(event => (
                <div key={event.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">{event.period}</span>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><Clock size={11} />{event.startTime.slice(0, 2)}:{event.startTime.slice(2, 4)} - {event.endTime.slice(0, 2)}:{event.endTime.slice(2, 4)}</span>
                      </div>
                      <p className="truncate text-sm font-black text-slate-800">{event.title}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-500"><MapPin size={12} />{event.location}</p>
                      {event.details && <p className="mt-2 whitespace-pre-wrap text-[11px] font-bold leading-relaxed text-slate-400">{event.details}</p>}
                    </div>
                    <a
                      href={getGoogleCalendarUrl(event)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-black text-white shadow-sm hover:bg-indigo-700"
                    >
                      <CalendarPlus size={13} /> 追加
                    </a>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => exportEventsAsIcs(selectedTeacherEvents, `teacher_shifts_${selectedDate}.ics`)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-100"
              >
                この日の予定をICSで出力
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* 凡例 */}
      <div className="flex items-center justify-center gap-3 mt-6 px-2 bg-gray-50 py-3 rounded-xl border border-gray-100 flex-wrap">
        {classDay && (
          <>
            <div className="flex items-center gap-1">
              <div className="bg-indigo-100 text-indigo-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-indigo-200">授業</div>
              <span className="text-[10px] text-gray-500 font-bold">授業あり</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="bg-gray-100 text-gray-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-gray-200">なし</div>
              <span className="text-[10px] text-gray-500 font-bold">休み</span>
            </div>
          </>
        )}
        {role === 'teacher' && (
          <div className="flex items-center gap-1">
            <div className="bg-violet-100 text-violet-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-violet-200">配置</div>
            <span className="text-[10px] text-gray-500 font-bold">講師配置</span>
          </div>
        )}
        {/* 宿題凡例 */}
        <div className="flex items-center gap-1">
          <div className="bg-orange-100 text-orange-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-orange-200 flex items-center gap-0.5"><BookOpen size={8}/> 提出</div>
          <span className="text-[10px] text-gray-500 font-bold">宿題期限</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="bg-emerald-100 text-emerald-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5"><Megaphone size={8}/> 予定</div>
          <span className="text-[10px] text-gray-500 font-bold">月間予定</span>
        </div>
      </div>
    </div>
  );
}
