'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, MessageCircle, Send } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Student = { id: string; student_name?: string; grade?: string };
type ChatItem = { id: string; student_name: string; role?: string; content?: string; createdAt?: any };

export default function ParentMessagesPage() {
  const { user, profile } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile) return;
      setLoading(true);
      try {
        if (!user) return;
        const response = await fetch('/api/parent/chat-history', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'chat-history-load-failed');
        setStudents(data.students || []);
        setChatItems(data.messages || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [profile, user]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/parent/absence" className="rounded-2xl bg-white p-6 shadow-sm hover:shadow-md">
          <Send className="mb-4 text-orange-500" />
          <h2 className="text-lg font-black text-slate-900">欠席連絡</h2>
          <p className="mt-2 text-sm font-bold text-slate-400">保護者アカウントから、紐づく生徒の欠席・遅刻連絡を送信します。</p>
          <ArrowRight className="mt-4 text-slate-300" />
        </Link>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <MessageCircle className="mb-4 text-indigo-500" />
          <h2 className="text-lg font-black text-slate-900">AIメッセージ</h2>
          <p className="mt-2 text-sm font-bold text-slate-400">紐づく生徒のAIチューター利用履歴を必要な範囲で確認します。</p>
        </div>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-700">
            <MessageCircle size={18} /> 最近のAIメッセージ
          </h3>
          <span className="text-xs font-black text-slate-400">{students.length}名</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : chatItems.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-10 text-center text-sm font-bold text-slate-400">
            表示できるAIメッセージはまだありません
          </div>
        ) : (
          <div className="space-y-3">
            {chatItems.map(item => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-black text-indigo-600">{item.student_name}</span>
                  <span className="text-[10px] font-bold text-slate-400">{item.role === 'assistant' ? 'AI' : '生徒'}</span>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-700">
                  {item.content || '内容なし'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
