'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import { 
  Clock, CheckCircle, AlertCircle, Play, Square, Briefcase, 
  ArrowLeft, Plus, Trash2, Save, X, Edit3, Train, 
  ChevronLeft, ChevronRight, Loader2, Copy,
  Calendar, LayoutTemplate, Coffee, DollarSign
} from 'lucide-react';
import Link from 'next/link';

// --- 型定義 ---
interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office' | 'support' | 'break'; 
  note: string;
  isAuto?: boolean;
}

interface Transportation {
  from: string;
  to: string;
  cost: number | string;
}

// シフト情報の型定義
interface ShiftData {
  id: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  note: string; 
  target_grade?: string;
  target_subject?: string;
  unit?: string;
}

// 時間割マスタ
const TIME_SLOTS: Record<string, { start: string; end: string }> = {
  '1限': { start: '19:20', end: '20:25' },
  '2限': { start: '20:35', end: '21:40' },
};

// --- サブコンポーネント: タイムライン表示 ---
const TimelineVisual = ({ record, currentSegments }: { record: any, currentSegments: WorkSegment[] }) => {
  if (!record.start_time || !record.end_time) return null;
  
  const startTime = new Date(record.start_time);
  const endTime = new Date(record.end_time);
  
  const displayStart = new Date(startTime);
  displayStart.setMinutes(displayStart.getMinutes() - 30);
  const displayEnd = new Date(endTime);
  displayEnd.setMinutes(displayEnd.getMinutes() + 30);

  const totalDuration = (displayEnd.getTime() - displayStart.getTime());

  const getPosition = (dateStr: string) => { 
    const d = new Date(record.start_time); 
    const [h, m] = dateStr.split(':').map(Number);
    d.setHours(h, m, 0);
    return ((d.getTime() - displayStart.getTime()) / totalDuration) * 100;
  };

  const getWidth = (startStr: string, endStr: string) => {
    const s = new Date(record.start_time);
    const [sh, sm] = startStr.split(':').map(Number);
    s.setHours(sh, sm, 0);
    const e = new Date(record.start_time);
    const [eh, em] = endStr.split(':').map(Number);
    e.setHours(eh, em, 0);
    return ((e.getTime() - s.getTime()) / totalDuration) * 100;
  };

  const workStartPos = ((startTime.getTime() - displayStart.getTime()) / totalDuration) * 100;
  const workWidth = ((endTime.getTime() - startTime.getTime()) / totalDuration) * 100;

  return (
    <div className="relative w-full h-12 bg-gray-100 rounded-lg overflow-hidden mb-4 border border-gray-200">
      <div className="absolute top-0 bottom-0 bg-gray-200/50 border-x-2 border-gray-300" style={{ left: `${workStartPos}%`, width: `${workWidth}%` }} />
      {currentSegments.map((seg, i) => {
        if (!seg.start || !seg.end) return null;
        const left = getPosition(seg.start);
        const width = getWidth(seg.start, seg.end);
        
        let colorClass = 'bg-gray-400';
        if (seg.type === 'lesson') colorClass = 'bg-blue-500';
        else if (seg.type === 'support') colorClass = 'bg-green-500';
        else if (seg.type === 'office') colorClass = 'bg-orange-500';
        else if (seg.type === 'break') colorClass = 'bg-slate-400';

        return (
          <div key={i} className={`absolute top-1 bottom-1 rounded-md shadow-sm ${colorClass} opacity-90 hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-bold truncate px-1`} style={{ left: `${left}%`, width: `${width}%` }} title={`${seg.start}-${seg.end} ${seg.note}`}>
            {width > 10 ? (
              seg.type === 'lesson' ? '授業' : 
              seg.type === 'support' ? 'サポ' : 
              seg.type === 'office' ? '事務' : '休憩'
            ) : ''}
          </div>
        );
      })}
      <div className="absolute top-0 bottom-0 w-px bg-black/20" style={{ left: `${workStartPos}%` }}></div>
      <div className="absolute top-0 bottom-0 w-px bg-black/20" style={{ left: `${workStartPos + workWidth}%` }}></div>
    </div>
  );
};

