'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowLeft, CalendarDays, CheckCircle2, Loader2, Megaphone, Send, UserPlus, XCircle } from 'lucide-react';

type Post = {
  id: string;
  teacher_name?: string;
  target_date: string;
  period: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'closed';
  claimed_by?: string;
  claimed_by_name?: string;
  shift_assignment_id?: string;
};

type EmptyShift = {
  id: string;
  target_date?: string;
  note?: string;
  role_type?: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  unit?: string;
  target_place?: string;
  teacher_name?: string;
  user_id?: string;
};

const todayString = () => new Date().toISOString().slice(0, 10);
const dayLabel = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return '';
  return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
};
const substituteMarkers = ['⇒', '→', '代講', '代行', '未定', '調整', '募集'];
const needsSubstitute = (shift: EmptyShift) => {
  const name = String(shift.teacher_name || '').trim();
  if (!name) return true;
  return substituteMarkers.some(marker => name.includes(marker));
};
const postKeyPart = (value: unknown) => String(value || '').trim().replace(/[^\p{Letter}\p{Number}]+/gu, '_').slice(0, 60) || 'none';
const candidatePostId = (shift: EmptyShift, period: string, title: string) => [
  'shift',
  postKeyPart(shift.target_date),
  postKeyPart(period),
  postKeyPart(shift.target_grade),
  postKeyPart(shift.target_subject),
  postKeyPart(shift.target_detail_subject),
  postKeyPart(shift.unit),
  postKeyPart(shift.target_place),
  postKeyPart(title),
].join('__').slice(0, 900);

