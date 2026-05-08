'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from 'ai/react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, where, limit, onSnapshot } from 'firebase/firestore';
import { Send, User, Bot, Loader2, Mail, Sparkles, MessageCircle, Info } from 'lucide-react';
import { logActivity } from '@/lib/logActivity';

export default function StudentChat() {
  const { user, profile } = useAuth();
  const [isSendingToTeacher, setIsSendingToTeacher] = useState(false);
  const [teacherMessages, setTeacherMessages] = useState<any[]>([]);
  const [teacherReply, setTeacherReply] = useState('');
  const [teacherReplyLoading, setTeacherReplyLoading] = useState(false);
  const showChatDestination = process.env.NEXT_PUBLIC_SHOW_CHAT_DESTINATION !== 'false';
  const stamps = ['ありがとう', 'わかった', '質問です', '復習します'];
  
  // useChat フック
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    
    // AIの回答が完了したタイミングで保存
    onFinish: async (message) => {
      if (!user) return;
      try {
        await addDoc(collection(db, 'users', user.uid, 'chat_history'), {
          role: 'assistant',
          content: message.content,
          createdAt: serverTimestamp(),
        });

        await logActivity(
          user.uid,
          profile?.student_name || '生徒',
          'chat',
          `AIチューターと会話しました`
        );
      } catch (e) {
        console.error("保存エラー", e);
      }
    },
  });

  // --- 1. 会話履歴の読み込み ---
  useEffect(() => {
    if (!user) return;

    const loadHistory = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'chat_history'),
          orderBy('createdAt', 'asc')
        );
        const snapshot = await getDocs(q);
        
        const history = snapshot.docs.map(doc => ({
          id: doc.id,
          role: doc.data().role,
          content: doc.data().content,
        }));

        if (history.length > 0) {
          // @ts-ignore: 型エラー回避
          setMessages(history);
        }
      } catch (e) {
        console.error("履歴読み込みエラー", e);
      }
    };

    loadHistory();
  }, [user, setMessages]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'chat_logs'), where('uid', '==', user.uid), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const toMillis = (value: any) => {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      };
      list.sort((a: any, b: any) => toMillis(a.created_at || a.createdAt) - toMillis(b.created_at || b.createdAt));
      setTeacherMessages(list);
    }, (error) => {
      console.error('先生チャット読み込みエラー', error);
    });
    return () => unsubscribe();
  }, [user]);

  // --- 2. ユーザーのメッセージ送信時に保存 ---
  const customSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !input.trim()) return;

    try {
      await addDoc(collection(db, 'users', user.uid, 'chat_history'), {
        role: 'user',
        content: input,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("メッセージ保存エラー", error);
    }

    handleSubmit(e);
  };

  // --- 3. 先生に送信機能 ---
  const handleSendToTeacher = async () => {
    if (!user || messages.length === 0) return;
    if (!confirm('この会話の内容を先生に送信しますか？\n（先生が後で確認してアドバイスをくれます）')) return;

    setIsSendingToTeacher(true);
    try {
      await addDoc(collection(db, 'teacher_inquiries'), {
        studentId: user.uid,
        studentName: profile?.student_name || '生徒',
        content: messages.map(m => `${m.role === 'user' ? '生徒' : 'AI'}: ${m.content}`).join('\n\n'),
        createdAt: serverTimestamp(),
        status: 'unread'
      });
      alert('先生に送信しました！\n確認まで少し待っててね。');
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました');
    } finally {
      setIsSendingToTeacher(false);
    }
  };

  const sendStamp = async (stamp: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'chat_history'), {
        role: 'user',
        content: `[スタンプ] ${stamp}`,
        message_type: 'stamp',
        createdAt: serverTimestamp(),
      });
      // @ts-ignore
      setMessages(current => [...current, { id: `stamp-${Date.now()}`, role: 'user', content: `[スタンプ] ${stamp}` }]);
    } catch (e) {
      console.error(e);
    }
  };

  const sendTeacherReply = async () => {
    if (!user || !teacherReply.trim()) return;
    setTeacherReplyLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/student/teacher-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: teacherReply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'teacher-chat-send-failed');
      setTeacherReply('');
    } catch (e) {
      console.error(e);
      alert('先生への返信に失敗しました');
    } finally {
      setTeacherReplyLoading(false);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-[#F0F4F8] font-sans overflow-hidden">
      
      {/* ヘッダー: 教育アプリらしいポップで信頼感のあるデザイン */}
      <div className="bg-white/80 backdrop-blur-md px-4 py-3 shadow-sm border-b border-indigo-50 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 transform group-hover:scale-105 transition-transform">
              <Bot size={22} className="fill-white/20" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-400 border-2 border-white rounded-full"></div>
          </div>
          <div>
            <h1 className="font-bold text-gray-800 text-lg leading-tight flex items-center gap-1">
              AIチューター <Sparkles size={14} className="text-yellow-500 fill-yellow-500 animate-pulse"/>
            </h1>
            <p className="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-0.5 rounded-full inline-block mt-0.5">
              {showChatDestination ? '宛先: AIチューター' : '24時間いつでも質問OK'}
            </p>
          </div>
        </div>
        
        {/* 先生に送信ボタン: 「お助けボタン」のような見た目に */}
        <button 
          onClick={handleSendToTeacher}
          disabled={messages.length === 0 || isSendingToTeacher}
          className="group flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          title="先生に会話を送る"
        >
          <div className="w-9 h-9 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center border border-orange-100 group-hover:bg-orange-100 group-hover:scale-110 transition-all shadow-sm">
            {isSendingToTeacher ? <Loader2 size={16} className="animate-spin"/> : <Mail size={16} />}
          </div>
          <span className="text-[9px] font-bold text-orange-400 group-hover:text-orange-600">先生へ報告</span>
        </button>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="mx-auto max-w-3xl rounded-3xl border border-orange-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="rounded-2xl bg-orange-50 p-2 text-orange-500"><MessageCircle size={18} /></div>
              <div>
                <h2 className="text-sm font-black text-gray-800">先生からのメッセージ</h2>
                <p className="text-[10px] font-bold text-gray-400">先生宛の返信もここから送れます</p>
              </div>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black text-orange-500">{teacherMessages.length}件</span>
          </div>

          {teacherMessages.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 px-4 py-5 text-center text-xs font-bold text-gray-400">
              まだ先生からのメッセージはありません
            </div>
          ) : (
            <div className="mb-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {teacherMessages.slice(-8).map((m) => {
                const isTeacher = m.role === 'teacher';
                return (
                  <div key={m.id} className={`rounded-2xl px-3 py-2 text-xs font-bold leading-relaxed ${isTeacher ? 'bg-orange-50 text-gray-800' : 'bg-indigo-50 text-indigo-700'}`}>
                    <div className="mb-1 text-[10px] font-black opacity-60">{isTeacher ? '先生' : '自分'}</div>
                    <div className="whitespace-pre-wrap">{m.message || m.content}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={teacherReply}
              onChange={(e) => setTeacherReply(e.target.value)}
              placeholder="先生へ返信..."
              className="min-w-0 flex-1 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-200 focus:bg-white"
            />
            <button
              type="button"
              onClick={sendTeacherReply}
              disabled={!teacherReply.trim() || teacherReplyLoading}
              className="rounded-2xl bg-orange-500 px-4 py-3 text-white shadow-sm disabled:opacity-50"
              aria-label="先生へ返信"
            >
              {teacherReplyLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </section>

        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-80 animate-in fade-in zoom-in duration-500">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-xl mb-4 border-4 border-indigo-50">
              <Sparkles size={40} className="text-indigo-400 fill-indigo-100"/>
            </div>
            <h3 className="text-lg font-bold text-gray-700 mb-2">何でも聞いてね！</h3>
            <p className="text-xs text-gray-500 font-medium bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100">
              「数学の宿題がわからない」<br/>
              「英単語の覚え方を教えて」<br/>
              「勉強のやる気が出ない...」
            </p>
          </div>
        )}

        {messages.map((m: any, index: number) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={index}
              className={`flex items-end gap-2.5 ${isUser ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2 duration-300`}
            >
              {/* アイコン */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm text-white text-xs font-bold
                ${isUser 
                  ? 'bg-blue-400 shadow-blue-200' 
                  : 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-indigo-200'
                }
              `}>
                {isUser ? <User size={14} /> : <Bot size={14} />}
              </div>

              {/* 吹き出し */}
              <div className={`max-w-[80%] p-3.5 rounded-2xl text-[13.5px] leading-relaxed shadow-sm relative group
                ${isUser 
                  ? 'bg-blue-500 text-white rounded-br-none shadow-blue-100' 
                  : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none shadow-gray-100'
                }
              `}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                
                {/* 送信時間などのメタ情報（必要なら表示） */}
                {/* <div className={`text-[9px] mt-1 text-right opacity-60 ${isUser ? 'text-white' : 'text-gray-400'}`}>Just now</div> */}
              </div>
            </div>
          );
        })}
        
        {/* ローディング表示: 可愛らしく */}
        {isLoading && (
          <div className="flex items-center gap-2 ml-10 animate-pulse">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <span className="text-xs font-bold text-indigo-400">考え中...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア: 浮かんでいるようなモダンなデザイン */}
      <div className="p-3 pb-6 bg-[#F0F4F8] sm:p-4"> {/* 背景色に合わせて一体感を出す */}
        <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
          {stamps.map(stamp => (
            <button key={stamp} onClick={() => sendStamp(stamp)} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-black text-indigo-500 shadow-sm border border-indigo-50">
              {stamp}
            </button>
          ))}
        </div>
        <form onSubmit={customSubmit} className="relative flex items-end gap-2 max-w-3xl mx-auto">
          <div className="flex-1 bg-white rounded-3xl shadow-lg shadow-gray-200 border border-gray-100 focus-within:ring-2 focus-within:ring-indigo-100 transition-all flex items-center p-1.5 pl-4">
            <input
              className="w-full bg-transparent text-gray-800 text-sm focus:outline-none py-2 font-bold placeholder:text-gray-300 placeholder:font-medium"
              value={input}
              onChange={handleInputChange}
              placeholder="メッセージを入力..."
              disabled={isLoading}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={`
                p-2.5 rounded-full transition-all duration-300 transform active:scale-95 flex items-center justify-center
                ${!input.trim() || isLoading 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-md shadow-indigo-200 hover:shadow-lg'
                }
              `}
            >
              {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Send size={18} className="ml-0.5" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
