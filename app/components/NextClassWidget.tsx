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

// ★名前マッチングロジック (スペース無視・部分一致)
// 例: shiftName="板 福井 裕次郎", profileName="福井 裕次郎" -> true
const isNameMatch = (shiftName: string | undefined, profileName: string) => {
  if (!shiftName || !profileName) return false;
  const s = shiftName.replace(/[ 　]/g, ''); // シフト名から全スペース除去
  const p = profileName.replace(/[ 　]/g, ''); // プロフィール名から全スペース除去
  return s.includes(p); // 含まれていればOK
};

// 日本時間の日付文字列 (YYYY-MM-DD)
const getJSTDate = (offsetDays: number = 0) => {
  const d = new Date();
  // 9時間足してJSTへ
  d.setHours(d.getHours() + 9);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
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
        const todayStr = getJSTDate(0);      // 今日
        const tomorrowStr = getJSTDate(1);   // 明日

        const shiftsMap = new Map<string, ShiftAssignment>();
        const promises = [];

        // ----------------------------------------------------
        // 1. ID検索 (ID紐付けがあるデータ)
        // ----------------------------------------------------
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

        // ----------------------------------------------------
        // 2. 今日のデータを「全件」取得 (limitなし)
        // ※ここが重要: 今日の授業が埋もれないようにする
        // ----------------------------------------------------
        promises.push(
          getDocs(query(
            collection(db, 'shift_assignments'),
            where('target_date', '==', todayStr)
          ))
        );

        // ----------------------------------------------------
        // 3. 明日以降のデータを取得 (少しだけ)
        // ----------------------------------------------------
        promises.push(
          getDocs(query(
            collection(db, 'shift_assignments'),
            where('target_date', '>=', tomorrowStr),
            orderBy('target_date', 'asc'),
            limit(100) // 明日以降は100件まで探す
          ))
        );

        // 実行
        const results = await Promise.all(promises);

        let totalFetched = 0;
        let matchedCount = 0;

        results.forEach(snap => {
          totalFetched += snap.size;
          snap.docs.forEach(doc => {
            const data = doc.data() as Omit<ShiftAssignment, 'id'>;
            
            // 重複除外
            if (shiftsMap.has(doc.id)) return;

            // マッチング判定
            const isIdMatched = data.user_id === userId;
            const isNameMatched = isNameMatch(data.teacher_name, userName);

            if (isIdMatched || isNameMatched) {
              shiftsMap.set(doc.id, { ...data, id: doc.id });
              matchedCount++;
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
          // 直近の日付の授業のみを表示
          const nearestDate = futureShifts[0].target_date;
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
  const isToday = firstClass.target_date === getJSTDate(0);

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
                  {/* デバッグ用: 実際にヒットした名前を表示 */}
                  {/* <div className="text-[10px] opacity-50">担当: {cls.teacher_name}</div> */}
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