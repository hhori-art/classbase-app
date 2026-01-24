'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, query, orderBy, getDocs, updateDoc, doc, increment, arrayUnion 
} from 'firebase/firestore';
import { 
  ArrowLeft, Video, Calendar as CalendarIcon, PlayCircle, Loader2, 
  ChevronLeft, ChevronRight, MonitorPlay, Filter, Atom, FlaskConical, 
  Leaf, Mountain, Globe, ScrollText, Landmark, X, Search, Coins, Layers
} from 'lucide-react';
import Link from 'next/link';

export default function StudentRecordingsPage() {
  const { user } = useAuth();
  
  // データ管理
  const [allRecordings, setAllRecordings] = useState<any[]>([]);
  const [filteredRecordings, setFilteredRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // UI状態
  const [searchMode, setSearchMode] = useState<'calendar' | 'unit'>('calendar'); 
  const [gradeFilter, setGradeFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // カレンダー用
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // データ取得
  useEffect(() => {
    const fetchRecordings = async () => {
      if (!user) return;
      setLoading(true);

      try {
        const ref = collection(db, 'class_recordings');
        const q = query(ref, orderBy('target_date', 'desc'));
        const snapshot = await getDocs(q);

        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return { 
            id: doc.id,
            target_date: d.target_date || '2024-01-01',
            grade: d.grade || 'その他',
            subject: d.subject || '全科目',
            title: d.title || 'タイトルなし',
            video_url: d.video_url || d.url,
            searchText: `${d.title} ${d.subject} ${d.grade} ${d.target_date}`.toLowerCase()
          };
        });

        setAllRecordings(data);
        setFilteredRecordings(data);

        if (data.length > 0) {
          setSelectedDate(data[0].target_date);
          setCurrentDate(new Date(data[0].target_date));
        }

      } catch (error) {
        console.error("録画取得エラー:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchRecordings();
  }, [user]);

  // モード切り替え
  const handleModeChange = (mode: 'calendar' | 'unit') => {
    setSearchMode(mode);
    setSearchQuery(''); 
    if (mode === 'calendar') {
      setUnitFilter('all');
    }
  };

  // 表示データの決定
  const displayVideos = (() => {
    let list = allRecordings;

    // 1. 学年フィルタ
    if (gradeFilter !== 'all') {
      list = list.filter(rec => rec.grade === gradeFilter);
    }

    // 2. キーワード検索
    if (searchQuery) {
      const lowerQ = searchQuery.toLowerCase();
      return list.filter(rec => rec.searchText.includes(lowerQ));
    }

    // 3. モード別フィルタ
    if (searchMode === 'unit') {
      if (unitFilter !== 'all') {
        return list.filter(rec => {
          const target = (rec.title + rec.subject).toLowerCase();
          return target.includes(unitFilter);
        });
      }
      return list; 
    } else {
      return list.filter(rec => rec.target_date === selectedDate);
    }
  })();

  // カレンダー計算
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = [];
  for (let i = 0; i < getFirstDayOfMonth(year, month); i++) days.push(null);
  for (let i = 1; i <= getDaysInMonth(year, month); i++) days.push(i);
  
  const recordingDates = new Set(allRecordings.map(r => r.target_date));

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

  const handleWatchVideo = async (e: React.MouseEvent, rec: any) => {
    e.preventDefault(); 
    if (processingId) return;
    window.open(rec.video_url, '_blank');
    setProcessingId(rec.id);
    try {
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          coins: increment(10), 
          total_coins: increment(10),
          earned_badges: arrayUnion('badge_1') 
        });
      }
    } catch (err) { console.error(err); } 
    finally { setTimeout(() => setProcessingId(null), 1000); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]"><Loader2 className="animate-spin text-red-400" size={40}/></div>;

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 pb-24 font-sans sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-red-600 hover:shadow-md transition-all active:scale-95">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
              {/* ★変更: 赤いグラデーション */}
              <span className="bg-gradient-to-br from-red-500 to-pink-600 text-white p-2.5 rounded-2xl shadow-lg shadow-red-200">
                <Video size={24} strokeWidth={3} />
              </span>
              授業アーカイブ
            </h1>
            <p className="text-xs font-bold text-gray-400 mt-1 pl-1">過去の授業が見放題！復習してコインをゲットしよう</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* === 左カラム: コントロール === */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-8">
            
            {/* 検索バー */}
            {/* ★変更: フォーカス時のリング色を赤に */}
            <div className="bg-white p-2 rounded-[24px] shadow-sm border border-gray-100 flex items-center gap-2 focus-within:ring-4 focus-within:ring-red-100 focus-within:border-red-300 transition-all">
              <div className="p-3 bg-gray-50 text-gray-400 rounded-full"><Search size={20} strokeWidth={3}/></div>
              <input type="text" placeholder="キーワード検索 (例: 鎌倉, 電流...)" className="flex-1 bg-transparent font-bold text-gray-700 outline-none h-full py-3" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}/>
              {searchQuery && <button onClick={() => setSearchQuery('')} className="p-2 mr-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full"><X size={18} strokeWidth={3}/></button>}
            </div>

            {/* モード切り替えタブ */}
            <div className="bg-gray-200/50 p-1.5 rounded-2xl flex gap-1">
              <button 
                onClick={() => handleModeChange('calendar')}
                // ★変更: アクティブ色を赤に
                className={`flex-1 py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all ${
                  searchMode === 'calendar' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:bg-gray-200/50'
                }`}
              >
                <CalendarIcon size={16}/> 日付から探す
              </button>
              <button 
                onClick={() => handleModeChange('unit')}
                // ★変更: アクティブ色を赤(またはピンク)に
                className={`flex-1 py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all ${
                  searchMode === 'unit' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:bg-gray-200/50'
                }`}
              >
                <Layers size={16}/> 単元から探す
              </button>
            </div>

            {/* モード別コンテンツ */}
            <div className="relative overflow-hidden">
              
              {/* === カレンダーモード === */}
              {searchMode === 'calendar' && !searchQuery && (
                <div className="bg-white p-6 rounded-[32px] shadow-xl shadow-gray-100 border-2 border-white animate-in slide-in-from-left-4 duration-300">
                  <div className="flex items-center justify-between mb-6">
                    <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-3 hover:bg-gray-100 rounded-full text-gray-400"><ChevronLeft size={24}/></button>
                    {/* ★変更: 月表示を赤に */}
                    <h2 className="text-xl font-black text-gray-800 tracking-tight">{year}年 <span className="text-red-500">{month + 1}月</span></h2>
                    <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-3 hover:bg-gray-100 rounded-full text-gray-400"><ChevronRight size={24}/></button>
                  </div>
                  <div className="grid grid-cols-7 text-center mb-4">
                    {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (<div key={i} className={`text-xs font-black ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-300'}`}>{d}</div>))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {days.map((day, idx) => {
                      if (!day) return <div key={idx}></div>;
                      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const hasRecording = recordingDates.has(dateStr);
                      const isSelected = selectedDate === dateStr;
                      return (
                        <button key={idx} onClick={() => setSelectedDate(dateStr)} className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all duration-300 ${isSelected ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-110 z-10' : hasRecording ? 'bg-white border-2 border-red-100 text-gray-700 hover:border-red-300' : 'hover:bg-gray-50 text-gray-400'}`}>
                          <span className={`text-sm ${isSelected ? 'font-black' : 'font-bold'}`}>{day}</span>
                          {!isSelected && hasRecording && <span className="absolute bottom-2 w-1.5 h-1.5 rounded-full bg-red-400"></span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* === 単元リストモード === */}
              {searchMode === 'unit' && !searchQuery && (
                <div className="bg-white p-6 rounded-[32px] shadow-xl shadow-gray-100 border-2 border-white animate-in slide-in-from-right-4 duration-300 space-y-6">
                  <div className="text-center">
                    <h3 className="font-bold text-gray-800">単元・カテゴリーを選択</h3>
                    <p className="text-xs text-gray-400 mt-1">選択すると全期間から動画を表示します</p>
                  </div>
                  
                  {/* 全表示ボタン */}
                  <button 
                    onClick={() => setUnitFilter('all')}
                    className={`w-full py-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${unitFilter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-100'}`}
                  >
                    <Layers size={16}/> すべての動画を表示
                  </button>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold text-gray-400 pl-1 mb-2">理科</p>
                      <div className="grid grid-cols-2 gap-2">{SCIENCE_UNITS.map(u => <button key={u.label} onClick={() => setUnitFilter(u.label)} className={`px-3 py-3 rounded-xl text-xs font-bold transition-all border-2 flex items-center gap-2 ${unitFilter === u.label ? `${u.bg} ${u.border} text-black border-current shadow-sm scale-105` : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'}`}><span className={`${u.color}`}>{u.icon}</span>{u.label}</button>)}</div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-400 pl-1 mb-2">社会</p>
                      <div className="grid grid-cols-3 gap-2">{SOCIAL_UNITS.map(u => <button key={u.label} onClick={() => setUnitFilter(u.label)} className={`px-2 py-3 rounded-xl text-xs font-bold transition-all border-2 flex flex-col items-center justify-center gap-1 ${unitFilter === u.label ? `${u.bg} ${u.border} text-black border-current shadow-sm scale-105` : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'}`}><span className={`${u.color}`}>{u.icon}</span>{u.label}</button>)}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* 検索中メッセージ */}
              {searchQuery && (
                // ★変更: 枠線を赤系に
                <div className="bg-white p-8 rounded-[32px] border-2 border-red-100 text-center animate-in fade-in">
                  <Search size={32} className="mx-auto text-red-200 mb-2"/>
                  <p className="font-bold text-red-900">キーワード検索中</p>
                  <p className="text-xs text-red-400">日付・単元に関係なく検索しています</p>
                </div>
              )}

            </div>

            {/* 共通フィルター (学年) */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-3">
              <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-wider"><Filter size={14}/> 絞り込み</div>
              <div className="flex flex-wrap gap-2">
                {['all', '中1', '中2', '中3'].map(g => (
                  <button key={g} onClick={() => setGradeFilter(g)} className={`flex-1 min-w-[60px] px-3 py-3 rounded-xl text-xs font-bold transition-all border-2 ${gradeFilter === g ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-100'}`}>{g === 'all' ? '全学年' : g}</button>
                ))}
              </div>
            </div>
          </div>

          {/* === 右カラム: 動画リスト === */}
          <div className="lg:col-span-7">
            <div className="bg-white/50 backdrop-blur-sm p-4 rounded-[32px] border border-white/50 mb-4 shadow-sm flex items-center justify-between px-2 sticky top-0 z-10">
                <h3 className="font-black text-gray-700 flex items-center gap-2 text-lg">
                  {/* ★変更: アイコン背景を赤に */}
                  <span className={`p-2 rounded-lg shadow-sm ${searchMode === 'unit' || searchQuery ? 'bg-pink-500 text-white' : 'bg-red-500 text-white'}`}>
                    {searchQuery ? <Search size={20}/> : searchMode === 'unit' ? <Layers size={20}/> : <CalendarIcon size={20}/>}
                  </span>
                  {searchQuery ? (
                    <span>検索結果</span>
                  ) : searchMode === 'unit' ? (
                    <span>{unitFilter === 'all' ? 'すべての動画' : `${unitFilter}の動画`} <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded ml-1">全期間</span></span>
                  ) : (
                    <span>{new Date(selectedDate).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}<span className="text-sm font-medium text-gray-400 ml-2">の授業</span></span>
                  )}
                </h3>
                <span className="bg-gray-800 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">{displayVideos.length} Videos</span>
            </div>

            {displayVideos.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300 flex flex-col items-center">
                <div className="bg-gray-50 p-6 rounded-full mb-4"><MonitorPlay size={48} className="text-gray-200"/></div>
                <p className="text-lg font-bold text-gray-400">動画は見つかりませんでした</p>
                {searchMode === 'calendar' && !searchQuery && <p className="text-xs text-red-400 mt-4 bg-red-50 px-3 py-1 rounded-full animate-pulse">※ 赤い点がある日付を選んでください</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {displayVideos.map((rec) => (
                  <button key={rec.id} onClick={(e) => handleWatchVideo(e, rec)} className="block group w-full text-left">
                    {/* ★変更: hover時のボーダーやシャドウを赤系に */}
                    <div className="bg-white p-5 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 hover:border-red-200 hover:shadow-xl hover:shadow-red-50 hover:-translate-y-1 transition-all duration-300 flex items-center justify-between gap-4 relative overflow-hidden">
                      <div className="relative z-10 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span className="text-[10px] font-black px-3 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{rec.grade} | {rec.subject}</span>
                          {(searchMode === 'unit' || searchQuery) && <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">{rec.target_date}</span>}
                          <span className="text-[10px] font-bold bg-yellow-400 text-yellow-900 px-2 py-1 rounded-full flex items-center gap-1 shadow-sm"><Coins size={10} /> +10pt</span>
                        </div>
                        {/* ★変更: タイトルホバー色を赤に */}
                        <h4 className="text-lg font-black text-gray-800 group-hover:text-red-600 transition-colors line-clamp-2">{rec.title}</h4>
                        <div className="flex items-center gap-2 mt-2 text-xs font-bold text-gray-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>{processingId === rec.id ? 'コイン追加中...' : '視聴してコインGET'}</div>
                      </div>
                      
                      {/* ★変更: 再生ボタンを赤に */}
                      <div className="relative z-10 w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center group-hover:bg-red-500 group-hover:text-white transition-all shadow-sm shrink-0">
                        {processingId === rec.id ? <Loader2 className="animate-spin" /> : <PlayCircle size={28} fill="currentColor" strokeWidth={2}/>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}