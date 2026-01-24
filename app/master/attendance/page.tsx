'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, deleteDoc, limit } from 'firebase/firestore';
import { 
  Briefcase, ArrowLeft, CheckCircle, Edit, Trash2, Search, Filter, Save, X, Plus, Train, Download, 
  Loader2, Clock, Layout, Copy, AlertCircle, ChevronRight 
} from 'lucide-react';
import Link from 'next/link';

interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office';
  note: string;
  isAuto?: boolean;
}

interface Transportation {
  from: string;
  to: string;
  cost: number | string;
}

export default function MasterAttendancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [usersMap, setUsersMap] = useState<{[key:string]: string}>({}); 
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterName, setFilterName] = useState('');

  // 編集用ステート
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
  // 親レコードの編集用
  const [mainTime, setMainTime] = useState({ start: '', end: '' });

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [filterMonth]);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'));
      const snap = await getDocs(q);
      const map: {[key:string]: string} = {};
      snap.forEach(doc => {
        const d = doc.data();
        map[doc.id] = d.name || d.student_name || d.displayName || '名称未設定';
      });
      setUsersMap(map);
    } catch (e) {
      console.error("Users fetch error:", e);
    }
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const [y, m] = filterMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const start = `${filterMonth}-01`;
      const end = `${filterMonth}-${lastDay}`;

      const q = query(
        collection(db, 'work_records'), 
        where('date', '>=', start), 
        where('date', '<=', end), 
        orderBy('date', 'desc'), 
        orderBy('start_time', 'desc')
      );
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      const q2 = query(collection(db, 'work_records'), orderBy('created_at', 'desc'));
      const snap2 = await getDocs(q2);
      setRecords(snap2.docs.map(d => ({ id: d.id, ...d.data() })).filter((r: any) => r.date.startsWith(filterMonth)));
    } finally {
      setLoading(false);
    }
  };

  // --- アクション ---
  const handleApprove = async (id: string) => {
    if (!confirm('承認しますか？')) return;
    await updateDoc(doc(db, 'work_records', id), { status: 'approved' });
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？')) return;
    await deleteDoc(doc(db, 'work_records', id));
    setRecords(prev => prev.filter(r => r.id !== id));
  };

  // --- モーダル操作 ---
  const openEditor = (rec: any) => {
    setEditingRecord(rec);
    
    // 時間の初期値
    const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('sv').slice(0, 16).replace(' ', 'T') : '';
    setMainTime({ start: fmt(rec.start_time), end: fmt(rec.end_time) });

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
  const addSegment = () => setSegments([...segments, { start: '', end: '', type: 'lesson', note: '' }]);
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
      const q = query(
        collection(db, 'work_records'),
        where('teacher_id', '==', editingRecord.teacher_id),
        orderBy('created_at', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      const lastRecord = snap.docs
        .map(d => d.data())
        .find((d: any) => d.transportation && d.transportation.length > 0 && d.id !== editingRecord.id);

      if (lastRecord) {
        if(confirm(`この講師の ${lastRecord.date} の交通費情報をコピーしますか？`)) {
          setExpenses(lastRecord.transportation);
        }
      } else { alert('過去の交通費データが見つかりませんでした'); }
    } catch (e) { console.error(e); }
  };

  // ★隙間を埋める処理（管理者用）
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
    const startMin = shiftStart.getHours() * 60 + shiftStart.getMinutes();
    const endMin = shiftEnd.getHours() * 60 + shiftEnd.getMinutes();

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
          type: 'office',
          note: '事務(自動補完)',
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
        type: 'office',
        note: '事務(自動補完)',
        isAuto: true
      });
    }

    return result;
  };

  const saveAll = async () => {
    if (!editingRecord) return;
    try {
      const ref = doc(db, 'work_records', editingRecord.id);
      
      const newStart = mainTime.start ? new Date(mainTime.start).toISOString() : editingRecord.start_time;
      const newEnd = mainTime.end ? new Date(mainTime.end).toISOString() : null;

      // 自動補完ロジック
      const filledSegments = fillGaps(segments, newStart, newEnd);

      const formattedExpenses = expenses.map(e => ({ ...e, cost: Number(e.cost) }));

      await updateDoc(ref, { 
        start_time: newStart,
        end_time: newEnd,
        work_segments: filledSegments,
        transportation: formattedExpenses
      });

      setRecords(prev => prev.map(r => r.id === editingRecord.id ? { 
        ...r, 
        start_time: newStart, 
        end_time: newEnd, 
        work_segments: filledSegments, 
        transportation: formattedExpenses 
      } : r));
      
      setEditingRecord(null);
      alert('保存しました。\n未入力の時間は自動的に「事務」として登録されました。');
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // --- 計算ロジック ---
  const calcDuration = (start: string, end: string) => {
    if (!start || !end) return '...';
    const s = new Date(start);
    const e = new Date(end);
    if(isNaN(s.getTime()) || isNaN(e.getTime())) return 'Error';
    const diff = e.getTime() - s.getTime();
    if(diff < 0) return 'Error';
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${h}h ${m}m`;
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + Number(item.cost), 0) : 0;

  // CSV出力
  const downloadCSV = () => {
    if (filteredRecords.length === 0) return alert('出力するデータがありません');
    const header = [
      '日付', '名前', 'オンライン授業(開始)', 'オンライン授業(終了)', 
      '事務・サポート(開始)', '事務・サポート(終了)', 
      '授業時間(分)', '事務時間(分)', '交通費(区間)', '交通費(金額)'
    ].join(',');

    const rows = filteredRecords.map(rec => {
      const teacherName = usersMap[rec.teacher_id] || rec.teacher_name;

      const lessonSegs = rec.work_segments?.filter((s: any) => s.type === 'lesson') || [];
      const officeSegs = rec.work_segments?.filter((s: any) => s.type === 'office') || [];

      const getDuration = (segs: any[]) => segs.reduce((acc, s) => {
        if(!s.start || !s.end) return acc;
        const [sh, sm] = s.start.split(':').map(Number);
        const [eh, em] = s.end.split(':').map(Number);
        return acc + ((eh * 60 + em) - (sh * 60 + sm));
      }, 0);

      const transportRoute = rec.transportation?.map((t: any) => `${t.from}-${t.to}`).join(' / ') || '';
      const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;

      return [
        rec.date,
        escape(teacherName),
        escape(lessonSegs.map((s:any)=>s.start).join('\n')), escape(lessonSegs.map((s:any)=>s.end).join('\n')),
        escape(officeSegs.map((s:any)=>s.start).join('\n')), escape(officeSegs.map((s:any)=>s.end).join('\n')),
        getDuration(lessonSegs), getDuration(officeSegs),
        escape(transportRoute), calcTotalCost(rec.transportation)
      ].join(',');
    });

    const blob = new Blob(["\uFEFF" + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `勤怠詳細_${filterMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredRecords = records.filter(r => {
    const name = usersMap[r.teacher_id] || r.teacher_name;
    return name.includes(filterName);
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-40 font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600"><ArrowLeft size={24} /></Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Briefcase className="text-indigo-600" /> 勤怠管理・承認</h1>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
            <Filter size={16} className="text-gray-400"/>
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-transparent font-bold text-gray-700 outline-none" />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
            <input type="text" placeholder="講師名で検索" className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48" value={filterName} onChange={e => setFilterName(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-3">
             <div className="text-sm text-gray-500 font-bold">合計: {filteredRecords.length} 件</div>
             <button onClick={downloadCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-green-700 transition-colors shadow-sm">
                <Download size={16}/> CSV出力
             </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 font-bold border-b">
              <tr>
                <th className="p-4">日付</th>
                <th className="p-4">講師名</th>
                <th className="p-4">出退勤</th>
                <th className="p-4">詳細 (内訳・交通費)</th>
                <th className="p-4">実働</th>
                <th className="p-4 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map(rec => {
                const displayName = usersMap[rec.teacher_id] || rec.teacher_name;
                // 表示用にセグメントをソート
                const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));

                return (
                  <tr key={rec.id} className="hover:bg-gray-50">
                    <td className="p-4 whitespace-nowrap">{rec.date}</td>
                    <td className="p-4 font-bold">{displayName}</td>
                    <td className="p-4 whitespace-nowrap font-mono text-gray-600">
                      {rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--'} - 
                      {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--'}
                    </td>
                    <td className="p-4">
                      {displaySegments?.length > 0 ? (
                        <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                          {displaySegments.map((seg: any, i: number) => (
                            <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 border-b border-gray-100 last:border-0 ${seg.type === 'lesson' ? 'bg-blue-50/50' : 'bg-orange-50/50'}`}>
                              <span className="font-mono text-gray-500 font-bold">{seg.start}-{seg.end}</span>
                              <span className={`px-1.5 rounded text-[10px] font-bold ${seg.type === 'lesson' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                {seg.type === 'lesson' ? '授業' : '事務'}
                              </span>
                              <span className="text-gray-600 truncate max-w-[120px]">{seg.note}</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-xs text-gray-400">詳細なし</span>}
                      
                      {rec.transportation?.length > 0 && (
                        <div className="mt-1 pt-1 border-t border-dashed border-gray-300 text-xs text-green-700 font-bold">
                          交通費: ¥{calcTotalCost(rec.transportation).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-bold">{calcDuration(rec.start_time, rec.end_time)}</td>
                    <td className="p-4">
                      <div className="flex justify-center items-center gap-2">
                        {rec.status === 'approved' ? <span className="text-green-600 flex items-center gap-1 text-xs font-bold"><CheckCircle size={14}/> 承認済</span> : <button onClick={() => handleApprove(rec.id)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700 shadow">承認</button>}
                        <button onClick={() => openEditor(rec)} className="text-gray-400 hover:text-blue-600 p-1"><Edit size={16}/></button>
                        <button onClick={() => handleDelete(rec.id)} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 管理者用 編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold flex items-center gap-2"><Briefcase size={18}/> 勤怠データ編集</h3>
              <button onClick={() => setEditingRecord(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-8 custom-scrollbar">
              
              {/* 出退勤時間の編集 */}
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200">
                <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><Clock size={16}/> 出退勤時間</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400">出勤</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm font-mono font-bold" value={mainTime.start} onChange={e => setMainTime({...mainTime, start: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400">退勤</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm font-mono font-bold" value={mainTime.end} onChange={e => setMainTime({...mainTime, end: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* ★テーブル形式の詳細登録 */}
              <section>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Layout size={16}/> 時間割・内訳</h4>
                  <div className="text-[10px] text-gray-400">※隙間時間は自動で「事務」になります</div>
                </div>
                
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100 text-gray-500 text-xs font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left w-20">開始</th>
                        <th className="px-3 py-2 text-left w-20">終了</th>
                        <th className="px-3 py-2 text-left w-24">区分</th>
                        <th className="px-3 py-2 text-left">詳細内容</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {segments.map((seg, i) => (
                        <tr key={i} className={`transition-colors ${seg.type === 'lesson' ? 'bg-blue-50/40' : 'bg-orange-50/40'}`}>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} /></td>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
                          <td className="p-2">
                            <div className="flex rounded-md bg-white border border-gray-300 overflow-hidden shadow-sm">
                              <button onClick={() => updateSegment(i, 'type', 'lesson')} className={`flex-1 text-[10px] font-bold py-1 ${seg.type === 'lesson' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-100'}`}>授業</button>
                              <div className="w-px bg-gray-300"></div>
                              <button onClick={() => updateSegment(i, 'type', 'office')} className={`flex-1 text-[10px] font-bold py-1 ${seg.type === 'office' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-100'}`}>事務</button>
                            </div>
                          </td>
                          <td className="p-2"><input type="text" className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none text-xs p-1" placeholder="内容..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} /></td>
                          <td className="p-2 text-center"><button onClick={() => removeSegment(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={16}/></button></td>
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
            
            <div className="p-4 border-t bg-white shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10">
              <button onClick={saveAll} className="w-full bg-gray-900 text-white py-3.5 rounded-2xl font-bold hover:bg-gray-800 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 text-lg"><Save size={20}/> 変更を保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}