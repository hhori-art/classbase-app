'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import { Clock, CheckCircle, AlertCircle, Play, Square, History, Briefcase, ArrowLeft, Plus, Trash2, Save, X, Edit3, Train } from 'lucide-react';
import Link from 'next/link';

// 業務区分の型
interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office';
  note: string;
}

// 交通費の型
interface Transportation {
  from: string;
  to: string;
  cost: number;
}

export default function TeacherAttendancePage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  
  // 詳細編集用
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]); // 交通費State

  useEffect(() => {
    if (user) fetchStatus();
  }, [user]);

  const fetchStatus = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. 本日のデータ
      const qToday = query(
        collection(db, 'work_records'),
        where('teacher_id', '==', user?.uid),
        where('date', '==', todayStr)
      );
      const snapToday = await getDocs(qToday);
      
      let active = null;
      let finished = null;

      if (!snapToday.empty) {
        const data = { id: snapToday.docs[0].id, ...snapToday.docs[0].data() } as any;
        if (data.end_time === null) active = data;
        else finished = data;
      }
      
      setCurrentSession(active);
      setTodayRecord(finished);

      // 2. 履歴取得
      const qHistory = query(
        collection(db, 'work_records'),
        where('teacher_id', '==', user?.uid),
        orderBy('created_at', 'desc'),
        limit(30)
      );
      const snapHistory = await getDocs(qHistory);
      
      const activeId = active ? active.id : null;
      const list = snapHistory.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((d: any) => d.id !== activeId);

      setHistory(list);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClockIn = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const alreadyExists = history.some((h: any) => h.date === todayStr) || todayRecord;
    
    if (alreadyExists && !confirm('本日すでに勤務記録があります。もう一度出勤しますか？')) return;
    if (!alreadyExists && !confirm('出勤時刻を記録しますか？')) return;

    try {
      setLoading(true);
      await addDoc(collection(db, 'work_records'), {
        teacher_id: user?.uid,
        teacher_name: profile?.student_name || user?.displayName || '講師',
        date: todayStr,
        start_time: new Date().toISOString(),
        end_time: null,
        status: 'pending',
        work_segments: [],
        transportation: [], // 交通費初期化
        created_at: new Date().toISOString()
      });
      await fetchStatus();
    } catch (e: any) { alert('エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  const handleClockOut = async () => {
    if (!confirm('退勤しますか？\n業務詳細や交通費は後から「詳細登録」で入力してください。')) return;
    try {
      setLoading(true);
      const ref = doc(db, 'work_records', currentSession.id);
      await updateDoc(ref, {
        end_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      await fetchStatus();
      alert('退勤しました。\n下のリストから「詳細・区分登録」を行ってください。');
    } catch (e: any) { alert('エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  // 編集モード開始
  const openEditModal = (rec: any) => {
    setEditingRecord(rec);
    
    // 業務区分
    if (rec.work_segments && rec.work_segments.length > 0) {
      setSegments(rec.work_segments);
    } else {
      const startHm = rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      const endHm = rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      setSegments([{ start: startHm, end: endHm, type: 'lesson', note: '' }]);
    }

    // 交通費
    setExpenses(rec.transportation || []);
  };

  // 業務区分 操作
  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    newSegs[index] = { ...newSegs[index], [field]: value };
    setSegments(newSegs);
  };
  const addSegment = () => setSegments([...segments, { start: '', end: '', type: 'lesson', note: '' }]);
  const removeSegment = (index: number) => setSegments(segments.filter((_, i) => i !== index));

  // 交通費 操作
  const updateExpense = (index: number, field: keyof Transportation, value: string | number) => {
    const newExps = [...expenses];
    newExps[index] = { ...newExps[index], [field]: value };
    setExpenses(newExps);
  };
  const addExpense = () => setExpenses([...expenses, { from: '', to: '', cost: 0 }]);
  const removeExpense = (index: number) => setExpenses(expenses.filter((_, i) => i !== index));

  // 保存
  const saveData = async () => {
    if (!editingRecord) return;
    if (segments.some(s => !s.start || !s.end || !s.note)) {
      return alert('業務区分の時間と詳細をすべて入力してください。');
    }
    if (expenses.some(e => !e.from || !e.to || !e.cost)) {
      return alert('交通費の駅名と金額をすべて入力してください。');
    }

    try {
      await updateDoc(doc(db, 'work_records', editingRecord.id), {
        work_segments: segments,
        transportation: expenses,
        updated_at: new Date().toISOString()
      });
      alert('詳細情報を保存しました');
      setEditingRecord(null);
      fetchStatus();
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  const calcDuration = (start: string, end: string) => {
    if (!end) return '...';
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${h}時間${m}分`;
  };

  const calcTotalCost = (exps: Transportation[]) => {
    if (!exps) return 0;
    return exps.reduce((sum, item) => sum + Number(item.cost), 0);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/teacher" className="bg-white p-2 rounded-full shadow text-gray-600"><ArrowLeft size={20} /></Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Briefcase className="text-blue-600" /> 勤怠打刻
          </h1>
        </div>

        {/* 打刻エリア */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center mb-8">
          <p className="text-gray-500 mb-2">{new Date().toLocaleDateString('ja-JP', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <div className="text-4xl font-bold text-gray-800 font-mono mb-8">
            {new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>

          {currentSession ? (
            <div className="space-y-6">
              <div className="bg-green-50 text-green-700 px-4 py-2 rounded-full inline-flex items-center gap-2 font-bold animate-pulse">
                <Clock size={18} /> 勤務中 ({new Date(currentSession.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 〜)
              </div>
              <button onClick={handleClockOut} className="w-full bg-red-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95 flex items-center justify-center gap-2">
                <Square fill="currentColor" size={20} /> 退勤する
              </button>
            </div>
          ) : todayRecord ? (
            <div className="bg-gray-100 text-gray-500 py-6 rounded-xl font-bold border border-gray-200">
              本日の勤務は終了しました
            </div>
          ) : (
            <button onClick={handleClockIn} disabled={loading} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Play fill="currentColor" size={20} /> 出勤する
            </button>
          )}
        </div>

        {/* 履歴リスト */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
            <History size={18} className="text-gray-500"/>
            <h2 className="font-bold text-gray-700">勤務履歴 (直近30件)</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {history.map((rec) => (
              <div key={rec.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">{rec.date}</div>
                    <div className="font-bold text-gray-800 font-mono">
                      {new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - 
                      {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ' ...'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-gray-700">{calcDuration(rec.start_time, rec.end_time)}</div>
                    <div className="mt-1">
                      {rec.status === 'approved' ? (
                        <span className="text-[10px] flex items-center gap-1 text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle size={10}/> 承認済</span>
                      ) : (
                        <span className="text-[10px] flex items-center gap-1 text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full"><AlertCircle size={10}/> 承認待</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 詳細表示 */}
                <div className="bg-gray-50 rounded-lg p-2 space-y-1 mb-2">
                  {rec.work_segments?.length > 0 ? (
                    rec.work_segments.map((seg: WorkSegment, i: number) => (
                      <div key={i} className="text-xs flex items-center gap-2">
                        <span className="font-mono text-gray-500 w-20">{seg.start}-{seg.end}</span>
                        <span className={`px-1 rounded text-[10px] w-8 text-center ${seg.type === 'lesson' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{seg.type === 'lesson' ? '授業' : '事務'}</span>
                        <span className="text-gray-600 truncate flex-1">{seg.note}</span>
                      </div>
                    ))
                  ) : <div className="text-xs text-red-400"><AlertCircle size={12} className="inline"/> 詳細未登録</div>}
                  
                  {/* 交通費表示 */}
                  {rec.transportation?.length > 0 && (
                    <div className="border-t border-gray-200 mt-2 pt-1">
                      {rec.transportation.map((tp: Transportation, i: number) => (
                        <div key={i} className="text-xs flex items-center gap-2 text-gray-600">
                          <Train size={12} className="text-green-600"/>
                          <span className="flex-1">{tp.from} ↔ {tp.to}</span>
                          <span className="font-bold">¥{tp.cost}</span>
                        </div>
                      ))}
                      <div className="text-right text-xs font-bold text-gray-700 mt-1">
                        交通費計: ¥{calcTotalCost(rec.transportation)}
                      </div>
                    </div>
                  )}
                </div>

                {rec.end_time && rec.status !== 'approved' && (
                  <button onClick={() => openEditModal(rec)} className="w-full py-2 bg-white border border-blue-200 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-50 flex items-center justify-center gap-1">
                    <Edit3 size={14}/> 詳細・交通費登録
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 詳細編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold flex items-center gap-2"><Briefcase size={18}/> 業務詳細・交通費</h3>
              <button onClick={() => setEditingRecord(null)} className="hover:bg-white/20 p-1 rounded-full"><X size={20}/></button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-gray-50 space-y-6">
              
              {/* 業務区分セクション */}
              <section>
                <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><Clock size={14}/> 業務内訳 (時間割)</h4>
                <div className="space-y-3">
                  {segments.map((seg, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm space-y-2">
                      <div className="flex gap-2 items-center">
                        <input type="time" className="border rounded p-1 text-sm font-mono w-24" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} />
                        <span className="text-gray-400">~</span>
                        <input type="time" className="border rounded p-1 text-sm font-mono w-24" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} />
                        <button onClick={() => removeSegment(i)} className="ml-auto text-gray-400 hover:text-red-500 p-1"><Trash2 size={16}/></button>
                      </div>
                      <div className="flex gap-2">
                        <select className={`border rounded p-2 text-sm font-bold ${seg.type === 'lesson' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`} value={seg.type} onChange={(e) => updateSegment(i, 'type', e.target.value as any)}>
                          <option value="lesson">授業</option><option value="office">事務</option>
                        </select>
                        <input type="text" className="border rounded p-2 text-sm flex-1" placeholder="詳細" value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addSegment} className="w-full mt-3 py-2 border border-dashed border-gray-300 text-gray-500 rounded-lg text-xs font-bold hover:bg-white flex items-center justify-center gap-1">
                  <Plus size={14}/> 業務追加
                </button>
              </section>

              {/* 交通費セクション */}
              <section className="pt-4 border-t border-gray-200">
                <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><Train size={14}/> 交通費申請 (ある場合のみ)</h4>
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2 relative">
                      <button onClick={() => removeExpense(i)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                      <div className="flex items-center gap-2">
                        <input type="text" className="border rounded p-2 text-sm flex-1" placeholder="出発駅" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} />
                        <span className="text-gray-400">↔</span>
                        <input type="text" className="border rounded p-2 text-sm flex-1" placeholder="到着駅" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">往復金額:</span>
                        <input type="number" className="border rounded p-2 text-sm w-32" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                        <span className="text-sm text-gray-500">円</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addExpense} className="w-full mt-3 py-2 border border-dashed border-green-300 text-green-600 rounded-lg text-xs font-bold hover:bg-green-50 flex items-center justify-center gap-1">
                  <Plus size={14}/> 交通費を追加
                </button>
              </section>

            </div>

            <div className="p-4 border-t bg-white shrink-0">
              <button onClick={saveData} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg flex items-center justify-center gap-2">
                <Save size={18}/> 保存する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}