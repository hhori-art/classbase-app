'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, where } from 'firebase/firestore';
import { 
  ArrowLeft, Video, Calendar as CalendarIcon, PlayCircle, Loader2, 
  ChevronLeft, ChevronRight, MonitorPlay, Filter, Atom, FlaskConical, 
  Leaf, Mountain, Globe, ScrollText, Landmark, X, Search
} from 'lucide-react';
import Link from 'next/link';

export default function StudentRecordingsPage() {
  const { user } = useAuth();
  const [allRecordings, setAllRecordings] = useState<any[]>([]);
  // フィルタリング（学年・単元）後のデータ
  const [filteredRecordings, setFilteredRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [gradeFilter, setGradeFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  
  // 検索用ステート
  const [searchQuery, setSearchQuery] = useState('');

  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const fetchRecordings = async () => {
      // 生徒ログイン時のみ取得（必要に応じて調整）
      if (!user) return; 

      try {
        // ★修正: 自動連携された 'shift_assignments' コレクションから取得
        // 録画URLが入っているデータのみを対象にしたいが、まずは日付順で取得してJS側でフィルタする
        const q = query(
          collection(db, 'shift_assignments'), 
          orderBy('target_date', 'desc')
        );
        const snapshot = await getDocs(q);
        
        const data = snapshot.docs
          .map(doc => {
            const d = doc.data();
            return { 
              id: doc.id,
              // シフトデータのフィールドをUI用にマッピング
              target_date: d.target_date,
              grade: d.target_grade,
              subject: d.target_subject,
              // タイトルとして「詳細科目 + 単元名」を結合
              title: `${d.target_detail_subject || ''} ${d.unit || ''}`.trim() || '授業録画',
              video_url: d.target_recording_url,
              role_type: d.role_type // 重複排除のために取得
            };
          })
          // ★重要フィルタ: 録画URLが存在し、かつ「メイン授業」のものだけを表示
          .filter(item => item.video_url && item.role_type === 'main');
        
        setAllRecordings(data);
        setFilteredRecordings(data);

        // 最新の録画がある日付を初期選択
        if (data.length > 0) {
          setSelectedDate(data[0].target_date);
          setCurrentDate(new Date(data[0].target_date));
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchRecordings();
  }, [user]);

  // --- フィルタリング処理 ---
  useEffect(() => {
    let result = allRecordings;

    // 1. 学年フィルタ
    if (gradeFilter !== 'all') {
      result = result.filter(rec => rec.grade === gradeFilter);
    }

    // 2. 単元フィルタ
    if (unitFilter !== 'all') {
      result = result.filter(rec => {
        // タイトルや科目にキーワードが含まれるか
        const target = (rec.title + rec.subject).toLowerCase();
        return target.includes(unitFilter);
      });
    }

    setFilteredRecordings(result);
  }, [gradeFilter, unitFilter, allRecordings]);


  // --- カレンダー生成ロジック ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  // カレンダー用：フィルタ済みデータの中にその日があるか
  const recordingDates = new Set(filteredRecordings.map(r => r.target_date));

  // 表示データの分岐
  const searchResults = searchQuery 
    ? filteredRecordings.filter(rec => rec.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const selectedDateVideos = filteredRecordings.filter(rec => rec.target_date === selectedDate);


  const SCIENCE_UNITS = [
    { label: '物理', icon: <Atom size={16}/>, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: '化学', icon: <FlaskConical size={16}/>, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-200' },
    { label: '生物', icon: <Leaf size={16}/>, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
    { label: '地学', icon: <Mountain size={16}/>, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  ];
  const SOCIAL_UNITS = [
    { label: '地理', icon: <Globe size={16}/>, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: '歴史', icon: <ScrollText size={16}/>, color: 'text-rose-500', bg: 'bg-rose-50', border: 'border-rose-200' },
    { label: '公民', icon: <Landmark size={16}/>, color: 'text-indigo-500', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  ];

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-rose-50/30"><Loader2 className="animate-spin text-rose-400" size={40}/></div>;

  return (
    <div className="min-h-screen bg-rose-50/30 p-4 pb-24 font-sans sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-rose-500 hover:shadow-md transition-all active:scale-95">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
              <span className="bg-red-500 text-white p-2.5 rounded-2xl shadow-lg shadow-red-200">
                <Video size={24} strokeWidth={3} />
              </span>
              授業アーカイブ
            </h1>
            <p className="text-xs font-bold text-gray-400 mt-1 pl-1">復習したい授業動画をチェック！</p>
          </div>
        </div>

        {/* メインレイアウト */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* 左カラム: コントロールパネル */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-8">
            
            {/* 検索バー */}
            <div className="bg-white p-2 rounded-[24px] shadow-sm border border-gray-100 flex items-center gap-2 focus-within:ring-4 focus-within:ring-red-100 focus-within:border-red-300 transition-all">
              <div className="p-3 bg-gray-50 text-gray-400 rounded-full">
                <Search size={20} strokeWidth={3}/>
              </div>
              <input 
                type="text" 
                placeholder="キーワード検索（例: 電流、鎌倉...）"
                className="flex-1 bg-transparent font-bold text-gray-700 placeholder:text-gray-300 outline-none h-full py-3"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="p-2 mr-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                >
                  <X size={18} strokeWidth={3}/>
                </button>
              )}
            </div>

            {/* カレンダーエリア */}
            <div className={`bg-white p-6 rounded-[32px] shadow-xl shadow-gray-100 border-2 border-white relative overflow-hidden transition-opacity duration-300 ${searchQuery ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
              <div className="flex items-center justify-between mb-6">
                <button onClick={prevMonth} className="p-3 hover:bg-gray-100 rounded-full text-gray-400 transition-colors active:scale-95"><ChevronLeft size={24} strokeWidth={3}/></button>
                <h2 className="text-xl font-black text-gray-800 tracking-tight">
                  {year}年 <span className="text-red-500">{month + 1}月</span>
                </h2>
                <button onClick={nextMonth} className="p-3 hover:bg-gray-100 rounded-full text-gray-400 transition-colors active:scale-95"><ChevronRight size={24} strokeWidth={3}/></button>
              </div>

              <div className="grid grid-cols-7 text-center mb-4">
                {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                  <div key={i} className={`text-xs font-black ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-300'}`}>
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {days.map((day, idx) => {
                  if (!day) return <div key={idx}></div>;
                  
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const hasRecording = recordingDates.has(dateStr);
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all duration-300 ${
                        isSelected 
                          ? 'bg-gradient-to-br from-red-500 to-pink-600 text-white shadow-lg shadow-red-200 scale-110 z-10' 
                          : hasRecording 
                            ? 'bg-white border-2 border-red-100 text-gray-700 hover:border-red-300' 
                            : 'hover:bg-gray-50 text-gray-400'
                      }`}
                    >
                      <span className={`text-sm ${isSelected ? 'font-black' : 'font-bold'}`}>
                        {day}
                      </span>
                      {!isSelected && hasRecording && (
                        <span className="absolute bottom-2 w-1.5 h-1.5 rounded-full bg-red-400"></span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            
            {searchQuery && (
               <div className="text-center text-xs font-bold text-gray-400">
                 ※ 検索中はカレンダー選択が無効になります
               </div>
            )}

            {/* フィルターエリア */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-black text-gray-400 uppercase tracking-wider">
                  <Filter size={16} strokeWidth={3} /> Filters
                </div>
                {(gradeFilter !== 'all' || unitFilter !== 'all') && (
                  <button 
                    onClick={() => { setGradeFilter('all'); setUnitFilter('all'); }}
                    className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1 rounded-full hover:bg-red-100 flex items-center gap-1 transition-colors"
                  >
                    <X size={12} strokeWidth={3}/> リセット
                  </button>
                )}
              </div>

              {/* 学年フィルター */}
              <div className="flex flex-wrap gap-2">
                {['all', '中1', '中2', '中3'].map(g => (
                  <button
                    key={g}
                    onClick={() => setGradeFilter(g)}
                    className={`flex-1 min-w-[60px] px-3 py-3 rounded-xl text-xs font-bold transition-all border-2 ${
                      gradeFilter === g 
                        ? 'bg-gray-800 text-white border-gray-800 shadow-lg shadow-gray-200 scale-105' 
                        : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                    }`}
                  >
                    {g === 'all' ? '全学年' : g}
                  </button>
                ))}
              </div>

              <div className="h-px bg-gray-100"></div>

              {/* ユニットフィルター */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 pl-1">カテゴリー</p>
                
                {/* 理科 */}
                <div className="grid grid-cols-2 gap-2">
                  {SCIENCE_UNITS.map((u) => (
                    <button
                      key={u.label}
                      onClick={() => setUnitFilter(unitFilter === u.label ? 'all' : u.label)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border-2 flex items-center gap-2 ${
                        unitFilter === u.label
                          ? `${u.bg} ${u.border} ${u.color.replace('text', 'text')} border-current shadow-sm ring-1 ring-offset-1 ring-current`
                          : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <span className={`${unitFilter === u.label ? 'opacity-100' : 'opacity-50'} ${u.color}`}>{u.icon}</span>
                      {u.label}
                    </button>
                  ))}
                </div>
                
                {/* 社会 */}
                <div className="grid grid-cols-3 gap-2">
                  {SOCIAL_UNITS.map((u) => (
                    <button
                      key={u.label}
                      onClick={() => setUnitFilter(unitFilter === u.label ? 'all' : u.label)}
                      className={`px-2 py-2.5 rounded-xl text-xs font-bold transition-all border-2 flex flex-col items-center justify-center gap-1 ${
                        unitFilter === u.label
                          ? `${u.bg} ${u.border} ${u.color.replace('text', 'text')} border-current shadow-sm ring-1 ring-offset-1 ring-current`
                          : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <span className={`${unitFilter === u.label ? 'opacity-100' : 'opacity-50'} ${u.color}`}>{u.icon}</span>
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 右カラム: 動画リスト */}
          <div className="lg:col-span-7">
            
            {/* リストヘッダー */}
            <div className="bg-white/50 backdrop-blur-sm p-4 rounded-[32px] border border-white/50 sticky top-0 z-10 mb-4 shadow-sm">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-black text-gray-700 flex items-center gap-2 text-lg">
                  <span className={`p-2 rounded-lg shadow-sm ${searchQuery ? 'bg-indigo-500 text-white' : 'bg-white text-red-500'}`}>
                    {searchQuery ? <Search size={20} strokeWidth={3}/> : <CalendarIcon size={20} strokeWidth={3}/>}
                  </span>
                  {searchQuery ? (
                    <span>
                      &quot;{searchQuery}&quot; の検索結果
                    </span>
                  ) : (
                    <span>
                      {new Date(selectedDate).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
                      <span className="text-sm font-medium text-gray-400 ml-2">の授業</span>
                    </span>
                  )}
                </h3>
                <span className="bg-gray-800 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                  {searchQuery ? searchResults.length : selectedDateVideos.length} Videos
                </span>
              </div>
            </div>

            {/* リスト表示部分 */}
            {(searchQuery ? searchResults : selectedDateVideos).length === 0 ? (
              <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300 flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <div className="bg-gray-50 p-6 rounded-full mb-4">
                  <MonitorPlay size={48} className="text-gray-200" strokeWidth={1.5}/>
                </div>
                <p className="text-lg font-bold text-gray-400">
                  該当する動画は見つかりませんでした
                </p>
                <p className="text-sm mt-2 opacity-60">
                  {searchQuery ? 'キーワードを変えて再度検索してみてください' : '他の日付を選択してください'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {(searchQuery ? searchResults : selectedDateVideos).map((rec) => (
                  <a 
                    key={rec.id} 
                    href={rec.video_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block group"
                  >
                    <div className="bg-white p-5 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 hover:border-red-200 hover:shadow-xl hover:shadow-red-50 hover:-translate-y-1 transition-all duration-300 flex items-center justify-between gap-4 relative overflow-hidden">
                      
                      {/* 背景装飾 */}
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-red-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-bl-[100px] pointer-events-none"></div>

                      <div className="relative z-10 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span className={`text-[10px] font-black px-3 py-1 rounded-full tracking-wide uppercase ${
                            (rec.subject || '').includes('理科') ? 'bg-blue-50 text-blue-600 border border-blue-100' : 
                            (rec.subject || '').includes('社会') ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {rec.grade} | {rec.subject}
                          </span>
                          {/* 検索時のみ日付も表示する */}
                          {searchQuery && (
                            <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
                              {new Date(rec.target_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <h4 className="text-lg font-black text-gray-800 group-hover:text-red-500 transition-colors line-clamp-2 leading-tight">
                          {rec.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-2 text-xs font-bold text-gray-400">
                           <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                           視聴可能
                        </div>
                      </div>

                      <div className="relative z-10 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center group-hover:bg-red-500 group-hover:text-white group-hover:scale-110 transition-all shadow-sm shrink-0">
                        <PlayCircle size={28} fill="currentColor" className="text-inherit group-hover:text-white transition-colors" strokeWidth={2}/>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}