'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { Send, Bot, User, ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function StudentChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自動スクロール
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // メッセージ更新時にスクロール
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // ★Firestoreからチャット履歴をリアルタイム取得
  useEffect(() => {
    if (!user) return;

    // ユーザーごとのサブコレクション "chats/{uid}/messages" を監視
    const q = query(
      collection(db, 'chats', user.uid, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => doc.data());
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [user]);

  const handleSend = async () => {
    if (!input.trim() || !user || loading) return;
    
    const userInput = input;
    setInput(''); // 入力欄をクリア
    setLoading(true);

    try {
      // 1. ユーザーのメッセージをFirestoreに保存
      await addDoc(collection(db, 'chats', user.uid, 'messages'), {
        role: 'user',
        content: userInput,
        createdAt: serverTimestamp()
      });

      // 2. AI APIを呼び出し（履歴を含めて文脈を維持）
      // FirestoreのデータにはcreatedAtなどが含まれるため、API用に整形
      const historyForApi = messages.map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput, history: historyForApi }),
      });

      const data = await response.json();
      const aiReply = data.reply || 'すみません、うまく回答できませんでした。';

      // 3. AIの回答をFirestoreに保存
      await addDoc(collection(db, 'chats', user.uid, 'messages'), {
        role: 'assistant',
        content: aiReply,
        createdAt: serverTimestamp()
      });

    } catch (e) {
      console.error(e);
      // エラー時もメッセージとして保存してユーザーに通知
      await addDoc(collection(db, 'chats', user.uid, 'messages'), {
        role: 'assistant',
        content: '通信エラーが発生しました。もう一度試してください。',
        createdAt: serverTimestamp()
      });
    } finally {
      setLoading(false);
    }
  };

  // ★Enterキーの挙動改善
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enterキーが押された かつ Shiftキーが押されていない場合
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // 改行などのデフォルト動作を防ぐ
      
      // ★日本語変換中（IME入力中）なら送信しない
      if (e.nativeEvent.isComposing) return;

      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F0F4F8] font-sans">
      
      {/* ヘッダー */}
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

      {/* チャットエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-60 animate-in fade-in zoom-in duration-500">
            <Bot size={64} className="mb-4 text-indigo-300"/>
            <p className="font-bold">わからないことは何でも聞いてね！</p>
            <p className="text-xs mt-2">履歴は自動で保存されます</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
            <div className={`flex items-end gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              {/* アイコン */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-purple-600 border border-purple-100'
              }`}>
                {msg.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
              </div>

              {/* 吹き出し */}
              <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-tr-none' 
                  : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        
        {loading && (
          <div className="flex justify-start animate-pulse">
            <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-2 text-gray-400 text-xs font-bold">
              <Loader2 className="animate-spin text-purple-500" size={16}/> AIが考え中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="p-4 bg-white border-t border-gray-100 safe-area-pb">
        <div className="flex gap-2 bg-gray-50 p-2 rounded-3xl border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-200 transition-all shadow-inner">
          <input
            type="text"
            className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-3 text-gray-800 placeholder-gray-400 font-medium outline-none"
            placeholder="メッセージを入力..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} // 改善したハンドラを使用
            disabled={loading}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="bg-indigo-600 text-white w-12 h-12 rounded-full flex items-center justify-center hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-transform active:scale-95"
          >
            <Send size={20} className={loading ? 'opacity-0' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
}