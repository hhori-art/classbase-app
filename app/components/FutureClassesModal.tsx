'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { X, Calendar as CalendarIcon, MapPin, Loader2, ChevronLeft, ChevronRight, Plus, BookOpen, Download, User } from 'lucide-react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
};

type ClassEvent = {
  id: string;
  title: string;
  dateStr: string;
  timeSlot: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  unit: string;
  teacherName: string;
};

// --- ヘルパー関数 ---
const toHalfWidth = (str: string) => !str ? '' : str.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');

// ★重要: 名前マッチングロジック (部分一致対応)
const isNameMatch = (shiftName: string | undefined, profileName: string) => {
  if (!shiftName || !profileName) return false;
  const s = shiftName.replace(/[ 　]/g, '');
  const p = profileName.replace(/[ 　]/g, '');
  return s.includes(p);
};

const TIME_MAP: Record<string, { start: string, end: string }> = {
  '1限': { start: '192000', end: '202500' }, 
  '2限': { start: '203500', end: '214000' }, 
};

export default function FutureClassesModal({ isOpen, onClose, profile }: Props) {
  const [allEvents, setAllEvents] = useState<ClassEvent[]>([]);
  const [viewDate, setViewDate] = useState(new Date()); 
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null); 
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && profile) {
      // 初期表示時は今日の年月を表示
      const d = new Date();
      d.setHours(d.getHours() + 9); // JST
      setViewDate(d);
      setSelectedDateStr(d.toISOString().split('T')[0]); 
    }
  }, [isOpen, profile]);

  // 月が変わったらデータを再取得
  useEffect(() => {
    if (isOpen && profile) {
      fetchMonthClasses();
    }
  }, [viewDate, isOpen, profile]);

  const fetchMonthClasses = async () => {
    setLoading(true);
    try {
      const userId = profile.id || profile.uid;
      const userName = profile.student_name || profile.name || '';

      // 月初の取得 (YYYY-MM-01)
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth() + 1;
      const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      // 月末の取得
      const endOfMonth = `${year}-${String(month).padStart(2, '0')}-31`; // 簡易的に31日指定（Firestore文字列比較なら問題なし）

      // その月のデータを全件取得する
      const q = query(
        collection(db, 'shift_assignments'),
        where('target_date', '>=', startOfMonth),
        where('target_date', '<=', endOfMonth),
        orderBy('target_date', 'asc')
      );

      const snap = await getDocs(q);
      const shiftsMap = new Map<string, any>();

      snap.docs.forEach(doc => {
        const data = doc.data();
        // ID一致 または 名前部分一致でフィルタリング
        if (data.user_id === userId || isNameMatch(data.teacher_name, userName)) {
          shiftsMap.set(doc.id, { ...data, id: doc.id });
        }
      });

      const events: ClassEvent[] = Array.from(shiftsMap.values())
        .map(d => {
          const note = d.note || '';
          let timeSlot = '';
          if (note.includes('1限')) timeSlot = '1限';
          else if (note.includes('2限')) timeSlot = '2限';

          const times = TIME_MAP[timeSlot] || { start: '090000', end: '100000' };

          return {
            id: d.id,
            title: `【${d.target_grade}】${d.target_subject}`,
            dateStr: d.target_date,
            timeSlot,
            startTime: times.start,
            endTime: times.end,
            location: d.target_place || 'オンライン',
            description: `科目: ${d.target_subject} (${d.target_detail_subject})\n単元: ${d.unit || '未定'}\n詳細: ${note}\n担当: ${d.teacher_name}`,
            unit: d.unit,
            teacherName: d.teacher_name
          };
        });

      events.sort((a, b) => {
        if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        return a.timeSlot.localeCompare(b.timeSlot);
      });

      setAllEvents(events);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getGoogleCalendarUrl = (evt: ClassEvent) => {
    const dateCompact = evt.dateStr.replace(/-/g, '');
    const dates = `${dateCompact}T${evt.startTime}/${dateCompact}T${evt.endTime}`;
    const url = new URL('https://www.google.com/calendar/render');
    url.searchParams.append('action', 'TEMPLATE');
    url.searchParams.append('text', `${evt.title} (${evt.timeSlot})`);
    url.searchParams.append('dates', dates);
    url.searchParams.append('details', evt.description);
    url.searchParams.append('location', evt.location);
    return url.toString();
  };

  const handleExportMonth = () => {
    if (allEvents.length === 0) return alert('この月の予定はありません');

    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Class Schedule//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";
    allEvents.forEach(evt => {
      const start = evt.dateStr.replace(/-/g, '') + 'T' + evt.startTime;
      const end = evt.dateStr.replace(/-/g, '') + 'T' + evt.endTime;
      icsContent += "BEGIN:VEVENT\n";
      icsContent += `SUMMARY:${evt.title}\n`;
      icsContent += `DTSTART:${start}\n`;
      icsContent += `DTEND:${end}\n`;
      icsContent += `LOCATION:${evt.location}\n`;
      icsContent += `DESCRIPTION:${evt.description.replace(/\n/g, '\\n')}\n`;
      icsContent += "END:VEVENT\n";
    });
    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `schedule_${viewDate.getFullYear()}_${viewDate.getMonth()+1}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const changeMonth = (diff: number) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + diff);
    setViewDate(newDate);
  };

  const generateCalendarDays = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    const startPadding = firstDay.getDay(); 
    
    for (let i = 0; i < startPadding; i++) days.push({ day: '', dateStr: '', isCurrentMonth: false });
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, dateStr, isCurrentMonth: true });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  const selectedDayEvents = allEvents.filter(e => e.dateStr === selectedDateStr);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
        
        {/* 左側: カレンダーエリア */}
        <div className="flex-1 bg-slate-50 p-4 flex flex-col border-r border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-700 flex items-center gap-2">
              <CalendarIcon className="text-indigo-600" /> 授業スケジュール
            </h2>
            <div className="flex gap-2">
              <button 
                onClick={handleExportMonth}
                className="p-2 bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-50 rounded-lg transition-colors shadow-sm text-xs font-bold flex items-center gap-1"
                title="表示月をまとめて書き出し"
              >
                <Download size={16}/> <span className="hidden sm:inline">一括出力</span>
              </button>
              <div className="flex items-center bg-white rounded-lg shadow-sm border border-slate-200 p-1">
                <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-100 rounded-md transition"><ChevronLeft size={20} className="text-slate-500"/></button>
                <span className="px-3 font-bold text-slate-700 text-sm">{viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月</span>
                <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-100 rounded-md transition"><ChevronRight size={20} className="text-slate-500"/></button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-7 mb-2 text-center">
            {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
              <div key={i} className={`text-xs font-bold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 md:gap-2 flex-1 auto-rows-fr">
            {calendarDays.map((d, i) => {
              if (!d.isCurrentMonth) return <div key={i} className="bg-transparent" />;
              
              const dayEvents = allEvents.filter(e => e.dateStr === d.dateStr);
              const isSelected = d.dateStr === selectedDateStr;
              
              // JSTでの今日判定
              const today = new Date();
              today.setHours(today.getHours() + 9);
              const isToday = d.dateStr === today.toISOString().split('T')[0];

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDateStr(d.dateStr)}
                  className={`relative rounded-xl p-1 flex flex-col items-center justify-start transition-all border min-h-[50px]
                    ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105 z-10' : 
                      isToday ? 'bg-white border-indigo-200 shadow-inner' : 'bg-white border-transparent hover:border-indigo-100 hover:bg-white'}
                  `}
                >
                  <span className={`text-sm font-bold ${isSelected ? 'text-white' : isToday ? 'text-indigo-600' : 'text-slate-600'}`}>{d.day}</span>
                  <div className="flex flex-col gap-0.5 mt-1 w-full px-1">
                    {dayEvents.map((ev, idx) => (
                      <div key={idx} className={`h-1.5 rounded-full w-full ${isSelected ? 'bg-white/80' : ev.timeSlot === '1限' ? 'bg-blue-400' : 'bg-orange-400'}`} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右側: 詳細エリア */}
        <div className="w-full md:w-80 bg-white flex flex-col h-1/2 md:h-full border-t md:border-t-0 md:border-l border-slate-200">
          <div className="p-4 border-b border-slate-100 flex justify-between items-start shrink-0">
            <div>
              <div className="text-xs font-bold text-slate-400">SELECTED DATE</div>
              <div className="text-2xl font-black text-slate-800">{selectedDateStr ? selectedDateStr.replace(/-/g, '/') : '---'}</div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X size={20} className="text-slate-400"/></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/50">
            {loading ? (
              <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-indigo-300"/></div>
            ) : !selectedDateStr ? (
              <div className="py-10 text-center text-slate-400 text-sm">日付を選択してください</div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm font-bold bg-white rounded-xl border border-dashed border-slate-200">
                予定はありません
              </div>
            ) : (
              selectedDayEvents.map(evt => (
                <div key={evt.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full ${evt.timeSlot === '1限' ? 'bg-blue-500' : 'bg-orange-500'}`} />
                  
                  <div className="flex justify-between items-start mb-2 pl-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${evt.timeSlot === '1限' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                      {evt.timeSlot || '時間未定'}
                    </span>
                    
                    <a 
                      href={getGoogleCalendarUrl(evt)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[10px] font-bold bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 px-2 py-1 rounded-full transition-colors border border-slate-200"
                      title="Googleカレンダーに追加"
                    >
                      <Plus size={10} /> 追加
                    </a>
                  </div>

                  <div className="pl-2">
                    <h3 className="font-bold text-slate-800 text-sm mb-1">{evt.title}</h3>
                    <div className="text-xs text-slate-500 space-y-1">
                      <div className="flex items-center gap-1.5"><MapPin size={12} className="opacity-70"/> {evt.location}</div>
                      <div className="flex items-center gap-1.5"><BookOpen size={12} className="opacity-70"/> {evt.unit || '単元設定なし'}</div>
                      <div className="flex items-center gap-1.5 text-indigo-500"><User size={12} className="opacity-70"/> {evt.teacherName}</div>
                    </div>
                    {evt.description && (
                      <div className="mt-2 pt-2 border-t border-slate-50 text-[10px] text-slate-400 whitespace-pre-wrap">
                        {evt.description}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}