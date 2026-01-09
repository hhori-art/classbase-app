'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { 
  Phone, Search, Filter, CheckCircle, PhoneOff, 
  ArrowLeft, Loader2, Calendar 
} from 'lucide-react';
import Link from 'next/link';

// フィルタリング用の型
type FilterState = {
  day: string;
  grade: string;
  subject: string;
};

export default function TeacherContactsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<any[]>([]); // 表示対象の生徒リスト
  const [currentWeek, setCurrentWeek] = useState('1');
  
  // ★修正: 日曜日を削除しました
  const days = ['月', '火', '水', '木', '金', '土'];
  
  // ★修正: 初期値を空文字（＝全て）にして、曜日が一致しなくても表示されるようにしました
  const [filters, setFilters] = useState<FilterState>({
    day: '', 
    grade: '',
    subject: ''
  });

  // 各生徒の入力状態管理 (メモなど)
  const [inputStates, setInputStates] = useState<{[key:string]: string}>({});

  useEffect(() => {
    fetchTargetStudents();
  }, [filters]); // フィルター変更時に再取得

  const fetchTargetStudents = async () => {
    setLoading(true);
    try {
      // 1. 現在の週番号を取得
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      const week = settingsSnap.exists() ? settingsSnap.data().current_week : '1';
      setCurrentWeek(week);

      // 2. 全生徒を取得
      // 注意: Firestoreの users コレクションに role: 'student' が設定されている必要があります
      const qUsers = query(collection(db, 'users'), where('role', '==', 'student'));
      const userSnap = await getDocs(qUsers);
      const allStudents = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 3. PFレコード(出席状況)を取得して除外リストを作成
      const pfQ = query(collection(db, 'pf_records'), where('week_number', '==', week));
      const pfSnap = await getDocs(pfQ);
      
      const exclusionMap = new Map();
      pfSnap.forEach(d => {
        const data = d.data();
        // 既に出席、遅刻、欠席がついている生徒は除外
        if (['出', '遅', '欠'].includes(data.attendance_status)) {
          exclusionMap.set(data.student_id, true);
        }
      });

      // 4. フィルタリング実行
      const targetList = allStudents.filter((st: any) => {
        // (A) フィルター条件
        // filters.day が空文字の場合は「全曜日」を表示
        if (filters.day && st.day_of_week !== filters.day) return false;
        
        if (filters.grade && st.grade !== filters.grade) return false;
        
        if (filters.subject) {
          const hasSub = st.subject_1 === filters.subject || st.subject_2 === filters.subject;
          if (!hasSub) return false;
        }

        // (B) 既に出席/連絡済みなら除外
        // レコードがなければ exclusionMap に入らないので、ここは通過して表示されるはずです
        if (exclusionMap.has(st.uid)) return false;

        return true;
      });

      setStudents(targetList);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 連絡結果の登録処理
  const handleRegisterContact = async (student: any, status: '欠' | '留守', note: string) => {
    if (!confirm(`${student.student_name} さんの記録を登録しますか？`)) return;

    try {
      const recordId = `${student.uid}_w${currentWeek}`;
      const pfRef = doc(db, 'pf_records', recordId);

      const updateData: any = {
        student_id: student.uid,
        week_number: currentWeek,
        updated_at: new Date().toISOString()
      };

      if (status === '欠') {
        updateData.attendance_status = '欠';
        updateData.note = note || '電話連絡による欠席確認';
        // 欠席確定の場合はPFレコードを書き込む
        await setDoc(pfRef, updateData, { merge: true });
      } else {
        // 留守の場合はPFレコードのステータスを変えずにログだけ残す運用もありますが
        // ここでは「メモだけPFに残す」などの処理はお好みで追加可能です
      }

      // ログ保存
      await addDoc(collection(db, 'contact_logs'), {
        student_id: student.uid,
        student_name: student.student_name,
        teacher_name: profile?.name || '講師',
        result: status === '欠' ? '欠席確認' : '留守番電話/不通',
        content: note,
        created_at: serverTimestamp()
      });

      alert('登録しました');
      
      if (status === '欠') {
        setStudents(prev => prev.filter(s => s.uid !== student.uid));
      } else {
        setInputStates(prev => ({...prev, [student.uid]: ''}));
      }

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
              <Phone className="text-blue-600" /> 未連絡・欠席確認
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              連絡がなく授業に参加していない生徒リスト
            </p>
          </div>
        </div>

        {/* フィルターバー */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4 items-end">
          <div className="flex items-center gap-2 text-gray-500 font-bold text-sm mb-1 w-full md:w-auto">
            <Filter size={16}/> 絞り込み:
          </div>
          
          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">曜日</label>
            <div className="flex bg-gray-100 rounded-lg p-1">
              {/* ★追加: 全て表示ボタン */}
              <button
                 onClick={() => setFilters({...filters, day: ''})}
                 className={`px-3 py-1 rounded-md text-sm font-bold transition-colors ${filters.day === '' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                全て
              </button>
              {days.map(d => (
                <button
                  key={d}
                  onClick={() => setFilters({...filters, day: d})}
                  className={`px-3 py-1 rounded-md text-sm font-bold transition-colors ${filters.day === d ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">学年</label>
            <select 
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-200"
              value={filters.grade}
              onChange={(e) => setFilters({...filters, grade: e.target.value})}
            >
              <option value="">全て</option>
              <option value="中1">中1</option>
              <option value="中2">中2</option>
              <option value="中3">中3</option>
            </select>
          </div>

          <button 
            onClick={fetchTargetStudents}
            className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 flex items-center gap-2"
          >
            <Search size={16}/> 検索更新
          </button>
        </div>

        {/* 生徒リスト */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" size={40}/></div>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-gray-300">
            <CheckCircle className="mx-auto text-green-500 mb-3" size={48}/>
            <h3 className="text-lg font-bold text-gray-800">対象者はいません</h3>
            <p className="text-gray-500 text-sm">現在、未連絡の欠席者は見つかりませんでした。<br/>（曜日フィルターが合っているか確認してください）</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {students.map((student) => (
              <div key={student.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:border-blue-200 transition-all flex flex-col md:flex-row gap-4 items-start md:items-center">
                
                {/* 生徒情報 */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded">{student.grade}</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={12}/> {student.day_of_week}曜クラス</span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                    {student.student_name}
                    {student.phone_number && (
                      <a href={`tel:${student.phone_number}`} className="text-gray-400 hover:text-green-600 transition-colors">
                        <Phone size={18}/>
                      </a>
                    )}
                  </h3>
                  <div className="text-sm text-gray-500 font-mono bg-gray-50 inline-block px-2 py-1 rounded border border-gray-100">
                    <Phone size={12} className="inline mr-1"/>
                    {student.phone_number || '電話番号未登録'}
                  </div>
                </div>

                {/* アクションエリア */}
                <div className="w-full md:w-auto flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="備考・理由 (例: 風邪のため)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={inputStates[student.uid] || ''}
                    onChange={(e) => setInputStates({...inputStates, [student.uid]: e.target.value})}
                  />
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRegisterContact(student, '留守', inputStates[student.uid])}
                      className="flex-1 bg-yellow-50 text-yellow-700 border border-yellow-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-yellow-100 flex items-center justify-center gap-1"
                    >
                      <PhoneOff size={16}/> 留守/不通
                    </button>
                    
                    <button
                      onClick={() => handleRegisterContact(student, '欠', inputStates[student.uid])}
                      className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700 shadow-sm flex items-center justify-center gap-1"
                    >
                      <CheckCircle size={16}/> 欠席確定
                    </button>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}