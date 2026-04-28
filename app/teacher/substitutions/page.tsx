'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, CalendarDays, CheckCircle2, Loader2, Megaphone } from 'lucide-react';

type Post = {
  id: string;
  created_by?: string;
  teacher_id?: string;
  teacher_name?: string;
  target_date: string;
  period: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'closed';
  claimed_by?: string;
  claimed_by_name?: string;
  shift_assignment_id?: string;
  created_at?: any;
};

const dayLabel = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return '';
  return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
};

export default function TeacherSubstitutionsPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'mine' | 'all'>('open');

  const loadPosts = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'teacher_substitution_posts'), orderBy('created_at', 'desc'), limit(80)));
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
    } catch (e) {
      console.error(e);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadPosts();
  }, [user]);

  const visiblePosts = useMemo(() => posts.filter(post => {
    if (filter === 'open') return post.status === 'open';
    if (filter === 'mine') return post.claimed_by === user?.uid;
    return true;
  }), [posts, filter, user?.uid]);

  const claimPost = async (post: Post) => {
    if (!user) return;
    if (!confirm('この代行に対応可能として返答しますか？')) return;
    const token = await user.getIdToken();
    const res = await fetch('/api/teacher/substitutions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ post_id: post.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const message = data.error === 'shift-already-filled'
        ? 'この講師配置はすでに埋まっています。'
        : data.error === 'already-claimed-or-closed'
          ? 'この代行依頼はすでに締切または返答済みです。'
          : data.error || '返答に失敗しました。';
      alert(message);
      await loadPosts();
      return;
    }
    await loadPosts();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 pb-28 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center gap-4">
          <Link href="/teacher/work" className="rounded-full bg-white p-3 text-slate-500 shadow-sm hover:bg-slate-100">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-500">Substitute Board</p>
            <h1 className="text-2xl font-black text-slate-900">代行依頼掲示板</h1>
          </div>
        </header>

        <section className="rounded-[28px] border border-rose-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-600"><Megaphone size={22} /></div>
            <div>
              <h2 className="text-sm font-black text-slate-800">講師は返答のみできます</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">代行依頼の作成・締切はマスター管理者または校舎管理者が行います。対応できる募集があれば「代行できます」を押してください。</p>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-sm font-black text-slate-800">募集一覧</h2>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1 text-xs font-black">
              {[
                ['open', '募集中'],
                ['mine', '自分関連'],
                ['all', 'すべて'],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key as any)} className={`rounded-xl px-3 py-2 ${filter === key ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>{label}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-rose-400" /></div>
          ) : visiblePosts.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-100 py-12 text-center text-sm font-bold text-slate-400">表示できる募集はありません</div>
          ) : (
            <div className="space-y-3">
              {visiblePosts.map(post => (
                <div key={post.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600"><CalendarDays size={12} className="mr-1 inline" />{post.target_date}（{dayLabel(post.target_date)}） {post.period}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${post.status === 'open' ? 'bg-rose-100 text-rose-700' : post.status === 'claimed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          {post.status === 'open' ? '募集中' : post.status === 'claimed' ? '引受済' : '締切'}
                        </span>
                      </div>
                      <h3 className="text-base font-black text-slate-900">{post.title}</h3>
                      <p className="mt-1 text-xs font-bold text-slate-400">依頼元: {post.teacher_name || '管理者'}{post.claimed_by_name ? ` / 返答: ${post.claimed_by_name}` : ''}</p>
                      {post.shift_assignment_id && <p className="mt-1 text-[11px] font-black text-indigo-500">講師配置と連携しています。返答すると担当講師に反映されます。</p>}
                      {post.detail && <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">{post.detail}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {post.status === 'open' && (
                        <button onClick={() => claimPost(post)} className="flex items-center gap-1 rounded-2xl bg-emerald-500 px-4 py-3 text-xs font-black text-white hover:bg-emerald-600"><CheckCircle2 size={16} /> 代行できます</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
