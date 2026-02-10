'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { 
  Users, ArrowLeft, Download, Filter, X, Loader2, MapPin, 
  GraduationCap, BookOpen, Clock, Trophy, 
  RefreshCw, CalendarCheck, CheckCircle2 
} from 'lucide-react';
import Link from 'next/link';

export default function TeacherStudentsPage() {
  // 生徒データ管理
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // フィルター条件
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterClassroom, setFilterClassroom] = useState('');

  // ★変更点: 簡易出席確認用 (setIntervalは使いません)
  const [monitorMeetingId, setMonitorMeetingId] = useState('');
  const [attendingStudentIds, setAttendingStudentIds] = useState<string[]>([]); // 出席者のIDリストのみ管理
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // 本日の授業リスト
  const [todayShifts, setTodayShifts] = useState<any[]>([]);

  // 1. 初回データ取得（ページを開いた時のみ1回だけ実行）
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // A. 生徒データ取得
        const usersQ = query(collection(db, 'users'), where('role', '==', 'student'));
        const usersSnap = await getDocs(usersQ);
        const list = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // 学年順でソート
        list.sort((a: any, b: any) => (a.grade || '').localeCompare(b.grade || ''));
        setStudents(list);
        setFilteredStudents(list);

        // B. 本日のシフト取得
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const shiftsQ = query(
          collection(db, 'shift_assignments'), 
          where('target_date', '==', dateStr)
        );
        const shiftsSnap = await getDocs(shiftsQ);
        const shifts = shiftsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          // ミーティングIDがあるものだけ
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((s: any) => s.target_meeting_id && s.target_meeting_id.trim() !== '');
        
        // 授業順(note)などでソート
        shifts.sort((a: any, b: any) => (a.note || '').localeCompare(b.note || ''));
        
        setTodayShifts(shifts);

      } catch (e) {
        console.error('Fetch error:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // 依存配列は空 [] なので、この処理はマウント時の1回しか走りません
  }, []);

  // 2. フィルタリング処理（出席状況が変わった時も再計算）
  useEffect(() => {
    let result = students;

    result = result.filter(s => {
      let match = true;

      // キーワード検索
      if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        const nameMatch = s.student_name && s.student_name.toLowerCase().includes(lowerQ);
        const idMatch = s.lifetime_id && String(s.lifetime_id).includes(lowerQ);
        if (!nameMatch && !idMatch) match = false;
      }

      // フィルター条件
      if (filterGrade !== 'all' && s.grade !== filterGrade) match = false;
      if (filterDay !== 'all') {
        if (!s.day_of_week || !s.day_of_week.includes(filterDay)) match = false;
      }
      if (filterClassroom) {
        if (!s.classroom || !s.classroom.includes(filterClassroom)) match = false;
      }

      return match;
    });

    // ソート：出席者をリストの上部に持ってくる
    if (attendingStudentIds.length > 0) {
      result.sort((a, b) => {
        const aActive = attendingStudentIds.includes(a.id) ? 1 : 0;
        const bActive = attendingStudentIds.includes(b.id) ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive; // アクティブ優先
        return (a.grade || '').localeCompare(b.grade || '');
      });
    }

    setFilteredStudents(result);
  }, [students, searchQuery, filterGrade, filterDay, filterClassroom, attendingStudentIds]);

  // ★変更点: 手動更新ロジック (ボタンを押した時だけAPIを叩く)
  const checkAttendance = async () => {
    const cleanId = monitorMeetingId.replace(/\s+/g, '');
    if (!cleanId) return alert("授業を選択してください");

    setMonitorLoading(true);
    try {
      // Zoom APIから参加者リストを取得
      const res = await fetch('/api/get-zoom-live-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: cleanId })
      });
      const data = await res.json();

      if (data.success) {
        // カメラ状態は無視して、IDが一致した生徒のリストだけ抽出
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const presentIds = data.participants
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((p: any) => p.matched_id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((p: any) => p.matched_id);

        setAttendingStudentIds(presentIds);
        
        const now = new Date();
        setLastUpdated(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
      } else {
        alert("Zoom情報の取得に失敗しました");
      }
    } catch (e) {
      console.error(e);
      alert("通信エラーが発生しました");
    } finally {
      setMonitorLoading(false);
    }
  };

  // CSV出力機能
  const handleExportCSV = () => {
    if (filteredStudents.length === 0) return alert('出力するデータがありません');
    if (!confirm('現在表示されているリストをCSVでダウンロードしますか？')) return;

    let csvContent = '\uFEFF';
    csvContent += "ID,氏名,学年,曜日,教室,受講科目,最終アクセス,コイン,メールアドレス,出席状況\n";

    filteredStudents.forEach(s => {
      const subjects = [
        s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5,
        s.subject_science, s.subject_social, ...(s.subjects || [])
      ].filter(v => v && typeof v === 'string').join('/');

      const lastLogin = s.last_login ? new Date(s.last_login).toLocaleString() : '未ログイン';
      // 現在の出席状況もCSVに含める
      const isPresent = attendingStudentIds.includes(s.id) ? "出席中" : "";

      const row = [
        `"${s.lifetime_id || ''}"`,
        `"${s.student_name || ''}"`,
        `"${s.grade || ''}"`,
        `"${s.day_of_week || ''}"`,
        `"${s.classroom || ''}"`,
        `"${subjects}"`,
        `"${lastLogin}"`,
        `"${s.coins || 0}"`,
        `"${s.email || ''}"`,
        `"${isPresent}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `生徒名簿_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterGrade('all');
    setFilterDay('all');
    setFilterClassroom('');
    setAttendingStudentIds([]); // 出席表示もクリア
    setLastUpdated(null);
  };

  // 科目リスト生成ヘルパー
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getSubjectList = (student: any) => {
    const list = [
      student.subject_1, student.subject_2, student.subject_3, student.subject_4, student.subject_5,
      student.subject_science, student.subject_social, ...(student.subjects || [])
    ];
    return Array.from(new Set(list.filter(s => s && typeof s === 'string' && s.trim() !== '')));
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 pb-32">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-end mb-6 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/teacher/work" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Users className="text-purple-600" /> 生徒名簿
              </h1>
              <p className="text-xs text-gray-500">生徒情報の確認・CSV出力・出席確認</p>
            </div>
          </div>
          <button onClick={handleExportCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-green-700 shadow-sm transition-all active:scale-95">
            <Download size={18} /> 名簿出力 (CSV)
          </button>
        </div>

        {/* 簡易出席チェッカー（手動更新のみ） */}
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg mb-6 border border-slate-700">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="bg-slate-800 p-2 rounded-lg">
                <CheckCircle2 size={24} className={attendingStudentIds.length > 0 ? "text-green-400" : "text-gray-400"} />
              </div>
              <div>
                <h2 className="font-bold flex items-center gap-2">
                  簡易出席チェッカー
                </h2>
                <p className="text-xs text-slate-400">
                  {lastUpdated 
                    ? `最終確認: ${lastUpdated} - ${attendingStudentIds.length}名が出席中` 
                    : "Zoomの参加状況を確認できます（ボタンを押すと更新）"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative">
                <select
                  className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg p-2.5 w-full md:w-80 pr-8 appearance-none cursor-pointer hover:bg-slate-700 transition-colors"
                  value={monitorMeetingId}
                  onChange={(e) => {
                    setMonitorMeetingId(e.target.value);
                    setAttendingStudentIds([]); // 授業を変更したらリセット
                    setLastUpdated(null);
                  }}
                >
                  <option value="">▼ 本日の授業を選択してください</option>
                  {todayShifts.length > 0 ? (
                    todayShifts.map((shift) => {
                      const note = shift.note?.replace(/[【】]/g, '') || '';
                      return (
                        <option key={shift.id} value={shift.target_meeting_id}>
                          {note} | {shift.target_grade} {shift.target_subject} ({shift.teacher_name})
                        </option>
                      );
                    })
                  ) : (
                    <option disabled>本日の授業予定がありません</option>
                  )}
                </select>
                <CalendarCheck size={16} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
              </div>

              {/* 手動更新ボタン */}
              <button 
                onClick={checkAttendance} 
                disabled={!monitorMeetingId || monitorLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-colors text-sm whitespace-nowrap shadow-lg shadow-blue-900/20"
              >
                {monitorLoading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
                出席確認
              </button>
            </div>
          </div>
        </div>

        {/* フィルターエリア */}
        <div className="bg-white p-5 rounded-xl shadow-sm mb-6 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Filter size={16} /> 生徒検索・絞り込み</h2>
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><X size={12} /> 条件クリア</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2 md:col-span-1">
              <input type="text" className="w-full p-2 border rounded bg-gray-50 text-sm" placeholder="氏名またはID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div>
              <select className="w-full p-2 border rounded bg-gray-50 text-sm" value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
                <option value="all">全学年</option><option value="中1">中1</option><option value="中2">中2</option><option value="中3">中3</option>
              </select>
            </div>
            <div>
              <select className="w-full p-2 border rounded bg-gray-50 text-sm" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
                <option value="all">全曜日</option><option>月</option><option>火</option><option>水</option><option>木</option><option>金</option><option>土</option><option>日</option>
              </select>
            </div>
            <div>
              <input type="text" className="w-full p-2 border rounded bg-gray-50 text-sm" placeholder="教室名..." value={filterClassroom} onChange={(e) => setFilterClassroom(e.target.value)} />
            </div>
          </div>
        </div>

        {/* 生徒リスト */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden min-h-[400px]">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <span className="font-bold text-gray-700">検索結果 ({filteredStudents.length}名)</span>
            {attendingStudentIds.length > 0 && <span className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2 py-1 rounded">※出席中の生徒が優先表示されます</span>}
          </div>

          {loading ? (
            <div className="flex justify-center items-center h-60">
               <Loader2 className="animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredStudents.length === 0 ? (
                 <div className="p-10 text-center text-gray-400">条件に一致する生徒がいません</div>
              ) : (
                 filteredStudents.map((student) => {
                   const subjects = getSubjectList(student);
                   const lastLoginDate = student.last_login ? new Date(student.last_login) : null;
                   const daysSinceLogin = lastLoginDate 
                     ? Math.floor((new Date().getTime() - lastLoginDate.getTime()) / (1000 * 3600 * 24))
                     : 999;
                   
                   // 出席中かどうか
                   const isAttending = attendingStudentIds.includes(student.id);

                   return (
                     <div key={student.id} className={`p-5 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group relative
                       ${isAttending ? 'bg-indigo-50/70 border-l-4 border-indigo-500' : 'hover:bg-gray-50 border-l-4 border-transparent'}
                     `}>
                       <div className="flex items-center gap-4">
                         <div className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-sm text-lg relative
                           ${student.grade?.includes('3') ? 'bg-red-400' : student.grade?.includes('2') ? 'bg-blue-400' : 'bg-green-400'}
                         `}>
                           {student.student_name ? student.student_name.charAt(0) : <Users size={20}/>}
                         </div>
                         <div>
                           <div className="flex items-center gap-2 mb-1">
                             <h3 className="font-bold text-gray-800 text-lg">{student.student_name || '名称未設定'}</h3>
                             {isAttending && <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">Zoom出席中</span>}
                             <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">ID: {student.lifetime_id}</span>
                           </div>
                           <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                             <span className="flex items-center gap-1"><GraduationCap size={12}/> {student.grade || '-'}</span>
                             <span className="flex items-center gap-1"><MapPin size={12}/> {student.classroom || '教室未設定'} ({student.day_of_week || '-'})</span>
                           </div>
                         </div>
                       </div>
                       
                       <div className="flex items-center gap-6 text-sm">
                         <div className="min-w-[120px]">
                           <div className="text-[10px] font-bold text-gray-400 mb-1 flex items-center gap-1"><BookOpen size={10}/> 受講科目</div>
                           <div className="flex flex-wrap gap-1">
                             {subjects.length > 0 ? subjects.map(sub => (
                               <span key={sub} className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-100">
                                 {sub}
                               </span>
                             )) : <span className="text-gray-300 text-xs">-</span>}
                           </div>
                         </div>

                         <div className="min-w-[140px] border-l pl-4 border-gray-100">
                           <div className="text-[10px] font-bold text-gray-400 mb-1 flex items-center gap-1"><Clock size={10}/> アプリ利用状況</div>
                           <div className={`text-xs font-bold ${daysSinceLogin > 7 ? 'text-red-500' : 'text-gray-600'}`}>
                             最終: {lastLoginDate ? lastLoginDate.toLocaleDateString() : '未ログイン'}
                           </div>
                           <div className="text-xs font-bold text-yellow-600 flex items-center gap-1 mt-0.5">
                             <Trophy size={12} className="fill-yellow-500"/> {student.coins || 0} Coin
                           </div>
                         </div>
                       </div>
                     </div>
                   );
                 })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}