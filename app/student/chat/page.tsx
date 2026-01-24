'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, addDoc, onSnapshot, serverTimestamp, where, limit, orderBy } from 'firebase/firestore';
import { Send, Bot, User, ArrowLeft, Sparkles, Loader2, AlertTriangle, RefreshCw, Megaphone } from 'lucide-react';
import Link from 'next/link';

export default function StudentChatPage() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  // ★AI応答モード管理 (true: AIが返信, false: 先生への連絡のみ)
  const [isAiMode, setIsAiMode] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 1. 個別チャットの監視
  useEffect(() => {
    if (!user) return;

    // インデックスエラー回避のため orderBy を外し、クライアント側でソート
    const q = query(
      collection(db, 'chat_logs'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data() as any; // ★ここで any 型として扱うよう修正
        return {
          ...data,
          createdAtDate: data.created_at ? new Date(data.created_at.seconds * 1000) : new Date()
        };
      });
      
      // 日付順にソート
      msgs.sort((a, b) => a.createdAtDate.getTime() - b.createdAtDate.getTime());
      setMessages(msgs);

      // ★自動モード切替: 最後のメッセージが先生なら、次は「先生への返信」としてAIをOFFにする
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role === 'teacher') {
          setIsAiMode(false);
        } else if (lastMsg.role === 'assistant') {
          setIsAiMode(true);
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // 2. 一斉配信の監視 (broadcasts)
  useEffect(() => {
    if (!profile) return;
    
    // 一斉配信を取得
    const q = query(collection(db, 'broadcasts'), orderBy('created_at', 'desc'), limit(20));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = new Date();
      const validBroadcasts = snapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as any))
        .filter((b: any) => {
          // A. 公開日時チェック
          const scheduled = b.scheduled_at ? new Date(b.scheduled_at.seconds * 1000) : new Date();
          if (scheduled > now) return false;

          // B. ターゲットチェック
          const t = b.targets;
          if (!t || (t.grades.length === 0 && t.schools.length === 0 && t.subjects.length === 0)) return true; // 全員

          const gradeMatch = t.grades.length > 0 && t.grades.includes(profile.grade);
          const schoolMatch = t.schools.length > 0 && profile.school && t.schools.includes(profile.school);
          const mySubjects = [profile.subject_1, profile.subject_2, profile.subject_3].filter(Boolean);
          const subjectMatch = t.subjects.length > 0 && t.subjects.some((sub: string) => mySubjects.includes(sub));

          // 条件のいずれかに一致すれば表示
          if (t.grades.length > 0 && !gradeMatch) return false;
          if (t.schools.length > 0 && !schoolMatch) return false;
          if (t.subjects.length > 0 && !subjectMatch) return false;

          return true;
        })
        .map((b: any) => ({
          role: 'broadcast',
          message: b.content,
          sender_name: b.sender_name || 'お知らせ',
          createdAtDate: b.scheduled_at ? new Date(b.scheduled_at.seconds * 1000) : new Date()
        }));
        
      setBroadcasts(validBroadcasts);
    });

    return () => unsubscribe();
  }, [profile]);

  // マージとソート (チャットログ + 一斉配信)
  const displayTimeline = useMemo(() => {
    const combined = [...messages, ...broadcasts];
    return combined.sort((a, b) => a.createdAtDate.getTime() - b.createdAtDate.getTime());
  }, [messages, broadcasts]);

  useEffect(() => {
    scrollToBottom();
  }, [displayTimeline, loading]);

  const checkSensitiveContent = (text: string) => {
    const ngWords = ['死ね', '殺す', '自殺', 'エッチ', '馬鹿', 'アホ'];
    return ngWords.some(word => text.includes(word));
  };

  const handleSend = async () => {
    if (!input.trim() || !user || loading) return;
    
    const userInput = input;
    setInput('');
    
    // AIモードの場合のみローディング
    if (isAiMode) setLoading(true);

    const isAlert = checkSensitiveContent(userInput);

    try {
      // ユーザーのメッセージを保存
      await addDoc(collection(db, 'chat_logs'), {
        uid: user.uid,
        student_name: profile?.student_name || '生徒',
        role: 'user',
        message: userInput,
        is_alert: isAlert,
        created_at: serverTimestamp()
      });

      // ★AIモードがOFFならここで終了
      if (!isAiMode) {
        setLoading(false);
        return;
      }

      const historyForApi = messages
        .filter(m => m.role !== 'teacher' && m.role !== 'broadcast')
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.message }));
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userInput, 
          history: historyForApi,
          studentName: profile?.student_name
        }),
      });

      const data = await response.json();
      let aiReply = data.reply || 'すみません、うまく回答できませんでした。';

      if (isAlert) {
        aiReply = "その言葉は不適切かもしれません。先生に通知が届く場合があります。悩みがあるなら相談してくださいね。";
      }

      await addDoc(collection(db, 'chat_logs'), {
        uid: user.uid,
        student_name: 'AI Tutor',
        role: 'assistant',
        message: aiReply,
        created_at: serverTimestamp()
      });

    } catch (e) {
      console.error(e);
      if (isAiMode) {
        await addDoc(collection(db, 'chat_logs'), {
          uid: user.uid,
          role: 'assistant',
          message: '通信エラーが発生しました。',
          created_at: serverTimestamp()
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing) return;
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F0F4F8] font-sans">
      <div className="bg-white px-4 py-4 shadow-sm flex items-center gap-4 sticky top-0 z-10">
        <Link href="/student" className="bg-gray-100 p-2 rounded-full text-gray-500 hover:bg-gray-200 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
            <span className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white p-1.5 rounded-lg">
              <Bot size={20} />
            </span>
            AIチューター
          </h1>
          <p className="text-xs text-gray-400 font-bold">24時間いつでも質問OK！</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {displayTimeline.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-60">
            <Bot size={64} className="mb-4 text-indigo-300"/>
            <p className="font-bold">わからないことは何でも聞いてね！</p>
            <p className="text-xs mt-2">※先生もこの会話を見守っています</p>
          </div>
        )}

        {displayTimeline.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isTeacher = msg.role === 'teacher';
          const isBroadcast = msg.role === 'broadcast';
          const align = isUser ? 'justify-end' : 'justify-start';
          
          return (
            <div key={idx} className={`flex ${align} animate-in slide-in-from-bottom-2`}>
              <div className={`flex items-end gap-2 max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                  isUser ? 'bg-indigo-100 text-indigo-600' 
                  : isTeacher ? 'bg-blue-600 text-white'
                  : isBroadcast ? 'bg-green-600 text-white'
                  : 'bg-white text-purple-600 border border-purple-100'
                }`}>
                  {isUser ? <User size={16} /> : isTeacher ? <User size={16}/> : isBroadcast ? <Megaphone size={16}/> : <Sparkles size={16} />}
                </div>

                <div className="flex flex-col">
                  {isTeacher && <span className="text-[10px] text-blue-600 font-bold mb-1 ml-1">{msg.teacher_name || '先生'}</span>}
                  {isBroadcast && <span className="text-[10px] text-green-600 font-bold mb-1 ml-1">{msg.sender_name}</span>}
                  
                  <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap relative ${
                    isUser 
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-tr-none' 
                      : isTeacher
                        ? 'bg-white border-2 border-blue-100 text-gray-800 rounded-tl-none'
                        : isBroadcast
                          ? 'bg-white border-2 border-green-100 text-gray-800 rounded-tl-none'
                          : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                  }`}>
                    {isUser && msg.is_alert && (
                      <div className="flex items-center gap-1 text-yellow-200 text-xs font-bold mb-2 pb-1 border-b border-white/20">
                        <AlertTriangle size={12}/> 不適切な表現が含まれている可能性があります
                      </div>
                    )}
                    {msg.message}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        
        {loading && (
          <div className="flex justify-start animate-pulse">
            <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-2 text-gray-400 text-xs font-bold">
              <Loader2 className="animate-spin text-purple-500" size={16}/> AIが考え中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-100 safe-area-pb">
        <div className="flex justify-center mb-2">
          <button 
            onClick={() => setIsAiMode(!isAiMode)}
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
              isAiMode 
                ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                : 'bg-blue-100 text-blue-700 border border-blue-200'
            }`}
          >
            {isAiMode ? <><Sparkles size={12}/> AIと会話中</> : <><User size={12}/> 先生へ送信モード</>}
            <RefreshCw size={10} className="opacity-50"/>
          </button>
        </div>

        <div className="flex gap-2 bg-gray-50 p-2 rounded-3xl border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-200 transition-all shadow-inner">
          <input
            type="text"
            className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-3 text-gray-800 placeholder-gray-400 font-medium outline-none"
            placeholder={isAiMode ? "AIに質問する..." : "先生へメッセージを送る..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} 
            disabled={loading}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 disabled:opacity-50 ${
              isAiMode ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Send size={20} className={loading ? 'opacity-0' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
}