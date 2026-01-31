'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, query, where, getDocs, addDoc, onSnapshot, serverTimestamp, limit 
} from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { 
  MessageCircle, ArrowLeft, Search, Send, User, Loader2, Bot, 
  AlertTriangle, Users, Filter, X, Calendar, BookOpen, MapPin 
} from 'lucide-react';
import Link from 'next/link';

// メッセージの型定義
type ChatLogMessage = {
  id: string;
  uid: string;
  role: 'user' | 'assistant' | 'teacher';
  message: string;
  teacher_name?: string;
  student_name?: string;
  is_alert?: boolean;
  is_broadcast?: boolean; // 一斉送信フラグ
  created_at: any;
  createdAtDate: Date;
};

export default function TeacherChatPage() {
  const { user, profile } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  
  const [messages, setMessages] = useState<ChatLogMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 動的な絞り込み選択肢用ステート
  const [availableOptions, setAvailableOptions] = useState({
    grades: [] as string[],
    classrooms: [] as string[],
    days: [] as string[],
    subjects: [] as string[],
  });

  // 一斉送信モーダル用ステート
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  
  // 詳細なフィルタリング設定
  const [bulkFilters, setBulkFilters] = useState({
    grades: [] as string[],
    classrooms: [] as string[],
    days: [] as string[],
    subjects: [] as string[], 
  });
  
  const [sendingBulk, setSendingBulk] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 生徒リスト取得 & 選択肢の生成
  useEffect(() => {
    const fetchList = async () => {
      try {
        const sQ = query(collection(db, 'users'), where('role', '==', 'student'));
        const sSnap = await getDocs(sQ);
        const allStudents = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const gradeSet = new Set<string>();
        const classroomSet = new Set<string>();
        const daySet = new Set<string>();
        const subjectSet = new Set<string>();

        allStudents.forEach((s: any) => {
          if (s.grade) gradeSet.add(s.grade);
          if (s.classroom && s.classroom !== '') classroomSet.add(s.classroom);
          if (s.day_of_week && s.day_of_week !== '') daySet.add(s.day_of_week);

          const checkAndAdd = (val: any) => {
            if (val && typeof val === 'string' && val.trim() !== '') {
              subjectSet.add(val);
            }
          };

          [s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5].forEach(checkAndAdd);
          checkAndAdd(s.subject_science);
          checkAndAdd(s.subject_social);
        });

        const dayOrder = ['月', '火', '水', '木', '金', '土', '日'];
        const sortDays = (a: string, b: string) => {
          return dayOrder.indexOf(a.charAt(0)) - dayOrder.indexOf(b.charAt(0));
        };

        setAvailableOptions({
          grades: Array.from(gradeSet).sort(),
          classrooms: Array.from(classroomSet).sort(),
          days: Array.from(daySet).sort(sortDays),
          subjects: Array.from(subjectSet).sort(),
        });

        // アラート情報の付与
        const enrichedStudents = await Promise.all(allStudents.map(async (s) => {
          try {
            const alertQ = query(
              collection(db, 'chat_logs'), 
              where('uid', '==', s.id), 
              where('is_alert', '==', true),
              limit(1)
            );
            const alertSnap = await getDocs(alertQ);
            return { ...s, hasAlert: !alertSnap.empty };
          } catch (e) {
            return { ...s, hasAlert: false };
          }
        }));

        enrichedStudents.sort((a, b) => (b.hasAlert ? 1 : 0) - (a.hasAlert ? 1 : 0));

        setStudents(enrichedStudents);
        setFilteredStudents(enrichedStudents);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchList();
  }, []);

  // 検索フィルタ
  useEffect(() => {
    const result = students.filter(s => 
      (s.student_name && s.student_name.includes(search)) || 
      (s.grade && s.grade.includes(search))
    );
    setFilteredStudents(result);
  }, [search, students]);

  // チャット監視
  useEffect(() => {
    if (!selectedStudent) return;
    setMessages([]);

    const q = query(
      collection(db, 'chat_logs'),
      where('uid', '==', selectedStudent.id),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAtDate: data.created_at ? new Date(data.created_at.seconds * 1000) : new Date()
        } as ChatLogMessage;
      });
      
      msgs.sort((a, b) => a.createdAtDate.getTime() - b.createdAtDate.getTime());
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [selectedStudent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 個別送信
  const handleSend = async () => {
    if (!inputText.trim() || !selectedStudent || !user) return;
    try {
      await addDoc(collection(db, 'chat_logs'), {
        uid: selectedStudent.id,
        role: 'teacher',
        teacher_name: profile?.name || '担当講師',
        // ★修正: 「生徒くん」等の固定値ではなく、実際の生徒名を保存
        student_name: selectedStudent.student_name, 
        message: inputText,
        created_at: serverTimestamp()
      });
      setInputText('');
    } catch (e) {
      alert('送信エラー');
      console.error(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // --- 一斉送信関連ロジック ---

  const bulkTargets = useMemo(() => {
    if (
      bulkFilters.grades.length === 0 && 
      bulkFilters.classrooms.length === 0 &&
      bulkFilters.days.length === 0 &&
      bulkFilters.subjects.length === 0
    ) {
      return [];
    }

    return students.filter(s => {
      if (bulkFilters.grades.length > 0 && (!s.grade || !bulkFilters.grades.includes(s.grade))) return false;
      if (bulkFilters.classrooms.length > 0 && (!s.classroom || !bulkFilters.classrooms.includes(s.classroom))) return false;
      if (bulkFilters.days.length > 0 && (!s.day_of_week || !bulkFilters.days.includes(s.day_of_week))) return false;

      if (bulkFilters.subjects.length > 0) {
        const mySubjects = [
          s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5,
          s.subject_science,
          s.subject_social
        ].filter(v => v && typeof v === 'string');
        const hasSubject = bulkFilters.subjects.some(filterSub => mySubjects.includes(filterSub));
        if (!hasSubject) return false;
      }
      return true;
    });
  }, [bulkFilters, students]);

  const toggleFilter = (type: 'grades' | 'classrooms' | 'days' | 'subjects', value: string) => {
    setBulkFilters(prev => {
      const current = prev[type];
      if (current.includes(value)) {
        return { ...prev, [type]: current.filter(v => v !== value) };
      } else {
        return { ...prev, [type]: [...current, value] };
      }
    });
  };

  // 一斉送信実行
  const handleBulkSend = async () => {
    if (!bulkMessage.trim()) return alert('メッセージを入力してください');
    if (bulkTargets.length === 0) return alert('条件に一致する生徒がいません');
    if (!confirm(`${bulkTargets.length}名のチャットにメッセージを一斉送信しますか？\n（生徒は通常のチャットとして返信できます）`)) return;

    setSendingBulk(true);
    try {
      // ★修正: chat_logs に role: 'teacher' で保存することで、通常の先生チャットとして扱われ、
      // 生徒はAIを介さずに直接返信できるようになります。
      const tasks = bulkTargets.map(student => 
        addDoc(collection(db, 'chat_logs'), {
          uid: student.id,
          role: 'teacher',
          teacher_name: profile?.name || '担当講師',
          // ★修正: 生徒名を正しく反映
          student_name: student.student_name,
          message: bulkMessage,
          is_broadcast: true, 
          created_at: serverTimestamp()
        })
      );

      await Promise.all(tasks);
      
      alert('送信が完了しました');
      setIsBulkModalOpen(false);
      setBulkMessage('');
    } catch (e) {
      console.error(e);
      alert('送信中にエラーが発生しました');
    } finally {
      setSendingBulk(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col h-screen overflow-hidden font-sans">
      <div className="flex-none mb-4">
        <Link href="/teacher/work" className="flex items-center text-gray-500 hover:text-gray-800"><ArrowLeft size={18}/> 管理画面へ戻る</Link>
      </div>

      <div className="flex flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
        
        {/* 左サイドバー */}
        <div className="w-1/3 border-r border-gray-200 flex flex-col min-w-[300px]">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-bold text-gray-700 flex items-center gap-2">
                <MessageCircle size={18}/> チャット一覧
              </h2>
              <button 
                onClick={() => setIsBulkModalOpen(true)}
                className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-indigo-700 flex items-center gap-1 transition-all"
              >
                <Users size={14}/> 一斉送信
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="生徒名検索..." 
                className="w-full pl-9 p-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-200 outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400"/></div>
            ) : filteredStudents.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">生徒が見つかりません</div>
            ) : (
              filteredStudents.map(student => {
                const dateStr = student.lastMessageAt ? new Date(student.lastMessageAt * 1000).toLocaleDateString() : '';
                return (
                  <div 
                    key={student.id} 
                    onClick={() => setSelectedStudent(student)}
                    className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${selectedStudent?.id === student.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="font-bold text-gray-800 text-sm flex items-center gap-2">
                        {/* ★修正: 生徒リストも「さん」付けで統一 */}
                        {student.student_name} さん
                        {student.hasAlert && (
                          <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                            <AlertTriangle size={10}/> Alert
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400">{student.grade}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-gray-300"></span> 履歴を確認
                      </span>
                      <span>{dateStr}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右メインエリア */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {selectedStudent ? (
            <>
              <div className="p-4 bg-white border-b border-gray-200 shadow-sm z-10 flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 border border-blue-200">
                  <User size={20} />
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                    {/* ★修正: ヘッダーも「さん」付けで統一 */}
                    {selectedStudent.student_name} さん
                    {selectedStudent.hasAlert && <AlertTriangle size={18} className="text-red-500"/>}
                  </div>
                  <div className="flex gap-2 text-xs text-gray-500 font-mono">
                    <span>{selectedStudent.classroom}</span>
                    <span>{selectedStudent.day_of_week}</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-[#F4F6F8]">
                {messages.map(msg => {
                  const isTeacher = msg.role === 'teacher';
                  const isAI = msg.role === 'assistant';
                  const isStudent = msg.role === 'user';
                  const alertStyle = msg.is_alert ? 'border-2 border-red-400 bg-red-50 ring-2 ring-red-100' : '';

                  return (
                    <div key={msg.id} className={`flex ${isTeacher ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col max-w-[75%] ${isTeacher ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1 mb-1 px-1">
                          {isAI && <span className="text-[10px] font-bold text-purple-600 flex items-center gap-1"><Bot size={10}/> AI Tutor</span>}
                          {isTeacher && <span className="text-[10px] font-bold text-blue-600">{msg.teacher_name || '講師'}</span>}
                          {/* ★修正: チャットログ内の生徒名にも「さん」を付け、名前がなければ「生徒さん」とする */}
                          {isStudent && <span className="text-[10px] font-bold text-gray-500">{msg.student_name || '生徒'} さん</span>}
                        </div>
                        <div className={`p-3.5 rounded-2xl text-sm shadow-sm relative ${
                          isTeacher 
                            ? 'bg-blue-600 text-white rounded-tr-none' 
                            : isAI 
                              ? `bg-white text-gray-800 border border-gray-200 rounded-tl-none ${alertStyle}`
                              : 'bg-green-50 text-gray-800 border border-green-100 rounded-tl-none'
                        }`}>
                          {msg.is_alert && <div className="flex items-center gap-1 text-red-500 font-bold text-xs mb-1 pb-1 border-b border-red-200"><AlertTriangle size={12}/> AI Alert: 要確認</div>}
                          {msg.is_broadcast && <div className="text-[10px] bg-white/20 px-1 rounded inline-block mb-1 border border-white/30">📢 一斉送信</div>}
                          <div className="whitespace-pre-wrap leading-relaxed">{msg.message}</div>
                        </div>
                        <div className="text-[9px] text-gray-400 mt-1 px-1">{msg.createdAtDate.toLocaleString([], {month:'numeric', day:'numeric', hour: '2-digit', minute:'2-digit'})}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 bg-white border-t border-gray-200">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 bg-gray-50 border border-gray-300 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                    <textarea 
                      className="w-full bg-transparent outline-none text-sm p-1 resize-none h-16"
                      placeholder="メッセージを入力 (Ctrl+Enterで送信)"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                  <button onClick={handleSend} disabled={!inputText.trim()} className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg shadow-blue-100 mb-1"><Send size={18} /></button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 text-center">※ Enterで改行、Ctrl(Command)+Enterで送信</p>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-4">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center"><MessageCircle size={48} className="text-gray-300" /></div>
              <p className="text-sm font-bold">左のリストから生徒を選択してください</p>
            </div>
          )}
        </div>

        {/* === 一斉送信モーダル === */}
        {isBulkModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-2xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              
              <div className="bg-gray-800 text-white p-5 flex justify-between items-center shrink-0">
                <h3 className="font-bold flex items-center gap-2 text-lg"><Users size={20}/> チャット一斉送信</h3>
                <button onClick={() => setIsBulkModalOpen(false)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-6">
                
                {/* 絞り込み設定 */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 space-y-5">
                  <h4 className="font-bold text-gray-700 flex items-center gap-2 text-sm"><Filter size={16}/> 送信先の絞り込み (AND条件)</h4>
                  
                  {/* 学年 */}
                  <div>
                    <p className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><Users size={12}/> 学年</p>
                    <div className="flex flex-wrap gap-2">
                      {availableOptions.grades.length > 0 ? availableOptions.grades.map(g => (
                        <button key={g} onClick={() => toggleFilter('grades', g)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${bulkFilters.grades.includes(g) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{g}</button>
                      )) : <span className="text-xs text-gray-400">登録なし</span>}
                    </div>
                  </div>

                  {/* 校舎 */}
                  <div>
                    <p className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><MapPin size={12}/> 校舎</p>
                    <div className="flex flex-wrap gap-2">
                      {availableOptions.classrooms.length > 0 ? availableOptions.classrooms.map(s => (
                        <button key={s} onClick={() => toggleFilter('classrooms', s)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${bulkFilters.classrooms.includes(s) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{s}</button>
                      )) : <span className="text-xs text-gray-400">登録なし</span>}
                    </div>
                  </div>

                  {/* 曜日 */}
                  <div>
                    <p className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><Calendar size={12}/> 通塾曜日</p>
                    <div className="flex flex-wrap gap-2">
                      {availableOptions.days.length > 0 ? availableOptions.days.map(d => (
                        <button key={d} onClick={() => toggleFilter('days', d)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${bulkFilters.days.includes(d) ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{d}</button>
                      )) : <span className="text-xs text-gray-400">登録なし</span>}
                    </div>
                  </div>

                  {/* 受講科目 */}
                  <div>
                    <p className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><BookOpen size={12}/> 受講科目 (いずれかを受講)</p>
                    <div className="flex flex-wrap gap-2">
                      {availableOptions.subjects.length > 0 ? availableOptions.subjects.map(sub => (
                        <button key={sub} onClick={() => toggleFilter('subjects', sub)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${bulkFilters.subjects.includes(sub) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{sub}</button>
                      )) : <span className="text-xs text-gray-400">登録科目なし</span>}
                    </div>
                  </div>

                  <div className="bg-blue-50 text-blue-700 px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-between">
                    <span>条件一致:</span>
                    <span className="text-lg">{bulkTargets.length} 名</span>
                  </div>
                </div>

                {/* メッセージ入力 */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                  <h4 className="font-bold text-gray-700 mb-3 text-sm">メッセージ内容</h4>
                  <textarea 
                    className="w-full h-32 p-4 bg-gray-50 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none"
                    placeholder="生徒のチャット画面に直接届きます..."
                    value={bulkMessage}
                    onChange={(e) => setBulkMessage(e.target.value)}
                  />
                </div>
              </div>

              <div className="p-5 border-t bg-white shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10 flex justify-end gap-3">
                <button onClick={() => setIsBulkModalOpen(false)} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">キャンセル</button>
                <button 
                  onClick={handleBulkSend}
                  disabled={sendingBulk || bulkTargets.length === 0 || !bulkMessage.trim()}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {sendingBulk ? <Loader2 className="animate-spin" size={20}/> : <Send size={20}/>}
                  {sendingBulk ? '送信中...' : '一斉送信する'}
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}