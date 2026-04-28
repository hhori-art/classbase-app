'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Loader2, BookOpen, Megaphone } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

// 曜日の数値変換マップ
const DAY_MAP: { [key: string]: number } = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
const scheduleStart = (item: any) => item.start_date || item.target_date || '';
const scheduleEnd = (item: any) => item.end_date || item.target_date || scheduleStart(item);
const scheduleCoversDate = (item: any, date: string) => scheduleStart(item) <= date && date <= scheduleEnd(item);

interface Props {
  classDay?: string; // 生徒の授業曜日 (例: "月")
  grade?: string;    // 生徒の学年 (例: "中1") ★追加
  role?: 'student' | 'parent' | 'teacher';
}

export default function CalendarWidget({ classDay, grade, role = 'student' }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState<string[]>([]);
  const [homeworks, setHomeworks] = useState<string[]>([]); // 宿題の期限日リスト
  const [monthlySchedules, setMonthlySchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 表示月が変わったらデータを取得
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;

      try {
        // 1. 授業シフトの取得
        const shiftQuery = query(
          collection(db, 'shift_assignments'),
          where('target_date', '>=', startStr),
          where('target_date', '<=', endStr)
        );
        const shiftSnap = await getDocs(shiftQuery);
        const shiftDates = shiftSnap.docs.map(d => d.data().target_date as string);
        setShifts(shiftDates);

        // 2. 宿題期限の取得 (インデックスエラー回避のため、日付で取得してからJSで学年フィルタ)
        const hwQuery = query(
          collection(db, 'homework_assignments'),
          where('deadline', '>=', startStr),
          where('deadline', '<=', endStr)
        );
        const hwSnap = await getDocs(hwQuery);
        const hwDates = hwSnap.docs
          .map(d => d.data())
          .filter(data => !grade || data.target_grade === grade) // 学年で絞り込み
          .map(data => data.deadline as string);
        
        // 重複を除去してセット
        setHomeworks([...new Set(hwDates)]);

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
        const [rangeScheduleSnap, legacyScheduleSnap] = await Promise.all([
          getDocs(rangeScheduleQuery).catch(() => ({ docs: [] as any[] })),
          getDocs(legacyScheduleQuery).catch(() => ({ docs: [] as any[] })),
        ]);
        const scheduleMap = new Map<string, any>();
        [...rangeScheduleSnap.docs, ...legacyScheduleSnap.docs].forEach((d: any) => {
          const item = { id: d.id, ...d.data() };
          if (scheduleStart(item) <= endStr && scheduleEnd(item) >= startStr) scheduleMap.set(item.id, item);
        });
        setMonthlySchedules(Array.from(scheduleMap.values())
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
        setLoading(false);
      }
    };

    fetchData();
  }, [currentDate, grade, role]);

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
  };

  return (
    <div className="w-full">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4 px-2 py-2">
        <h3 className="font-extrabold text-gray-800 text-xl">
          {year}年 <span className="text-indigo-600">{month + 1}月</span>
        </h3>
        <div className="flex gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 bg-gray-100 hover:bg-white rounded-xl text-gray-500 hover:text-indigo-600 transition-all shadow-sm border border-transparent hover:border-gray-200">
            <ChevronLeft size={20}/>
          </button>
          <button onClick={() => changeMonth(1)} className="p-2 bg-gray-100 hover:bg-white rounded-xl text-gray-500 hover:text-indigo-600 transition-all shadow-sm border border-transparent hover:border-gray-200">
            <ChevronRight size={20}/>
          </button>
        </div>
      </div>

      {/* 曜日行 */}
      <div className="grid grid-cols-7 mb-2 text-center">
        {weekDays.map((day, i) => (
          <div key={i} className={`text-xs font-black pb-2 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
            {day}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7 gap-1.5 text-center relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 z-20 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
          </div>
        )}

        {calendarDays.map((dateObj, idx) => {
          if (dateObj.type !== 'current') {
            return <div key={idx} className="min-h-[70px]"></div>; 
          }

          const currentDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
          const currentDayOfWeek = new Date(year, month, dateObj.day).getDay();
          
          const isToday = 
            new Date().getDate() === dateObj.day && 
            new Date().getMonth() === month && 
            new Date().getFullYear() === year;

          // 判定
          const isMyClassDay = classDay && DAY_MAP[classDay] === currentDayOfWeek;
          const hasShift = shifts.includes(currentDayStr);
          const hasHomework = homeworks.includes(currentDayStr); // 宿題あり判定
          const daySchedules = monthlySchedules.filter(item => scheduleCoversDate(item, currentDayStr));

          let shiftStatus = 'none';
          if (isMyClassDay) {
            shiftStatus = hasShift ? 'class' : 'closed';
          }

          return (
            <div key={idx} className={`min-h-[70px] flex flex-col items-center justify-start py-1.5 rounded-xl transition-all border overflow-hidden ${
              isToday 
                ? 'bg-indigo-50 border-indigo-200 shadow-inner' 
                : 'bg-white border-transparent hover:border-gray-100'
            }`}>
              {/* 日付 */}
              <span className={`text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                isToday ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-700'
              }`}>
                {dateObj.day}
              </span>

              <div className="flex flex-col gap-1 w-full px-0.5">
                {/* 授業マーカー */}
                {shiftStatus === 'class' && (
                  <div className="bg-indigo-100 text-indigo-700 text-[9px] font-black py-0.5 rounded shadow-sm border border-indigo-200 truncate">
                    授業
                  </div>
                )}
                {shiftStatus === 'closed' && (
                  <div className="bg-gray-100 text-gray-400 text-[9px] font-bold py-0.5 rounded border border-gray-200 truncate">
                    なし
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
            </div>
          );
        })}
      </div>
      
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
