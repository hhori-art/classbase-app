'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { MessageCircle, ArrowLeft, Search, Send, User, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function TeacherChatPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // メッセージ自動スクロール用
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 生徒リストと最終メッセージの取得
  useEffect(() => {
    const fetchChatList = async () => {
      try {
        // 全生徒を取得
        const sQ = query(collection(db, 'users'), where('role', '==', 'student'));
        const sSnap = await getDocs(sQ);
        const allStudents = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 全ての個別メッセージを取得して、生徒ごとに最新のものを探す
        // (データ量が多い場合は非効率ですが、Supabase版のロジックを再現します)
        // private_messages コレクション: { student_id, content, is_from_student, created_at, ... }
        const mQ = query(collection(db, 'private_messages'), orderBy('created_at', 'desc'));
        const mSnap = await getDocs(mQ);
        const allMsgs = mSnap.docs.map(d => d.data());

        const list = allStudents.map((s: any) => {
          // この生徒IDに関連するメッセージを探す
          const lastMsg = allMsgs.find((m: any) => m.student_id === s.id);
          return { ...s, lastMessage: lastMsg };
        })
        .filter((s: any) => s.lastMessage) // メッセージがある生徒のみ表示
        .sort((a: any, b: any) => {
          const timeA = a.lastMessage?.created_at ? new Date(a.lastMessage.created_at).getTime() : 0;
          const timeB = b.lastMessage?.created_at ? new Date(b.lastMessage.created_at).getTime() : 0;
          return timeB - timeA;
        });

        setStudents(list);
        setFilteredStudents(list);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchChatList();
  }, []);

  // 検索フィルタ
  useEffect(() => {
    const result = students.filter(s => 
      (s.student_name && s.student_name.includes(search)) || 
      (s.grade && s.grade.includes(search))
    );
    setFilteredStudents(result);
  }, [search, students]);

  // 生徒選択 & リアルタイムリスナー設定
  useEffect(() => {
    if (!selectedStudent) return;

    // 選択された生徒とのメッセージをリアルタイム監視
    const q = query(
      collection(db, 'private_messages'),
      where('student_id', '==', selectedStudent.id),
      orderBy('created_at', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // FirestoreのTimestampをDateに変換して扱いやすくする
          createdAtDate: data.created_at ? new Date(data.created_at.seconds * 1000) : new Date() 
        };
      });
      setMessages(msgs);
      
      // スクロール
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });

    return () => unsubscribe();
  }, [selectedStudent]);

  const handleSend = async () => {
    if (!inputText.trim() || !selectedStudent || !user) return;
    
    try {
      await addDoc(collection(db, 'private_messages'), {
        student_id: selectedStudent.id, // 相手の生徒ID
        teacher_id: user.uid,           // 送信した講師ID
        content: inputText,
        is_from_student: false,         // 講師からのメッセージ
        created_at: serverTimestamp()
      });

      setInputText('');
      // リアルタイムリスナーが画面を更新するので、ここで手動更新は不要
    } catch (e) {
      alert('送信エラー');
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col h-screen overflow-hidden">
      <div className="flex-none mb-4">
        <Link href="/teacher" className="flex items-center text-gray-500 hover:text-gray-800"><ArrowLeft size={18}/> 管理画面へ戻る</Link>
      </div>

      <div className="flex flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* 左サイドバー: 生徒リスト */}
        <div className="w-1/3 border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
              <MessageCircle size={18}/> 個別相談リスト
            </h2>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="名前や学年で検索..." 
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
              <div className="p-4 text-center text-xs text-gray-400">メッセージ履歴のある生徒はいません</div>
            ) : (
              filteredStudents.map(student => (
                <div 
                  key={student.id} 
                  onClick={() => setSelectedStudent(student)}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${selectedStudent?.id === student.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-gray-800 text-sm">{student.student_name}</div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${student.grade?.includes('3') ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                      {student.grade}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1 truncate">
                    {student.lastMessage?.is_from_student ? '📩' : '↩️'} {student.lastMessage?.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右メインエリア: チャット画面 */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {selectedStudent ? (
            <>
              {/* チャットヘッダー */}
              <div className="p-4 bg-white border-b border-gray-200 flex items-center gap-3 shadow-sm z-10">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 border border-blue-200">
                  <User size={20} />
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-lg">{selectedStudent.student_name}</div>
                  <div className="text-xs text-gray-500 font-mono">ID: {selectedStudent.lifetime_id}</div>
                </div>
              </div>

              {/* メッセージ表示エリア */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.is_from_student ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[70%] p-3 rounded-2xl text-sm shadow-sm ${
                      msg.is_from_student 
                        ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-none' 
                        : 'bg-blue-600 text-white rounded-tr-none'
                    }`}>
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      <div className={`text-[10px] mt-1 text-right ${msg.is_from_student ? 'text-gray-400' : 'text-blue-200'}`}>
                        {msg.createdAtDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* 入力エリア */}
              <div className="p-4 bg-white border-t border-gray-200">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    className="flex-1 p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 transition-all"
                    placeholder="メッセージを入力..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  />
                  <button 
                    onClick={handleSend} 
                    disabled={!inputText.trim()}
                    className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-md shadow-blue-100"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-4">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                <MessageCircle size={40} className="text-gray-300" />
              </div>
              <p className="text-sm font-bold">左のリストから生徒を選択してください</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}