'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  addDoc, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { Send, ArrowLeft, Loader2, User, UserCircle } from 'lucide-react';
import Link from 'next/link';

export default function ChatPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  
  // 自動スクロール用の参照
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 初回マウント時にリアルタイムリスナーを設定
  useEffect(() => {
    // 過去100件を表示
    const q = query(
      collection(db, 'messages'),
      orderBy('created_at', 'asc'),
      limit(100)
    );

    // onSnapshot: Firestoreのデータが変わるたびに実行される
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(msgs);
      setLoading(false);
      
      // 新着メッセージがあれば下までスクロール
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });

    // クリーンアップ関数: 画面を離れる時にリスナーを解除
    return () => unsubscribe();
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    try {
      await addDoc(collection(db, 'messages'), {
        text: newMessage,
        uid: user.uid,
        name: profile?.student_name || profile?.name || user.displayName || '名無し',
        role: profile?.role || 'student', // student | teacher | master
        created_at: serverTimestamp(), // サーバー側で時刻を設定
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('送信できませんでした');
    }
  };

  if (authLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;

  // 戻るボタンのリンク先をロールによって変える
  const backLink = profile?.role === 'master' ? '/master' : profile?.role === 'teacher' ? '/teacher' : '/student';

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      
      {/* ヘッダー */}
      <header className="bg-white p-4 shadow-sm flex items-center gap-4 z-10">
        <Link href={backLink} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-800">クラスルーム・チャット</h1>
          <p className="text-xs text-gray-400">全体連絡・雑談用</p>
        </div>
      </header>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-gray-400" />
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.uid === user?.uid;
          
          return (
            <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
              
              {/* アイコン */}
              <div className="shrink-0">
                {msg.role === 'teacher' || msg.role === 'master' ? (
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center border border-purple-200">
                    <User size={16} />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center border border-green-200">
                    <UserCircle size={16} />
                  </div>
                )}
              </div>

              {/* 吹き出し */}
              <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className="flex items-baseline gap-2 mb-1 px-1">
                  <span className="text-xs font-bold text-gray-600">{msg.name}</span>
                  {msg.role !== 'student' && <span className="text-[10px] bg-purple-100 text-purple-600 px-1 rounded">講師</span>}
                </div>
                
                <div className={`p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm
                  ${isMe 
                    ? 'bg-blue-600 text-white rounded-tr-none' 
                    : 'bg-white text-gray-800 border border-gray-200 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
                
                <span className="text-[10px] text-gray-400 mt-1 px-1">
                  {msg.created_at ? new Date(msg.created_at.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                </span>
              </div>
            </div>
          );
        })}
        {/* 自動スクロール用アンカー */}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="bg-white p-4 border-t border-gray-200">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            className="flex-1 bg-gray-100 border-0 rounded-full px-5 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="メッセージを入力..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <button 
            type="submit" 
            disabled={!newMessage.trim()}
            className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-md shadow-blue-200"
          >
            <Send size={20} />
          </button>
        </form>
      </div>

    </div>
  );
}