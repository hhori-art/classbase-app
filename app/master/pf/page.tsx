'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch, getDoc } from 'firebase/firestore';
import { ArrowLeft, Save, Loader2, Search, Download, RefreshCw, ChevronLeft, ChevronRight, Calendar, Filter } from 'lucide-react';
import Link from 'next/link';
import PfImportButton from '@/app/components/PfImportButton'; // インポートボタン

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

const MONTH_MAP: { [key: string]: number[] } = {
  '3月': [1, 2, 3],
  '4月': [4, 5, 6, 7],
  '5月': [8, 9, 10, 11],
  '6月': [12, 13, 14, 15],
  '7月': [16, 17, 18, 19],
  '8月': [20, 21, 22],
  '9月': [23, 24, 25, 26],
  '10月': [27, 28, 29, 30],
  '11月': [31, 32, 33, 34],
  '12月': [35, 36, 37, 38],
  '全期間': Array.from({ length: 40 }, (_, i) => i + 1),
};

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

  // データ取得関数
  const fetchData = async () => {
    setLoading(true);
    try {
      // 設定取得
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      if (settingsSnap.exists()) {
        const data = settingsSnap.data();
        // ここでは初期ロード時のみ設定値を反映し、ユーザー操作後はStateを優先する
        if (!currentWeek || currentWeek === '1') setCurrentWeek(data.current_week || '1');
        
        // 月の自動選択
        const w = Number(data.current_week || '1');
        const m = Object.keys(MONTH_MAP).find(k => k!=='全期間' && MONTH_MAP[k].includes(w));
        if (m) setSelectedMonth(m);
      }

      // 生徒一覧
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

  // レコード取得 (年度や生徒が変わった時)
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
    if (absentCount >= 3) attAlert = '要対応③';
    else if (absentCount >= 1) attAlert = '要対応①';

    let hwAlert = '';
    if (totalClasses > 0 && hwRate < 50) hwAlert = '要対応';

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

  // 今週の統計
  const weekStats = useMemo(() => {
    if (filteredStudents.length === 0) return { att: 0, hw: 0, late: 0 };
    let totalAtt = 0, totalLate = 0, totalHw = 0, count = 0;
    filteredStudents.forEach(s => {
      const rec = records[s.id]?.[currentWeek];
      if (rec) {
        count++;
        if (rec.attendance_status === '出') totalAtt++;
        if (rec.attendance_status === '遅') { totalAtt++; totalLate++; }
        if ((rec.social_hw && rec.social_hw !== '未') || (rec.science_hw && rec.science_hw !== '未')) totalHw++;
      }
    });
    if (count === 0) return { att: 0, hw: 0, late: 0 };
    return { att: Math.round((totalAtt/count)*100), late: totalLate, hw: Math.round((totalHw/count)*100) };
  }, [filteredStudents, records, currentWeek]);

  // 入力ハンドラ
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

  // 保存
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

  // CSVエクスポート
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
    const months = Object.keys(MONTH_MAP).filter(m => m !== '全期間');
    const idx = months.indexOf(selectedMonth);
    let newIdx = dir === 'next' ? idx + 1 : idx - 1;
    if (newIdx < 0) newIdx = months.length - 1;
    if (newIdx >= months.length) newIdx = 0;
    setSelectedMonth(months[newIdx]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20 font-sans text-xs">
      
      {/* 統合ヘッダー */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 sticky top-0 z-30">
        <div className="bg-indigo-900 text-white p-2 rounded-t-xl flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/master" className="p-1 hover:bg-white/20 rounded-full"><ArrowLeft size={16}/></Link>
            <h1 className="font-bold flex items-center gap-2 text-sm"><RefreshCw size={16}/> 【管理者】PFデータ管理</h1>
          </div>

          <div className="flex items-center gap-2 bg-indigo-800/50 px-3 py-1 rounded-lg border border-white/10">
            <Calendar size={14} className="text-white/70"/>
            <select className="bg-transparent font-bold text-white outline-none cursor-pointer text-sm" value={currentYear} onChange={(e) => setCurrentYear(e.target.value)}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y} className="text-black">{y}年度</option>)}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
             <span className="text-[10px] opacity-70">集計週:</span>
             <select className="bg-white/10 border border-white/30 rounded px-1 py-0.5 text-xs outline-none cursor-pointer" value={currentWeek} onChange={(e) => setCurrentWeek(e.target.value)}>
               {Array.from({length:40},(_,i)=>i+1).map(w => <option key={w} value={String(w)} className="text-black">第 {w} 週</option>)}
             </select>
          </div>

          {/* ★管理者用インポートボタン */}
          <div>
            <PfImportButton onSuccess={fetchData} />
          </div>
        </div>

        {/* フィルター & 操作 */}
        <div className="p-2 flex flex-wrap gap-3 items-center justify-between bg-white rounded-b-xl">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border border-gray-200 mr-2">
              <button onClick={() => switchMonth('prev')} className="p-1 hover:bg-white rounded shadow-sm"><ChevronLeft size={14}/></button>
              <select className="bg-transparent text-xs font-bold px-2 outline-none cursor-pointer text-indigo-700" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {Object.keys(MONTH_MAP).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => switchMonth('next')} className="p-1 hover:bg-white rounded shadow-sm"><ChevronRight size={14}/></button>
            </div>

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={12}/>
              <input type="text" className="pl-7 pr-2 py-1 border rounded-md text-xs w-24 md:w-32 outline-none" placeholder="氏名/ID..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            
            <div className="flex items-center gap-1">
              <Filter size={12} className="text-gray-400" />
              <select className="bg-gray-50 border rounded-md px-1 py-1 text-xs outline-none cursor-pointer max-w-[100px]" value={filterClassroom} onChange={e => setFilterClassroom(e.target.value)}>
                <option value="all">全校舎</option>
                {classrooms.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            
            <select className="bg-gray-50 border rounded-md px-1 py-1 text-xs outline-none cursor-pointer" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
              <option value="all">全曜日</option>
              {DAYS_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <select className="bg-gray-50 border rounded-md px-1 py-1 text-xs outline-none cursor-pointer" value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
              <option value="all">全学年</option>
              <option value="中1">中1</option>
              <option value="中2">中2</option>
              <option value="中3">中3</option>
            </select>
          </div>

          <div className="flex gap-2">
            <select className="bg-orange-50 border border-orange-100 rounded-md px-2 py-1 text-[10px] text-orange-700 font-bold outline-none cursor-pointer" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="id">ID順</option>
              <option value="attendance">欠席多い順</option>
              <option value="homework">未提出多い順</option>
            </select>

            <button onClick={handleExportCSV} className="flex items-center gap-1 bg-gray-100 text-gray-600 px-3 py-1 rounded-md font-bold hover:bg-gray-200 text-[10px]"><Download size={12}/> CSV</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1 rounded-md font-bold hover:bg-indigo-700 disabled:opacity-50 text-[10px]">{saving ? <Loader2 className="animate-spin" size={12}/> : <Save size={12}/>} 保存</button>
          </div>
        </div>
      </div>

      {/* メインテーブル */}
      {loading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin text-indigo-400"/></div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-300 overflow-x-auto max-h-[75vh]">
          <table className="min-w-max border-collapse text-[10px]">
            <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 z-20 shadow-sm h-10">
              <tr>
                <th className="p-1 border border-gray-300 w-8 text-center sticky left-0 bg-gray-100 z-30">No</th>
                <th className="p-1 border border-gray-300 w-12 text-center sticky left-8 bg-gray-100 z-30">教室</th>
                <th className="p-1 border border-gray-300 w-16 text-center sticky left-20 bg-gray-100 z-30">ID</th>
                <th className="p-1 border border-gray-300 w-24 text-center sticky left-36 bg-gray-100 z-30 shadow-md">氏名</th>
                <th className="p-1 border border-gray-300 w-8 text-center">学年</th>
                <th className="p-1 border border-gray-300 w-8 text-center">曜</th>
                <th className="p-1 border border-gray-300 w-12 text-center bg-red-50 text-red-700">出席<br/>警報</th>
                <th className="p-1 border border-gray-300 w-12 text-center bg-orange-50 text-orange-700">宿題<br/>警報</th>
                <th className="p-1 border border-gray-300 w-10 text-center">出率</th>
                <th className="p-1 border border-gray-300 w-10 text-center">提率</th>

                {visibleWeeks.map(w => (
                  <th key={w} colSpan={3} className={`p-0 border border-gray-300 text-center min-w-[75px] ${String(w)===currentWeek ? 'bg-indigo-100 text-indigo-900 border-indigo-300 border-2' : 'bg-blue-50/50'}`}>
                    第{w}週
                    <div className="grid grid-cols-3 text-[9px] font-normal border-t border-gray-300/50">
                      <span className="border-r">出</span><span className="border-r">社</span><span>理</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-800 bg-white">
              {filteredStudents.length === 0 ? (
                <tr><td colSpan={20} className="p-10 text-center text-gray-400 text-sm">該当生徒なし (CSVインポートで生徒情報を更新してください)</td></tr>
              ) : filteredStudents.map((student) => {
                const stats = calculateStats(student.id);
                return (
                  <tr key={student.id} className="hover:bg-yellow-50 transition-colors h-8">
                    <td className="p-1 border border-gray-300 text-center sticky left-0 bg-white z-10 font-mono">{student.index}</td>
                    <td className="p-1 border border-gray-300 text-center sticky left-8 bg-white z-10">{student.classroom?.substring(0,3)}</td>
                    <td className="p-1 border border-gray-300 text-center sticky left-20 bg-white z-10 font-mono text-[9px]">{student.lifetime_id}</td>
                    <td className="p-1 border border-gray-300 font-bold sticky left-36 bg-white z-10 shadow-md whitespace-nowrap overflow-hidden text-ellipsis max-w-[96px]">{student.student_name}</td>
                    <td className="p-1 border border-gray-300 text-center">{student.grade}</td>
                    <td className="p-1 border border-gray-300 text-center">{student.day_of_week}</td>
                    <td className={`p-1 border border-gray-300 text-center font-bold text-[9px] ${stats.attAlert ? 'bg-red-100 text-red-600' : ''}`}>{stats.attAlert}</td>
                    <td className={`p-1 border border-gray-300 text-center font-bold text-[9px] ${stats.hwAlert ? 'bg-orange-100 text-orange-600' : ''}`}>{stats.hwAlert}</td>
                    <td className="p-1 border border-gray-300 text-center font-mono">{stats.attRate}%</td>
                    <td className="p-1 border border-gray-300 text-center font-mono">{stats.hwRate}%</td>
                    {visibleWeeks.map(w => {
                      const rec = records[student.id]?.[w] || {};
                      const att = rec.attendance_status || '';
                      const soc = rec.social_hw || '';
                      const sci = rec.science_hw || '';
                      const isCurrent = String(w) === currentWeek;
                      return (
                        <td key={w} className={`p-0 border border-gray-300 ${isCurrent ? 'bg-indigo-50 border-x-2 border-indigo-200' : ''}`}>
                          <div className="grid grid-cols-3 h-full min-h-[28px]">
                            <select className={`h-full w-full text-center outline-none appearance-none cursor-pointer border-r border-gray-100 font-bold text-[9px] ${att==='欠'?'bg-red-50 text-red-600':att==='遅'?'bg-yellow-50 text-yellow-600':att==='出'?'bg-blue-50 text-blue-600':'bg-transparent'}`} value={att} onChange={(e) => handleInputChange(student.id, w, 'attendance_status', e.target.value)}>
                              <option value=""></option><option value="出">出</option><option value="遅">遅</option><option value="欠">欠</option>
                            </select>
                            <input type="text" className="h-full w-full text-center outline-none border-r border-gray-100 focus:bg-orange-50 font-mono text-[9px] bg-transparent p-0" value={soc} onChange={(e) => handleInputChange(student.id, w, 'social_hw', e.target.value)} />
                            <input type="text" className="h-full w-full text-center outline-none focus:bg-green-50 font-mono text-[9px] bg-transparent p-0" value={sci} onChange={(e) => handleInputChange(student.id, w, 'science_hw', e.target.value)} />
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