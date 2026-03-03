'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { CalendarClock, Video, Loader2, BookOpen } from 'lucide-react';

type ShiftAssignment = {
  id: string;
  target_date: string;
  note?: string;
  target_grade?: string;
  target_subject?: string;
  target_meeting_id?: string;
  unit?: string;
  teacher_name?: string;
  user_id?: string;
};

// --- ヘルパー関数 ---
const toHalfWidth = (str: string) => !str ? '' : str.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');

// 名前マッチングロジック
const isNameMatch = (shiftName: string | undefined, profileName: string) => {
  if (!shiftName || !profileName) return false;
  const s = shiftName.replace(/[ 　]/g, '');
  const p = profileName.replace(/[ 　]/g, '');
  return s.includes(p);
};

// 日本時間を取得
const getJSTNow = () => {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
};

const getJSTDateStr = (offsetDays: number = 0) => {
  const d = getJSTNow();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

// ★追加: 日付の表記ゆれ（2026/3/2, 2026-3-2 など）を "2026-03-02" に統一する関数
const normalizeDateStr = (raw: string) => {
  if (!raw) return '';
  // 1. スラッシュをハイフンに変換
  let s = raw.replace(/\//g, '-');
  // 2. ゼロ埋め（例: 2026-3-2 -> 2026-03-02）
  const parts = s.split('-');
  if (parts.length === 3) {
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s;
};

// 授業が「これから（未終了）」かどうかを判定する
const isUpcomingClass = (normalizedTargetDate: string, note?: string) => {
  const todayStr = getJSTDateStr(0);
  
  // 表記ゆれを無くした状態で比較するため、過去の授業は確実に弾かれます
  if (normalizedTargetDate > todayStr) return true;
  if (normalizedTargetDate < todayStr) return false;

  // 今日の授業の場合、時間をチェックする
  if (!note) return true; 

  const timeMatches = note.match(/([0-9]{1,2})[:：]([0-9]{2})/g);
  if (!timeMatches || timeMatches.length === 0) return true; 

  let endTimeStr = timeMatches[timeMatches.length - 1].replace('：', ':');
  if (endTimeStr.length === 4) endTimeStr = '0' + endTimeStr; 

  const now = getJSTNow();
  const currentHH = now.getUTCHours().toString().padStart(2, '0');
  const currentMM = now.getUTCMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${currentHH}:${currentMM}`;

  return endTimeStr >= currentTimeStr;
};

export default function NextClassWidget({ profile }: { profile: any }) {
  const [nextClasses, setNextClasses] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNext = async () => {
      if (!profile) {
        setLoading(false);
        return;
      }

      const userId = profile.id || profile.uid;
      const userName = profile.student_name || profile.name || '';

      console.log(`🔍 授業検索開始: User=${userName}, ID=${userId}`);

      try {
        const todayStr = getJSTDateStr(0);      
        const tomorrowStr = getJSTDateStr(1);   

        const shiftsMap = new Map<string, ShiftAssignment>();
        const promises = [];

        if (userId) {
          const idCandidates = Array.from(new Set([userId, toHalfWidth(userId)])).filter(Boolean);
          if (idCandidates.length > 0) {
            promises.push(
              getDocs(query(
                collection(db, 'shift_assignments'), 
                where('user_id', 'in', idCandidates),
                where('target_date', '>=', todayStr)
              ))
            );
          }
        }

        promises.push(
          getDocs(query(
            collection(db, 'shift_assignments'),
            where('target_date', '==', todayStr)
          ))
        );

        promises.push(
          getDocs(query(
            collection(db, 'shift_assignments'),
            where('target_date', '>=', tomorrowStr),
            orderBy('target_date', 'asc'),
            limit(100)
          ))
        );

        const results = await Promise.all(promises);

        let totalFetched = 0;
        let matchedCount = 0;

        results.forEach(snap => {
          totalFetched += snap.size;
          snap.docs.forEach(doc => {
            const data = doc.data() as Omit<ShiftAssignment, 'id'>;
            
            if (shiftsMap.has(doc.id)) return;

            const isIdMatched = data.user_id === userId;
            const isNameMatched = isNameMatch(data.teacher_name, userName);

            if (isIdMatched || isNameMatched) {
              // ★ 取得した日付の表記ゆれをここで一律綺麗にする
              const normalizedDate = normalizeDateStr(data.target_date);
              
              if (isUpcomingClass(normalizedDate, data.note)) {
                // 綺麗な日付でデータを上書きして保存する
                shiftsMap.set(doc.id, { ...data, id: doc.id, target_date: normalizedDate });
                matchedCount++;
              }
            }
          });
        });

        console.log(`📊 検索結果: 取得総数=${totalFetched}, ヒット数=${matchedCount}`);

        // ソート (日付 > 時間帯)
        const futureShifts = Array.from(shiftsMap.values()).sort((a, b) => {
          if (a.target_date !== b.target_date) return a.target_date.localeCompare(b.target_date);
          return (a.note || '').localeCompare(b.note || '');
        });

        if (futureShifts.length > 0) {
          const nearestDate = futureShifts[0].target_date;
          // 直近の日付の授業のみを表示
          const todaysClasses = futureShifts.filter(s => s.target_date === nearestDate);
          setNextClasses(todaysClasses);
        } else {
          setNextClasses([]);
        }

      } catch (e) {
        console.error("❌ NextClass fetch error:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchNext();
  }, [profile]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex items-center justify-center h-[88px] animate-pulse">
        <Loader2 className="animate-spin text-indigo-300" />
      </div>
    );
  }

  // データがない場合は非表示
  if (nextClasses.length === 0) return null; 

  const firstClass = nextClasses[0];
  const isToday = firstClass.target_date === getJSTDateStr(0);

  const handleJoin = (meetingId?: string) => {
     if (!meetingId) return alert("ミーティングIDが未設定です");
     const confno = toHalfWidth(meetingId).replace(/[^0-9]/g, '');
     window.open(`zoommtg://zoom.us/join?confno=${confno}`, '_self');
  };

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-4 text-white shadow-lg relative overflow-hidden group mb-6">
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
      <div className="absolute bottom-0 left-10 w-24 h-24 bg-indigo-400/20 rounded-full blur-xl mb-[-2rem] pointer-events-none"></div>
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3 border-b border-white/10 pb-2">
          <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm shadow-inner shrink-0">
            <CalendarClock size={20} className="text-indigo-50" />
          </div>
          <div className="flex items-center gap-3">
             <span className="text-sm font-bold tracking-wider text-indigo-100">次回担当授業</span>
             {/* 表記ゆれを綺麗にしたので、常に YYYY/MM/DD と美しく表示されます */}
             <span className="text-lg font-black">{firstClass.target_date.replace(/-/g, '/')}</span>
             {isToday && (
                <span className="bg-rose-500 text-white px-2 py-0.5 rounded text-[10px] font-bold animate-pulse shadow-sm">TODAY</span>
              )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {nextClasses.map((cls) => (
            <div key={cls.id} className="bg-white/10 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-white/5 backdrop-blur-sm hover:bg-white/20 transition-colors">
              <div className="flex items-start gap-3 overflow-hidden">
                <div className="bg-black/30 text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap shrink-0 mt-0.5">
                  {cls.note?.match(/【.*?】/)?.[0] || '時間未定'}
                </div>
                
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold mb-0.5">
                     <span>{cls.target_grade}</span>
                     <span className="opacity-50">|</span>
                     <span>{cls.target_subject}</span>
                  </div>
                  <div className="text-xs text-indigo-100 flex items-center gap-1 truncate">
                    <BookOpen size={10} className="shrink-0 opacity-70"/>
                    <span className="truncate">{cls.unit || '単元設定なし'}</span>
                  </div>
                </div>
              </div>

              {cls.target_meeting_id && (
                <button 
                  onClick={() => handleJoin(cls.target_meeting_id)}
                  className="bg-white text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg font-bold text-xs transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 active:scale-95 whitespace-nowrap sm:w-auto w-full"
                >
                  <Video size={12} /> 入室
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}