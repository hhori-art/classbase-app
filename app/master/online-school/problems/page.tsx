'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Problem = { id: string; subject_id: string; category_id: string; category_name: string; level: number; problem_type: string; prompt: string; passage?: string; choices?: string[]; correct_answer: string; explanation: string; published: boolean };
const EMPTY = { subjectId: 'math', categoryId: 'addition', categoryName: 'たし算', level: 1, problemType: 'number_input', prompt: '', passage: '', choicesText: '', correctAnswer: '', explanation: '', published: true };

export default function ProblemManagement() {
  const { user } = useAuth();
  const [problems, setProblems] = useState<Problem[]>([]); const [form, setForm] = useState(EMPTY); const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [filter, setFilter] = useState('all');
  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error('ログインが必要です。'); const token = await user.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }, [user]);
  const load = useCallback(async () => { try { const data = await api('/api/online-school/admin?mode=problems'); setProblems(data.problems || []); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await api('/api/online-school/admin', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, id: editingId || undefined, choices: form.choicesText.split('\n').map(item => item.trim()).filter(Boolean) }) });
      setForm(EMPTY); setEditingId(''); await load();
    } catch (err) { alert(err instanceof Error ? err.message : '保存できませんでした。'); } finally { setSaving(false); }
  };
  const edit = (problem: Problem) => {
    setEditingId(problem.id); setForm({ subjectId: problem.subject_id, categoryId: problem.category_id, categoryName: problem.category_name, level: problem.level, problemType: problem.problem_type, prompt: problem.prompt, passage: problem.passage || '', choicesText: (problem.choices || []).join('\n'), correctAnswer: problem.correct_answer, explanation: problem.explanation, published: problem.published });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const toggle = async (problem: Problem) => { await api('/api/online-school/admin', { method: 'PATCH', body: JSON.stringify({ id: problem.id, subjectId: problem.subject_id, categoryId: problem.category_id, categoryName: problem.category_name, level: problem.level, problemType: problem.problem_type, prompt: problem.prompt, passage: problem.passage || '', choices: problem.choices || [], correctAnswer: problem.correct_answer, explanation: problem.explanation, published: !problem.published }) }); await load(); };
  const remove = async (problem: Problem) => { if (!confirm('この問題を削除しますか？')) return; await api(`/api/online-school/admin?id=${problem.id}`, { method: 'DELETE' }); await load(); };
  const visible = problems.filter(problem => filter === 'all' || problem.subject_id === filter);

  return <main className="mx-auto max-w-7xl p-4 sm:p-8">
    <header className="mb-6 flex items-center gap-4"><Link href="/master/online-school" className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm"><ArrowLeft/></Link><div><p className="text-xs font-black text-indigo-500">ONLINE SCHOOL</p><h1 className="text-2xl font-black">問題管理</h1></div></header>
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <form onSubmit={submit} className="self-start rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 font-black">{editingId ? <Pencil size={18}/> : <Plus size={18}/>} {editingId ? '問題を編集' : '問題を追加'}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} className="h-11 rounded-xl border px-3 font-bold"><option value="math">算数・数学</option><option value="japanese">国語</option></select><input type="number" min="1" value={form.level} onChange={e => setForm({ ...form, level: Number(e.target.value) })} className="h-11 rounded-xl border px-3" placeholder="Level"/></div>
          <div className="grid grid-cols-2 gap-2"><input value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="h-11 rounded-xl border px-3" placeholder="category_id"/><input value={form.categoryName} onChange={e => setForm({ ...form, categoryName: e.target.value })} className="h-11 rounded-xl border px-3" placeholder="カテゴリー名"/></div>
          <select value={form.problemType} onChange={e => setForm({ ...form, problemType: e.target.value })} className="h-11 w-full rounded-xl border px-3"><option value="number_input">数字入力</option><option value="text_input">文字入力</option><option value="multiple_choice">4択</option></select>
          <textarea required value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} className="min-h-20 w-full rounded-xl border p-3" placeholder="問題文"/><textarea value={form.passage} onChange={e => setForm({ ...form, passage: e.target.value })} className="min-h-16 w-full rounded-xl border p-3" placeholder="本文（読解問題のみ）"/>
          {form.problemType === 'multiple_choice' && <textarea value={form.choicesText} onChange={e => setForm({ ...form, choicesText: e.target.value })} className="min-h-24 w-full rounded-xl border p-3" placeholder={'選択肢を1行に1つ\n正答も含めて入力'}/>}
          <input required value={form.correctAnswer} onChange={e => setForm({ ...form, correctAnswer: e.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="正答"/><textarea required value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} className="min-h-20 w-full rounded-xl border p-3" placeholder="解説"/>
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.published} onChange={e => setForm({ ...form, published: e.target.checked })}/>公開する</label>
          <button disabled={saving} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-indigo-600 font-black text-white">{saving ? <Loader2 className="animate-spin"/> : editingId ? '変更を保存' : '追加する'}</button>
          {editingId && <button type="button" onClick={() => { setEditingId(''); setForm(EMPTY); }} className="min-h-11 w-full rounded-xl bg-slate-100 font-black text-slate-600">編集をやめる</button>}
        </div>
      </form>
      <section className="rounded-2xl bg-white shadow-sm"><div className="flex items-center justify-between border-b p-4"><h2 className="font-black">登録済み問題（{visible.length}件）</h2><select value={filter} onChange={e => setFilter(e.target.value)} className="h-10 rounded-xl border px-3 text-sm font-bold"><option value="all">全科目</option><option value="math">算数・数学</option><option value="japanese">国語</option></select></div>
        {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin"/></div> : <div className="divide-y">{visible.map(problem => <div key={problem.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2 text-xs font-black"><span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">{problem.subject_id === 'math' ? '数学' : '国語'}</span><span className="rounded bg-slate-100 px-2 py-1">Level {problem.level}</span><span className="rounded bg-slate-100 px-2 py-1">{problem.category_name}</span></div><p className="font-bold text-slate-900">{problem.prompt}</p><p className="mt-1 text-xs text-slate-500">正答：{problem.correct_answer}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => edit(problem)} className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600" aria-label="編集"><Pencil size={16}/></button><button onClick={() => void toggle(problem)} className={`rounded-lg px-3 py-2 text-xs font-black ${problem.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{problem.published ? '公開中' : '非公開'}</button><button onClick={() => void remove(problem)} className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-600" aria-label="削除"><Trash2 size={16}/></button></div></div></div>)}{!visible.length && <p className="p-10 text-center text-sm text-slate-400">手動登録された問題はありません。標準テンプレートはコードで管理されています。</p>}</div>}
      </section>
    </div>
  </main>;
}
