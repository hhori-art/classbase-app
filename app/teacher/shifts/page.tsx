'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext'; // Firebase Authを使用
import { db } from '@/lib/firebase'; // Firestoreを使用
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { CalendarPlus, Trash2, ArrowLeft, Check, ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function TeacherShiftSubmissionPage() {
  const { user } = useAuth();
  
  // 提出済みデータ
  const [submittedShifts, setSubmittedShifts] = useState<any[]>([]);
  
  // フォーム状態 (複数選択対応)
  const [form, setForm] = useState<{ dates: string[], time: string, role: string }>({ 
    dates: [], 
    time: '19:00 - 22:00',
    role: 'main'
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
        where('user_id', '==', user.uid),
        where('available_date', '>=', today)
      );
      
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 日付順にソート
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

  // 日付の選択/解除 (トグル処理)
  const toggleDate = (dateStr: string) => {
    setForm(prev => {
      if (prev.dates.includes(dateStr)) {
        // 解除
        return { ...prev, dates: prev.dates.filter(d => d !== dateStr) };
      } else {
        // 追加してソート
        return { ...prev, dates: [...prev.dates, dateStr].sort() };
      }
    });
  };

  // 一括提出処理
  const handleSubmit = async () => {
    if (form.dates.length === 0) return alert('日付を1つ以上選択してください');
    if (!confirm(`${form.dates.length}件のシフトを一括提出しますか？`)) return;
    
    setLoading(true);
    if (!user) return;

    try {
      const roleLabel = form.role === 'main' ? '希望:講師' : form.role === 'sub' ? '希望:サポート' : '希望:全体';
      const batch = writeBatch(db);

      // まとめてデータ作成 (Batch Writeは一度に500件までだが、シフト登録なら通常問題ない)
      form.dates.forEach(date => {
        // 新しいドキュメント参照を作成
        const newRef = doc(collection(db, 'teacher_availability'));
        batch.set(newRef, {
          user_id: user.uid,
          teacher_name: user.displayName || '講師', // 名前も保存しておくと便利
          available_date: date,
          time_range: form.time,
          note: roleLabel,
          created_at: new Date().toISOString()
        });
      });

      await batch.commit();
      
      await fetchMyShifts();
      setForm({ ...form, dates: [] }); // 選択クリア
      alert('提出しました！');

    } catch (error: any) {
      alert('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 削除処理
  const handleDelete = async (id: string) => {
    if(!confirm('このシフト希望を取り消しますか？')) return;
    try {
      await deleteDoc(doc(db, 'teacher_availability', id));
      // ローカルStateからも削除して即時反映
      setSubmittedShifts(prev => prev.filter(item => item.id !== id));
    } catch (e: any) {
      alert('削除エラー: ' + e.message);
    }
  };

  // --- カレンダーロジック ---
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
  
  // その日に提出済みシフトがあるか確認
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
    <div className="min-h-screen bg-gray-100 p-6 pb-32">
      <div className="max-w-5xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/teacher" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <CalendarPlus className="text-green-600" /> シフト希望提出 (一括)
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
                
                // 過去日は選択不可にする判定
                const isPast = dateStr < new Date().toISOString().split('T')[0];

                return (
                  <button
                    key={i}
                    onClick={() => toggleDate(dateStr)}
                    disabled={!!existingShift || isPast} // 提出済み or 過去日は無効
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
            <div className="bg-white p-6 rounded-xl shadow-sm border-t-4 border-green-500">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Check className="text-green-600 bg-green-100 p-1 rounded-full" size={24}/> 一括登録設定
              </h2>
              
              <div className="space-y-5">
                
                {/* 選択中の日付リスト */}
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <label className="text-xs font-bold text-gray-500">
                      選択中の日付 <span className="text-green-600">({form.dates.length}日)</span>
                    </label>
                    {form.dates.length > 0 && (
                      <button onClick={() => setForm({...form, dates: []})} className="text-[10px] text-red-400 hover:underline">全解除</button>
                    )}
                  </div>
                  
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 min-h-[80px] max-h-[120px] overflow-y-auto flex flex-wrap gap-2 content-start transition-all">
                    {form.dates.length > 0 ? (
                      form.dates.map(date => (
                        <span key={date} className="bg-white text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold flex items-center gap-1 shadow-sm animate-in fade-in zoom-in duration-200">
                          {new Date(date).getDate()}日
                          <button onClick={() => toggleDate(date)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-0.5"><X size={12}/></button>
                        </span>
                      ))
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs italic">
                        カレンダーから日付を選択してください
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">時間帯</label>
                    <select 
                      className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none"
                      value={form.time}
                      onChange={e => setForm({...form, time: e.target.value})}
                    >
                      <option>19:00 - 22:00</option>
                      <option>19:00 - 20:30 (1限のみ)</option>
                      <option>20:30 - 22:00 (2限のみ)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">希望役割</label>
                    <select 
                      className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-gray-700 focus:ring-2 focus:ring-green-500 outline-none"
                      value={form.role}
                      onChange={e => setForm({...form, role: e.target.value})}
                    >
                      <option value="main">講師 (授業担当)</option>
                      <option value="sub">サポート (個別対応)</option>
                      <option value="general">全体サポート (電話等)</option>
                    </select>
                  </div>
                </div>

                <button 
                  onClick={handleSubmit} 
                  disabled={loading || form.dates.length === 0}
                  className="w-full bg-green-600 text-white py-4 rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  {loading ? <Loader2 className="animate-spin"/> : <CalendarPlus size={20} />} 
                  {form.dates.length}件を一括提出する
                </button>
              </div>
            </div>

            {/* 提出済みリスト */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <h3 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                 提出済みのシフト <span className="bg-gray-100 px-2 py-0.5 rounded text-xs text-gray-500">{submittedShifts.length}件</span>
               </h3>
               <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                 {submittedShifts.map(item => (
                   <div key={item.id} className="flex justify-between items-center text-sm p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors group border border-transparent hover:border-blue-100">
                      <div className="flex items-center gap-3">
                        <div className="bg-white border border-gray-200 w-10 h-10 rounded-lg flex flex-col items-center justify-center shadow-sm">
                           <span className="text-[10px] text-gray-400 leading-none">{new Date(item.available_date).getMonth()+1}/</span>
                           <span className="text-sm font-bold text-gray-800 leading-none">{new Date(item.available_date).getDate()}</span>
                        </div>
                        <div>
                           <div className="text-xs font-bold text-gray-700">{item.time_range}</div>
                           <div className="text-[10px] text-gray-400">{item.note}</div>
                        </div>
                      </div>
                      <button onClick={() => handleDelete(item.id)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors">
                        <Trash2 size={16}/>
                      </button>
                   </div>
                 ))}
                 {submittedShifts.length === 0 && (
                   <div className="text-center py-8 text-gray-400 text-xs dashed border-2 border-gray-100 rounded-lg">
                     まだ提出されていません
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