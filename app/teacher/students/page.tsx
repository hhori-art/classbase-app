'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Users, Search, ArrowLeft, Download, Filter, X, Loader2, MapPin, GraduationCap, BookOpen, Clock, Trophy } from 'lucide-react';
import Link from 'next/link';

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // フィルター用
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterClassroom, setFilterClassroom] = useState('');

  // Firebaseデータ取得
  const fetchStudents = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'student')
      );
      
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 学年順などでソート
      list.sort((a: any, b: any) => (a.grade || '').localeCompare(b.grade || ''));

      setStudents(list);
      setFilteredStudents(list);
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // フィルタリング処理
  useEffect(() => {
    let result = students;

    // 1. 検索
    if (searchQuery) {
      const lowerQ = searchQuery.toLowerCase();
      result = result.filter(s => 
        (s.student_name && s.student_name.toLowerCase().includes(lowerQ)) ||
        (s.lifetime_id && String(s.lifetime_id).includes(lowerQ))
      );
    }

    // 2. 学年
    if (filterGrade !== 'all') {
      result = result.filter(s => s.grade === filterGrade);
    }

    // 3. 曜日
    if (filterDay !== 'all') {
      result = result.filter(s => s.day_of_week && s.day_of_week.includes(filterDay));
    }

    // 4. 教室
    if (filterClassroom) {
      result = result.filter(s => s.classroom && s.classroom.includes(filterClassroom));
    }

    setFilteredStudents(result);
  }, [students, searchQuery, filterGrade, filterDay, filterClassroom]);

  // CSV出力機能
  const handleExportCSV = () => {
    if (filteredStudents.length === 0) return alert('出力するデータがありません');
    if (!confirm('現在表示されているリストをCSVでダウンロードしますか？')) return;

    let csvContent = '\uFEFF';
    // ヘッダーに受講科目や最終アクセスを追加
    csvContent += "ID(生涯番号),氏名,学年,曜日,教室,受講科目,最終アクセス,保有コイン,メールアドレス\n";

    filteredStudents.forEach(s => {
      // 科目リスト生成
      const subjects = [
        s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5,
        s.subject_science, s.subject_social, ...(s.subjects || [])
      ].filter(v => v && typeof v === 'string').join('/');

      // 最終アクセス
      const lastLogin = s.last_login ? new Date(s.last_login).toLocaleString() : '未ログイン';

      const row = [
        `"${s.lifetime_id || ''}"`,
        `"${s.student_name || ''}"`,
        `"${s.grade || ''}"`,
        `"${s.day_of_week || ''}"`,
        `"${s.classroom || ''}"`,
        `"${subjects}"`,
        `"${lastLogin}"`,
        `"${s.coins || 0}"`,
        `"${s.email || ''}"`
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
  };

  // 受講科目を文字列配列として取得するヘルパー
  const getSubjectList = (student: any) => {
    const list = [
      student.subject_1, student.subject_2, student.subject_3, student.subject_4, student.subject_5,
      student.subject_science, student.subject_social, ...(student.subjects || [])
    ];
    // 重複除去と空文字除去
    return Array.from(new Set(list.filter(s => s && typeof s === 'string' && s.trim() !== '')));
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 pb-32">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-6">
          <div className="flex items-center gap-4">
            {/* ★修正: リンク先を /teacher/work に変更 */}
            <Link href="/teacher/work" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Users className="text-purple-600" /> 生徒名簿
              </h1>
              <p className="text-xs text-gray-500">条件で絞り込み、CSV出力が可能です</p>
            </div>
          </div>
          <button onClick={handleExportCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-green-700 shadow-sm transition-all active:scale-95">
            <Download size={18} /> 名簿出力 (CSV)
          </button>
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

        {/* 生徒リスト表示エリア */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden min-h-[400px]">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <span className="font-bold text-gray-700">検索結果 ({filteredStudents.length}名)</span>
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
                   
                   // 最終ログインからの経過日数
                   const daysSinceLogin = lastLoginDate 
                     ? Math.floor((new Date().getTime() - lastLoginDate.getTime()) / (1000 * 3600 * 24))
                     : 999;
                   
                   return (
                     <div key={student.id} className="p-5 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group">
                       <div className="flex items-center gap-4">
                         <div className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-sm text-lg
                           ${student.grade?.includes('3') ? 'bg-red-400' : student.grade?.includes('2') ? 'bg-blue-400' : 'bg-green-400'}
                         `}>
                           {student.student_name ? student.student_name.charAt(0) : <Users size={20}/>}
                         </div>
                         <div>
                           <div className="flex items-center gap-2 mb-1">
                             <h3 className="font-bold text-gray-800 text-lg">{student.student_name || '名称未設定'}</h3>
                             <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">ID: {student.lifetime_id}</span>
                           </div>
                           <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                             <span className="flex items-center gap-1"><GraduationCap size={12}/> {student.grade || '-'}</span>
                             <span className="flex items-center gap-1"><MapPin size={12}/> {student.classroom || '教室未設定'} ({student.day_of_week || '-'})</span>
                           </div>
                         </div>
                       </div>
                       
                       {/* ★追加: 科目・アプリ使用状況 */}
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