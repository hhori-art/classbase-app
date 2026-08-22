'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { CalendarPlus, Trash2, ArrowLeft, Check, ChevronLeft, ChevronRight, X, Loader2, Clock, User, CheckSquare, MapPin } from 'lucide-react';
import Link from 'next/link';

// ロール定義
const ROLES = [
  { id: 'main', label: '講師 (授業)' },
  { id: 'sub', label: 'サポート (個別)' },
  { id: 'general', label: '全体サポート' },
  { id: 'office', label: '事務作業' }
];

const WORK_LOCATIONS = ['元町', '本山', '西神南', '姫路', '加古川', '明石'];

export default function TeacherShiftSubmissionPage() {
  const { user } = useAuth();
  
  // 提出済みデータ
  const [submittedShifts, setSubmittedShifts] = useState<any[]>([]);
  
  // フォーム状態
  const [form, setForm] = useState<{ 
    dates: string[], 
    timeType: 'preset' | 'custom', 
    timePreset: string, 
    timeCustomStart: string,
    timeCustomEnd: string,
    workplace: string,
    roles: string[] // 複数選択に変更
  }>({ 
    dates: [], 
    timeType: 'preset',
    timePreset: '19:00 - 22:00',
    timeCustomStart: '18:00',
    timeCustomEnd: '21:00',
    workplace: '元町',
    roles: ['main'] // デフォルトでメイン講師を選択
  });
  
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // シフト取得処理
  const fetchMyShifts = async () => {
    if (!user) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const q = query(
        collection(db, 'teacher_availability'),
        where('teacher_id', '==', user.uid),
        where('available_date', '>=', today)
      );
      const legacyQ = query(
        collection(db, 'teacher_availability'),
        where('user_id', '==', user.uid),
        where('available_date', '>=', today)
      );
      
      const [snapshot, legacySnapshot] = await Promise.all([getDocs(q), getDocs(legacyQ)]);
      const byId = new Map<string, any>();
      snapshot.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() }));
      legacySnapshot.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() }));
      const data = Array.from(byId.values());
      data.sort((a: any, b: any) => a.available_date.localeCompare(b.available_date));
      setSubmittedShifts(data);
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { 
    if(user) fetchMyShifts(); 
  }, [user]);

  const toggleDate = (dateStr: string) => {
    setForm(prev => {
      if (prev.dates.includes(dateStr)) {
        return { ...prev, dates: prev.dates.filter(d => d !== dateStr) };
      } else {
        return { ...prev, dates: [...prev.dates, dateStr].sort() };
      }
    });
  };

  // 役割トグル
  const toggleRole = (roleId: string) => {
    setForm(prev => {
      if (prev.roles.includes(roleId)) {
        // 最低1つは選択必須にするなら length check
        return { ...prev, roles: prev.roles.filter(r => r !== roleId) };
      } else {
        return { ...prev, roles: [...prev.roles, roleId] };
      }
    });
  };

  // 一括提出処理
  const handleSubmit = async () => {
    if (form.dates.length === 0) return alert('日付を1つ以上選択してください');
    if (form.roles.length === 0) return alert('希望役割を1つ以上選択してください');
    const workplace = form.workplace;
    if (!workplace) return alert('勤務地を選択または入力してください');
    
    // 時間文字列の生成
    let finalTime = form.timePreset;
    if (form.timeType === 'custom') {
      if (!form.timeCustomStart || !form.timeCustomEnd) return alert('開始・終了時間を入力してください');
      finalTime = `${form.timeCustomStart} - ${form.timeCustomEnd}`;
    }

    // 役割ラベルの生成
    const roleLabels = form.roles.map(r => ROLES.find(item => item.id === r)?.label).filter(Boolean).join(' / ');
    const note = `希望: ${roleLabels}`;

    if (!confirm(`${form.dates.length}件のシフトを一括提出しますか？\n勤務地: ${workplace}\n時間: ${finalTime}\n役割: ${roleLabels}`)) return;
    
    setLoading(true);
    if (!user) return;

    try {
      const batch = writeBatch(db);

      form.dates.forEach(date => {
        const newRef = doc(collection(db, 'teacher_availability'));
        batch.set(newRef, {
          teacher_id: user.uid,
          user_id: user.uid,
          teacher_name: user.displayName || '講師',
          available_date: date,
          time_range: finalTime,
          workplace,
          location: workplace,
          note: note, // 複数役割を結合して保存
          roles: form.roles, // 後で集計しやすいように配列も保存（推奨）
          status: 'possible',
          created_by: user.uid,
          created_at: new Date().toISOString()
        });
      });

      await batch.commit();
      await fetchMyShifts();
      setForm({ ...form, dates: [] });
      alert('提出しました！');

    } catch (error: any) {
      alert('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if(!confirm('このシフト希望を取り消しますか？')) return;
    try {
      await deleteDoc(doc(db, 'teacher_availability', id));
      setSubmittedShifts(prev => prev.filter(item => item.id !== id));
    } catch (e: any) {
      alert('削除エラー: ' + e.message);
    }
  };

  // カレンダーロジック
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  
  const getShiftOnDate = (d: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return submittedShifts.find(item => item.available_date === dateStr);
  };

  if (dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 pb-32 font-sans">
      <div className="max-w-5xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          {/* ★修正: リンク先を /teacher から /teacher/work に変更 */}
          <Link href="/teacher/work" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <CalendarPlus className="text-green-600" /> シフト希望提出
          </h1>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          
          {/* 左カラム: カレンダー */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><ChevronLeft/></button>
              <h2 className="text-xl font-bold text-gray-800">{year}年 {month + 1}月</h2>
              <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><ChevronRight/></button>
            </div>
            
            <div className="grid grid-cols-7 gap-2 text-center mb-2">
              {['日','月','火','水','木','金','土'].map((d, i) => (
                <div key={d} className={`text-xs font-bold ${i===0 ? 'text-red-400' : i===6 ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {days.map((d, i) => {
                if (!d) return <div key={i} className="aspect-square"></div>;
                
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const isSelected = form.dates.includes(dateStr);
                const existingShift = getShiftOnDate(d as number);
                const isToday = new Date().toISOString().split('T')[0] === dateStr;
                const isPast = dateStr < new Date().toISOString().split('T')[0];

                return (
                  <button
                    key={i}
                    onClick={() => toggleDate(dateStr)}
                    disabled={!!existingShift || isPast}
                    className={`
                      relative aspect-square rounded-xl text-sm font-bold flex flex-col items-center justify-center transition-all duration-200
                      ${isPast ? 'opacity-30 cursor-not-allowed bg-gray-50' : ''}
                      ${isSelected ? 'bg-green-600 text-white shadow-lg shadow-green-200 scale-105 z-10' : 'bg-gray-50 text-gray-700 hover:bg-white hover:shadow-md hover:scale-105'}
                      ${existingShift ? 'bg-blue-50 border-2 border-blue-100 text-blue-400 cursor-default hover:scale-100 hover:shadow-none opacity-80' : ''}
                      ${isToday && !isSelected && !existingShift ? 'ring-2 ring-blue-400 ring-offset-2' : ''}
                    `}
                  >
                    <span>{d}</span>
                    {existingShift && <span className="text-[10px] font-normal">済</span>}
                    {isSelected && <Check size={14} className="absolute top-1 right-1"/>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-center text-gray-400 mt-6 bg-gray-50 py-2 rounded">
              日付をタップして選択 → 右側で設定して「一括提出」
            </p>
          </div>

          {/* 右カラム: フォーム & リスト */}
          <div className="space-y-6">
            
            {/* 一括登録フォーム */}
            <div className="bg-white p-6 rounded-xl shadow-sm border-t-4 border-green-500 relative overflow-hidden">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Check className="text-green-600 bg-green-100 p-1 rounded-full" size={20}/> 一括登録設定
              </h2>
              
              <div className="space-y-6">
                
                {/* 選択中の日付 */}
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <label className="text-xs font-bold text-gray-500">
                      選択中の日付 <span className="text-green-600">({form.dates.length}日)</span>
                    </label>
                    {form.dates.length > 0 && (
                      <button onClick={() => setForm({...form, dates: []})} className="text-[10px] text-red-400 hover:underline">全解除</button>
                    )}
                  </div>
                  
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 min-h-[60px] max-h-[100px] overflow-y-auto flex flex-wrap gap-2 content-start custom-scrollbar">
                    {form.dates.length > 0 ? (
                      form.dates.map(date => (
                        <span key={date} className="bg-white text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold flex items-center gap-1 shadow-sm">
                          {new Date(date).getDate()}日
                          <button onClick={() => toggleDate(date)} className="text-gray-400 hover:text-red-500"><X size={12}/></button>
                        </span>
                      ))
                    ) : <span className="text-xs text-gray-400 w-full text-center py-2">左のカレンダーから選択</span>}
                  </div>
                </div>

                {/* 勤務地 */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><MapPin size={12}/> 勤務地</label>
                  <select
                    className="w-full p-3 border rounded-xl bg-white font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none text-sm"
                    value={form.workplace}
                    onChange={e => setForm({...form, workplace: e.target.value})}
                  >
                    {WORK_LOCATIONS.map(location => <option key={location}>{location}</option>)}
                  </select>
                </div>

                {/* 時間設定 (タブ切り替え) */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><Clock size={12}/> 時間帯</label>
                  <div className="flex bg-gray-100 p-1 rounded-lg mb-3">
                    <button 
                      onClick={() => setForm({...form, timeType: 'preset'})}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${form.timeType === 'preset' ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      選択
                    </button>
                    <button 
                      onClick={() => setForm({...form, timeType: 'custom'})}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${form.timeType === 'custom' ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      自由入力
                    </button>
                  </div>

                  {form.timeType === 'preset' ? (
                    <select 
                      className="w-full p-3 border rounded-xl bg-white font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none text-sm"
                      value={form.timePreset}
                      onChange={e => setForm({...form, timePreset: e.target.value})}
                    >
                      <option>19:00 - 22:00</option>
                      <option>19:00 - 20:30</option>
                      <option>20:30 - 22:00</option>
                      <option>18:00 - 22:00</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input 
                        type="time" 
                        className="flex-1 p-3 border rounded-xl bg-white font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none text-sm text-center"
                        value={form.timeCustomStart}
                        onChange={e => setForm({...form, timeCustomStart: e.target.value})}
                      />
                      <span className="text-gray-400 font-bold">~</span>
                      <input 
                        type="time" 
                        className="flex-1 p-3 border rounded-xl bg-white font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none text-sm text-center"
                        value={form.timeCustomEnd}
                        onChange={e => setForm({...form, timeCustomEnd: e.target.value})}
                      />
                    </div>
                  )}
                </div>

                {/* 役割 (複数選択) */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><User size={12}/> 希望役割 (複数選択可)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLES.map(role => {
                      const isChecked = form.roles.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          onClick={() => toggleRole(role.id)}
                          className={`
                            flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-bold transition-all text-left
                            ${isChecked 
                              ? 'bg-green-50 border-green-500 text-green-700 shadow-sm' 
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}
                          `}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white'}`}>
                            {isChecked && <Check size={10} strokeWidth={4}/>}
                          </div>
                          {role.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button 
                  onClick={handleSubmit} 
                  disabled={loading || form.dates.length === 0 || form.roles.length === 0}
                  className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-gray-800 shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  {loading ? <Loader2 className="animate-spin"/> : <CalendarPlus size={18} />} 
                  一括提出する
                </button>
              </div>
            </div>

            {/* 提出済みリスト */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <h3 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                 <CheckSquare size={16}/> 提出済みのシフト
               </h3>
               <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                 {submittedShifts.map(item => (
                   <div key={item.id} className="flex justify-between items-center text-sm p-3 bg-gray-50 rounded-lg border border-transparent hover:border-blue-200 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className="bg-white border border-gray-200 w-10 h-10 rounded-lg flex flex-col items-center justify-center shadow-sm shrink-0">
                           <span className="text-[9px] text-gray-400 leading-none">{new Date(item.available_date).getMonth()+1}/</span>
                           <span className="text-sm font-bold text-gray-800 leading-none">{new Date(item.available_date).getDate()}</span>
                        </div>
                        <div className="min-w-0">
                           <div className="text-xs font-bold text-gray-800 flex items-center gap-1">
                             <Clock size={10} className="text-gray-400"/> {item.time_range}
                           </div>
                           <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                             <MapPin size={10} className="text-gray-400"/> {item.workplace || item.location || '勤務地未設定'}
                           </div>
                           <div className="text-[10px] text-gray-500 truncate mt-0.5">{item.note}</div>
                        </div>
                      </div>
                      <button onClick={() => handleDelete(item.id)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors">
                        <Trash2 size={16}/>
                      </button>
                   </div>
                 ))}
                 {submittedShifts.length === 0 && (
                   <div className="text-center py-8 text-gray-400 text-xs border-2 border-dashed border-gray-100 rounded-lg">
                     まだシフト希望がありません
                   </div>
                 )}
               </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
