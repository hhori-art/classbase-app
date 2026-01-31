'use client';

import { useState, useMemo, useEffect } from 'react';
import { 
  Calendar, MonitorPlay, MapPin, User, Loader2, Star,
  ChevronLeft, ChevronRight, LayoutList, Layout, Home, Video, Maximize2, Minimize2
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import NewsWidget from '@/app/components/NewsWidget';

// --- 型定義 (変更なし) ---
type ShiftAssignment = {
  id: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_meeting_id?: string | null; 
  unit: string | null;
  note: string;
  parent_id?: string;
};

type ClassGroup = {
  id: string;
  main: ShiftAssignment | null;
  subs: ShiftAssignment[];
  subject: string | null;
  grade: string | null;
  unit: string | null;
  place: string | null;
  url: string | null;
};

// --- サブコンポーネント (ClockIcon, EmptyState, ClassCard, ShiftViewer) ---
// ※変更ありませんが、コード全体を示すため再掲します

function ClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

const EmptyState = ({ text, small }: { text: string, small?: boolean }) => (
  <div className={`border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center text-gray-300 font-bold text-xs ${small ? 'h-[40px]' : 'w-[100px] h-[100px]'}`}>
    {text}
  </div>
);

const ClassCard = ({ info, color, currentTeacherName }: { info: ClassGroup, color: 'emerald' | 'orange', currentTeacherName: string }) => {
  const isEmerald = color === 'emerald';
  const isMyMain = info.main?.teacher_name === currentTeacherName;

  let bgHeader = isEmerald ? 'bg-emerald-50' : 'bg-orange-50';
  let textHeader = isEmerald ? 'text-emerald-800' : 'text-orange-800';
  let border = isEmerald ? 'border-emerald-100' : 'border-orange-100';
  const badge = isEmerald ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700';
  const btn = isEmerald ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600' : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600';

  if (isMyMain) {
    border = isEmerald ? 'border-emerald-500 ring-4 ring-emerald-50' : 'border-orange-500 ring-4 ring-orange-50';
    bgHeader = isEmerald ? 'bg-emerald-100' : 'bg-orange-100';
  }

  return (
    <div className={`w-[200px] bg-white border-2 ${border} rounded-2xl shadow-sm flex flex-col overflow-hidden shrink-0 transition-all ${isMyMain ? 'shadow-lg transform -translate-y-1' : ''}`}>
      <div className={`${bgHeader} p-3 border-b ${isEmerald ? 'border-emerald-100' : 'border-orange-100'}`}>
        <div className="flex justify-between items-start mb-1.5">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${badge}`}>{info.grade || '?'} / {info.place || '-'}</span>
          {isMyMain && <span className="text-[9px] font-bold bg-gray-800 text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse"><Star size={8} fill="white"/> あなた</span>}
        </div>
        <div className={`text-xs font-bold ${textHeader} line-clamp-1`}>{info.unit || '-'}</div>
      </div>
      
      <div className="p-3 flex-1 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm ${isEmerald ? 'bg-emerald-400' : 'bg-orange-400'}`}>T</div>
          <div className={`text-xs font-bold ${isMyMain ? 'text-gray-900 text-sm' : 'text-gray-600'}`}>{info.main?.teacher_name || '未定'}</div>
        </div>

        {info.subs.length > 0 && (
          <div className="bg-gray-50 p-2 rounded-xl border border-gray-100 space-y-1">
            <span className="text-[8px] text-gray-400 font-bold block uppercase tracking-wider mb-1">Support</span>
            {info.subs.map((s) => {
              const isMySub = s.teacher_name === currentTeacherName;
              return (
                <div key={s.id} className={`text-[10px] flex items-center gap-1.5 p-1 rounded ${isMySub ? 'font-bold text-indigo-700 bg-indigo-50 border border-indigo-100' : 'text-gray-600'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isMySub ? 'bg-indigo-500' : 'bg-gray-300'}`}></div> 
                  {s.teacher_name}
                  {isMySub && <span className="text-[8px] text-indigo-400 ml-auto font-bold">YOU</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-auto pt-1">
          {info.url ? (
            <a href={info.url} target="_blank" rel="noreferrer" className={`w-full ${btn} text-white text-[10px] font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-transform active:scale-95 shadow-md`}>
              <Video size={14}/> 入室する
            </a>
          ) : (
            <div className="w-full bg-gray-100 text-gray-400 text-[10px] font-bold py-2.5 rounded-xl flex items-center justify-center gap-1 cursor-not-allowed border border-gray-200">
              <Video size={14}/> URL未設定
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ShiftViewer = ({ date, teacherName }: { date: string, teacherName: string }) => {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [urlMaster, setUrlMaster] = useState<{[key: string]: string}>({});
  const [loading, setLoading] = useState(true);
  const [dayOfWeek, setDayOfWeek] = useState('');

  useEffect(() => {
    const fetchShiftData = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'shift_assignments'), where('target_date', '==', date));
        const snap = await getDocs(q);
        setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)));

        const uSnap = await getDocs(collection(db, 'subject_urls'));
        const urls: {[key: string]: string} = {};
        uSnap.forEach(d => { urls[d.id] = d.data().url; });
        setUrlMaster(urls);

        const d = new Date(date);
        setDayOfWeek(['日','月','火','水','木','金','土'][d.getDay()]);
      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchShiftData();
  }, [date]);

  const getAllClassesForSubject = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => a.note.includes(`【${time}】`) && a.target_subject === subject);
    if (slotAssignments.length === 0) return [];

    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');

    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub => 
        sub.parent_id === main.id || 
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );
      
      let joinUrl = null;
      if (main.target_meeting_id) {
        joinUrl = `https://zoom.us/j/${main.target_meeting_id.replace(/\s/g, '')}`;
      } else if (main.target_detail_subject && dayOfWeek) {
        joinUrl = urlMaster[`${main.target_detail_subject}_${dayOfWeek}`];
      }

      return { id: main.id, main, subs: relatedSubs, subject: main.target_subject, grade: main.target_grade, unit: main.unit, place: main.target_detail_subject, url: joinUrl };
    });

    const orphans = subs.filter(sub => 
      !mains.some(m => sub.parent_id === m.id || (!sub.parent_id && m.target_grade === sub.target_grade && m.target_detail_subject === sub.target_detail_subject))
    );
    
    if (orphans.length > 0) {
      classes.push({ id: 'orphans', main: null, subs: orphans, subject, grade: '未割当', unit: '-', place: '-', url: null });
    }
    return classes.sort((a, b) => (a.grade || '').localeCompare(b.grade || ''));
  };

  const getGeneralSupport = (time: string) => assignments.filter(a => a.role_type === 'general' && a.note.includes(`【${time}】`));

  if (loading) return <div className="p-8 flex justify-center border-t border-gray-100"><Loader2 className="animate-spin text-gray-300"/></div>;

  return (
    <div className="space-y-4">
      {['1限', '2限'].map(period => (
        <div key={period} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className={`px-4 py-2 text-white font-bold text-xs flex items-center justify-between ${period === '1限' ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-indigo-500 to-indigo-600'}`}>
            <span className="flex items-center gap-2"><ClockIcon/> {period}</span>
            <span className="text-[10px] opacity-90 font-mono">{period === '1限' ? '19:20 - 20:25' : '20:35 - 21:40'}</span>
          </div>
          <div className="overflow-x-auto p-4 bg-[#F8FAFC]">
            <div className="flex min-w-max gap-4">
              <div className="flex flex-col gap-2 min-w-[280px]">
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full w-fit flex items-center gap-1"><MonitorPlay size={10}/> 理科グループ</span>
                <div className="flex gap-3">
                  {getAllClassesForSubject(period, '理科').map(info => (
                    <ClassCard key={info.id} info={info} color="emerald" currentTeacherName={teacherName} />
                  ))}
                  {getAllClassesForSubject(period, '理科').length === 0 && <EmptyState text="なし" small/>}
                </div>
              </div>
              <div className="flex flex-col gap-2 min-w-[280px]">
                <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full w-fit flex items-center gap-1"><MapPin size={10}/> 社会グループ</span>
                <div className="flex gap-3">
                  {getAllClassesForSubject(period, '社会').map(info => (
                    <ClassCard key={info.id} info={info} color="orange" currentTeacherName={teacherName} />
                  ))}
                  {getAllClassesForSubject(period, '社会').length === 0 && <EmptyState text="なし" small/>}
                </div>
              </div>
              <div className="flex flex-col gap-2 min-w-[160px]">
                <span className="text-[10px] font-bold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full w-fit">全体サポート</span>
                <div className="flex flex-col gap-2">
                  {getGeneralSupport(period).map(a => {
                    const isMe = a.teacher_name === teacherName;
                    return (
                      <div key={a.id} className={`p-2 rounded-lg border shadow-sm text-[10px] font-bold flex items-center gap-2 transition-all ${isMe ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' : 'bg-white text-gray-700 border-gray-200'}`}>
                        <User size={12} className={isMe ? 'text-white' : 'text-gray-400'}/> 
                        {a.teacher_name}
                        {isMe && <span className="ml-auto text-[8px] bg-white text-indigo-600 px-1 rounded font-black">YOU</span>}
                      </div>
                    );
                  })}
                  {getGeneralSupport(period).length === 0 && <EmptyState text="なし" small/>}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// --- メインコンポーネント ---
type Props = {
  profile: any;
  mainShifts?: any[]; 
  pendingCount?: number; 
};

export default function TeacherDashboard({ profile }: Props) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  
  // ★追加: 拡大モードの状態
  const [isExpanded, setIsExpanded] = useState(false);

  const displayDates = useMemo(() => {
    if (viewMode === 'day') return [selectedDate];
    const dates = [];
    const base = new Date(selectedDate);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, [selectedDate, viewMode]);

  const handleDateChange = (direction: number) => {
    const d = new Date(selectedDate);
    const increment = viewMode === 'week' ? 7 : 1;
    d.setDate(d.getDate() + (direction * increment));
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // ★追加: 拡大・縮小に応じたクラス
  const containerClasses = isExpanded 
    ? 'fixed inset-0 z-50 bg-[#F0F4F8] p-4 lg:p-8 overflow-hidden flex flex-col' // フルスクリーン
    : 'p-4 sm:p-6 lg:p-8 space-y-6 animate-in fade-in duration-300'; // 通常

  const calendarContainerClasses = isExpanded
    ? 'bg-white rounded-3xl shadow-2xl border border-indigo-100 flex flex-col h-full overflow-hidden'
    : 'bg-white rounded-[32px] shadow-lg border border-indigo-100 overflow-hidden flex flex-col';

  return (
    <div className={containerClasses}>
      
      {/* 通常モード時のみヘッダーとお知らせを表示 */}
      {!isExpanded && (
        <>
          <h2 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2 mb-4">
            <Home className="text-indigo-600" size={28}/> 先生のホーム
          </h2>
          <NewsWidget role="teacher" />
        </>
      )}

      {/* カレンダーコンテナ */}
      <div className={calendarContainerClasses}>
        <div className="p-6 bg-white border-b border-gray-100 flex flex-wrap justify-between items-center sticky top-0 z-10 backdrop-blur-sm bg-white/90 gap-4">
          <div className="flex items-center gap-3">
            {/* 拡大時は戻るボタンを表示 */}
            {isExpanded && (
              <button onClick={() => setIsExpanded(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors mr-2">
                <ChevronLeft size={24} className="text-gray-600"/>
              </button>
            )}
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="text-indigo-500" size={20}/> 講師配置
            </h3>
          </div>
          
          <div className="flex items-center gap-3">
            {/* ★追加: 拡大/縮小ボタン */}
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors"
              title={isExpanded ? "縮小" : "拡大"}
            >
              {isExpanded ? <Minimize2 size={20}/> : <Maximize2 size={20}/>}
            </button>

            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
              <button onClick={() => setViewMode('day')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${viewMode === 'day' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}><Layout size={14}/> 1日</button>
              <button onClick={() => setViewMode('week')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${viewMode === 'week' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}><LayoutList size={14}/> 週間</button>
            </div>
            
            <div className="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-100 shadow-inner">
              <button onClick={() => handleDateChange(-1)} className="p-1.5 hover:bg-white rounded-lg transition text-gray-500 hover:text-indigo-600"><ChevronLeft size={18}/></button>
              <input type="date" className="bg-transparent text-xs font-bold text-indigo-700 px-2 py-1 outline-none text-center w-28 cursor-pointer" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}/>
              <button onClick={() => handleDateChange(1)} className="p-1.5 hover:bg-white rounded-lg transition text-gray-500 hover:text-indigo-600"><ChevronRight size={18}/></button>
            </div>
          </div>
        </div>
        
        {/* スクロール領域 (拡大時は高さを最大化) */}
        <div className={`p-4 sm:p-6 bg-white flex-1 space-y-8 overflow-y-auto custom-scrollbar ${viewMode === 'week' || isExpanded ? 'max-h-full' : 'max-h-[600px]'}`}>
          {displayDates.map((date, idx) => {
            const dayStr = ['日','月','火','水','木','金','土'][new Date(date).getDay()];
            const isToday = date === new Date().toISOString().split('T')[0];
            return (
              <div key={date} className={idx > 0 ? "pt-6 border-t border-dashed border-gray-200" : ""}>
                {viewMode === 'week' && (
                  <div className={`mb-3 flex items-center gap-2 ${isToday ? 'text-indigo-600' : 'text-gray-600'}`}>
                    <span className="font-black text-sm">{new Date(date).getMonth()+1}/{new Date(date).getDate()} ({dayStr})</span>
                    {isToday && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">Today</span>}
                  </div>
                )}
                <ShiftViewer date={date} teacherName={profile?.name || ''} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}