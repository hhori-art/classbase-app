'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, query, orderBy, limit, getDocs, addDoc, deleteDoc, doc, writeBatch, where 
} from 'firebase/firestore';
import { 
  Video, CheckCircle, ArrowLeft, Calendar as CalendarIcon, MonitorPlay, ExternalLink, 
  RefreshCw, Loader2, Link as LinkIcon, Clock, Trash2, Search, 
  Check, List, CheckSquare, Layers, Filter, XCircle
} from 'lucide-react';
import Link from 'next/link';

// 型定義
type ShiftData = {
  id: string; 
  target_date: string;
  target_grade: string;
  target_subject: string;
  target_detail_subject?: string;
  unit?: string;
  teacher_name: string;
  target_recording_url?: string; 
  target_meeting_id?: string;
  note?: string;
  defaultTitle?: string;
};

type PublishedData = {
  id: string;
  original_shift_id?: string;
  target_date: string;
  title: string;
  video_url: string;
  grade: string;
  subject: string;
};

export default function MasterApprovalPage() {
  const [candidates, setCandidates] = useState<ShiftData[]>([]);
  const [published, setPublished] = useState<PublishedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // --- 左カラム用State ---
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<{ [key: string]: string }>({});

  // --- 右カラム（公開済み）用State ---
  const [publishedSearch, setPublishedSearch] = useState('');
  const [pubFilterDate, setPubFilterDate] = useState('');
  const [pubFilterSubject, setPubFilterSubject] = useState('all');
  const [pubSelectedIds, setPubSelectedIds] = useState<Set<string>>(new Set());

  // データ取得
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 公開済みデータ
      const pubQ = query(collection(db, 'class_recordings'), orderBy('target_date', 'desc'), limit(300));
      const pubSnap = await getDocs(pubQ);
      const pubList = pubSnap.docs.map(d => ({ id: d.id, ...d.data() } as PublishedData));
      setPublished(pubList);

      const publishedShiftIds = new Set(pubList.map(p => p.original_shift_id).filter(Boolean));

      // 2. 承認候補
      const shiftQ = query(
        collection(db, 'shift_assignments'),
        where('target_recording_url', '!=', null),
        orderBy('target_date', 'desc'),
        limit(100)
      );
      
      const shiftSnap = await getDocs(shiftQ);
      const rawCandidates = shiftSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftData));

      // 3. フィルタリング (未公開のみ)
      const validCandidates = rawCandidates.filter(c => !publishedShiftIds.has(c.id));

      setCandidates(validCandidates);

      // タイトル初期値
      const initialTitles: any = {};
      validCandidates.forEach(c => {
        const t = `${c.target_detail_subject || ''} ${c.unit || ''}`.trim() || `${c.target_subject}の授業`;
        initialTitles[c.id] = t;
        c.defaultTitle = t;
      });
      setTitles(initialTitles);
      
      if (validCandidates.length > 0 && !selectedDateFilter) {
        setSelectedDateFilter(validCandidates[0].target_date);
        setCurrentDate(new Date(validCandidates[0].target_date));
      }

    } catch (e: any) {
      console.error(e);
      if (e.code === 'failed-precondition') {
        alert('システム設定が必要です。開発者コンソール(F12)のリンクからインデックスを作成してください。');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- 左カラム：一括操作 ---
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const targetIds = displayedCandidates.map(c => c.id);
    const allSelected = targetIds.every(id => selectedIds.has(id));
    const newSet = new Set(selectedIds);
    if (allSelected) {
      targetIds.forEach(id => newSet.delete(id));
    } else {
      targetIds.forEach(id => newSet.add(id));
    }
    setSelectedIds(newSet);
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件を一括公開しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      const targets = candidates.filter(c => selectedIds.has(c.id));
      const newPublished: PublishedData[] = [];

      targets.forEach(shift => {
        const ref = doc(collection(db, 'class_recordings'));
        const data = {
          original_shift_id: shift.id,
          target_date: shift.target_date,
          grade: shift.target_grade || 'その他',
          subject: shift.target_subject || '全科目',
          title: titles[shift.id] || shift.defaultTitle || 'タイトルなし',
          video_url: shift.target_recording_url || '',
          created_at: new Date().toISOString()
        };
        batch.set(ref, data);
        newPublished.push({ id: ref.id, ...data });
      });

      await batch.commit();
      setPublished(prev => [...newPublished, ...prev].sort((a,b) => b.target_date.localeCompare(a.target_date)));
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件のZoom連携を解除しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'shift_assignments', id);
        batch.update(ref, { target_recording_url: null });
      });
      await batch.commit();
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  // --- 右カラム：公開済みフィルター ---
  const filteredPublished = useMemo(() => {
    return published.filter(p => {
      const matchesSearch = 
        p.title.includes(publishedSearch) || 
        p.target_date.includes(publishedSearch) || 
        p.subject.includes(publishedSearch);
      
      const matchesDate = pubFilterDate ? p.target_date === pubFilterDate : true;
      const matchesSubject = pubFilterSubject !== 'all' ? p.subject === pubFilterSubject : true;

      return matchesSearch && matchesDate && matchesSubject;
    });
  }, [published, publishedSearch, pubFilterDate, pubFilterSubject]);

  const uniqueSubjects = useMemo(() => Array.from(new Set(published.map(p => p.subject))), [published]);

  // --- 右カラム：一括操作 ---
  const togglePubSelect = (id: string) => {
    const newSet = new Set(pubSelectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setPubSelectedIds(newSet);
  };

  const togglePubSelectAll = () => {
    const targetIds = filteredPublished.map(p => p.id);
    const allSelected = targetIds.length > 0 && targetIds.every(id => pubSelectedIds.has(id));
    const newSet = new Set(pubSelectedIds);
    if (allSelected) {
      targetIds.forEach(id => newSet.delete(id));
    } else {
      targetIds.forEach(id => newSet.add(id));
    }
    setPubSelectedIds(newSet);
  };

  const handleBulkUnpublish = async () => {
    if (pubSelectedIds.size === 0) return;
    if (!confirm(`選択した${pubSelectedIds.size}件の動画を削除（公開停止）しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      pubSelectedIds.forEach(id => {
        const ref = doc(db, 'class_recordings', id);
        batch.delete(ref);
      });
      await batch.commit();
      
      // シフト由来のものは候補に戻したいが、複雑になるため今回は単純削除後のリロード
      setPublished(prev => prev.filter(p => !pubSelectedIds.has(p.id)));
      setPubSelectedIds(new Set());
      fetchData(); // 整合性のため再取得
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  const handleUnpublish = async (pubId: string) => {
    if(!confirm('公開を取り下げますか？')) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'class_recordings', pubId));
      fetchData(); 
    } catch (e) { alert('削除失敗'); } finally { setProcessing(false); }
  };

  // --- カレンダーロジック ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = [];
  for (let i = 0; i < getFirstDayOfMonth(year, month); i++) days.push(null);
  for (let i = 1; i <= getDaysInMonth(year, month); i++) days.push(i);

  const displayedCandidates = useMemo(() => {
    if (viewMode === 'list') return candidates;
    if (!selectedDateFilter) return [];
    return candidates.filter(c => c.target_date === selectedDateFilter);
  }, [candidates, viewMode, selectedDateFilter]);

  const dateCounts = useMemo(() => {
    const counts: {[key:string]: number} = {};
    candidates.forEach(c => {
      counts[c.target_date] = (counts[c.target_date] || 0) + 1;
    });
    return counts;
  }, [candidates]);

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-[1800px] mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-6">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-red-600 hover:shadow-md transition-all active:scale-95">
              <ArrowLeft size={24} strokeWidth={3} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
                <span className="bg-gradient-to-br from-red-500 to-pink-600 text-white p-2.5 rounded-2xl shadow-lg shadow-red-200">
                  <Video size={24} strokeWidth={3} />
                </span>
                録画承認センター
              </h1>
              <p className="text-xs font-bold text-gray-400 mt-1 pl-1">未承認: {candidates.length}件</p>
            </div>
          </div>
          <button onClick={fetchData} className="flex items-center gap-2 bg-white px-5 py-3 rounded-2xl text-sm font-black text-gray-600 hover:bg-gray-50 shadow-sm transition-colors">
            <RefreshCw size={18} strokeWidth={2.5} /> 更新
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* === 左カラム: 承認ワークスペース === */}
          <div className="xl:col-span-8 space-y-6">
            
            {/* 左コントロールバー */}
            <div className="bg-white p-2 rounded-[24px] shadow-sm border border-slate-100 flex flex-wrap items-center justify-between gap-3 sticky top-4 z-20">
              <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                <button onClick={() => setViewMode('calendar')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${viewMode==='calendar' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <CalendarIcon size={16}/> カレンダー
                </button>
                <button onClick={() => setViewMode('list')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${viewMode==='list' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <List size={16}/> 全リスト
                </button>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mr-2 animate-in fade-in">
                  <span className="text-xs font-bold text-slate-500 mr-2">{selectedIds.size}件選択中</span>
                  <button onClick={handleBulkReject} disabled={processing} className="bg-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-300 transition-colors flex items-center gap-1">
                    <Trash2 size={14}/> 却下
                  </button>
                  <button onClick={handleBulkApprove} disabled={processing} className="bg-red-600 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-red-700 shadow-md shadow-red-200 transition-all active:scale-95 flex items-center gap-1">
                    {processing ? <Loader2 className="animate-spin" size={14}/> : <CheckCircle size={14}/>} 
                    一括承認
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* カレンダー */}
              {viewMode === 'calendar' && (
                <div className="md:col-span-5 lg:col-span-4">
                  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-2 hover:bg-slate-50 rounded-full text-slate-400"><ArrowLeft size={18}/></button>
                      <h2 className="text-lg font-black text-slate-700">{year}年 <span className="text-red-500">{month + 1}月</span></h2>
                      <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-2 hover:bg-slate-50 rounded-full text-slate-400"><ArrowLeft size={18} className="rotate-180"/></button>
                    </div>
                    <div className="grid grid-cols-7 text-center mb-2">
                      {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (<div key={i} className={`text-xs font-black ${i===0?'text-red-400':i===6?'text-blue-400':'text-slate-300'}`}>{d}</div>))}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {days.map((day, idx) => {
                        if (!day) return <div key={idx}></div>;
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const count = dateCounts[dateStr] || 0;
                        const isSelected = selectedDateFilter === dateStr;
                        return (
                          <button key={idx} onClick={() => setSelectedDateFilter(dateStr)} className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${isSelected ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-105 z-10' : count > 0 ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:border-red-300' : 'text-slate-300 hover:bg-slate-50'}`}>
                            <span className={`text-sm ${isSelected||count>0 ? 'font-black' : 'font-bold'}`}>{day}</span>
                            {count > 0 && !isSelected && <span className="absolute bottom-1 right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 承認リスト */}
              <div className={viewMode === 'calendar' ? 'md:col-span-7 lg:col-span-8' : 'md:col-span-12'}>
                <div className="flex items-center justify-between mb-4 px-2">
                  <h3 className="font-black text-slate-700 flex items-center gap-2">
                    {viewMode === 'calendar' && selectedDateFilter ? <><span className="bg-red-500 text-white p-1.5 rounded-lg"><CalendarIcon size={16}/></span>{new Date(selectedDateFilter).toLocaleDateString()} の承認待ち</> : <><span className="bg-red-500 text-white p-1.5 rounded-lg"><List size={16}/></span>全ての承認待ち</>}
                  </h3>
                  {displayedCandidates.length > 0 && (
                    <button onClick={toggleSelectAll} className="text-xs font-bold text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors"><CheckSquare size={14}/> {displayedCandidates.every(c => selectedIds.has(c.id)) ? '選択解除' : 'すべて選択'}</button>
                  )}
                </div>

                {loading ? <div className="p-20 text-center"><Loader2 className="animate-spin inline text-red-400" size={32}/></div> : displayedCandidates.length === 0 ? <div className="bg-white p-12 rounded-[32px] border-4 border-dashed border-slate-100 text-center text-slate-300"><p className="font-bold">この条件の承認待ちはありません</p></div> : (
                  <div className="space-y-4">
                    {displayedCandidates.map((shift) => {
                      const isSelected = selectedIds.has(shift.id);
                      return (
                        <div key={shift.id} className={`bg-white p-5 rounded-[28px] border-2 transition-all group relative overflow-hidden ${isSelected ? 'border-red-400 bg-red-50/30' : 'border-slate-100 hover:border-red-200'}`}>
                          <div className="absolute inset-0 cursor-pointer z-0" onClick={() => toggleSelect(shift.id)} />
                          <div className="relative z-10 flex gap-4 items-start pointer-events-none">
                            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-1 transition-colors ${isSelected ? 'bg-red-500 border-red-500 text-white' : 'border-slate-300 bg-white'}`}>{isSelected && <Check size={16} strokeWidth={4}/>}</div>
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-2 pointer-events-auto">
                                <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><Clock size={10}/> {shift.target_date} {shift.note || ''}</span>
                                <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><LinkIcon size={10}/> Zoom連携済</span>
                                <a href={shift.target_recording_url} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-500 hover:underline flex items-center gap-1 ml-auto z-20"><ExternalLink size={10}/> 録画確認</a>
                              </div>
                              <h4 className="text-lg font-black text-slate-800 leading-snug">{shift.target_grade} {shift.target_subject}<span className="text-sm text-slate-400 ml-2 font-bold">by {shift.teacher_name}</span></h4>
                              <div className="mt-3 pointer-events-auto">
                                <input type="text" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-red-300 transition-colors" value={titles[shift.id] || ''} onChange={(e) => setTitles(prev => ({...prev, [shift.id]: e.target.value}))} onClick={(e) => e.stopPropagation()} placeholder="公開タイトル"/>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* === 右カラム: 公開済み管理 === */}
          <div className="xl:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-[32px] shadow-sm border border-slate-100 h-full max-h-[calc(100vh-100px)] flex flex-col">
              
              {/* 右カラムヘッダー */}
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="font-black text-slate-700 flex items-center gap-2">
                  <span className="bg-green-100 text-green-700 p-1.5 rounded-lg"><Layers size={16}/></span>
                  公開済み
                  <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{published.length}</span>
                </h2>
                
                {/* 一括削除ボタン (選択時) */}
                {pubSelectedIds.size > 0 && (
                  <button onClick={handleBulkUnpublish} disabled={processing} className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-bold hover:bg-red-100 transition-colors flex items-center gap-1 animate-in zoom-in">
                    <Trash2 size={12}/> {pubSelectedIds.size}件削除
                  </button>
                )}
              </div>

              {/* フィルターエリア */}
              <div className="space-y-2 mb-4 shrink-0">
                {/* テキスト検索 */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input type="text" placeholder="検索..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-green-400 transition-colors" value={publishedSearch} onChange={(e) => setPublishedSearch(e.target.value)} />
                </div>
                
                {/* 詳細フィルター */}
                <div className="flex gap-2">
                  <input type="date" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterDate} onChange={(e) => setPubFilterDate(e.target.value)} />
                  <select className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterSubject} onChange={(e) => setPubFilterSubject(e.target.value)}>
                    <option value="all">全科目</option>
                    {uniqueSubjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                  </select>
                  {(pubFilterDate || pubFilterSubject !== 'all') && (
                    <button onClick={() => { setPubFilterDate(''); setPubFilterSubject('all'); }} className="p-1.5 bg-gray-100 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50"><XCircle size={16}/></button>
                  )}
                </div>

                {/* 全選択ボタン */}
                {filteredPublished.length > 0 && (
                  <div className="flex justify-end">
                    <button onClick={togglePubSelectAll} className="text-[10px] font-bold text-slate-400 hover:text-green-600 flex items-center gap-1 transition-colors">
                      <CheckSquare size={12}/> {filteredPublished.every(p => pubSelectedIds.has(p.id)) ? '解除' : 'すべて選択'}
                    </button>
                  </div>
                )}
              </div>

              {/* リスト */}
              <div className="overflow-y-auto custom-scrollbar space-y-2 flex-1 pr-1">
                {filteredPublished.length === 0 ? (
                  <div className="text-center py-10 text-slate-300 text-xs font-bold">該当なし</div>
                ) : (
                  filteredPublished.map((pub) => {
                    const isSelected = pubSelectedIds.has(pub.id);
                    return (
                      <div 
                        key={pub.id} 
                        className={`p-3 rounded-2xl border transition-all group flex gap-3 items-start cursor-pointer ${isSelected ? 'border-green-400 bg-green-50/30' : 'border-slate-100 hover:border-green-200 hover:bg-green-50/10'}`}
                        onClick={() => togglePubSelect(pub.id)}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-1.5 transition-colors ${isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 bg-white'}`}>
                          {isSelected && <Check size={12} strokeWidth={4}/>}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 mb-0.5">{pub.target_date} <span className="bg-slate-100 px-1.5 rounded text-slate-500 ml-1">{pub.subject}</span></p>
                          <h5 className="text-xs font-black text-slate-700 truncate mb-1">{pub.title}</h5>
                          <div className="flex justify-between items-center pointer-events-auto"> {/* リンクなどはクリック可能に */}
                            <a href={pub.video_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink size={10}/> 再生
                            </a>
                            {/* 個別削除ボタンも維持 */}
                            <button onClick={(e) => { e.stopPropagation(); handleUnpublish(pub.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={14}/>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}