export default function TeacherAttendancePage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [viewDate, setViewDate] = useState(new Date());

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);

  // その日のシフト情報
  const [dailyShifts, setDailyShifts] = useState<ShiftData[]>([]);

  useEffect(() => {
    if (user) {
      fetchTodayStatus();
      fetchMonthlyHistory();
    }
  }, [user, viewDate]);

  // --- データ取得 ---
  const fetchTodayStatus = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), where('date', '==', todayStr));
      const snap = await getDocs(q);
      
      let active = null;
      let finished = null;
      if (!snap.empty) {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const latest = docs[0];
        if (latest.end_time === null) active = latest; else finished = latest;
      }
      setCurrentSession(active);
      setTodayRecord(finished);
      setLoading(false);
    } catch (e) { console.error(e); setLoading(false); }
  };

  const fetchMonthlyHistory = async () => {
    try {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth() + 1;
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), where('date', '>=', startStr), where('date', '<=', endStr), orderBy('date', 'desc'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  };

  // --- アクション ---
  const handleClockIn = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (todayRecord) {
      alert('本日は既に勤務記録が完了しています。1日1回のみ打刻可能です。');
      return;
    }
    if (!confirm('出勤時刻を記録しますか？')) return;

    try {
      setLoading(true);
      const teacherName = profile?.name || profile?.student_name || user?.displayName || '未設定の講師';
      await addDoc(collection(db, 'work_records'), {
        teacher_id: user?.uid,
        teacher_name: teacherName,
        date: todayStr,
        start_time: new Date().toISOString(),
        end_time: null,
        status: 'pending',
        work_segments: [],
        transportation: [],
        created_at: new Date().toISOString()
      });
      await fetchTodayStatus();
      await fetchMonthlyHistory();
    } catch (e: any) { alert('エラー: ' + e.message); } finally { setLoading(false); }
  };

  const handleClockOut = async () => {
    if (!confirm('退勤しますか？')) return;
    try {
      setLoading(true);
      const ref = doc(db, 'work_records', currentSession.id);
      await updateDoc(ref, { end_time: new Date().toISOString(), updated_at: new Date().toISOString() });
      await fetchTodayStatus();
      await fetchMonthlyHistory();
    } catch (e: any) { alert('エラー: ' + e.message); } finally { setLoading(false); }
  };

  // --- 編集モーダルと自動入力ロジック ---
  
  const generateSegmentsFromShifts = (shifts: ShiftData[]): WorkSegment[] => {
    const newSegments: WorkSegment[] = [];
    
    shifts.forEach(shift => {
      let timeSlot = null;
      // noteに含まれる "1限" などの文字列から時間を判定
      for (const [key, slot] of Object.entries(TIME_SLOTS)) {
        if (shift.note && shift.note.includes(key)) {
          timeSlot = slot;
          break;
        }
      }

      if (timeSlot) {
        const type = (shift.role_type === 'main' || shift.role_type === 'sub') ? 'lesson' : 'support';
        
        const details = [
          shift.target_grade,
          shift.target_subject,
          shift.unit
        ].filter(Boolean).join(' ');

        newSegments.push({
          start: timeSlot.start,
          end: timeSlot.end,
          type: type,
          note: details || shift.note || '',
          isAuto: true
        });
      }
    });

    return newSegments.sort((a, b) => a.start.localeCompare(b.start));
  };

  const openEditModal = async (rec: any) => {
    setEditingRecord(rec);
    setExpenses(rec.transportation || []);

    let fetchedShifts: ShiftData[] = [];
    try {
      const q = query(collection(db, 'shift_assignments'), where('user_id', '==', user?.uid), where('target_date', '==', rec.date));
      const snap = await getDocs(q);
      fetchedShifts = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftData));
      setDailyShifts(fetchedShifts);
    } catch (e) { console.error("Shift fetch error", e); }

    if (rec.work_segments && rec.work_segments.length > 0) {
      const sorted = [...rec.work_segments].sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
      setSegments(sorted);
    } else {
      const autoSegments = generateSegmentsFromShifts(fetchedShifts);
      setSegments(autoSegments);
    }
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index] };

    if (field === 'type') {
      const prevType = current.type;
      current.type = value as any;

      if (prevType === 'break' && (current.note === '休憩' || current.note.includes('自動'))) {
        current.note = '';
      }
      
      if (value === 'break' && !current.note) {
        current.note = '休憩';
      }
    } else {
      // @ts-ignore
      current[field] = value;
    }
    
    newSegs[index] = current;
    setSegments(newSegs);
  };
  
  const addSegment = () => {
    let nextStart = '';
    if (segments.length > 0) {
      nextStart = segments[segments.length - 1].end;
    } else if (editingRecord) {
      // 最初のセグメントを追加する場合は、出勤時刻を5分単位で切り上げた時刻を初期値にする
      const shiftStart = new Date(editingRecord.start_time);
      const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
      const h = Math.floor(startMin / 60);
      const m = startMin % 60;
      nextStart = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    setSegments([...segments, { start: nextStart, end: '', type: 'office', note: '' }]);
  };
  
  const removeSegment = (index: number) => setSegments(segments.filter((_, i) => i !== index));

  const updateExpense = (index: number, field: keyof Transportation, value: string | number) => {
    const newExps = [...expenses];
    newExps[index] = { ...newExps[index], [field]: value };
    setExpenses(newExps);
  };
  const addExpense = () => setExpenses([...expenses, { from: '', to: '', cost: '' }]);
  const removeExpense = (index: number) => setExpenses(expenses.filter((_, i) => i !== index));

  const handleCopyLastTransport = async () => {
    try {
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), orderBy('created_at', 'desc'), limit(10));
      const snap = await getDocs(q);
      const lastRecord = snap.docs.map(d => d.data()).find((d: any) => d.transportation?.length > 0 && d.id !== editingRecord.id);
      if (lastRecord && confirm(`${lastRecord.date} の交通費情報をコピーしますか？`)) {
        setExpenses(lastRecord.transportation);
      } else if (!lastRecord) alert('過去の交通費データが見つかりませんでした');
    } catch (e) { console.error(e); }
  };

  // ★修正: 打刻時間を5分単位に丸めてから隙間を計算する
  const fillGaps = (currentSegments: WorkSegment[], startTime: string, endTime: string | null) => {
    if (!startTime || !endTime) return currentSegments;
    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const toTimeStr = (m: number) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    };

    const shiftStart = new Date(startTime);
    const shiftEnd = new Date(endTime);
    
    // 出勤時刻は5分単位に「切り上げ」
    const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
    // 退勤時刻は5分単位に「切り捨て」
    const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

    const sorted = [...currentSegments]
      .filter(s => s.start && s.end)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    const result: WorkSegment[] = [];
    let cursor = startMin;

    for (const seg of sorted) {
      const segStart = toMinutes(seg.start);
      const segEnd = toMinutes(seg.end);

      if (cursor < segStart) {
        result.push({ 
          start: toTimeStr(cursor), 
          end: toTimeStr(segStart), 
          type: 'break',
          note: '休憩(自動補完)', 
          isAuto: true 
        });
      }
      result.push(seg);
      cursor = Math.max(cursor, segEnd);
    }

    if (cursor < endMin) {
      result.push({ 
        start: toTimeStr(cursor), 
        end: toTimeStr(endMin), 
        type: 'break',
        note: '休憩(自動補完)', 
        isAuto: true 
      });
    }
    return result;
  };

  const saveData = async () => {
    if (!editingRecord) return;
    
    // 講師用画面は打刻時間を変更できないため、editingRecordの値をそのまま使う
    const newStartISO = editingRecord.start_time;
    const newEndISO = editingRecord.end_time;

    // ★ 修正: 詳細(業務内訳)の入力のみ5分単位であることをチェック
    const isTimeStrMultipleOf5 = (timeStr: string) => {
      if (!timeStr) return true;
      const [, m] = timeStr.split(':').map(Number);
      return m % 5 === 0;
    };

    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };

    for (const seg of segments) {
      if (seg.start && seg.end) {
        if (!isTimeStrMultipleOf5(seg.start) || !isTimeStrMultipleOf5(seg.end)) {
          return alert('【エラー】業務内訳の開始・終了時刻は5分単位（0, 5, 10...）で入力してください。');
        }
      }
    }

    // ★ 修正: 打刻時間を丸めた範囲内に詳細が収まっているか、および開始直後の休憩禁止チェック
    if (newStartISO && newEndISO) {
      const shiftStart = new Date(newStartISO);
      const shiftEnd = new Date(newEndISO);
      // 出勤は切り上げ、退勤は切り捨て
      const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
      const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

      // 範囲チェック
      for (const seg of segments) {
        if (seg.start && seg.end) {
          const sMin = toMinutes(seg.start);
          const eMin = toMinutes(seg.end);
          if (sMin < startMin || eMin > endMin) {
             return alert(`【エラー】業務内訳は打刻時間に基づき「${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}」から「${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')}」の間で入力してください。`);
          }
        }
      }

      // 最初の業務までの空白チェック＆休憩チェック
      if (segments.length > 0) {
        const sortedSegments = [...segments].filter(s => s.start && s.end).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        if (sortedSegments.length > 0) {
          const firstSegMin = toMinutes(sortedSegments[0].start);
          if (firstSegMin > startMin) {
            return alert(`【エラー】出勤時刻（打刻丸め後: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}）から最初の業務までに空白時間を作ることはできません。\n最初の業務の開始時刻を合わせるか、管理者に打刻時刻の修正を依頼してください。`);
          }
          if (sortedSegments[0].type === 'break') {
            return alert('【エラー】出勤直後の最初の業務区分に「休憩」を登録することはできません。');
          }
        }
      }
    }

    try {
      const validSegments = segments.filter(s => s.start && s.end);
      validSegments.sort((a, b) => a.start.localeCompare(b.start));
      const filledSegments = fillGaps(validSegments, editingRecord.start_time, editingRecord.end_time);

      // ★ 修正: 最後が休憩で終わることを禁止するバリデーション
      if (filledSegments.length > 0) {
        const lastSeg = filledSegments[filledSegments.length - 1];
        if (lastSeg.type === 'break') {
          return alert('【エラー】最後が「休憩」で終わることはできません。\n最後の業務の終了時刻と退勤時刻(丸め後)を一致させてください。');
        }
      }

      const formattedExpenses = expenses.map(e => ({ ...e, cost: Number(e.cost) }));
      
      await updateDoc(doc(db, 'work_records', editingRecord.id), {
        work_segments: filledSegments,
        transportation: formattedExpenses,
        updated_at: new Date().toISOString()
      });
      
      alert('保存しました。');
      setEditingRecord(null);
      fetchMonthlyHistory();
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  const changeMonth = (diff: number) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + diff);
    setViewDate(newDate);
  };

  const calcDurationMinutes = (startISO: string, endISO: string) => {
    if (!startISO || !endISO) return 0;
    const diff = new Date(endISO).getTime() - new Date(startISO).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60)));
  };
  const formatDuration = (mins: number) => `${Math.floor(mins / 60)}時間${mins % 60}分`;
  
  const calcSegmentTotal = (segs: WorkSegment[], type: string) => {
    return segs.filter(s => s.type === type).reduce((acc, s) => {
      const start = new Date(`2000/01/01 ${s.start}`);
      const end = new Date(`2000/01/01 ${s.end}`);
      const diff = (end.getTime() - start.getTime()) / (1000 * 60);
      return acc + (isNaN(diff) ? 0 : diff);
    }, 0);
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + (Number(item.cost) || 0), 0) : 0;

  const monthlySummary = useMemo(() => {
    let totalMinutes = 0, totalTransportCost = 0;
    history.forEach(rec => {
      if (rec.end_time) totalMinutes += calcDurationMinutes(rec.start_time, rec.end_time);
      if (rec.transportation) totalTransportCost += calcTotalCost(rec.transportation);
    });
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, cost: totalTransportCost };
  }, [history]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-48 font-sans md:p-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/teacher/work" className="bg-white p-3 rounded-full shadow-sm hover:bg-gray-50 text-gray-600 transition-colors"><ArrowLeft size={20} /></Link>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2"><Briefcase className="text-blue-600" /> 勤怠打刻</h1>
        </div>

        {/* 今日の打刻 */}
        <div className="bg-white rounded-[32px] shadow-lg shadow-blue-50 border border-white p-6 md:p-8 text-center mb-6 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-400 via-green-400 to-orange-400"></div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md">TODAY</span>
            <span className="text-xs font-bold text-gray-400">{new Date().toLocaleDateString('ja-JP', { weekday: 'long' })}</span>
          </div>
          <div className="text-5xl font-black text-gray-800 font-mono mb-6 tracking-tighter mt-2">
            {new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
          {loading ? <div className="h-16 flex items-center justify-center"><Loader2 className="animate-spin text-gray-300"/></div> : currentSession ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full text-sm font-bold animate-pulse border border-green-100 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span> 
                勤務中 ({new Date(currentSession.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 〜)
              </div>
              <button onClick={handleClockOut} className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-xl hover:shadow-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"><Square fill="currentColor" size={18} /> 退勤する</button>
            </div>
          ) : (
            <div className="space-y-4">
              {todayRecord ? (
                <div className="py-6 px-4 bg-gray-50 rounded-2xl border border-gray-200 text-gray-500 flex flex-col items-center justify-center gap-2">
                  <div className="font-bold text-lg text-slate-600">お疲れ様でした 🎉</div>
                  <div className="text-xs">本日の業務記録は完了しています</div>
                  <div className="text-sm font-bold bg-white px-4 py-1.5 rounded-full border border-gray-200 shadow-sm mt-1 text-slate-700">
                    実働 {formatDuration(calcDurationMinutes(todayRecord.start_time, todayRecord.end_time))}
                  </div>
                </div>
              ) : (
                <button onClick={handleClockIn} className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-xl hover:shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2"><Play fill="currentColor" size={18} /> 出勤する</button>
              )}
            </div>
          )}
        </div>

        {/* 月次サマリー */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between px-4 py-2 bg-white rounded-full shadow-sm border border-gray-100">
            <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-blue-600 transition-colors"><ChevronLeft size={20}/></button>
            <h2 className="text-lg font-black text-gray-700 flex items-center gap-2"><Calendar size={18} className="text-blue-500 mb-0.5"/> {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月</h2>
            <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-blue-600 transition-colors"><ChevronRight size={20}/></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Hours</span>
              <div className="text-xl font-black text-gray-800">{monthlySummary.hours}<span className="text-xs font-bold text-gray-400 ml-0.5">時間</span>{monthlySummary.minutes > 0 && <span className="ml-1 text-lg">{monthlySummary.minutes}<span className="text-xs font-bold text-gray-400">分</span></span>}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Cost</span>
              <div className="text-xl font-black text-gray-800 flex items-baseline"><span className="text-sm text-gray-400 mr-1">¥</span>{monthlySummary.cost.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* 履歴リスト */}
        <div className="space-y-4 pb-24">
          {history.length === 0 ? <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-gray-100"><Clock size={40} className="mx-auto text-gray-200 mb-2"/><p className="text-gray-400 font-bold text-sm">この月の履歴はありません</p></div> : history.map((rec) => {
             const duration = rec.end_time ? calcDurationMinutes(rec.start_time, rec.end_time) : 0;
             if(currentSession && currentSession.id === rec.id) return null;
             const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));

             return (
              <div key={rec.id} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl px-3 min-w-[3.5rem] border border-gray-100">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(rec.date).toLocaleDateString('en-US', {month:'short'})}</span>
                      <span className="text-xl font-black text-gray-700">{new Date(rec.date).getDate()}</span>
                    </div>
                    <div>
                      <div className="font-black text-gray-800 text-lg font-mono flex items-center gap-1">{new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}<ArrowLeft size={12} className="rotate-180 text-gray-300"/>{rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}</div>
                      <div className="flex items-center gap-2 mt-1"><span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{formatDuration(duration)}</span>{rec.status === 'approved' ? <span className="text-[10px] font-bold text-green-600 flex items-center gap-0.5"><CheckCircle size={10}/> 承認済</span> : <span className="text-[10px] font-bold text-orange-400 flex items-center gap-0.5"><AlertCircle size={10}/> 承認待</span>}</div>
                    </div>
                  </div>
                </div>
                
                {displaySegments?.length > 0 ? (
                  <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100 mb-4">
                    {displaySegments.map((seg: WorkSegment, i: number) => (
                      <div key={i} className={`flex items-center px-3 py-2 text-xs border-b border-gray-100 last:border-0 ${seg.type === 'lesson' ? 'bg-blue-50/50' : seg.type === 'support' ? 'bg-green-50/50' : seg.type === 'office' ? 'bg-orange-50/50' : 'bg-gray-100'}`}>
                        <div className="w-20 font-mono font-bold text-gray-600 shrink-0">{seg.start} - {seg.end}</div>
                        <div className={`px-2 py-0.5 rounded font-bold mr-3 shrink-0 text-[10px] ${
                          seg.type === 'lesson' ? 'bg-blue-100 text-blue-700' : 
                          seg.type === 'support' ? 'bg-green-100 text-green-700' : 
                          seg.type === 'office' ? 'bg-orange-100 text-orange-700' : 
                          'bg-gray-200 text-gray-600'
                        }`}>
                          {seg.type === 'lesson' ? '授業' : seg.type === 'support' ? 'サポ' : seg.type === 'office' ? '事務' : '休憩'}
                        </div>
                        <div className="truncate text-gray-600 font-medium">{seg.note}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="mb-4 text-xs text-blue-500 font-bold flex items-center gap-1 bg-blue-50 p-2 rounded-lg border border-blue-100"><LayoutTemplate size={14}/> シフトから自動入力可能です</div>}
                
                {rec.transportation?.length > 0 && <div className="mb-4 pt-2 border-t border-dashed border-gray-100 flex items-center justify-between text-xs text-gray-500 px-1"><span className="flex items-center gap-1 font-bold"><Train size={12}/> 交通費あり</span><span className="font-mono font-bold">¥{calcTotalCost(rec.transportation).toLocaleString()}</span></div>}
                {rec.end_time && rec.status !== 'approved' && <button onClick={() => openEditModal(rec)} className="w-full py-3 rounded-xl bg-gray-50 text-gray-600 text-xs font-bold hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center gap-2"><Edit3 size={14}/> {displaySegments?.length > 0 ? '詳細を修正' : '詳細・交通費を入力'}</button>}
              </div>
            );
          })}
          <div className="h-24 md:hidden"></div>
        </div>
      </div>

      {/* 詳細編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center z-[9999] p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl h-[85dvh] sm:h-[90vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col overflow-hidden">
            
            {/* モーダルヘッダー */}
            <div className="bg-white p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
              <div><h3 className="font-black text-gray-800 text-lg flex items-center gap-2"><LayoutTemplate size={20} className="text-blue-600"/> 業務詳細修正</h3><p className="text-xs text-gray-400 font-bold mt-0.5">{editingRecord.date}</p></div>
              <button onClick={() => setEditingRecord(null)} className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors"><X size={20} className="text-gray-600"/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50 space-y-6 custom-scrollbar">
              
              {/* ビジュアルタイムライン */}
              <section>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 px-1 gap-2">
                  <h4 className="text-xs font-bold text-gray-500">1日の流れ</h4>
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="flex items-center gap-1 text-blue-600"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>授業</span>
                    <span className="flex items-center gap-1 text-green-600"><span className="w-2 h-2 bg-green-500 rounded-full"></span>サポート</span>
                    <span className="flex items-center gap-1 text-orange-600"><span className="w-2 h-2 bg-orange-500 rounded-full"></span>事務</span>
                    <span className="flex items-center gap-1 text-gray-400"><span className="w-2 h-2 bg-slate-400 rounded-full"></span>休憩</span>
                  </div>
                </div>
                <TimelineVisual record={editingRecord} currentSegments={segments} />
              </section>

              {/* 編集テーブル */}
              <section>
                <div className="flex flex-col gap-2 mb-3 px-1 text-[10px] text-gray-600 font-bold bg-gray-100 p-3 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-1"><AlertCircle size={12} className="shrink-0 text-gray-500"/> 始まりと終わりの隙間は自動で「休憩」になり、空白時間を埋めます（出勤直後は不可）。</div>
                  <div className="flex items-center gap-1 text-red-500"><AlertCircle size={12} className="shrink-0"/> ※勤務時間が6時間を超える場合は45分以上、8時間を超える場合は1時間以上の休憩が必要です。</div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-[500px] sm:min-w-0">
                    <thead className="bg-gray-100 text-gray-500 text-xs font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-2 text-left w-16">開始</th>
                        <th className="px-2 py-2 text-left w-16">終了</th>
                        <th className="px-2 py-2 text-left w-32">区分</th>
                        <th className="px-2 py-2 text-left hidden sm:table-cell">詳細</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {segments.map((seg, i) => (
                        <tr key={i} className={`transition-colors ${
                          seg.type === 'lesson' ? 'bg-blue-50/30' : 
                          seg.type === 'support' ? 'bg-green-50/30' : 
                          seg.type === 'office' ? 'bg-orange-50/30' : 
                          'bg-gray-100'
                        }`}>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} /></td>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
                          <td className="p-2">
                            <div className="flex flex-col sm:flex-row gap-1">
                              <select 
                                className={`w-full text-xs font-bold p-1 rounded border outline-none ${
                                  seg.type === 'lesson' ? 'text-blue-600 border-blue-200 bg-blue-50' : 
                                  seg.type === 'support' ? 'text-green-600 border-green-200 bg-green-50' : 
                                  seg.type === 'office' ? 'text-orange-600 border-orange-200 bg-orange-50' :
                                  'text-gray-500 border-gray-300 bg-white'
                                }`}
                                value={seg.type}
                                onChange={(e) => updateSegment(i, 'type', e.target.value as any)}
                              >
                                <option value="lesson">授業</option>
                                <option value="support">サポート</option>
                                <option value="office">事務</option>
                                <option value="break">休憩</option>
                              </select>
                              <input type="text" className="sm:hidden w-full bg-transparent border-b border-gray-300 text-xs p-1 mt-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                            </div>
                          </td>
                          <td className="p-2 hidden sm:table-cell"><input type="text" className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none text-xs p-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} /></td>
                          <td className="p-2 text-center w-10 whitespace-nowrap"><button onClick={() => removeSegment(i)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors shrink-0"><Trash2 size={16}/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between">
                  <span className="flex items-center gap-1"><Coffee size={12}/> 入力のない時間は自動的に「休憩」となります</span>
                  <button onClick={addSegment} className="text-blue-600 font-bold hover:underline flex items-center gap-1"><Plus size={12}/> 行を追加</button>
                </div>
              </section>

              {/* 交通費セクション */}
              <section className="pt-4 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-3 gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                      <Train size={16}/> 交通費申請
                    </h4>
                    <p className="text-[10px] text-red-500 font-bold mt-1">※必ず駅名を入力してください。定期券区間は除外して申請してください。</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCopyLastTransport} className="text-[10px] sm:text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-bold hover:bg-blue-100 flex items-center gap-1 shrink-0">
                      <Copy size={12}/> 前回をコピー
                    </button>
                    <button onClick={addExpense} className="text-[10px] sm:text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-bold hover:bg-green-200 flex items-center gap-1 shrink-0">
                      <Plus size={12}/> 追加
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group">
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-50 rounded-r-full border-y border-r border-gray-200"></div>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-50 rounded-l-full border-y border-l border-gray-200"></div>
                      <div className="absolute top-1/2 left-4 right-4 border-t-2 border-dashed border-gray-100 pointer-events-none"></div>
                      <button onClick={() => removeExpense(i)} className="absolute top-1 right-1 text-gray-300 hover:text-red-500 p-1 z-10"><X size={14}/></button>
                      <div className="p-4 flex items-center justify-between relative z-0">
                        <div className="flex flex-col gap-1 w-2/3">
                          <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                            <input type="text" className="w-full bg-transparent border-b border-gray-200 focus:border-green-400 outline-none pb-0.5" placeholder="出発" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} />
                            <ChevronRight size={14} className="text-gray-300"/>
                            <input type="text" className="w-full bg-transparent border-b border-gray-200 focus:border-green-400 outline-none pb-0.5" placeholder="到着" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} />
                          </div>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">ONE WAY TICKET</span>
                        </div>
                        <div className="text-right">
                          <div className="flex items-baseline justify-end gap-1">
                            <span className="text-xs text-gray-400">¥</span>
                            <input type="number" className="w-16 text-right font-mono text-lg font-black text-gray-800 bg-transparent outline-none border-b border-transparent focus:border-green-400 placeholder:text-gray-200" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <div className="h-10"></div>
            </div>
            
            {/* 保存ボタンエリア */}
            <div className="bg-white p-4 border-t border-gray-100 shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10">
              <div className="flex justify-between items-center mb-2 px-2 text-xs font-bold text-gray-500">
                <span>合計勤務時間 (休憩除く)</span>
                <span className="text-gray-800 text-sm">
                  {formatDuration(calcSegmentTotal(segments, 'lesson') + calcSegmentTotal(segments, 'support') + calcSegmentTotal(segments, 'office'))}
                </span>
              </div>
              <button onClick={saveData} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 text-lg"><Save size={20}/> 保存して完了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}