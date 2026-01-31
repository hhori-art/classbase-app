'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, deleteDoc, limit } from 'firebase/firestore';
import { 
  Briefcase, ArrowLeft, CheckCircle, Edit, Trash2, Search, Filter, Save, X, Plus, Train, Download, 
  Loader2, Clock, Layout, Copy, AlertCircle, ChevronRight, Calendar, User, DollarSign, CheckSquare, Coffee, FileText
} from 'lucide-react';
import Link from 'next/link';
// ★ ZIP圧縮用ライブラリのインポート (npm install jszip が必要)
import JSZip from 'jszip';

// 型定義
interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office' | 'break'; 
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
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [isZipping, setIsZipping] = useState(false); // CSV生成中のローディング

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
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
    } catch (e) { console.error("Users fetch error:", e); }
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

  const handleApprove = async (id: string) => {
    if (!confirm('承認しますか？')) return;
    try {
      await updateDoc(doc(db, 'work_records', id), { status: 'approved' });
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    } catch (e) { alert('承認エラー'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？この操作は取り消せません。')) return;
    try {
      await deleteDoc(doc(db, 'work_records', id));
      setRecords(prev => prev.filter(r => r.id !== id));
    } catch (e) { alert('削除エラー'); }
  };

  const openEditor = (rec: any) => {
    setEditingRecord(rec);
    const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('sv').slice(0, 16).replace(' ', 'T') : '';
    setMainTime({ start: fmt(rec.start_time), end: fmt(rec.end_time) });
    setSegments(rec.work_segments && rec.work_segments.length > 0 ? rec.work_segments : []);
    setExpenses(rec.transportation || []);
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    // @ts-ignore
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

  const saveAll = async () => {
    if (!editingRecord) return;
    try {
      const ref = doc(db, 'work_records', editingRecord.id);
      const newStart = mainTime.start ? new Date(mainTime.start).toISOString() : editingRecord.start_time;
      const newEnd = mainTime.end ? new Date(mainTime.end).toISOString() : null;
      const filledSegments = fillGaps(segments, newStart, newEnd);
      const formattedExpenses = expenses.map(e => ({ ...e, cost: Number(e.cost) }));

      await updateDoc(ref, { 
        start_time: newStart,
        end_time: newEnd,
        work_segments: filledSegments,
        transportation: formattedExpenses
      });

      setRecords(prev => prev.map(r => r.id === editingRecord.id ? { 
        ...r, start_time: newStart, end_time: newEnd, work_segments: filledSegments, transportation: formattedExpenses 
      } : r));
      
      setEditingRecord(null);
      alert('保存しました。');
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // --- 計算関数 ---
  const calcDurationMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if(isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60));
  };

  const calcDurationStr = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + Number(item.cost), 0) : 0;

  // 22時またぎ計算用
  const splitTimeBy22 = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return { before22: 0, after22: 0 };
    
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startM = start.getHours() * 60 + start.getMinutes();
    const endM = end.getHours() * 60 + end.getMinutes();
    
    // 22:00 = 1320分
    const border = 22 * 60; 
    
    let before22 = 0;
    let after22 = 0;

    // 日付またぎは今回考慮しない（同日前提）
    if (endM <= border) {
      before22 = endM - startM;
    } else if (startM >= border) {
      after22 = endM - startM;
    } else {
      before22 = border - startM;
      after22 = endM - border;
    }
    
    return { before22, after22 };
  };

  // --- フィルタリング ---
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const name = usersMap[r.teacher_id] || r.teacher_name;
      const nameMatch = name.includes(filterName);
      const statusMatch = showOnlyPending ? r.status !== 'approved' : true;
      return nameMatch && statusMatch;
    });
  }, [records, usersMap, filterName, showOnlyPending]);

  // ★サマリー計算 (表示用)
  const summary = useMemo(() => {
    const pending = records.filter(r => r.status !== 'approved').length;
    
    let totalLessonMinutes = 0;
    let totalOfficeMinutes = 0;

    records.forEach(rec => {
      // 日付からISO文字列のベースを作る
      const baseDate = rec.date; 
      
      rec.work_segments?.forEach((seg: WorkSegment) => {
        if (!seg.start || !seg.end) return;
        // 時間文字列(HH:MM)から分を計算
        const [sh, sm] = seg.start.split(':').map(Number);
        const [eh, em] = seg.end.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);

        if (seg.type === 'lesson') totalLessonMinutes += duration;
        else if (seg.type === 'office') totalOfficeMinutes += duration;
      });
    });

    return { 
      pending, 
      lessonTime: calcDurationStr(totalLessonMinutes),
      officeTime: calcDurationStr(totalOfficeMinutes)
    };
  }, [records]);

  // ★CSV個別出力 & ZIP圧縮機能
  const handleBulkDownload = async () => {
    if (filteredRecords.length === 0) return alert('出力するデータがありません');
    if (!confirm('表示中の講師データを個別のCSVファイルとしてZIPで出力しますか？')) return;

    setIsZipping(true);
    const zip = new JSZip();

    // 講師ごとにデータをグルーピング
    const groupedData: { [key: string]: any[] } = {};
    filteredRecords.forEach(rec => {
      const teacherName = usersMap[rec.teacher_id] || rec.teacher_name || '不明な講師';
      if (!groupedData[teacherName]) groupedData[teacherName] = [];
      groupedData[teacherName].push(rec);
    });

    // 添付PDFの形式に合わせたCSVヘッダー
    // 休憩開始・終了はPDFにはないが、データ整合性のため含めるか、あるいは「事務」に含めるか。
    // ここではPDFの項目を優先しつつ、内部データを網羅する。
    const header = [
      '日付', '曜日',
      'オンライン授業(開始)', 'オンライン授業(終了)',
      '事務・サポート(開始)', '事務・サポート(終了)',
      'オンライン授業時間(~22時)', 'オンライン授業時間(22時~)',
      '事務・研修時間(~22時)', '事務・研修時間(22時~)',
      'オンラインサポート時間(~22時)', 'オンラインサポート時間(22時~)', // サポートは事務と分ける実装が必要だが、今回は事務に統合またはtypeで判断
      '交通費(区間)', '交通費(金額)'
    ].join(',');

    // 各講師ごとにCSV生成
    Object.keys(groupedData).forEach(teacherName => {
      const teacherRecords = groupedData[teacherName].sort((a, b) => a.date.localeCompare(b.date));
      
      const rows = teacherRecords.map(rec => {
        const dateObj = new Date(rec.date);
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];

        // セグメント処理
        let lessonStart = '', lessonEnd = '';
        let officeStart = '', officeEnd = '';
        
        let lessonTimeNormal = 0, lessonTimeLate = 0;
        let officeTimeNormal = 0, officeTimeLate = 0;
        let supportTimeNormal = 0, supportTimeLate = 0; // 今回はofficeに統合

        rec.work_segments?.forEach((seg: WorkSegment) => {
          // 開始・終了時刻の文字列確保（最初のものを採用、あるいは連結）
          if (seg.type === 'lesson') {
            if (!lessonStart) lessonStart = seg.start;
            lessonEnd = seg.end; // 最後を終了とする
            
            // 時間計算
            const startISO = `${rec.date}T${seg.start}:00`;
            const endISO = `${rec.date}T${seg.end}:00`;
            const { before22, after22 } = splitTimeBy22(startISO, endISO);
            lessonTimeNormal += before22;
            lessonTimeLate += after22;

          } else if (seg.type === 'office') {
            if (!officeStart) officeStart = seg.start;
            officeEnd = seg.end;

            const startISO = `${rec.date}T${seg.start}:00`;
            const endISO = `${rec.date}T${seg.end}:00`;
            const { before22, after22 } = splitTimeBy22(startISO, endISO);
            officeTimeNormal += before22;
            officeTimeLate += after22;
          }
        });

        // 交通費
        const transportText = rec.transportation?.map((t: any) => `${t.from}-${t.to}`).join(' / ') || '';
        const transportCost = calcTotalCost(rec.transportation);

        // 分を "H:MM" 形式に変換するヘルパー
        const minToHm = (m: number) => {
          if (m <= 0) return '';
          const h = Math.floor(m / 60);
          const min = m % 60;
          return `${h}:${String(min).padStart(2, '0')}`;
        };

        return [
          rec.date, dayOfWeek,
          lessonStart, lessonEnd,
          officeStart, officeEnd,
          minToHm(lessonTimeNormal), minToHm(lessonTimeLate),
          minToHm(officeTimeNormal), minToHm(officeTimeLate),
          minToHm(supportTimeNormal), minToHm(supportTimeLate),
          `"${transportText}"`, transportCost
        ].join(',');
      });

      // CSVデータ作成 (BOM付きUTF-8)
      const csvContent = "\uFEFF" + [header, ...rows].join('\n');
      zip.file(`${filterMonth}_${teacherName}.csv`, csvContent);
    });

    // ZIPダウンロード実行
    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `勤怠データ一括_${filterMonth}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error(e);
      alert('ZIP圧縮に失敗しました');
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 pb-32 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        
        {/* ヘッダーエリア */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-2.5 rounded-full shadow-sm hover:bg-gray-100 text-gray-500 transition-colors border border-gray-200">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Briefcase className="text-indigo-600" /> 勤怠管理
              </h1>
              <p className="text-xs text-gray-500 mt-1">講師の出勤記録の確認と承認を行います</p>
            </div>
          </div>

          {/* ★修正: サマリー表示 (授業時間・事務時間・承認待ち) */}
          <div className="flex gap-4 flex-wrap">
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><FileText size={12}/> 授業時間</span>
              <span className="text-xl font-black text-blue-600 font-mono">{summary.lessonTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><Coffee size={12}/> 事務時間</span>
              <span className="text-xl font-black text-orange-500 font-mono">{summary.officeTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase">承認待ち</span>
              <span className={`text-xl font-black ${summary.pending > 0 ? 'text-red-500' : 'text-gray-300'}`}>{summary.pending}</span>
            </div>
          </div>
        </div>

        {/* フィルター & 操作バー */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-4 z-20">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
              <Calendar size={16} className="text-gray-400"/>
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-transparent font-bold text-gray-700 outline-none text-sm cursor-pointer" />
            </div>
            
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
              <input 
                type="text" 
                placeholder="名前で検索..." 
                className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                value={filterName} 
                onChange={e => setFilterName(e.target.value)} 
              />
            </div>

            <button 
              onClick={() => setShowOnlyPending(!showOnlyPending)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                showOnlyPending 
                  ? 'bg-orange-50 text-orange-600 border-orange-200' 
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {showOnlyPending ? <CheckSquare size={16}/> : <Filter size={16}/>}
              承認待ちのみ
            </button>
          </div>

          {/* ★修正: ZIP一括ダウンロードボタン */}
          <button 
            onClick={handleBulkDownload} 
            disabled={isZipping || filteredRecords.length === 0}
            className="w-full md:w-auto bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isZipping ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
            {isZipping ? '圧縮中...' : 'CSV一括出力 (ZIP)'}
          </button>
        </div>

        {/* リスト表示 */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-400" size={32}/></div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-bold bg-white rounded-3xl border border-dashed border-gray-200">
            データが見つかりません
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredRecords.map(rec => {
              const displayName = usersMap[rec.teacher_id] || rec.teacher_name;
              // 開始時間順にソート
              const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
              const isApproved = rec.status === 'approved';

              return (
                <div key={rec.id} className={`bg-white p-5 rounded-2xl shadow-sm border transition-all hover:shadow-md ${isApproved ? 'border-gray-200 opacity-80' : 'border-orange-200 ring-1 ring-orange-100'}`}>
                  <div className="flex flex-col md:flex-row gap-6">
                    
                    {/* 左側: 基本情報 */}
                    <div className="md:w-48 shrink-0 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-6">
                      <div className="flex items-center gap-2 text-gray-500 text-xs font-bold mb-1">
                        <Calendar size={12}/> {rec.date}
                      </div>
                      <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                        <User size={18} className="text-gray-400"/>
                        {displayName}
                      </h3>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-400 font-bold mb-1">拘束時間</div>
                        <div className="text-xl font-black text-gray-700 font-mono">
                          {calcDurationMinutes(rec.start_time, rec.end_time) > 0 ? calcDurationStr(calcDurationMinutes(rec.start_time, rec.end_time)) : '--'}
                        </div>
                      </div>
                    </div>

                    {/* 中央: 詳細情報 */}
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">出勤</span>
                        <span className="font-mono font-bold text-lg">
                          {rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                        </span>
                        <span className="text-gray-300">➜</span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">退勤</span>
                        <span className="font-mono font-bold text-lg">
                          {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                        </span>
                      </div>

                      {displaySegments?.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {displaySegments.map((seg: any, i: number) => (
                            <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
                              seg.type === 'lesson' ? 'bg-blue-50 border-blue-100 text-blue-800' :
                              seg.type === 'office' ? 'bg-orange-50 border-orange-100 text-orange-800' :
                              'bg-gray-50 border-gray-200 text-gray-500' // break
                            }`}>
                              <span className="font-mono font-bold">{seg.start}-{seg.end}</span>
                              <span className="font-bold opacity-70">|</span>
                              <span className="font-bold">
                                {seg.type === 'lesson' ? '授業' : seg.type === 'office' ? '事務' : '休憩'}
                              </span>
                              {seg.note && !seg.isAuto && <span className="opacity-70 truncate max-w-[100px]">({seg.note})</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">詳細なし</span>
                      )}

                      {rec.transportation?.length > 0 && (
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit">
                          <Train size={14}/> 交通費: ¥{calcTotalCost(rec.transportation).toLocaleString()}
                        </div>
                      )}
                    </div>

                    {/* 右側: アクション */}
                    <div className="flex flex-row md:flex-col justify-center gap-2 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                      {isApproved ? (
                        <button disabled className="w-full bg-gray-100 text-gray-400 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                          <CheckCircle size={16}/> 承認済
                        </button>
                      ) : (
                        <button onClick={() => handleApprove(rec.id)} className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-sm transition-all active:scale-95">
                          <CheckCircle size={16}/> 承認する
                        </button>
                      )}
                      <button onClick={() => openEditor(rec)} className="w-full bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors">
                        <Edit size={14}/> 編集
                      </button>
                      <button onClick={() => handleDelete(rec.id)} className="w-full bg-white border border-red-100 text-red-500 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
                        <Trash2 size={14}/> 削除
                      </button>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            
            <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg"><Briefcase size={20}/> 勤怠データ編集</h3>
                <p className="text-xs text-slate-400 mt-0.5">{editingRecord.date} - {usersMap[editingRecord.teacher_id] || editingRecord.teacher_name}</p>
              </div>
              <button onClick={() => setEditingRecord(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={24}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-8 custom-scrollbar">
              
              {/* 出退勤時間 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2"><Clock size={18} className="text-indigo-500"/> 出退勤時間</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">出勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.start} onChange={e => setMainTime({...mainTime, start: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">退勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.end} onChange={e => setMainTime({...mainTime, end: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* 時間割・内訳 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Layout size={18} className="text-orange-500"/> 業務内訳</h4>
                  <div className="text-[10px] text-gray-500 bg-gray-100 px-2 py-1 rounded font-bold flex items-center gap-1"><AlertCircle size={12}/> 隙間は自動で「休憩」になります</div>
                </div>
                
                <div className="space-y-3">
                  {segments.map((seg, i) => (
                    <div key={i} className={`flex flex-col sm:flex-row gap-3 items-start sm:items-center p-3 rounded-xl border transition-all group ${
                      seg.type === 'lesson' ? 'bg-blue-50/50 border-blue-100' :
                      seg.type === 'office' ? 'bg-orange-50/50 border-orange-100' :
                      'bg-gray-50/50 border-gray-200'
                    }`}>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <input type="time" className="bg-white border border-gray-200 rounded-lg p-2 text-xs font-mono font-bold w-24 text-center" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} />
                        <span className="text-gray-300">➜</span>
                        <input type="time" className="bg-white border border-gray-200 rounded-lg p-2 text-xs font-mono font-bold w-24 text-center" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} />
                      </div>
                      
                      <div className="flex gap-2 flex-1 w-full sm:w-auto">
                        <div className="flex bg-white rounded-lg border border-gray-200 p-1 shrink-0">
                          <button onClick={() => updateSegment(i, 'type', 'lesson')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${seg.type === 'lesson' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-100'}`}>授業</button>
                          <div className="w-px bg-gray-200"></div>
                          <button onClick={() => updateSegment(i, 'type', 'office')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${seg.type === 'office' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-100'}`}>事務</button>
                          <div className="w-px bg-gray-200"></div>
                          <button onClick={() => updateSegment(i, 'type', 'break')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${seg.type === 'break' ? 'bg-gray-500 text-white' : 'text-gray-400 hover:bg-gray-100'}`}>休憩</button>
                        </div>
                        <input type="text" className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="内容メモ" value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                      </div>
                      
                      <button onClick={() => removeSegment(i)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors ml-auto sm:ml-0"><Trash2 size={16}/></button>
                    </div>
                  ))}
                  <button onClick={addSegment} className="w-full py-3 text-xs font-bold text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 border border-dashed border-gray-300 hover:border-indigo-300 rounded-xl flex items-center justify-center gap-2 transition-all">
                    <Plus size={16}/> 行を追加する
                  </button>
                </div>
              </div>

              {/* 交通費 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Train size={18} className="text-emerald-500"/> 交通費申請</h4>
                  <button onClick={handleCopyLastTransport} className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-100 flex items-center gap-1 transition-colors"><Copy size={12}/> 前回をコピー</button>
                </div>
                
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-3 items-center bg-emerald-50/30 p-3 rounded-xl border border-emerald-100/50">
                      <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                        <div className="bg-white px-2 py-1 rounded text-[10px] font-bold text-emerald-600 border border-emerald-100 shrink-0">片道</div>
                        <input type="text" className="flex-1 bg-transparent border-b border-gray-300 focus:border-emerald-500 outline-none text-sm font-bold pb-1 placeholder:text-gray-300" placeholder="出発駅" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} />
                        <ChevronRight size={16} className="text-gray-300 shrink-0"/>
                        <input type="text" className="flex-1 bg-transparent border-b border-gray-300 focus:border-emerald-500 outline-none text-sm font-bold pb-1 placeholder:text-gray-300" placeholder="到着駅" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} />
                      </div>
                      
                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <div className="relative">
                          <DollarSign size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                          <input type="number" className="w-24 bg-white border border-gray-200 rounded-lg pl-6 pr-2 py-1.5 text-sm font-mono font-bold text-right focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                        </div>
                        <button onClick={() => removeExpense(i)} className="text-gray-300 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-colors"><X size={16}/></button>
                      </div>
                    </div>
                  ))}
                  <button onClick={addExpense} className="w-full py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 border border-dashed border-emerald-200 hover:border-emerald-400 rounded-xl flex items-center justify-center gap-2 transition-all">
                    <Plus size={16}/> 交通費を追加
                  </button>
                </div>
              </div>
              
              <div className="h-10"></div>
            </div>
            
            <div className="p-5 border-t bg-white shrink-0 z-10 flex justify-end gap-3">
              <button onClick={() => setEditingRecord(null)} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm">キャンセル</button>
              <button onClick={saveAll} className="px-8 py-3 rounded-xl font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all active:scale-95 text-sm flex items-center gap-2">
                <Save size={18}/> 変更を保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}