'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, deleteDoc } from 'firebase/firestore';
import { Briefcase, ArrowLeft, CheckCircle, Edit, Trash2, Search, Filter, Save, X, AlertTriangle, Plus, Clock, Train } from 'lucide-react';
import Link from 'next/link';

interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office';
  note: string;
}

interface Transportation {
  from: string;
  to: string;
  cost: number;
}

export default function MasterAttendancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterName, setFilterName] = useState('');

  // 時間編集用
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  
  // 詳細セグメント・交通費編集用
  const [isSegmentModalOpen, setIsSegmentModalOpen] = useState(false);
  const [editingSegmentsRecord, setEditingSegmentsRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);

  useEffect(() => {
    fetchRecords();
  }, [filterMonth]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const start = `${filterMonth}-01`;
      const end = `${filterMonth}-31`;
      const q = query(collection(db, 'work_records'), where('date', '>=', start), where('date', '<=', end), orderBy('date', 'desc'), orderBy('start_time', 'desc'));
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      if (records.length === 0) {
        const q2 = query(collection(db, 'work_records'), orderBy('created_at', 'desc'));
        const snap2 = await getDocs(q2);
        setRecords(snap2.docs.map(d => ({ id: d.id, ...d.data() })).filter((r: any) => r.date.startsWith(filterMonth)));
      }
    } finally {
      setLoading(false);
    }
  };

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

  // 時間編集
  const startEdit = (rec: any) => {
    setEditingId(rec.id);
    const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('sv').slice(0, 16).replace(' ', 'T') : '';
    setEditForm({ start: fmt(rec.start_time), end: fmt(rec.end_time) });
  };

  const saveEdit = async () => {
    try {
      const ref = doc(db, 'work_records', editingId!);
      const newStart = new Date(editForm.start).toISOString();
      const newEnd = editForm.end ? new Date(editForm.end).toISOString() : null;
      await updateDoc(ref, { start_time: newStart, end_time: newEnd });
      setRecords(prev => prev.map(r => r.id === editingId ? { ...r, start_time: newStart, end_time: newEnd } : r));
      setEditingId(null);
      alert('時間を修正しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  // 詳細・交通費編集
  const openSegmentEditor = (rec: any) => {
    setEditingSegmentsRecord(rec);
    setSegments(rec.work_segments || []);
    setExpenses(rec.transportation || []);
    setIsSegmentModalOpen(true);
  };

  const saveSegments = async () => {
    try {
      await updateDoc(doc(db, 'work_records', editingSegmentsRecord.id), { 
        work_segments: segments,
        transportation: expenses
      });
      setRecords(prev => prev.map(r => r.id === editingSegmentsRecord.id ? { ...r, work_segments: segments, transportation: expenses } : r));
      setIsSegmentModalOpen(false);
      alert('詳細情報を保存しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  // セグメント操作
  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    newSegs[index] = { ...newSegs[index], [field]: value };
    setSegments(newSegs);
  };
  const addSegment = () => setSegments([...segments, { start: '', end: '', type: 'lesson', note: '' }]);
  const removeSegment = (index: number) => setSegments(segments.filter((_, i) => i !== index));

  // 交通費操作
  const updateExpense = (index: number, field: keyof Transportation, value: string | number) => {
    const newExps = [...expenses];
    newExps[index] = { ...newExps[index], [field]: value };
    setExpenses(newExps);
  };
  const addExpense = () => setExpenses([...expenses, { from: '', to: '', cost: 0 }]);
  const removeExpense = (index: number) => setExpenses(expenses.filter((_, i) => i !== index));

  const calcDuration = (start: string, end: string) => {
    if (!end) return '...';
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${h}h ${m}m`;
  };

  const calcTotalCost = (exps: Transportation[]) => {
    return exps ? exps.reduce((sum, item) => sum + Number(item.cost), 0) : 0;
  };

  const filteredRecords = records.filter(r => r.teacher_name.includes(filterName));

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-40">
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
          <div className="ml-auto text-sm text-gray-500 font-bold">合計: {filteredRecords.length} 件</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 font-bold border-b">
              <tr>
                <th className="p-4">日付</th>
                <th className="p-4">講師名</th>
                <th className="p-4">時間 (出退勤)</th>
                <th className="p-4">詳細 (内訳・交通費)</th>
                <th className="p-4">実働</th>
                <th className="p-4 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map(rec => (
                <tr key={rec.id} className={`hover:bg-gray-50 ${editingId === rec.id ? 'bg-yellow-50' : ''}`}>
                  {editingId === rec.id ? (
                    // 時間編集モード
                    <>
                      <td className="p-4" colSpan={4}>
                        <div className="grid grid-cols-2 gap-4">
                          <div><span className="text-xs font-bold text-gray-500">出勤</span><input type="datetime-local" className="w-full border p-1 rounded" value={editForm.start} onChange={e => setEditForm({...editForm, start: e.target.value})} /></div>
                          <div><span className="text-xs font-bold text-gray-500">退勤</span><input type="datetime-local" className="w-full border p-1 rounded" value={editForm.end} onChange={e => setEditForm({...editForm, end: e.target.value})} /></div>
                        </div>
                      </td>
                      <td className="p-4 text-center" colSpan={2}>
                        <div className="flex gap-2 justify-center"><button onClick={saveEdit} className="bg-green-600 text-white p-2 rounded"><Save size={16}/></button><button onClick={() => setEditingId(null)} className="bg-gray-400 text-white p-2 rounded"><X size={16}/></button></div>
                      </td>
                    </>
                  ) : (
                    // 表示モード
                    <>
                      <td className="p-4 whitespace-nowrap">{rec.date}</td>
                      <td className="p-4 font-bold">{rec.teacher_name}</td>
                      <td className="p-4 whitespace-nowrap font-mono text-gray-600">
                        {new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - 
                        {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          {rec.work_segments?.map((seg: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-gray-500">{seg.start}-{seg.end}</span>
                              <span className={`px-1.5 rounded text-[10px] ${seg.type === 'lesson' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{seg.type === 'lesson' ? '授業' : '事務'}</span>
                              <span className="text-gray-600">{seg.note}</span>
                            </div>
                          ))}
                          
                          {/* 交通費表示 */}
                          {rec.transportation?.length > 0 && (
                            <div className="mt-2 pt-1 border-t border-dashed border-gray-300">
                              {rec.transportation.map((tp: any, i: number) => (
                                <div key={i} className="text-xs text-gray-600 flex gap-2">
                                  <Train size={12}/> {tp.from}↔{tp.to} (¥{tp.cost})
                                </div>
                              ))}
                              <div className="text-xs font-bold mt-1 text-green-700">交通費計: ¥{calcTotalCost(rec.transportation)}</div>
                            </div>
                          )}

                          <button onClick={() => openSegmentEditor(rec)} className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-1">
                            <Edit size={12}/> 詳細を編集
                          </button>
                        </div>
                      </td>
                      <td className="p-4 font-bold">{calcDuration(rec.start_time, rec.end_time)}</td>
                      <td className="p-4">
                        <div className="flex justify-center items-center gap-2">
                          {rec.status === 'approved' ? <span className="text-green-600 flex items-center gap-1 text-xs font-bold"><CheckCircle size={14}/> 承認済</span> : <button onClick={() => handleApprove(rec.id)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700 shadow">承認</button>}
                          <button onClick={() => startEdit(rec)} className="text-gray-400 hover:text-blue-600"><Edit size={16}/></button>
                          <button onClick={() => handleDelete(rec.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 管理者用 詳細編集モーダル */}
      {isSegmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold flex items-center gap-2"><Briefcase size={18}/> 詳細編集 (管理者)</h3>
              <button onClick={() => setIsSegmentModalOpen(false)} className="hover:bg-white/20 p-1 rounded-full"><X size={20}/></button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 bg-gray-50 space-y-6">
              
              {/* 業務区分 */}
              <section>
                <h4 className="text-xs font-bold text-gray-500 mb-2">業務内訳</h4>
                <div className="space-y-3">
                  {segments.map((seg, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm space-y-2">
                      <div className="flex gap-2 items-center">
                        <input type="time" className="border rounded p-1 text-sm w-24" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} />
                        <span>~</span>
                        <input type="time" className="border rounded p-1 text-sm w-24" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} />
                        <button onClick={() => removeSegment(i)} className="ml-auto text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                      </div>
                      <div className="flex gap-2">
                        <select className="border rounded p-2 text-sm" value={seg.type} onChange={(e) => updateSegment(i, 'type', e.target.value as any)}>
                          <option value="lesson">授業</option><option value="office">事務</option>
                        </select>
                        <input type="text" className="border rounded p-2 text-sm flex-1" value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addSegment} className="w-full mt-3 py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg text-xs font-bold hover:bg-white flex items-center justify-center gap-1"><Plus size={14}/> 業務追加</button>
              </section>

              {/* 交通費 */}
              <section className="pt-4 border-t border-gray-200">
                <h4 className="text-xs font-bold text-gray-500 mb-2">交通費</h4>
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2 relative">
                      <button onClick={() => removeExpense(i)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                      <div className="flex items-center gap-2">
                        <input type="text" className="border rounded p-2 text-sm flex-1" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} />
                        <span>↔</span>
                        <input type="text" className="border rounded p-2 text-sm flex-1" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">¥</span>
                        <input type="number" className="border rounded p-2 text-sm w-32" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addExpense} className="w-full mt-3 py-2 border-2 border-dashed border-green-300 text-green-600 rounded-lg text-xs font-bold hover:bg-green-50 flex items-center justify-center gap-1"><Plus size={14}/> 交通費追加</button>
              </section>

            </div>
            
            <div className="p-4 border-t bg-white shrink-0">
              <button onClick={saveSegments} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg flex items-center justify-center gap-2"><Save size={18}/> 保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}