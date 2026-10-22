'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';

type Problem = { id: string; subject_id: string; category_id: string; category_name: string; level: number; problem_type: string; prompt: string; passage?: string; choices?: string[]; correct_answer: string; explanation: string; published: boolean };
const EMPTY = { subjectId: 'math', categoryId: 'addition', categoryName: 'たし算', level: 1, problemType: 'number_input', prompt: '', passage: '', choicesText: '', correctAnswer: '', explanation: '', published: true };

export default function ProblemManagement() {
  const { user } = useAuth();
  const [problems, setProblems] = useState<Problem[]>([]); const [form, setForm] = useState(EMPTY); const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [filter, setFilter] = useState('all');
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error('ログインが必要です。'); const token = await user.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }, [user]);
  const load = useCallback(async () => { setLoadError(false); try { const data = await api('/api/online-school/admin?mode=problems'); setProblems(data.problems || []); } catch (err) { console.error(err); setLoadError(true); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await api('/api/online-school/admin', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, id: editingId || undefined, choices: form.choicesText.split('\n').map(item => item.trim()).filter(Boolean) }) });
      setForm(EMPTY); setEditingId(''); await load();
    } catch (err) { console.error(err); toast.error(err instanceof Error ? err.message : '保存できませんでした。'); } finally { setSaving(false); }
  };
  const edit = (problem: Problem) => {
    setEditingId(problem.id); setForm({ subjectId: problem.subject_id, categoryId: problem.category_id, categoryName: problem.category_name, level: problem.level, problemType: problem.problem_type, prompt: problem.prompt, passage: problem.passage || '', choicesText: (problem.choices || []).join('\n'), correctAnswer: problem.correct_answer, explanation: problem.explanation, published: problem.published });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const toggle = async (problem: Problem) => { try { await api('/api/online-school/admin', { method: 'PATCH', body: JSON.stringify({ id: problem.id, subjectId: problem.subject_id, categoryId: problem.category_id, categoryName: problem.category_name, level: problem.level, problemType: problem.problem_type, prompt: problem.prompt, passage: problem.passage || '', choices: problem.choices || [], correctAnswer: problem.correct_answer, explanation: problem.explanation, published: !problem.published }) }); await load(); } catch (err) { console.error(err); toast.error(err instanceof Error ? err.message : '公開状態を変更できませんでした。'); } };
  const remove = async (problem: Problem) => {
    const label = problem.prompt.length > 30 ? `${problem.prompt.slice(0, 30)}…` : problem.prompt;
    if (!(await confirm({ title: `「${label}」を削除しますか？`, message: '削除した問題は元に戻せません。', confirmLabel: '削除する', tone: 'danger' }))) return;
    try { await api(`/api/online-school/admin?id=${problem.id}`, { method: 'DELETE' }); await load(); } catch (err) { console.error(err); toast.error(err instanceof Error ? err.message : '削除できませんでした。'); }
  };
  const field = 'h-11 rounded-input border border-line bg-surface px-3';
  const area = 'w-full rounded-input border border-line bg-surface p-3';
  const visible = problems.filter(problem => filter === 'all' || problem.subject_id === filter);

  return <div>
    <AdminPageHeader icon={BookOpen} title="問題管理" backHref="/master/online-school" />
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <form onSubmit={submit} className="self-start rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-4 flex items-center gap-2 font-bold">{editingId ? <Pencil size={18} aria-hidden /> : <Plus size={18} aria-hidden />} {editingId ? '問題を編集' : '問題を追加'}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} aria-label="科目" className={`${field} font-bold`}><option value="math">算数・数学</option><option value="japanese">国語</option></select><input type="number" min="1" value={form.level} onChange={e => setForm({ ...form, level: Number(e.target.value) })} aria-label="レベル" className={field} placeholder="レベル"/></div>
          <div className="grid grid-cols-2 gap-2"><input value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} aria-label="カテゴリーID" className={field} placeholder="カテゴリーID（例：addition）"/><input value={form.categoryName} onChange={e => setForm({ ...form, categoryName: e.target.value })} aria-label="カテゴリー名" className={field} placeholder="カテゴリー名"/></div>
          <select value={form.problemType} onChange={e => setForm({ ...form, problemType: e.target.value })} aria-label="回答形式" className={`${field} w-full`}><option value="number_input">数字入力</option><option value="text_input">文字入力</option><option value="multiple_choice">4択</option></select>
          <textarea required value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} aria-label="問題文" className={`${area} min-h-20`} placeholder="問題文"/><textarea value={form.passage} onChange={e => setForm({ ...form, passage: e.target.value })} aria-label="本文" className={`${area} min-h-16`} placeholder="本文（読解問題のみ）"/>
          {form.problemType === 'multiple_choice' && <textarea value={form.choicesText} onChange={e => setForm({ ...form, choicesText: e.target.value })} aria-label="選択肢" className={`${area} min-h-24`} placeholder={'選択肢を1行に1つ\n正答も含めて入力'}/>}
          <input required value={form.correctAnswer} onChange={e => setForm({ ...form, correctAnswer: e.target.value })} aria-label="正答" className={`${field} w-full`} placeholder="正答"/><textarea required value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} aria-label="解説" className={`${area} min-h-20`} placeholder="解説"/>
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.published} onChange={e => setForm({ ...form, published: e.target.checked })}/>公開する</label>
          <Button type="submit" fullWidth size="lg" loading={saving}>{editingId ? '変更を保存' : '追加する'}</Button>
          {editingId && <Button variant="secondary" fullWidth onClick={() => { setEditingId(''); setForm(EMPTY); }}>編集をやめる</Button>}
        </div>
      </form>
      <section className="rounded-card border border-line bg-surface shadow-card"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4"><h2 className="font-bold">登録済み問題（{visible.length}件）</h2><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="科目で絞り込み" className="h-10 rounded-input border border-line bg-surface px-3 text-sm font-bold"><option value="all">全科目</option><option value="math">算数・数学</option><option value="japanese">国語</option></select></div>
        {loading ? <div className="p-4"><ListSkeleton rows={4} /></div> : loadError ? <ErrorState className="m-4" onRetry={() => void load()} /> : <div className="divide-y divide-slate-100">{visible.map(problem => <div key={problem.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-btn bg-accent-soft px-2 py-1 text-accent">{problem.subject_id === 'math' ? '数学' : '国語'}</span><span className="rounded-btn bg-slate-100 px-2 py-1">Level {problem.level}</span><span className="rounded-btn bg-slate-100 px-2 py-1">{problem.category_name}</span></div><p className="font-bold text-slate-900">{problem.prompt}</p><p className="mt-1 text-xs text-slate-500">正答：{problem.correct_answer}</p></div><div className="flex shrink-0 gap-2"><IconButton size="sm" variant="secondary" label="この問題を編集" onClick={() => edit(problem)}><Pencil size={16} aria-hidden /></IconButton><button type="button" aria-label={problem.published ? '公開中（押すと非公開にする）' : '非公開（押すと公開する）'} onClick={() => void toggle(problem)} className={`min-h-9 rounded-btn px-3 py-2 text-xs font-bold ${problem.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{problem.published ? '公開中' : '非公開'}</button><IconButton size="sm" label="この問題を削除" onClick={() => void remove(problem)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={16} aria-hidden /></IconButton></div></div></div>)}{!visible.length && <EmptyState className="m-4" icon={BookOpen} title="手動登録された問題はありません" description="標準テンプレートはコードで管理されています。" />}</div>}
      </section>
    </div>
  </div>;
}
