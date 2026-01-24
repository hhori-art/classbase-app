'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch, getDoc, setDoc } from 'firebase/firestore';
import { 
  ArrowLeft, Save, Loader2, Search, Download, RefreshCw, 
  ChevronLeft, ChevronRight, Calendar, Filter, AlertCircle, CheckCircle, BookOpen 
} from 'lucide-react';
import Link from 'next/link';

// 生徒データの型定義
interface Student {
  id: string;
  uid: string;
  student_name: string;
  lifetime_id: string;
  grade: string;
  classroom: string;
  day_of_week: string;
  // 科目情報
  subject_1?: string;
  subject_2?: string;
  subject_3?: string;
  subject_4?: string;
  subject_5?: string;
  subject_science?: string;
  subject_social?: string;
  [key: string]: any;
}

// アラート解決状況の型
interface Resolution {
  att: boolean; // 出席アラート解決済みか
  hw: boolean;  // 宿題アラート解決済みか
}

// 月ごとの週範囲設定
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

const DAYS_OF_WEEK = ['月', '火', '水', '木', '金', '土'];

export default function TeacherPFPage() {
  // 基本データ
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<{ [key: string]: { [key: string]: any } }>({});
  const [resolutions, setResolutions] = useState<{ [key: string]: Resolution }>({}); // アラート解決状況
  
  // UI状態
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 設定 & フィルター
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());
  const [currentWeek, setCurrentWeek] = useState('1'); 
  const [selectedMonth, setSelectedMonth] = useState('3月');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClassroom, setFilterClassroom] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all'); // ★科目フィルター
  
  const [sortBy, setSortBy] = useState<'id' | 'attendance' | 'homework'>('id');

  const [classrooms, setClassrooms] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]); // ★全科目リスト

  const visibleWeeks = useMemo(() => MONTH_MAP[selectedMonth] || MONTH_MAP['全期間'], [selectedMonth]);

  // 初期データロード
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // 設定取得
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        let nowWeek = '1';
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          nowWeek = data.current_week || '1';
          if (data.current_year) setCurrentYear(data.current_year);
          setCurrentWeek(nowWeek);
        }

        const wNum = Number(nowWeek);
        const foundMonth = Object.keys(MONTH_MAP).find(m => m !== '全期間' && MONTH_MAP[m].includes(wNum));
        if (foundMonth) setSelectedMonth(foundMonth);

        // 生徒取得
        const qUsers = query(collection(db, 'users'), where('role', '==', 'student'));
        const snapUsers = await getDocs(qUsers);
        
        const list = snapUsers.docs.map(doc => ({
          id: doc.id,
          uid: doc.id,
          ...doc.data()
        } as Student));
        
        // 校舎リスト抽出
        const cls = Array.from(new Set(list.map(s => s.classroom).filter(Boolean))).sort();
        
        // ★科目リスト抽出
        const subSet = new Set<string>();
        list.forEach(s => {
          [s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5, s.subject_science, s.subject_social]
            .forEach(sub => {
              if (sub && typeof sub === 'string' && sub.trim() !== '') subSet.add(sub);
            });
        });
        
        setStudents(list);
        setClassrooms(cls);
        setSubjects(Array.from(subSet).sort());

      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // レコード & 解決状況 取得
  useEffect(() => {
    if (students.length === 0) return;
    
    const loadRecords = async () => {
      setLoading(true);
      try {
        // PFレコード取得
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

        // ★アラート解決状況取得
        const qRes = query(collection(db, 'pf_resolutions'), where('year', '==', currentYear));
        const snapRes = await getDocs(qRes);
        const resMap: { [key: string]: Resolution } = {};
        snapRes.forEach(doc => {
          // doc.id は studentId_year
          const data = doc.data();
          resMap[data.student_id] = { att: data.att || false, hw: data.hw || false };
        });
        setResolutions(resMap);

      } catch (e) { console.error(e); } 
      finally { setLoading(false); }
    };
    loadRecords();
  }, [currentYear, students.length]);

  // ★統計情報の一括計算 (アラート判定含む)
  const statsMap = useMemo(() => {
    const map: { [key: string]: { attRate: number, hwRate: number, attAlert: string, hwAlert: string, isAttResolved: boolean, isHwResolved: boolean } } = {};
    const calcWeeks = Array.from({length: Number(currentWeek)}, (_, i) => i + 1);

    students.forEach(s => {
      const studentRecs = records[s.id] || {};
      let attendCount = 0, absentCount = 0, hwSubmittedCount = 0, totalClasses = 0;

      calcWeeks.forEach(week => {
        const r = studentRecs[week];
        if (r) {
          if (r.attendance_status) {
            totalClasses++;
            if (r.attendance_status === '出' || r.attendance_status === '遅') attendCount++;
            if (r.attendance_status === '欠') absentCount++;
          }
          if ((r.social_hw && r.social_hw !== '未') || (r.science_hw && r.science_hw !== '未')) {
            hwSubmittedCount++;
          }
        }
      });

      const attRate = totalClasses > 0 ? Math.round((attendCount / totalClasses) * 100) : 0;
      const hwRate = totalClasses > 0 ? Math.round((hwSubmittedCount / totalClasses) * 100) : 0;

      // アラートロジック
      let attAlert = '';
      if (absentCount >= 3) attAlert = '要対応③';
      else if (absentCount >= 1) attAlert = '要対応①';

      let hwAlert = '';
      if (totalClasses > 0 && hwRate < 50) hwAlert = '要対応';

      // 解決済みフラグ
      const res = resolutions[s.id] || { att: false, hw: false };

      map[s.id] = { 
        attRate, hwRate, 
        attAlert, hwAlert,
        isAttResolved: res.att,
        isHwResolved: res.hw
      };
    });
    return map;
  }, [students, records, currentWeek, resolutions]);

  // ★フィルタリングとソート
  const displayStudents = useMemo(() => {
    let result = students;

    // フィルタ
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(s => 
        (s.student_name || '').includes(lower) || 
        (s.grade || '').includes(lower) || 
        String(s.lifetime_id || '').includes(lower)
      );
    }
    if (filterClassroom !== 'all') result = result.filter(s => s.classroom === filterClassroom);
    if (filterDay !== 'all') result = result.filter(s => s.day_of_week && s.day_of_week.includes(filterDay));
    if (filterGrade !== 'all') result = result.filter(s => s.grade === filterGrade);
    
    // ★科目フィルター実装
    if (filterSubject !== 'all') {
      result = result.filter(s => {
        const mySubjects = [
          s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5, 
          s.subject_science, s.subject_social
        ];
        return mySubjects.includes(filterSubject);
      });
    }

    // ソート
    result = [...result].sort((a, b) => {
      if (sortBy === 'attendance') return statsMap[a.id].attRate - statsMap[b.id].attRate;
      if (sortBy === 'homework') return statsMap[a.id].hwRate - statsMap[b.id].hwRate;
      
      const gradeDiff = (a.grade || '').localeCompare(b.grade || '');
      if (gradeDiff !== 0) return gradeDiff;
      return (a.student_name || '').localeCompare(b.student_name || '');
    });

    return result;
  }, [students, searchQuery, filterClassroom, filterDay, filterGrade, filterSubject, sortBy, statsMap]);

  // 今週の統計
  const weekStats = useMemo(() => {
    if (displayStudents.length === 0) return { att: 0, hw: 0, late: 0 };
    let totalAtt = 0, totalLate = 0, totalHw = 0, count = 0;

    displayStudents.forEach(s => {
      const rec = records[s.id]?.[currentWeek];
      if (rec) {
        count++;
        if (rec.attendance_status === '出') totalAtt++;
        if (rec.attendance_status === '遅') { totalAtt++; totalLate++; }
        if ((rec.social_hw && rec.social_hw !== '未') || (rec.science_hw && rec.science_hw !== '未')) totalHw++;
      }
    });

    if (count === 0) return { att: 0, hw: 0, late: 0 };
    return {
      att: Math.round((totalAtt / count) * 100),
      late: totalLate,
      hw: Math.round((totalHw / count) * 100)
    };
  }, [displayStudents, records, currentWeek]);

  // 入力ハンドラ
  const handleInputChange = (studentId: string, week: number, field: string, value: string) => {
    setRecords(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [week]: {
          ...(prev[studentId]?.[week] || {}),
          student_id: studentId,
          week_number: String(week),
          year: currentYear,
          [field]: value
        }
      }
    }));
  };

  // ★アラート解決トグル
  const toggleAlertResolution = async (studentId: string, type: 'att' | 'hw') => {
    // 状態を反転
    const currentRes = resolutions[studentId] || { att: false, hw: false };
    const newStatus = !currentRes[type];
    
    // ローカル更新
    setResolutions(prev => ({
      ...prev,
      [studentId]: { ...currentRes, [type]: newStatus }
    }));

    // Firestore保存 (pf_resolutionsコレクション)
    // IDは studentId_year
    const docId = `${studentId}_${currentYear}`;
    try {
      await setDoc(doc(db, 'pf_resolutions', docId), {
        student_id: studentId,
        year: currentYear,
        [type]: newStatus, // att または hw を更新
        updated_at: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.error('Alert resolution save failed:', e);
      alert('保存に失敗しました');
      // ロールバック
      setResolutions(prev => ({
        ...prev,
        [studentId]: currentRes
      }));
    }
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
          const ref = doc(db, 'pf_records', docId);
          batch.set(ref, { 
            ...data, 
            year: currentYear,
            updated_at: new Date().toISOString() 
          }, { merge: true });
          count++;
        });
      });
      if (count > 0) await batch.commit();
      alert('保存完了');
    } catch (e: any) { alert('エラー: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleExportCSV = () => {
    let csv = `\uFEFF${currentYear}年度PFデータ\nNo,教室,生涯番号,氏名,学年,年間出席率,年間宿題率,出席アラート,宿題アラート\n`;
    displayStudents.forEach((s, idx) => {
      const stats = statsMap[s.id];
      const attSt = stats.isAttResolved ? '対応済' : stats.attAlert;
      const hwSt = stats.isHwResolved ? '対応済' : stats.hwAlert;
      csv += `${idx + 1},${s.classroom},${s.lifetime_id},${s.student_name},${s.grade},${stats.attRate}%,${stats.hwRate}%,${attSt},${hwSt}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `PF_${currentYear}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const switchMonth = (direction: 'prev' | 'next') => {
    const months = Object.keys(MONTH_MAP).filter(m => m !== '全期間');
    const idx = months.indexOf(selectedMonth);
    if (idx === -1) return setSelectedMonth('3月');
    
    let newIdx = direction === 'next' ? idx + 1 : idx - 1;
    if (newIdx < 0) newIdx = months.length - 1;
    if (newIdx >= months.length) newIdx = 0;
    setSelectedMonth(months[newIdx]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32 font-sans text-sm text-gray-800">
      
      {/* 統合ヘッダー */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6 sticky top-0 z-40">
        
        {/* 上段 */}
        <div className="bg-gray-900 text-white px-4 py-3 rounded-t-2xl flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <Link href="/teacher" className="p-2 hover:bg-white/20 rounded-full transition-colors"><ArrowLeft size={18}/></Link>
            <h1 className="font-black flex items-center gap-2 text-lg tracking-tight">
              <RefreshCw size={20} className="text-indigo-400"/> PF管理システム
            </h1>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
              <Calendar size={14} className="text-indigo-300"/>
              <select 
                className="bg-transparent font-bold text-white outline-none cursor-pointer text-sm"
                value={currentYear}
                onChange={(e) => setCurrentYear(e.target.value)}
              >
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y} className="text-black">{y}年度</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
              <span className="text-xs text-gray-300">集計基準:</span>
              <select 
                className="bg-transparent font-bold text-white outline-none cursor-pointer text-sm"
                value={currentWeek} 
                onChange={(e) => setCurrentWeek(e.target.value)}
              >
                {Array.from({length:40},(_,i)=>i+1).map(w => <option key={w} value={String(w)} className="text-black">第 {w} 週</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* 中段: サマリー */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-50 to-white border-b border-gray-100 flex items-center gap-8 overflow-x-auto">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Attendance</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-gray-800">{weekStats.att}</span>
              <span className="text-xs font-bold text-gray-500">%</span>
            </div>
          </div>
          <div className="w-px h-8 bg-gray-200"></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Late</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black ${weekStats.late > 0 ? 'text-yellow-500' : 'text-gray-800'}`}>{weekStats.late}</span>
              <span className="text-xs font-bold text-gray-500">人</span>
            </div>
          </div>
          <div className="w-px h-8 bg-gray-200"></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Homework</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-gray-800">{weekStats.hw}</span>
              <span className="text-xs font-bold text-gray-500">%</span>
            </div>
          </div>
        </div>

        {/* 下段: フィルター */}
        <div className="p-3 flex flex-wrap gap-3 items-center justify-between bg-white rounded-b-2xl">
          <div className="flex flex-wrap gap-2 items-center">
            {/* 月選択 */}
            <div className="flex items-center bg-gray-50 rounded-lg p-1 border border-gray-200 shadow-sm mr-2">
              <button onClick={() => switchMonth('prev')} className="p-1.5 hover:bg-white rounded-md shadow-sm transition-all text-gray-500 hover:text-indigo-600"><ChevronLeft size={16}/></button>
              <select className="bg-transparent text-sm font-bold px-2 outline-none cursor-pointer text-indigo-700 min-w-[4rem] text-center appearance-none" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {Object.keys(MONTH_MAP).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => switchMonth('next')} className="p-1.5 hover:bg-white rounded-md shadow-sm transition-all text-gray-500 hover:text-indigo-600"><ChevronRight size={16}/></button>
            </div>

            <div className="relative group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={14}/>
              <input type="text" className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs w-32 md:w-40 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all" placeholder="検索 (氏名/ID)..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            
            <div className="flex items-center gap-2 border-l border-gray-200 pl-2">
              <Filter size={14} className="text-gray-400" />
              
              {/* 校舎 */}
              <select className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none cursor-pointer hover:border-gray-300 transition-colors" value={filterClassroom} onChange={e => setFilterClassroom(e.target.value)}>
                <option value="all">全校舎</option>
                {classrooms.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              
              {/* 曜日 */}
              <select className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none cursor-pointer hover:border-gray-300 transition-colors" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
                <option value="all">全曜日</option>
                {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              {/* 学年 */}
              <select className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none cursor-pointer hover:border-gray-300 transition-colors" value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
                <option value="all">全学年</option>
                <option value="中1">中1</option>
                <option value="中2">中2</option>
                <option value="中3">中3</option>
              </select>

              {/* ★科目フィルター (追加) */}
              <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
                <BookOpen size={12} className="text-gray-400"/>
                <select className="bg-transparent text-xs font-medium outline-none cursor-pointer min-w-[60px]" value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
                  <option value="all">全科目</option>
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-2 ml-auto">
            <select className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-600 outline-none cursor-pointer hover:bg-gray-50" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="id">ID順</option>
              <option value="attendance">欠席順</option>
              <option value="homework">未提出順</option>
            </select>
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-50 hover:text-indigo-600 text-xs transition-all shadow-sm"><Download size={14}/> CSV出力</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-1.5 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 text-xs shadow-md shadow-indigo-100 transition-all active:scale-95">
              {saving ? <Loader2 className="animate-spin" size={14}/> : <Save size={14}/>} 保存する
            </button>
          </div>
        </div>
      </div>

      {/* メインテーブル */}
      {loading ? (
        <div className="flex flex-col justify-center items-center h-64 text-gray-400 gap-2"><Loader2 className="animate-spin text-indigo-500" size={32}/><span className="text-xs font-bold">データを読み込んでいます...</span></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="min-w-max border-collapse text-xs w-full">
              <thead className="bg-gray-50 text-gray-500 font-bold sticky top-0 z-30 shadow-sm h-10 border-b border-gray-200">
                <tr>
                  {/* 固定列 (背景色を明示して透け防止) */}
                  <th className="p-2 border-r border-gray-200 w-10 text-center sticky left-0 bg-gray-50 z-40">No</th>
                  <th className="p-2 border-r border-gray-200 w-16 text-center sticky left-10 bg-gray-50 z-40">教室</th>
                  <th className="p-2 border-r border-gray-200 w-20 text-center sticky left-24 bg-gray-50 z-40">ID</th>
                  <th className="p-2 border-r border-gray-200 w-32 text-left sticky left-44 bg-gray-50 z-40 shadow-md pl-3">氏名</th>
                  
                  <th className="p-2 border-r border-gray-200 w-12 text-center">学年</th>
                  <th className="p-2 border-r border-gray-200 w-12 text-center">曜日</th>

                  <th className="p-2 border-r border-gray-200 w-20 text-center bg-red-50/50 text-red-600">出席警報</th>
                  <th className="p-2 border-r border-gray-200 w-20 text-center bg-orange-50/50 text-orange-600">宿題警報</th>
                  <th className="p-2 border-r border-gray-200 w-14 text-center">出席率</th>
                  <th className="p-2 border-r border-gray-200 w-14 text-center">提出率</th>

                  {visibleWeeks.map(w => {
                    const isCurrent = String(w) === currentWeek;
                    return (
                      <th key={w} colSpan={3} className={`p-0 border-r border-gray-200 text-center min-w-[90px] group transition-colors ${isCurrent ? 'bg-indigo-50 border-x-2 border-x-indigo-200' : 'hover:bg-gray-100'}`}>
                        <div className={`py-1 text-[10px] uppercase tracking-wider ${isCurrent ? 'text-indigo-700 font-black' : 'text-gray-400'}`}>Week {w}</div>
                        <div className="grid grid-cols-3 text-[9px] font-normal border-t border-gray-200 bg-white">
                          <span className="border-r py-0.5 text-gray-400">出欠</span>
                          <span className="border-r py-0.5 text-gray-400">社</span>
                          <span className="py-0.5 text-gray-400">理</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="text-gray-700 bg-white divide-y divide-gray-100">
                {displayStudents.length === 0 ? (
                  <tr><td colSpan={20} className="p-12 text-center text-gray-400 font-bold">該当する生徒がいません</td></tr>
                ) : displayStudents.map((student, idx) => {
                  const stats = statsMap[student.id];
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'; 
                  
                  return (
                    <tr key={student.id} className={`${rowBg} hover:bg-indigo-50 transition-colors h-9 group`}>
                      {/* 固定列 */}
                      <td className={`p-2 border-r border-gray-100 text-center sticky left-0 z-20 font-mono text-gray-400 ${idx%2===0?'bg-white':'bg-gray-50'} group-hover:bg-indigo-50`}>{idx + 1}</td>
                      <td className={`p-2 border-r border-gray-100 text-center sticky left-10 z-20 text-[10px] font-bold text-gray-500 ${idx%2===0?'bg-white':'bg-gray-50'} group-hover:bg-indigo-50`}>{student.classroom?.substring(0,3)}</td>
                      <td className={`p-2 border-r border-gray-100 text-center sticky left-24 z-20 font-mono text-[10px] text-gray-400 ${idx%2===0?'bg-white':'bg-gray-50'} group-hover:bg-indigo-50`}>{student.lifetime_id}</td>
                      <td className={`p-2 border-r border-gray-200 font-bold sticky left-44 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] pl-3 text-gray-800 whitespace-nowrap overflow-hidden ${idx%2===0?'bg-white':'bg-gray-50'} group-hover:bg-indigo-50`}>
                        {student.student_name}
                      </td>

                      <td className="p-2 border-r border-gray-100 text-center">{student.grade}</td>
                      <td className="p-2 border-r border-gray-100 text-center text-[10px]">{student.day_of_week}</td>

                      {/* ★アラートセル (クリックで解決切り替え) */}
                      <td className="p-1 border-r border-gray-100 text-center cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => stats.attAlert && toggleAlertResolution(student.id, 'att')}>
                        {stats.isAttResolved ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[9px] font-bold border border-green-200">
                            <CheckCircle size={10}/> 対応済
                          </span>
                        ) : stats.attAlert ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[9px] font-bold border border-red-200 animate-pulse">
                            <AlertCircle size={10}/> {stats.attAlert}
                          </span>
                        ) : null}
                      </td>
                      
                      <td className="p-1 border-r border-gray-100 text-center cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => stats.hwAlert && toggleAlertResolution(student.id, 'hw')}>
                        {stats.isHwResolved ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[9px] font-bold border border-green-200">
                            <CheckCircle size={10}/> 対応済
                          </span>
                        ) : stats.hwAlert ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 text-[9px] font-bold border border-orange-200 animate-pulse">
                            <AlertCircle size={10}/> {stats.hwAlert}
                          </span>
                        ) : null}
                      </td>

                      <td className="p-2 border-r border-gray-100 text-center font-mono font-bold text-gray-600">{stats.attRate}%</td>
                      <td className="p-2 border-r border-gray-100 text-center font-mono font-bold text-gray-600">{stats.hwRate}%</td>

                      {visibleWeeks.map(w => {
                        const rec = records[student.id]?.[w] || {};
                        const att = rec.attendance_status || '';
                        const soc = rec.social_hw || '';
                        const sci = rec.science_hw || '';
                        const isCurrent = String(w) === currentWeek;

                        let attStyle = 'text-gray-300 font-bold';
                        if (att === '出') attStyle = 'bg-blue-50 text-blue-600 font-black';
                        if (att === '遅') attStyle = 'bg-yellow-50 text-yellow-600 font-black';
                        if (att === '欠') attStyle = 'bg-red-50 text-red-600 font-black';

                        return (
                          <td key={w} colSpan={3} className={`p-0 border-r border-gray-200 align-middle ${isCurrent ? 'bg-indigo-50 border-x-2 border-x-indigo-200' : ''}`}>
                             <div className="grid grid-cols-3 h-9 w-full divide-x divide-gray-100/50">
                                <div className="h-full relative">
                                  <select 
                                    className={`w-full h-full text-center outline-none appearance-none cursor-pointer text-[10px] transition-colors focus:ring-2 focus:ring-inset focus:ring-indigo-300 bg-transparent ${attStyle}`}
                                    value={att}
                                    onChange={(e) => handleInputChange(student.id, w, 'attendance_status', e.target.value)}
                                  >
                                    <option value=""></option><option value="出">出</option><option value="遅">遅</option><option value="欠">欠</option>
                                  </select>
                                </div>
                                <input type="text" className="h-full w-full text-center outline-none focus:bg-orange-50 font-mono text-[10px] bg-transparent p-0" value={soc} onChange={(e) => handleInputChange(student.id, w, 'social_hw', e.target.value)} />
                                <input type="text" className="h-full w-full text-center outline-none focus:bg-green-50 font-mono text-[10px] bg-transparent p-0" value={sci} onChange={(e) => handleInputChange(student.id, w, 'science_hw', e.target.value)} />
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
        </div>
      )}
    </div>
  );
}