'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch, getDoc } from 'firebase/firestore';
import { ArrowLeft, Save, Loader2, Search, Download, RefreshCw, ChevronLeft, ChevronRight, Calendar, Filter, UserCheck, BookOpen, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import PfImportButton from '@/app/components/PfImportButton';

interface Student {
  id: string;
  index: number;
  uid: string;
  student_name: string;
  lifetime_id: string;
  grade: string;
  classroom: string;
  day_of_week: string;
  [key: string]: any;
}

// 3月スタート、翌年2月までのマップ
const MONTH_MAP: { [key: string]: number[] } = {
  '3月': [1, 2, 3, 4],
  '4月': [5, 6, 7, 8],
  '5月': [9, 10, 11, 12],
  '6月': [13, 14, 15, 16],
  '7月': [17, 18, 19, 20],
  '8月': [21, 22, 23, 24],
  '9月': [25, 26, 27, 28],
  '10月': [29, 30, 31, 32],
  '11月': [33, 34, 35, 36],
  '12月': [37, 38, 39, 40],
  '1月': [41, 42, 43, 44],
  '2月': [45, 46, 47, 48],
  '全期間': Array.from({ length: 48 }, (_, i) => i + 1),
};

const MONTH_ORDER = ['3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月'];
const DAYS_OPTIONS = ['月', '火', '水', '木', '金', '土'];

export default function MasterPFPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<{ [key: string]: { [key: string]: any } }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());
  const [currentWeek, setCurrentWeek] = useState('1'); 
  const [selectedMonth, setSelectedMonth] = useState('3月');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClassroom, setFilterClassroom] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterGrade, setFilterGrade] = useState('all');
  const [sortBy, setSortBy] = useState<'id' | 'attendance' | 'homework'>('id');

  const [classrooms, setClassrooms] = useState<string[]>([]);

  const visibleWeeks = MONTH_MAP[selectedMonth] || MONTH_MAP['全期間'];

  // 今月の自動選択
  useEffect(() => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const monthStr = `${month}月`;
    if (MONTH_MAP[monthStr]) {
      setSelectedMonth(monthStr);
    }
  }, []);

  // データ取得
  const fetchData = async () => {
    setLoading(true);
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      if (settingsSnap.exists()) {
        const data = settingsSnap.data();
        if (data.current_week) setCurrentWeek(data.current_week);
      }

      const qUsers = query(collection(db, 'users'), where('role', '==', 'student'));
      const snapUsers = await getDocs(qUsers);
      
      const list = snapUsers.docs.map((doc, index) => {
        const data = doc.data();
        return {
          id: doc.id,
          index: index + 1,
          uid: doc.id,
          student_name: data.student_name || '',
          lifetime_id: data.lifetime_id || '',
          grade: data.grade || '',
          classroom: data.classroom || '',
          day_of_week: data.day_of_week || '',
          ...data
        } as Student;
      });
      
      list.sort((a, b) => (a.grade || '').localeCompare(b.grade || '') || (a.student_name || '').localeCompare(b.student_name || ''));
      list.forEach((s, i) => s.index = i + 1);

      setStudents(list);
      const cls = Array.from(new Set(list.map(s => s.classroom).filter(Boolean))).sort();
      setClassrooms(cls);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // レコード取得
  useEffect(() => {
    const fetchRecords = async () => {
      if (students.length === 0) return;
      setLoading(true);
      try {
        const qRecords = query(collection(db, 'pf_records'), where('year', '==', currentYear));
        const snapRecords = await getDocs(qRecords);
        const recordMap: { [key: string]: { [key: string]: any } } = {};
        
        snapRecords.forEach(doc => {
          const data = doc.data();
          const sid = data.student_id;
          const week = data.week_number;
          if (!recordMap[sid]) recordMap[sid] = {};
          recordMap[sid][week] = data;
        });
        setRecords(recordMap);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchRecords();
  }, [currentYear, students]);

  // 統計計算
  const calculateStats = (studentId: string) => {
    const studentRecs = records[studentId] || {};
    let attendCount = 0, absentCount = 0, hwSubmittedCount = 0, totalClasses = 0;
    const calcWeeks = Array.from({length: Number(currentWeek)}, (_, i) => i + 1);

    calcWeeks.forEach(week => {
      const r = studentRecs[week];
      if (r) {
        if (r.attendance_status) {
          totalClasses++;
          if (r.attendance_status === '出' || r.attendance_status === '遅') attendCount++;
          if (r.attendance_status === '欠') absentCount++;
        }
        if ((r.social_hw && r.social_hw !== '未') || (r.science_hw && r.science_hw !== '未')) hwSubmittedCount++;
      }
    });

    const attRate = totalClasses > 0 ? Math.round((attendCount / totalClasses) * 100) : 0;
    const hwRate = totalClasses > 0 ? Math.round((hwSubmittedCount / totalClasses) * 100) : 0;

    let attAlert = '';
    if (absentCount >= 3) attAlert = '警告③';
    else if (absentCount >= 1) attAlert = '注意①';

    let hwAlert = '';
    if (totalClasses > 0 && hwRate < 50) hwAlert = '低提出';

    return { attRate, hwRate, attAlert, hwAlert };
  };

  // フィルタリング
  useEffect(() => {
    let result = students;

    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.student_name.includes(lower) || 
        s.grade.includes(lower) || 
        String(s.lifetime_id).includes(lower)
      );
    }
    if (filterClassroom !== 'all') result = result.filter(s => s.classroom === filterClassroom);
    if (filterDay !== 'all') result = result.filter(s => s.day_of_week && s.day_of_week.includes(filterDay));
    if (filterGrade !== 'all') result = result.filter(s => s.grade === filterGrade);

    if (sortBy !== 'id') {
      result = [...result].sort((a, b) => {
        const statsA = calculateStats(a.id);
        const statsB = calculateStats(b.id);
        if (sortBy === 'attendance') return statsA.attRate - statsB.attRate;
        if (sortBy === 'homework') return statsA.hwRate - statsB.hwRate;
        return 0;
      });
    } else {
      result.sort((a, b) => a.index - b.index);
    }
    setFilteredStudents(result);
  }, [students, searchQuery, filterClassroom, filterDay, filterGrade, sortBy, records, currentWeek]);

  // 全体統計
  const summaryStats = useMemo(() => {
    if (filteredStudents.length === 0) return { attAvg: 0, hwAvg: 0, alertCount: 0 };

    let totalAttRate = 0;
    let totalHwRate = 0;
    let alertCount = 0;
    let validCount = 0;

    filteredStudents.forEach(s => {
      const stats = calculateStats(s.id);
      totalAttRate += stats.attRate;
      totalHwRate += stats.hwRate;
      if (stats.attAlert || stats.hwAlert) alertCount++;
      validCount++;
    });

    const attAvg = validCount > 0 ? Math.round(totalAttRate / validCount) : 0;
    const hwAvg = validCount > 0 ? Math.round(totalHwRate / validCount) : 0;

    return { attAvg, hwAvg, alertCount };
  }, [filteredStudents, records, currentWeek]);

  const handleInputChange = (studentId: string, week: number, field: string, value: string) => {
    setRecords(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [week]: {
          ...(prev[studentId]?.[week] || {}),
          student_id: studentId, week_number: String(week), year: currentYear, [field]: value
        }
      }
    }));
  };

  const handleSave = async () => {
    if (!confirm(`${currentYear}年度のデータとして保存しますか？`)) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      let count = 0;
      Object.keys(records).forEach(sid => {
        Object.keys(records[sid]).forEach(week => {
          const data = records[sid][week];
          if (!data) return;
          const docId = `${sid}_${currentYear}_w${week}`;
          batch.set(doc(db, 'pf_records', docId), { ...data, year: currentYear, updated_at: new Date().toISOString() }, { merge: true });
          count++;
        });
      });
      if (count > 0) await batch.commit();
      alert('保存完了');
    } catch (e: any) { alert('エラー: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleExportCSV = () => {
    let csv = `\uFEFF${currentYear}年度PFデータ\nNo,教室,生涯番号,氏名,学年,年間出席率,年間宿題率\n`;
    filteredStudents.forEach(s => {
      const stats = calculateStats(s.id);
      csv += `${s.index},${s.classroom},${s.lifetime_id},${s.student_name},${s.grade},${stats.attRate}%,${stats.hwRate}%\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `PF_${currentYear}.csv`;
    link.click();
  };

  const switchMonth = (dir: 'prev' | 'next') => {
    const idx = MONTH_ORDER.indexOf(selectedMonth);
    let newIdx = dir === 'next' ? idx + 1 : idx - 1;
    if (newIdx < 0) newIdx = MONTH_ORDER.length - 1;
    if (newIdx >= MONTH_ORDER.length) newIdx = 0;
    setSelectedMonth(MONTH_ORDER[newIdx]);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 pb-20 font-sans text-xs">
      
      {/* ヘッダー */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 sticky top-0 z-30">
        
        {/* 最上部 */}
        <div className="bg-slate-800 text-white p-3 rounded-t-xl flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <Link href="/master" className="p-1.5 hover:bg-white/20 rounded-full transition-colors"><ArrowLeft size={18}/></Link>
            <h1 className="font-bold flex items-center gap-2 text-base"><RefreshCw size={18} className="text-cyan-400"/> PF管理</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-600">
              <Calendar size={14} className="text-cyan-400"/>
              <select className="bg-transparent font-bold text-white outline-none cursor-pointer text-sm" value={currentYear} onChange={(e) => setCurrentYear(e.target.value)}>
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y} className="text-black">{y}年度</option>)}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
               <span className="text-[10px] opacity-70">集計基準:</span>
               <select className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs outline-none cursor-pointer text-white font-mono" value={currentWeek} onChange={(e) => setCurrentWeek(e.target.value)}>
                 {Array.from({length:48},(_,i)=>i+1).map(w => <option key={w} value={String(w)} className="text-black">第 {w} 週</option>)}
               </select>
            </div>

            <PfImportButton onSuccess={fetchData} />
          </div>
        </div>

        {/* 統計ダッシュボード */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-200 bg-white">
          <div className="p-3 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1 mb-1"><UserCheck size={12}/> 全体出席率</span>
            <span className={`text-xl font-black font-mono ${summaryStats.attAvg >= 90 ? 'text-blue-600' : summaryStats.attAvg >= 80 ? 'text-gray-700' : 'text-red-500'}`}>
              {summaryStats.attAvg}%
            </span>
          </div>
          <div className="p-3 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1 mb-1"><BookOpen size={12}/> 宿題提出率</span>
            <span className={`text-xl font-black font-mono ${summaryStats.hwAvg >= 80 ? 'text-green-600' : summaryStats.hwAvg >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
              {summaryStats.hwAvg}%
            </span>
          </div>
          <div className="p-3 flex flex-col items-center justify-center bg-red-50/30">
            <span className="text-[10px] font-bold text-red-400 flex items-center gap-1 mb-1"><AlertTriangle size={12}/> アラート対象</span>
            <span className="text-xl font-black font-mono text-red-600">{summaryStats.alertCount} <span className="text-xs font-medium">名</span></span>
          </div>
        </div>

        {/* フィルター & 操作 */}
        <div className="p-3 flex flex-wrap gap-3 items-center justify-between bg-gray-50 rounded-b-xl border-t border-gray-200">
          <div className="flex flex-wrap gap-2 items-center">
            {/* 月選択 */}
            <div className="flex items-center bg-white rounded-lg p-0.5 border border-gray-300 shadow-sm mr-2">
              <button onClick={() => switchMonth('prev')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><ChevronLeft size={14}/></button>
              <select className="bg-transparent text-sm font-bold px-2 outline-none cursor-pointer text-slate-700 py-1" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {MONTH_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="全期間">全期間</option>
              </select>
              <button onClick={() => switchMonth('next')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><ChevronRight size={14}/></button>
            </div>

            {/* 検索・絞り込み */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14}/>
              <input type="text" className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-28 md:w-40 outline-none focus:border-cyan-500 transition-colors" placeholder="氏名/ID..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            
            <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg px-2 py-1.5">
              <Filter size={12} className="text-gray-400" />
              <select className="bg-transparent text-xs outline-none cursor-pointer font-medium text-gray-600" value={filterClassroom} onChange={e => setFilterClassroom(e.target.value)}>
                <option value="all">全校舎</option>
                {classrooms.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            
            <select className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer font-medium text-gray-600" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
              <option value="all">全曜日</option>
              {DAYS_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <select className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer font-medium text-gray-600" value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
              <option value="all">全学年</option>
              <option value="中1">中1</option>
              <option value="中2">中2</option>
              <option value="中3">中3</option>
            </select>
          </div>

          <div className="flex gap-2">
            <select className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-[10px] text-orange-700 font-bold outline-none cursor-pointer" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="id">ID順</option>
              <option value="attendance">欠席多い順</option>
              <option value="homework">未提出多い順</option>
            </select>

            <button onClick={handleExportCSV} className="flex items-center gap-1 bg-white border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-50 text-[10px] shadow-sm"><Download size={12}/> CSV</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 bg-cyan-600 text-white px-4 py-1.5 rounded-lg font-bold hover:bg-cyan-700 disabled:opacity-50 text-[10px] shadow-sm shadow-cyan-200 transition-all active:scale-95">{saving ? <Loader2 className="animate-spin" size={12}/> : <Save size={12}/>} 保存</button>
          </div>
        </div>
      </div>

      {/* メインテーブル */}
      {loading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin text-cyan-500" size={32}/></div>
      ) : (
        <div className="bg-white rounded-lg shadow-md border border-gray-300 overflow-x-auto max-h-[75vh]">
          <table className="min-w-max border-collapse text-[10px]">
            <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 z-20 shadow-sm h-12">
              <tr>
                {/* 固定カラム */}
                <th className="p-1 border border-gray-300 w-8 text-center sticky left-0 bg-gray-100 z-30">No</th>
                <th className="p-1 border border-gray-300 w-12 text-center sticky left-8 bg-gray-100 z-30">教室</th>
                <th className="p-1 border border-gray-300 w-16 text-center sticky left-20 bg-gray-100 z-30">ID</th>
                <th className="p-1 border border-gray-300 w-24 text-center sticky left-36 bg-gray-100 z-30 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.1)]">氏名</th>
                <th className="p-1 border border-gray-300 w-8 text-center">学年</th>
                <th className="p-1 border border-gray-300 w-8 text-center">曜</th>
                
                {/* 統計カラム */}
                <th className="p-1 border border-gray-300 w-10 text-center bg-red-50 text-red-700">出席<br/>警報</th>
                <th className="p-1 border border-gray-300 w-10 text-center bg-orange-50 text-orange-700">宿題<br/>警報</th>
                <th className="p-1 border border-gray-300 w-8 text-center">出率</th>
                <th className="p-1 border border-gray-300 w-8 text-center">提率</th>

                {/* 週ごとの入力カラム（縦積み） */}
                {visibleWeeks.map(w => (
                  <th key={w} className={`p-0 border border-gray-300 text-center min-w-[40px] max-w-[50px] ${String(w)===currentWeek ? 'bg-cyan-100 text-cyan-900 border-cyan-400 border-2' : 'bg-slate-50'}`}>
                    <div className="py-0.5 text-[9px]">w{w}</div>
                    <div className="flex flex-col text-[8px] font-normal border-t border-gray-300/50">
                      <span className="border-b border-gray-300/50 bg-white/50 h-4 leading-4">出</span>
                      <span className="border-b border-gray-300/50 bg-white/50 h-4 leading-4">社</span>
                      <span className="h-4 leading-4 bg-white/50">理</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-800 bg-white">
              {filteredStudents.length === 0 ? (
                <tr><td colSpan={20} className="p-10 text-center text-gray-400 text-sm font-bold bg-gray-50">該当なし</td></tr>
              ) : filteredStudents.map((student) => {
                const stats = calculateStats(student.id);
                return (
                  <tr key={student.id} className="hover:bg-yellow-50 transition-colors h-14 group">
                    <td className="p-1 border border-gray-300 text-center sticky left-0 bg-white group-hover:bg-yellow-50 z-10 font-mono">{student.index}</td>
                    <td className="p-1 border border-gray-300 text-center sticky left-8 bg-white group-hover:bg-yellow-50 z-10">{student.classroom?.substring(0,3)}</td>
                    <td className="p-1 border border-gray-300 text-center sticky left-20 bg-white group-hover:bg-yellow-50 z-10 font-mono text-[9px]">{student.lifetime_id}</td>
                    <td className="p-1 border border-gray-300 font-bold sticky left-36 bg-white group-hover:bg-yellow-50 z-10 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-nowrap overflow-hidden text-ellipsis max-w-[96px]">{student.student_name}</td>
                    <td className="p-1 border border-gray-300 text-center">{student.grade}</td>
                    <td className="p-1 border border-gray-300 text-center">{student.day_of_week}</td>
                    <td className={`p-1 border border-gray-300 text-center font-bold text-[8px] ${stats.attAlert ? 'bg-red-100 text-red-600' : ''}`}>{stats.attAlert}</td>
                    <td className={`p-1 border border-gray-300 text-center font-bold text-[8px] ${stats.hwAlert ? 'bg-orange-100 text-orange-600' : ''}`}>{stats.hwAlert}</td>
                    <td className="p-1 border border-gray-300 text-center font-mono">{stats.attRate}%</td>
                    <td className="p-1 border border-gray-300 text-center font-mono">{stats.hwRate}%</td>
                    
                    {visibleWeeks.map(w => {
                      const rec = records[student.id]?.[w] || {};
                      const att = rec.attendance_status || '';
                      const soc = rec.social_hw || '';
                      const sci = rec.science_hw || '';
                      const isCurrent = String(w) === currentWeek;
                      return (
                        <td key={w} className={`p-0 border border-gray-300 ${isCurrent ? 'bg-cyan-50 border-x-2 border-cyan-200' : ''}`}>
                          {/* 縦積み入力フィールド */}
                          <div className="flex flex-col h-full w-full">
                            <select 
                              className={`h-5 w-full text-center outline-none appearance-none cursor-pointer border-b border-gray-200 font-bold text-[9px] ${att==='欠'?'bg-red-50 text-red-600':att==='遅'?'bg-yellow-50 text-yellow-600':att==='出'?'bg-blue-50 text-blue-600':'bg-transparent hover:bg-gray-50'}`} 
                              value={att} 
                              onChange={(e) => handleInputChange(student.id, w, 'attendance_status', e.target.value)}
                            >
                              <option value=""></option><option value="出">出</option><option value="遅">遅</option><option value="欠">欠</option>
                            </select>
                            <input type="text" className="h-5 w-full text-center outline-none border-b border-gray-200 focus:bg-orange-100 font-mono text-[9px] bg-transparent p-0 hover:bg-gray-50" value={soc} onChange={(e) => handleInputChange(student.id, w, 'social_hw', e.target.value)} />
                            <input type="text" className="h-5 w-full text-center outline-none focus:bg-green-100 font-mono text-[9px] bg-transparent p-0 hover:bg-gray-50" value={sci} onChange={(e) => handleInputChange(student.id, w, 'science_hw', e.target.value)} />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}