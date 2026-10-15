'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, BookOpen, CalendarClock, Eye, FileText, Loader2, Megaphone, Paperclip, Send, Trash2, Users, X } from 'lucide-react';
import { auth } from '@/lib/firebase';

const LABELS: Record<string, string> = { important: '重要', event: 'イベント', info: 'お知らせ', alert: '緊急' };
const TARGETS: Record<string, string> = { all: '全員', student: '生徒', parent: '保護者', teacher: '講師', admin: '校舎管理者' };
type Form = { title: string; content: string; target: string; label: string; school_ids: string; grades: string; publish_at: string };
type School = { code: string; name: string; group: string };
const EMPTY: Form = { title: '', content: '', target: 'all', label: 'info', school_ids: '', grades: '', publish_at: '' };
const GRADE_OPTIONS = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '既卒', 'その他'];
const values = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

export default function AnnouncementsPage() {
  const [list, setList] = useState<any[]>([]), [templates, setTemplates] = useState<any[]>([]), [groups, setGroups] = useState<any[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [form, setForm] = useState<Form>(EMPTY), [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false), [fetching, setFetching] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const token = async () => {
    const value = await auth.currentUser?.getIdToken();
    if (!value) throw new Error('認証情報を取得できません');
    return value;
  };
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/announcements?manage=1', { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
      setList(data.announcements || []); setTemplates(data.templates || []); setGroups(data.groups || []); setSchools(data.schools || []);
    } catch (error: any) { alert(error.message || '読み込みに失敗しました'); } finally { setFetching(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveConfig = async (body: any) => {
    const response = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '保存に失敗しました');
    await load();
  };
  const saveTemplate = async () => {
    const name = prompt('テンプレート名を入力してください');
    if (!name) return;
    try { await saveConfig({ action: 'save_template', name, title: form.title, content: form.content, label: form.label }); } catch (error: any) { alert(error.message); }
  };
  const saveGroup = async () => {
    const name = prompt('配信グループ名を入力してください');
    if (!name) return;
    try { await saveConfig({ action: 'save_group', name, target: form.target, school_ids: form.school_ids, grades: form.grades }); } catch (error: any) { alert(error.message); }
  };
  const addFilterValue = (field: 'school_ids' | 'grades', value: string) => {
    if (!value) return;
    setForm(current => ({ ...current, [field]: Array.from(new Set([...values(current[field]), value])).join(',') }));
  };
  const removeFilterValue = (field: 'school_ids' | 'grades', value: string) => {
    setForm(current => ({ ...current, [field]: values(current[field]).filter(item => item !== value).join(',') }));
  };
  const submit = async () => {
    if (!form.title.trim() || !form.content.trim()) return alert('タイトルと本文を入力してください');
    if (!confirm(form.publish_at ? '指定日時で配信予約しますか？' : 'すぐに配信しますか？')) return;
    setLoading(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, value));
      files.forEach(file => payload.append('files', file));
      const response = await fetch('/api/announcements', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: payload });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '配信に失敗しました');
      setForm(EMPTY); setFiles([]); if (fileRef.current) fileRef.current.value = ''; await load();
    } catch (error: any) { alert(error.message || '配信に失敗しました'); } finally { setLoading(false); }
  };
  const archive = async (id: string) => {
    if (!confirm('このお知らせをアーカイブしますか？')) return;
    try {
      const response = await fetch('/api/announcements', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error('アーカイブに失敗しました');
      setList(current => current.map(item => item.id === id ? { ...item, archived: true } : item));
    } catch (error: any) { alert(error.message); }
  };

  return <div className="min-h-screen bg-slate-50 p-5 pb-24 text-slate-800">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-[28px] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3"><Link href="/master" className="rounded-full bg-slate-100 p-2"><ArrowLeft size={20}/></Link><div><h1 className="flex items-center gap-2 text-2xl font-black"><Megaphone className="text-blue-600"/> お知らせ配信</h1><p className="mt-1 text-sm font-bold text-slate-500">運営からの正式な一方向連絡です。返信や参加者同士の投稿はできません。</p></div></div>
          <Link href="/master/community" className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 text-sm font-black text-fuchsia-700">交流掲示板の管理はこちら</Link>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[420px_1fr]">
        <section className="space-y-5 rounded-[28px] bg-white p-5 shadow-sm lg:sticky lg:top-5">
          <div><label className="text-xs font-black text-slate-500">テンプレート</label><select className="mt-1 w-full rounded-xl border p-3 text-sm" defaultValue="" onChange={e => { const item = templates.find(value => value.id === e.target.value); if (item) setForm(current => ({ ...current, title: item.title || '', content: item.content || '', label: item.label || 'info' })); }}><option value="">選択してください</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div><label className="text-xs font-black text-slate-500">配信グループ</label><select className="mt-1 w-full rounded-xl border p-3 text-sm" defaultValue="" onChange={e => { const item = groups.find(value => value.id === e.target.value); if (item) setForm(current => ({ ...current, target: item.target, school_ids: (item.school_ids || []).join(','), grades: (item.grades || []).join(',') })); }}><option value="">選択してください</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs font-black text-slate-500">対象<select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm">{Object.entries(TARGETS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-xs font-black text-slate-500">ラベル<select value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm">{Object.entries(LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="text-xs font-black text-slate-500">対象校舎（未選択は全校舎）<select value="" onChange={e => addFilterValue('school_ids', e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm"><option value="">校舎を追加</option>{Array.from(new Set(schools.map(school => school.group))).map(group => <optgroup key={group} label={group}>{schools.filter(school => school.group === group).map(school => <option key={school.code} value={school.code}>{school.name}（{school.code}）</option>)}</optgroup>)}</select></label><div className="mt-2 flex flex-wrap gap-1">{values(form.school_ids).map(code => <button type="button" key={code} onClick={() => removeFilterValue('school_ids', code)} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">{schools.find(school => school.code === code)?.name || code}<X size={11}/></button>)}</div></div>
            <div><label className="text-xs font-black text-slate-500">対象学年（未選択は全学年）<select value="" onChange={e => addFilterValue('grades', e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm"><option value="">学年を追加</option>{GRADE_OPTIONS.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label><div className="mt-2 flex flex-wrap gap-1">{values(form.grades).map(grade => <button type="button" key={grade} onClick={() => removeFilterValue('grades', grade)} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">{grade}<X size={11}/></button>)}</div></div>
          </div>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border p-3 font-bold" placeholder="タイトル" maxLength={120}/>
          <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="min-h-48 w-full rounded-xl border p-3 text-sm" placeholder="お知らせ本文" maxLength={5000}/>
          <label className="block text-xs font-black text-slate-500"><CalendarClock size={15} className="mr-1 inline"/>予約配信日時（空欄は即時）<input type="datetime-local" value={form.publish_at} onChange={e => setForm({ ...form, publish_at: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm"/></label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-relaxed text-amber-900"><Bell size={14} className="mr-1 inline"/>この画面はアプリ内の「お知らせ」に掲載します。LINE・メール・個別のアプリ内通知も送る場合は<Link href="/master/line" className="ml-1 underline">通知・LINE管理</Link>を使ってください。</div>
          <label className="block rounded-xl border border-dashed p-3 text-xs font-bold text-slate-500"><Paperclip size={15} className="mr-1 inline"/>添付（PDF・画像・Word・Excel／3件、各10MBまで）<input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 3))} className="mt-2 block w-full text-xs"/></label>
          <div className="flex gap-2"><button onClick={saveTemplate} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black"><FileText size={14} className="mr-1 inline"/>テンプレート保存</button><button onClick={saveGroup} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black"><Users size={14} className="mr-1 inline"/>グループ保存</button></div>
          <button onClick={submit} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 font-black text-white disabled:opacity-50">{loading ? <Loader2 className="animate-spin"/> : <Send/>}{form.publish_at ? '配信予約する' : '配信する'}</button>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-800"><BookOpen size={17} className="mr-2 inline"/>お知らせは正式連絡、掲示板は公開交流です。用途を混在させないでください。</div>
          {fetching ? <div className="flex justify-center py-16"><Loader2 className="animate-spin"/></div> : list.map(item => <article key={item.id} className={`rounded-[24px] bg-white p-5 shadow-sm ${item.archived ? 'opacity-50' : ''}`}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black"><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{LABELS[item.label] || 'お知らせ'}</span><span className="rounded-full bg-slate-100 px-2 py-1">{TARGETS[item.target] || '全員'}</span>{item.status === 'scheduled' && new Date(item.publish_at).getTime() > Date.now() ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">予約中</span> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">配信済み</span>}<span className="ml-auto flex items-center gap-1 text-slate-400"><Eye size={13}/>既読 {item.read_count || 0}件</span></div>
            <h2 className="mt-3 text-lg font-black">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{item.content}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-400"><span>配信: {item.publish_at ? new Date(item.publish_at).toLocaleString('ja-JP') : '-'}</span>{item.attachments?.length > 0 && <span><Paperclip size={13} className="mr-1 inline"/>{item.attachments.length}件</span>}{!item.archived && <button onClick={() => archive(item.id)} className="ml-auto text-rose-500"><Trash2 size={15}/></button>}</div>
          </article>)}
        </section>
      </div>
    </div>
  </div>;
}
