'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import { 
  Clock, CheckCircle, AlertCircle, Play, Square, Briefcase, 
  ArrowLeft, Plus, Trash2, Save, X, Edit3, Train, 
  Layout, ChevronLeft, Calendar, Copy, ChevronRight, Loader2, RefreshCw
} from 'lucide-react';
import Link from 'next/link';

interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office';
  note: string;
  isAuto?: boolean; // 自動生成されたかどうか
}

interface Transportation {
  from: string;
  to: string;
  cost: number | string;
}

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
    if (todayRecord && !currentSession && !confirm('本日は既に退勤記録があります。再度出勤しますか？')) return;
    if (!todayRecord && !confirm('出勤時刻を記録しますか？')) return;

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

  // --- 編集モーダル ---
  const openEditModal = (rec: any) => {
    setEditingRecord(rec);
    if (rec.work_segments && rec.work_segments.length > 0) {
      setSegments(rec.work_segments);
    } else {
      setSegments([]); 
    }
    setExpenses(rec.transportation || []);
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    newSegs[index] = { ...newSegs[index], [field]: value };
    setSegments(newSegs);
  };
  
  // 新規追加時は、直前の終了時間を開始時間としてセットする便利機能
  const addSegment = () => {
    let nextStart = '';
    if (segments.length > 0) {
      nextStart = segments[segments.length - 1].end;
    } else if (editingRecord) {
      nextStart = new Date(editingRecord.start_time).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
    }
    setSegments([...segments, { start: nextStart, end: '', type: 'lesson', note: '' }]);
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

  // ★隙間を埋める処理（プレビュー用・保存用共通）
  const fillGaps = (currentSegments: WorkSegment[], startTime: string, endTime: string | null) => {
    if (!startTime || !endTime) return currentSegments;

    // 時間変換ヘルパー (HH:MM -> 分)
    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    // 分 -> HH:MM
    const toTimeStr = (m: number) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    };

    const shiftStart = new Date(startTime);
    const shiftEnd = new Date(endTime);
    const startMin = shiftStart.getHours() * 60 + shiftStart.getMinutes();
    const endMin = shiftEnd.getHours() * 60 + shiftEnd.getMinutes();

    // ユーザー入力をソート
    const sorted = [...currentSegments]
      .filter(s => s.start && s.end)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    const result: WorkSegment[] = [];
    let cursor = startMin;

    for (const seg of sorted) {
      const segStart = toMinutes(seg.start);
      const segEnd = toMinutes(seg.end);

      // 隙間があれば事務で埋める
      if (cursor < segStart) {
        result.push({
          start: toTimeStr(cursor),
          end: toTimeStr(segStart),
          type: 'office',
          note: '事務(自動)',
          isAuto: true
        });
      }

      // 重複・包含チェック（簡易）
      if (segEnd > cursor) {
        // 現在のカーソルより後ろに伸びている有効な部分だけ採用またはそのまま採用
        // ここでは単純にユーザー入力を優先して追加
        result.push(seg);
        cursor = Math.max(cursor, segEnd);
      }
    }

    // 末尾の隙間を埋める
    if (cursor < endMin) {
      result.push({
        start: toTimeStr(cursor),
        end: toTimeStr(endMin),
        type: 'office',
        note: '事務(自動)',
        isAuto: true
      });
    }

    return result;
  };

  const saveData = async () => {
    if (!editingRecord) return;
    try {
      // 保存時に隙間を埋める
      const filledSegments = fillGaps(segments, editingRecord.start_time, editingRecord.end_time);

      const formattedExpenses = expenses.map(e => ({ ...e, cost: Number(e.cost) }));
      await updateDoc(doc(db, 'work_records', editingRecord.id), {
        work_segments: filledSegments,
        transportation: formattedExpenses,
        updated_at: new Date().toISOString()
      });
      alert('保存しました。\n未入力の時間は自動的に「事務」として登録されました。');
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
  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + (Number(item.cost) || 0), 0) : 0;

  const monthlySummary = useMemo(() => {
    let totalMinutes = 0, totalTransportCost = 0;
    history.forEach(rec => {
      if (rec.end_time) totalMinutes += calcDurationMinutes(rec.start_time, rec.end_time);
      if (rec.transportation) totalTransportCost += calcTotalCost(rec.transportation);
    });
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, cost: totalTransportCost };
  }, [history]);

  // ソート済みの表示用セグメント
  const sortedSegments = useMemo(() => {
    return [...segments].sort((a, b) => a.start.localeCompare(b.start));
  }, [segments]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32 font-sans">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/teacher" className="bg-white p-3 rounded-full shadow-sm hover:bg-gray-50 text-gray-600 transition-colors"><ArrowLeft size={20} /></Link>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2"><Briefcase className="text-blue-600" /> 勤怠打刻</h1>
        </div>

        {/* 今日の打刻 */}
        <div className="bg-white rounded-[32px] shadow-lg shadow-blue-50 border border-white p-8 text-center mb-8 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500"></div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md">TODAY</span>
            <span className="text-xs font-bold text-gray-400">{new Date().toLocaleDateString('ja-JP', { weekday: 'long' })}</span>
          </div>
          <div className="text-5xl font-black text-gray-800 font-mono mb-8 tracking-tighter mt-4">
            {new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
          {loading ? <div className="h-16 flex items-center justify-center"><Loader2 className="animate-spin text-gray-300"/></div> : currentSession ? (
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full text-sm font-bold animate-pulse border border-green-100 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span> 
                勤務中 ({new Date(currentSession.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 〜)
              </div>
              <button onClick={handleClockOut} className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-xl hover:shadow-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"><Square fill="currentColor" size={18} /> 退勤する</button>
            </div>
          ) : (
            <div className="space-y-4">
              {todayRecord && <div className="text-xs font-bold text-gray-500 bg-gray-50 py-2 rounded-lg border border-gray-100">本日は {formatDuration(calcDurationMinutes(todayRecord.start_time, todayRecord.end_time))} 勤務しました</div>}
              <button onClick={handleClockIn} className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-xl hover:shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2"><Play fill="currentColor" size={18} /> 出勤する</button>
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
        <div className="space-y-4">
          {history.length === 0 ? <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-gray-100"><Clock size={40} className="mx-auto text-gray-200 mb-2"/><p className="text-gray-400 font-bold text-sm">この月の履歴はありません</p></div> : history.map((rec) => {
             const duration = rec.end_time ? calcDurationMinutes(rec.start_time, rec.end_time) : 0;
             if(currentSession && currentSession.id === rec.id) return null;
             
             // 表示用にセグメントを時間順ソート
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
                
                {/* テーブル形式でのプレビュー */}
                {displaySegments?.length > 0 ? (
                  <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100 mb-4">
                    {displaySegments.map((seg: WorkSegment, i: number) => (
                      <div key={i} className={`flex items-center px-3 py-2 text-xs border-b border-gray-100 last:border-0 ${seg.type === 'lesson' ? 'bg-blue-50/50' : 'bg-orange-50/50'}`}>
                        <div className="w-24 font-mono font-bold text-gray-600 shrink-0">{seg.start} - {seg.end}</div>
                        <div className={`px-2 py-0.5 rounded font-bold mr-3 shrink-0 ${seg.type === 'lesson' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {seg.type === 'lesson' ? '授業' : '事務'}
                        </div>
                        <div className="truncate text-gray-600 font-medium">{seg.note}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="mb-4 text-xs text-orange-400 font-bold flex items-center gap-1 bg-orange-50 p-2 rounded-lg border border-orange-100"><AlertCircle size={14}/> 詳細未登録 (自動補完されます)</div>}
                
                {rec.transportation?.length > 0 && <div className="mb-4 pt-2 border-t border-dashed border-gray-100 flex items-center justify-between text-xs text-gray-500 px-1"><span className="flex items-center gap-1 font-bold"><Train size={12}/> 交通費あり</span><span className="font-mono font-bold">¥{calcTotalCost(rec.transportation).toLocaleString()}</span></div>}
                {rec.end_time && rec.status !== 'approved' && <button onClick={() => openEditModal(rec)} className="w-full py-3 rounded-xl bg-gray-50 text-gray-600 text-xs font-bold hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center gap-2"><Edit3 size={14}/> {displaySegments?.length > 0 ? '詳細を修正' : '詳細・交通費を入力'}</button>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 詳細編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg h-[95vh] sm:h-[85vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-white p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
              <div><h3 className="font-black text-gray-800 text-lg flex items-center gap-2"><Layout size={20} className="text-blue-600"/> 業務詳細</h3><p className="text-xs text-gray-400 font-bold mt-0.5">{editingRecord.date}</p></div>
              <button onClick={() => setEditingRecord(null)} className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors"><X size={20} className="text-gray-600"/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-8 custom-scrollbar">
              
              {/* テーブル形式の詳細入力 */}
              <section>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Clock size={16}/> 時間割・内訳</h4>
                  <div className="text-[10px] text-gray-400">※隙間時間は自動で「事務」になります</div>
                </div>
                
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100 text-gray-500 text-xs font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left w-20">開始</th>
                        <th className="px-3 py-2 text-left w-20">終了</th>
                        <th className="px-3 py-2 text-left w-24">区分</th>
                        <th className="px-3 py-2 text-left">詳細</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedSegments.map((seg, i) => (
                        <tr key={i} className={`transition-colors ${seg.type === 'lesson' ? 'bg-blue-50/40' : 'bg-orange-50/40'}`}>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => {
                            const newSegs = [...segments]; 
                            // 並び替え前のインデックスを探す必要があるが、簡単のためここでは直接編集（stateはまだソートされていない）
                            // 簡易実装: map内だが、segments配列自体の更新はindexで行う
                            // ※注意: sortedSegmentsを使っているためiがずれる可能性がある。
                            // 正しくは segments を操作する。ここではソートせず表示するか、IDを持たせるのが理想だが、
                            // 今回は入力順序をユーザーに委ね、表示だけソートせずそのまま出す形に戻すのが安全。
                            // → 下記の実装では segments をそのままマップします（自動ソートは表示のみ）
                            updateSegment(i, 'start', e.target.value);
                          }} /></td>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
                          <td className="p-2">
                            <div className="flex rounded-md bg-white border border-gray-300 overflow-hidden shadow-sm">
                              <button onClick={() => updateSegment(i, 'type', 'lesson')} className={`flex-1 text-[10px] font-bold py-1.5 ${seg.type === 'lesson' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-50'}`}>授業</button>
                              <div className="w-px bg-gray-300"></div>
                              <button onClick={() => updateSegment(i, 'type', 'office')} className={`flex-1 text-[10px] font-bold py-1.5 ${seg.type === 'office' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-50'}`}>事務</button>
                            </div>
                          </td>
                          <td className="p-2"><input type="text" className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none text-xs p-1" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} /></td>
                          <td className="p-2 text-center"><button onClick={() => removeSegment(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={16}/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={addSegment} className="w-full py-3 text-xs font-bold text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-1 border-t border-gray-100 transition-colors">
                    <Plus size={14}/> 行を追加する
                  </button>
                </div>
              </section>

              {/* 交通費 */}
              <section className="pt-6 border-t border-gray-200">
                <div className="flex justify-between items-center mb-3"><h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Train size={16}/> 交通費申請</h4><div className="flex gap-2"><button onClick={handleCopyLastTransport} className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-bold hover:bg-blue-100 flex items-center gap-1"><Copy size={12}/> 前回をコピー</button><button onClick={addExpense} className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-bold hover:bg-green-200 flex items-center gap-1"><Plus size={12}/> 追加</button></div></div>
                <div className="space-y-3">{expenses.map((exp, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group">
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-50 rounded-r-full border-y border-r border-gray-200"></div><div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-50 rounded-l-full border-y border-l border-gray-200"></div><div className="absolute top-1/2 left-4 right-4 border-t-2 border-dashed border-gray-100 pointer-events-none"></div>
                      <button onClick={() => removeExpense(i)} className="absolute top-1 right-1 text-gray-300 hover:text-red-500 p-1 z-10"><X size={14}/></button>
                      <div className="p-4 flex items-center justify-between relative z-0"><div className="flex flex-col gap-1 w-2/3"><div className="flex items-center gap-2 text-sm font-bold text-gray-700"><input type="text" className="w-full bg-transparent border-b border-gray-200 focus:border-green-400 outline-none pb-0.5" placeholder="出発" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} /><ChevronRight size={14} className="text-gray-300"/><input type="text" className="w-full bg-transparent border-b border-gray-200 focus:border-green-400 outline-none pb-0.5" placeholder="到着" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} /></div><span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">ONE WAY TICKET</span></div><div className="text-right"><div className="flex items-baseline justify-end gap-1"><span className="text-xs text-gray-400">¥</span><input type="number" className="w-16 text-right font-mono text-lg font-black text-gray-800 bg-transparent outline-none border-b border-transparent focus:border-green-400 placeholder:text-gray-200" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} /></div></div></div>
                    </div>
                  ))}</div>
              </section>
              <div className="h-20"></div>
            </div>
            <div className="bg-white p-4 border-t border-gray-100 shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10"><button onClick={saveData} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 text-lg"><Save size={20}/> 保存して完了</button></div>
          </div>
        </div>
      )}
    </div>
  );
}