export default function MasterSubstitutionsPage() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'open' | 'claimed' | 'all'>('open');
  const [emptyShifts, setEmptyShifts] = useState<EmptyShift[]>([]);
  const [form, setForm] = useState({
    target_date: todayString(),
    period: '1限',
    title: '',
    detail: '',
  });

  const adminName = profile?.name || profile?.student_name || user?.displayName || '管理者';

  const periodFromShift = (shift: EmptyShift) => {
    const raw = `${shift.note || ''} ${shift.target_detail_subject || ''}`.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return '1限';
    if (raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return '2限';
    return shift.note || 'その他';
  };

  const shiftTitle = (shift: EmptyShift) => {
    const subject = [shift.target_grade, shift.target_subject, shift.target_detail_subject].filter(Boolean).join(' ');
    return subject || shift.note || '講師未定の授業';
  };

  const loadData = async () => {
    setLoading(true);
    setCandidateLoading(true);
    try {
      const today = todayString();
      const [snap, shiftSnap] = await Promise.all([
        getDocs(query(collection(db, 'teacher_substitution_posts'), orderBy('created_at', 'desc'), limit(120))),
        getDocs(query(collection(db, 'shift_assignments'), where('target_date', '>=', today), orderBy('target_date', 'asc'), limit(500))).catch(() => ({ docs: [] as any[] })),
      ]);
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
      const existingShiftIds = new Set(snap.docs.map(d => String((d.data() as any).shift_assignment_id || '')).filter(Boolean));
      const existingPostIds = new Set(snap.docs.map(d => d.id));
      setEmptyShifts(shiftSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as EmptyShift))
        .filter((shift: EmptyShift) => needsSubstitute(shift))
        .filter((shift: EmptyShift) => shift.role_type !== 'sub')
        .filter((shift: EmptyShift) => !existingShiftIds.has(shift.id))
        .filter((shift: EmptyShift) => !existingPostIds.has(candidatePostId(shift, periodFromShift(shift), shiftTitle(shift))))
        .slice(0, 30)
      );
    } catch (e) {
      console.error(e);
      setPosts([]);
      setEmptyShifts([]);
    } finally {
      setLoading(false);
      setCandidateLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const visiblePosts = useMemo(() => posts.filter(post => {
    if (filter === 'open') return post.status === 'open';
    if (filter === 'claimed') return post.status === 'claimed';
    return true;
  }), [posts, filter]);

  const createPost = async (candidate?: EmptyShift) => {
    if (!user) return;
    const targetDate = candidate?.target_date || form.target_date;
    const period = candidate ? periodFromShift(candidate) : form.period;
    const title = candidate ? shiftTitle(candidate) : form.title.trim();
    const detail = candidate
      ? [
        candidate.unit ? `単元: ${candidate.unit}` : '',
        candidate.target_place ? `場所: ${candidate.target_place}` : '',
        candidate.teacher_name ? `現在の講師欄: ${candidate.teacher_name}` : '',
        candidate.note ? `備考: ${candidate.note}` : '',
      ].filter(Boolean).join('\n')
      : form.detail.trim();
    if (!targetDate || !title) return alert('日付と件名を入力してください。');
    setSaving(true);
    try {
      const payload = {
        created_by: user.uid,
        teacher_name: adminName,
        target_date: targetDate,
        period,
        title,
        detail,
        shift_assignment_id: candidate?.id || null,
        shift_summary: candidate ? {
          target_grade: candidate.target_grade || '',
          target_subject: candidate.target_subject || '',
          target_detail_subject: candidate.target_detail_subject || '',
          unit: candidate.unit || '',
          target_place: candidate.target_place || '',
        } : null,
        status: 'open',
        updated_at: serverTimestamp(),
      };

      if (candidate) {
        const postRef = doc(db, 'teacher_substitution_posts', candidatePostId(candidate, period, title));
        const existing = await getDoc(postRef);
        if (existing.exists()) {
          const existingData = existing.data() as Post;
          if (existingData.status === 'open' || existingData.status === 'claimed') {
            alert('この講師配置の代行依頼はすでに作成済みです。');
            return;
          }
        }
        await setDoc(postRef, {
          ...payload,
          shift_assignment_id: candidate.id,
          created_at: existing.exists() ? existing.data().created_at || serverTimestamp() : serverTimestamp(),
        }, { merge: true });
      } else {
        await addDoc(collection(db, 'teacher_substitution_posts'), {
          ...payload,
          created_at: serverTimestamp(),
        });
      }
      setForm({ target_date: todayString(), period: '1限', title: '', detail: '' });
      await loadData();
    } catch (e: any) {
      alert(`作成に失敗しました: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const closePost = async (post: Post) => {
    if (!confirm('この代行依頼を締め切りますか？')) return;
    await updateDoc(doc(db, 'teacher_substitution_posts', post.id), {
      status: 'closed',
      updated_at: serverTimestamp(),
    });
    await loadData();
  };

  const reopenPost = async (post: Post) => {
    if (!confirm('この代行依頼を再募集しますか？')) return;
    await updateDoc(doc(db, 'teacher_substitution_posts', post.id), {
      status: 'open',
      claimed_by: null,
      claimed_by_name: null,
      updated_at: serverTimestamp(),
    });
    await loadData();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Link href="/master" className="rounded-full bg-white p-3 text-slate-500 shadow-sm hover:bg-slate-100">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-500">Substitute Requests</p>
          <h1 className="text-2xl font-black text-slate-900">代行依頼管理</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">代行依頼の作成・締切は管理者のみ行えます。</p>
        </div>
      </header>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Megaphone className="text-rose-500" size={20} />
          <h2 className="text-sm font-black text-slate-800">代行依頼を作成</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-[160px_120px_1fr]">
          <label>
            <span className="mb-1 block text-xs font-black text-slate-500">日付</span>
            <input type="date" value={form.target_date} onChange={e => setForm(prev => ({ ...prev, target_date: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-100" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-black text-slate-500">時限</span>
            <select value={form.period} onChange={e => setForm(prev => ({ ...prev, period: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-100">
              <option>1限</option>
              <option>2限</option>
              <option>全日</option>
              <option>その他</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-black text-slate-500">件名</span>
            <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="例: 中2理科 1限の代行をお願いします" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-100" />
          </label>
        </div>
        <textarea value={form.detail} onChange={e => setForm(prev => ({ ...prev, detail: e.target.value }))} placeholder="詳細、引き継ぎ事項、集合場所、連絡方法など" className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-100" />
        <button onClick={() => createPost()} disabled={saving} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 代行依頼を作成
        </button>
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="text-indigo-500" size={20} />
          <h2 className="text-sm font-black text-slate-800">講師未定の講師配置から作成</h2>
        </div>
        {candidateLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-indigo-400" /></div>
        ) : emptyShifts.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-8 text-center text-sm font-bold text-slate-400">講師名が空欄の講師配置はありません</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {emptyShifts.map(shift => (
              <div key={shift.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">{shift.target_date}（{dayLabel(shift.target_date || '')}） {periodFromShift(shift)}</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-700">{shift.teacher_name ? '代講表示あり' : '講師未定'}</span>
                </div>
                <h3 className="text-sm font-black text-slate-900">{shiftTitle(shift)}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{[shift.unit, shift.target_place, shift.note].filter(Boolean).join(' / ') || '詳細未設定'}</p>
                <button onClick={() => createPost(shift)} disabled={saving} className="mt-3 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                  この配置から代行依頼を作成
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-sm font-black text-slate-800">依頼一覧</h2>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1 text-xs font-black">
            {[
              ['open', '募集中'],
              ['claimed', '返答あり'],
              ['all', 'すべて'],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key as any)} className={`rounded-xl px-3 py-2 ${filter === key ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>{label}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-rose-400" /></div>
        ) : visiblePosts.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-12 text-center text-sm font-bold text-slate-400">表示できる依頼はありません</div>
        ) : (
          <div className="space-y-3">
            {visiblePosts.map(post => (
              <div key={post.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600"><CalendarDays size={12} className="mr-1 inline" />{post.target_date}（{dayLabel(post.target_date)}） {post.period}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${post.status === 'open' ? 'bg-rose-100 text-rose-700' : post.status === 'claimed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                        {post.status === 'open' ? '募集中' : post.status === 'claimed' ? '返答あり' : '締切'}
                      </span>
                    </div>
                    <h3 className="text-base font-black text-slate-900">{post.title}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">作成: {post.teacher_name || '管理者'}{post.claimed_by_name ? ` / 代行可能: ${post.claimed_by_name}` : ''}</p>
                    {post.shift_assignment_id && <p className="mt-1 text-[11px] font-black text-indigo-500">講師配置連携済み</p>}
                    {post.detail && <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">{post.detail}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {post.status !== 'closed' && (
                      <button onClick={() => closePost(post)} className="flex items-center gap-1 rounded-2xl bg-slate-200 px-4 py-3 text-xs font-black text-slate-600 hover:bg-slate-300"><XCircle size={16} /> 締切</button>
                    )}
                    {post.status !== 'open' && (
                      <button onClick={() => reopenPost(post)} className="flex items-center gap-1 rounded-2xl bg-emerald-500 px-4 py-3 text-xs font-black text-white hover:bg-emerald-600"><CheckCircle2 size={16} /> 再募集</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
