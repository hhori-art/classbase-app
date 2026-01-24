'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { 
  Phone, Search, Filter, CheckCircle, PhoneOff, 
  ArrowLeft, Loader2, Calendar, Clock, UserX 
} from 'lucide-react';
import Link from 'next/link';

// フィルタリング用の型
type FilterState = {
  day: string;
  grade: string;
};

// 今日の曜日を取得するヘルパー ('日'~'土' -> '日','月'...)
const getTodayDayOfWeek = () => {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[new Date().getDay()];
};

export default function TeacherContactsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<any[]>([]); 
  const [currentWeek, setCurrentWeek] = useState('1');
  
  // 曜日リスト
  const days = ['月', '火', '水', '木', '金', '土'];
  
  // 初期値: 今日の曜日
  const [filters, setFilters] = useState<FilterState>({
    day: getTodayDayOfWeek(), 
    grade: ''
  });

  // 各生徒の入力状態 (備考)
  const [inputNotes, setInputNotes] = useState<{[key:string]: string}>({});
  
  // 電話済みフラグ管理 (一時的)
  const [calledStates, setCalledStates] = useState<{[key:string]: boolean}>({});

  useEffect(() => {
    fetchTargetStudents();
  }, [filters]); 

  const fetchTargetStudents = async () => {
    setLoading(true);
    try {
      // 1. 現在の週番号を取得
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      
      // ★修正: current_week が undefined の場合に備えて、必ず '1' などの値が入るように修正
      // これが "Unsupported field value: undefined" エラーの対策です
      const data = settingsSnap.data();
      const week = (data && data.current_week) ? data.current_week : '1';
      
      setCurrentWeek(week);

      // 2. 全生徒を取得
      const qUsers = query(collection(db, 'users'), where('role', '==', 'student'));
      const userSnap = await getDocs(qUsers);
      const allStudents = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 3. PFレコード(今週の出席状況)を取得して除外リストを作成
      // 出席(出), 欠席(欠), 遅刻(遅) がすでについている生徒は除外対象
      // ★修正した week 変数を使うのでエラーになりません
      const pfQ = query(collection(db, 'pf_records'), where('week_number', '==', week));
      const pfSnap = await getDocs(pfQ);
      
      const statusMap = new Map(); // uid -> status
      pfSnap.forEach(d => {
        const data = d.data();
        statusMap.set(data.student_id, data.attendance_status);
      });

      // 4. フィルタリング実行 (未出席かつ未連絡のみ残す)
      const targetList = allStudents.filter((st: any) => {
        // (A) 曜日・学年フィルター
        // filters.day が空なら全曜日、そうでなければ一致するもの
        if (filters.day && st.day_of_week !== filters.day) return false;
        if (filters.grade && st.grade !== filters.grade) return false;

        // (B) ステータスチェック
        const status = statusMap.get(st.uid);
        
        // すでに出席(Zoom含む)、欠席(申請含む)、遅刻がついている場合はリストから消す
        if (status === '出' || status === '欠' || status === '遅') return false;

        // ステータスがない(未定) または '未' の場合のみ表示
        return true;
      });

      setStudents(targetList);

    } catch (e) {
      console.error("Fetch Error:", e);
    } finally {
      setLoading(false);
    }
  };

  // 電話済み処理 (ステータスは変えず、ログだけ残す)
  const handleMarkCalled = async (student: any) => {
    const note = inputNotes[student.uid] || '';
    if (!confirm(`${student.student_name} さんに電話済みとして記録しますか？`)) return;

    try {
      // ログ保存
      await addDoc(collection(db, 'contact_logs'), {
        student_id: student.uid,
        student_name: student.student_name,
        teacher_name: profile?.name || '講師',
        result: '電話済み(繋がらず/留守)',
        content: note,
        created_at: serverTimestamp()
      });

      // ローカル表示更新 (グレーアウトなど)
      setCalledStates(prev => ({ ...prev, [student.uid]: true }));
      alert('電話記録を保存しました');
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    }
  };

  // 欠席確定処理 (PFレコードを更新してリストから消す)
  const handleConfirmAbsence = async (student: any) => {
    const note = inputNotes[student.uid] || '電話確認による欠席';
    if (!confirm(`${student.student_name} さんを「欠席」として確定しますか？\n(リストから消えます)`)) return;

    try {
      const recordId = `${student.uid}_w${currentWeek}`;
      const pfRef = doc(db, 'pf_records', recordId);

      // PFレコードを更新 (または作成)
      await setDoc(pfRef, {
        student_id: student.uid,
        week_number: currentWeek,
        attendance_status: '欠', // これでリストから除外される
        note: note,
        updated_at: new Date().toISOString()
      }, { merge: true });

      // ログ保存
      await addDoc(collection(db, 'contact_logs'), {
        student_id: student.uid,
        student_name: student.student_name,
        teacher_name: profile?.name || '講師',
        result: '欠席確定',
        content: note,
        created_at: serverTimestamp()
      });

      alert('欠席登録しました');
      // リストから即座に除外
      setStudents(prev => prev.filter(s => s.uid !== student.uid));

    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/teacher" className="bg-white p-2 rounded-full shadow text-gray-600"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Phone className="text-blue-600" /> 未連絡・欠席確認リスト
            </h1>
            <p className="text-xs text-gray-500 mt-1 font-bold">
              Zoom不参加 ＆ 欠席連絡なしの生徒のみ表示
            </p>
          </div>
        </div>

        {/* フィルターバー */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4 items-end">
          <div className="flex items-center gap-2 text-gray-500 font-bold text-sm mb-1 w-full md:w-auto">
            <Filter size={16}/> 今日の曜日: <span className="text-blue-600 text-lg">{getTodayDayOfWeek()}</span>
          </div>
          
          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">曜日絞り込み</label>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                 onClick={() => setFilters({...filters, day: ''})}
                 className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${filters.day === '' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                全て
              </button>
              {days.map(d => (
                <button
                  key={d}
                  onClick={() => setFilters({...filters, day: d})}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${filters.day === d ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="ml-auto">
            <button 
              onClick={fetchTargetStudents}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 flex items-center gap-2 shadow-sm active:scale-95 transition-all"
            >
              <Loader2 size={16} className={loading ? "animate-spin" : "hidden"}/> リスト更新
            </button>
          </div>
        </div>

        {/* 生徒リスト */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={40}/></div>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border-2 border-dashed border-gray-200">
            <CheckCircle className="mx-auto text-green-200 mb-3" size={60}/>
            <h3 className="text-lg font-bold text-gray-400">未確認の生徒はいません</h3>
            <p className="text-gray-400 text-xs mt-1">全員出席済み、または欠席連絡済みです</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {students.map((student) => {
              const isCalled = calledStates[student.uid];

              return (
                <div key={student.id} className={`p-5 rounded-2xl shadow-sm border transition-all flex flex-col md:flex-row gap-4 items-start md:items-center ${isCalled ? 'bg-gray-100 border-gray-200 opacity-70' : 'bg-white border-red-100 ring-2 ring-red-50'}`}>
                  
                  {/* 生徒情報 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <UserX size={10}/> 未確認
                      </span>
                      <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded">
                        {student.grade}
                      </span>
                      <span className="text-xs text-gray-400 font-bold">
                        {student.day_of_week}曜クラス
                      </span>
                    </div>
                    
                    <h3 className="text-xl font-black text-gray-800 mb-2 flex items-center gap-2">
                      {student.student_name}
                      {student.phone_number && (
                        <a href={`tel:${student.phone_number}`} className="bg-green-50 text-green-600 p-1.5 rounded-full hover:bg-green-100 transition-colors">
                          <Phone size={16}/>
                        </a>
                      )}
                    </h3>
                    
                    <div className="text-xs text-gray-500 font-mono bg-gray-50 inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200">
                      <Phone size={10}/> {student.phone_number || '電話番号なし'}
                    </div>
                  </div>

                  {/* アクションエリア */}
                  <div className="w-full md:w-[60%] flex flex-col gap-2">
                    <textarea
                      placeholder="電話の結果・備考 (例: 母対応、風邪で欠席)"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 bg-gray-50 min-h-[60px]"
                      value={inputNotes[student.uid] || ''}
                      onChange={(e) => setInputNotes({...inputNotes, [student.uid]: e.target.value})}
                    />
                    
                    <div className="flex gap-2">
                      {/* 電話済みボタン */}
                      <button
                        onClick={() => handleMarkCalled(student)}
                        disabled={isCalled}
                        className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                          isCalled 
                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                            : 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100'
                        }`}
                      >
                        {isCalled ? <><CheckCircle size={14}/> 電話済</> : <><PhoneOff size={14}/> 電話のみ(留守等)</>}
                      </button>
                      
                      {/* 欠席確定ボタン */}
                      <button
                        onClick={() => handleConfirmAbsence(student)}
                        className="flex-1 bg-red-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold hover:bg-red-600 shadow-md shadow-red-100 flex items-center justify-center gap-1 transition-all active:scale-95"
                      >
                        <UserX size={14}/> 欠席確定 (リストから消去)
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}