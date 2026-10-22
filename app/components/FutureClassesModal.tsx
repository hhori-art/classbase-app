'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { MapPin, ChevronLeft, ChevronRight, Plus, BookOpen, Download, User } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';

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

const isNameMatch = (shiftName: string | undefined, profileName: string) => {
  if (!shiftName || !profileName) return false;
  const s = shiftName.replace(/[ 　]/g, '');
  const p = profileName.replace(/[ 　]/g, '');
  return s.includes(p);
};

// ★追加: JSTの今日の日付を確実に 'YYYY-MM-DD' 形式で取得する関数
const getJSTDateString = () => {
  const now = new Date();
  // 端末のタイムゾーンオフセットを相殺し、強制的にJST(+9時間)へ変換
  const jstTime = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000);
  const jstDate = new Date(jstTime);
  const y = jstDate.getFullYear();
  const m = String(jstDate.getMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (isOpen && profile) {
      // 初期表示時は今日の年月を表示（+9時間の重複バグを解消）
      const todayStr = getJSTDateString();
      const [y, m, d] = todayStr.split('-');
      setViewDate(new Date(Number(y), Number(m) - 1, Number(d)));
      setSelectedDateStr(todayStr); 
    }
  }, [isOpen, profile]);

  useEffect(() => {
    if (isOpen && profile) {
      fetchMonthClasses();
    }
  }, [viewDate, isOpen, profile]);

  const fetchMonthClasses = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const userId = profile.id || profile.uid;
      const userName = profile.student_name || profile.name || '';

      const year = viewDate.getFullYear();
      const month = viewDate.getMonth() + 1;
      const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      const endOfMonth = `${year}-${String(month).padStart(2, '0')}-31`; 

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

          // ★重要: 時刻付きやスラッシュ区切りのデータが混入していても確実に 'YYYY-MM-DD' に正規化する
          const rawDate = d.target_date || '';
          const normalizedDate = rawDate.replace(/\//g, '-').split('T')[0].split(' ')[0].trim();

          return {
            id: d.id,
            title: `【${d.target_grade}】${d.target_subject}`,
            dateStr: normalizedDate,
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
      setLoadError(true);
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
    // 省略せずに記述
    if (allEvents.length === 0) { toast.info('この月の予定はありません'); return; }

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
    newDate.setDate(1); // ★修正: 月またぎのバグ（31日の月に遷移して月が飛ぶ現象）を防止
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
  const todayJstStr = getJSTDateString(); // レンダリング中の今日判定用

  return (
    <Modal open={isOpen} onClose={onClose} title="授業スケジュール" size="lg">
      <div className="flex flex-col gap-4 md:flex-row">
        {/* 左側: カレンダーエリア */}
        <div className="flex flex-1 flex-col">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center rounded-btn border border-line bg-surface">
              <IconButton label="前の月" size="sm" onClick={() => changeMonth(-1)}><ChevronLeft size={20} aria-hidden /></IconButton>
              <span className="px-2 text-sm font-bold text-fg">{viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月</span>
              <IconButton label="次の月" size="sm" onClick={() => changeMonth(1)}><ChevronRight size={20} aria-hidden /></IconButton>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportMonth}
              icon={<Download size={16} aria-hidden />}
              title="表示月をまとめて書き出し"
            >
              一括出力
            </Button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center">
            {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
              <div key={i} className={`text-xs font-bold ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : 'text-fg-muted'}`}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((d, i) => {
              if (!d.isCurrentMonth) return <div key={i} className="bg-transparent" />;
              
              const dayEvents = allEvents.filter(e => e.dateStr === d.dateStr);
              const isSelected = d.dateStr === selectedDateStr;
              const isToday = d.dateStr === todayJstStr;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedDateStr(d.dateStr)}
                  aria-pressed={isSelected}
                  className={`relative flex min-h-[52px] flex-col items-center justify-start rounded-input border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    ${isSelected ? 'border-accent bg-accent text-accent-ink shadow-sm' : 
                      isToday ? 'border-accent/40 bg-accent-soft' : 'border-transparent bg-canvas hover:border-accent/30'}
                  `}
                >
                  <span className={`text-sm font-bold ${isSelected ? 'text-accent-ink' : isToday ? 'text-accent' : 'text-fg'}`}>{d.day}</span>
                  <div className="mt-1 flex w-full flex-col gap-0.5 px-1">
                    {dayEvents.map((ev, idx) => (
                      <div key={idx} className={`h-1.5 w-full rounded-full ${isSelected ? 'bg-white/80' : ev.timeSlot === '1限' ? 'bg-sky-400' : 'bg-amber-400'}`} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右側: 詳細エリア */}
        <div className="flex w-full flex-col border-t border-line pt-4 md:w-64 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <div className="mb-3 shrink-0">
            <div className="text-xs font-bold text-fg-muted">選択した日</div>
            <div className="text-xl font-black text-fg">{selectedDateStr ? formatDate(selectedDateStr, { withWeekday: true }) : '---'}</div>
          </div>

          <div className="space-y-3">
            {loading ? (
              <ListSkeleton rows={2} />
            ) : loadError ? (
              <ErrorState title="予定を読み込めませんでした" onRetry={fetchMonthClasses} />
            ) : !selectedDateStr ? (
              <EmptyState title="日付を選択してください" />
            ) : selectedDayEvents.length === 0 ? (
              <EmptyState title="予定はありません" />
            ) : (
              selectedDayEvents.map(evt => (
                <div key={evt.id} className="relative overflow-hidden rounded-card border border-line bg-surface p-4 shadow-sm">
                  <div className={`absolute left-0 top-0 h-full w-1 ${evt.timeSlot === '1限' ? 'bg-sky-500' : 'bg-amber-500'}`} />
                  
                  <div className="mb-2 flex items-start justify-between pl-2">
                    <span className={`rounded-input px-2 py-0.5 text-xs font-bold ${evt.timeSlot === '1限' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                      {evt.timeSlot || '時間未定'}
                    </span>
                    
                    <a 
                      href={getGoogleCalendarUrl(evt)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-9 items-center gap-1 rounded-btn border border-line bg-canvas px-3 text-xs font-bold text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
                      title="Googleカレンダーに追加"
                    >
                      <Plus size={14} aria-hidden /> 追加
                    </a>
                  </div>

                  <div className="pl-2">
                    <h3 className="mb-1 text-sm font-bold text-fg">{evt.title}</h3>
                    <div className="space-y-1 text-xs text-fg-muted">
                      <div className="flex items-center gap-1.5"><MapPin size={12} className="opacity-70" aria-hidden /> {evt.location}</div>
                      <div className="flex items-center gap-1.5"><BookOpen size={12} className="opacity-70" aria-hidden /> {evt.unit || '単元設定なし'}</div>
                      <div className="flex items-center gap-1.5 text-accent"><User size={12} className="opacity-70" aria-hidden /> {evt.teacherName}</div>
                    </div>
                    {evt.description && (
                      <div className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs text-fg-muted">
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
    </Modal>
  );
}
