'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BookOpen, CalendarClock, Eye, FileText, Megaphone, Paperclip, Send, Smartphone, Trash2, Users, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, ButtonLink, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, usePrompt, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';

const LABELS: Record<string, string> = { important: '重要', event: 'イベント', info: 'お知らせ', alert: '緊急' };
const TARGETS: Record<string, string> = { all: '全員', student: '生徒', parent: '保護者', teacher: '講師', admin: '校舎管理者' };
// push: '' は未操作（重要・緊急なら端末にも通知）、'1' / '0' は管理者が選んだ値。
type Form = { title: string; content: string; target: string; label: string; school_ids: string; grades: string; publish_at: string; push: '' | '1' | '0' };
type School = { code: string; name: string; group: string };
const EMPTY: Form = { title: '', content: '', target: 'all', label: 'info', school_ids: '', grades: '', publish_at: '', push: '' };
const PUSH_DEFAULT_LABELS = new Set(['important', 'alert']);
const pushChecked = (form: Form) => form.push === '' ? PUSH_DEFAULT_LABELS.has(form.label) : form.push === '1';
const isPublished = (item: any) => !item.archived && !(item.publish_at && new Date(item.publish_at).getTime() > Date.now());
const pushResultMessage = (push: any) => {
  if (push?.status === 'sent') return `端末への通知を${push.recipients}人に送ります${push.truncated ? '（上限に達したため一部のみ）' : ''}`;
  if (push?.status === 'disabled') return '端末への通知は準備中のため送っていません';
  if (push?.status === 'already-notified') return 'このお知らせは端末に通知済みです';
  if (push?.status === 'failed') return '端末への通知を送れませんでした。一覧の「端末に通知」から送り直せます';
  if (push?.status === 'scheduled') return '予約配信の時刻を過ぎたら、一覧の「端末に通知」を押してください';
  return '';
};
const GRADE_OPTIONS = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '既卒', 'その他'];
const values = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

export default function AnnouncementsPage() {
  const [list, setList] = useState<any[]>([]), [templates, setTemplates] = useState<any[]>([]), [groups, setGroups] = useState<any[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [form, setForm] = useState<Form>(EMPTY), [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false), [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const ask = usePrompt();

  const token = async () => {
    const value = await auth.currentUser?.getIdToken();
    if (!value) throw new Error('認証情報を取得できません');
    return value;
  };
  const load = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/announcements?manage=1', { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
      setList(data.announcements || []); setTemplates(data.templates || []); setGroups(data.groups || []); setSchools(data.schools || []);
    } catch (error: any) { console.error(error); setLoadError(error.message || '読み込みに失敗しました'); } finally { setFetching(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveConfig = async (body: any) => {
    const response = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '保存に失敗しました');
    await load();
  };
  const saveTemplate = async () => {
    const name = await ask({ title: 'テンプレートを保存', label: 'テンプレート名', required: true });
    if (!name) return;
    try { await saveConfig({ action: 'save_template', name, title: form.title, content: form.content, label: form.label }); toast.success('テンプレートを保存しました'); } catch (error: any) { toast.error(error.message || '保存できませんでした'); }
  };
  const saveGroup = async () => {
    const name = await ask({ title: '配信グループを保存', label: '配信グループ名', required: true });
    if (!name) return;
    try { await saveConfig({ action: 'save_group', name, target: form.target, school_ids: form.school_ids, grades: form.grades }); toast.success('配信グループを保存しました'); } catch (error: any) { toast.error(error.message || '保存できませんでした'); }
  };
  const addFilterValue = (field: 'school_ids' | 'grades', value: string) => {
    if (!value) return;
    setForm(current => ({ ...current, [field]: Array.from(new Set([...values(current[field]), value])).join(',') }));
  };
  const removeFilterValue = (field: 'school_ids' | 'grades', value: string) => {
    setForm(current => ({ ...current, [field]: values(current[field]).filter(item => item !== value).join(',') }));
  };
  const submit = async () => {
    if (!form.title.trim() || !form.content.trim()) return toast.error('タイトルと本文を入力してください');
    if (!(await confirm({ title: form.publish_at ? '指定日時で配信予約しますか？' : 'すぐに配信しますか？', message: `「${form.title.trim()}」を${TARGETS[form.target] || '全員'}に${form.publish_at ? '予約配信' : '配信'}します。`, confirmLabel: form.publish_at ? '予約する' : '配信する' }))) return;
    setLoading(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, value));
      files.forEach(file => payload.append('files', file));
      const response = await fetch('/api/announcements', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: payload });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '配信に失敗しました');
      setForm(EMPTY); setFiles([]); if (fileRef.current) fileRef.current.value = ''; await load();
      toast.success(form.publish_at ? '配信を予約しました' : '配信しました');
      const pushMessage = pushResultMessage(data.push);
      if (pushMessage) (data.push?.status === 'failed' ? toast.error : toast.info)(pushMessage);
    } catch (error: any) { toast.error(error.message || '配信に失敗しました'); } finally { setLoading(false); }
  };
  const notifyPush = async (item: any) => {
    if (!(await confirm({ title: `「${item.title || 'このお知らせ'}」を端末に通知しますか？`, message: '対象者のうち「この端末に通知を送る」をオンにしている人の端末に知らせます。1件のお知らせにつき1回だけ送れます。', confirmLabel: '通知する' }))) return;
    try {
      const response = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ action: 'notify_push', id: item.id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '端末への通知に失敗しました');
      toast.info(pushResultMessage(data.push) || '端末に通知しました');
      await load();
    } catch (error: any) { toast.error(error.message || '端末への通知に失敗しました'); }
  };
  const archive = async (id: string) => {
    const target = list.find(item => item.id === id);
    if (!(await confirm({ title: `「${target?.title || 'このお知らせ'}」を取り下げますか？`, message: '取り下げると、配信先の画面に表示されなくなります。', confirmLabel: '取り下げる', tone: 'danger' }))) return;
    try {
      const response = await fetch('/api/announcements', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error('取り下げに失敗しました');
      setList(current => current.map(item => item.id === id ? { ...item, archived: true } : item));
    } catch (error: any) { toast.error(error.message || '取り下げに失敗しました'); }
  };

  return <div className="text-slate-800">
    <AdminPageHeader
      description="運営からの正式な一方向連絡です。返信や参加者同士の投稿はできません。"
      actions={<ButtonLink href="/master/community" variant="secondary">交流掲示板の管理はこちら</ButtonLink>}
    />
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-[420px_1fr]">
        <section className="space-y-5 rounded-card bg-white p-5 shadow-sm lg:sticky lg:top-5">
          <div><label className="text-xs font-bold text-slate-500">テンプレート</label><select className="mt-1 w-full rounded-input border border-line p-3 text-sm" defaultValue="" onChange={e => { const item = templates.find(value => value.id === e.target.value); if (item) setForm(current => ({ ...current, title: item.title || '', content: item.content || '', label: item.label || 'info' })); }}><option value="">選択してください</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div><label className="text-xs font-bold text-slate-500">配信グループ</label><select className="mt-1 w-full rounded-input border border-line p-3 text-sm" defaultValue="" onChange={e => { const item = groups.find(value => value.id === e.target.value); if (item) setForm(current => ({ ...current, target: item.target, school_ids: (item.school_ids || []).join(','), grades: (item.grades || []).join(',') })); }}><option value="">選択してください</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">対象<select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="mt-1 w-full rounded-input border border-line p-3 text-sm">{Object.entries(TARGETS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-xs font-bold text-slate-500">ラベル<select value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="mt-1 w-full rounded-input border border-line p-3 text-sm">{Object.entries(LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="text-xs font-bold text-slate-500">対象校舎（未選択は全校舎）<select value="" onChange={e => addFilterValue('school_ids', e.target.value)} className="mt-1 w-full rounded-input border border-line p-3 text-sm"><option value="">校舎を追加</option>{Array.from(new Set(schools.map(school => school.group))).map(group => <optgroup key={group} label={group}>{schools.filter(school => school.group === group).map(school => <option key={school.code} value={school.code}>{school.name}（{school.code}）</option>)}</optgroup>)}</select></label><div className="mt-2 flex flex-wrap gap-1">{values(form.school_ids).map(code => <button type="button" key={code} onClick={() => removeFilterValue('school_ids', code)} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">{schools.find(school => school.code === code)?.name || code}<X size={12} aria-hidden/></button>)}</div></div>
            <div><label className="text-xs font-bold text-slate-500">対象学年（未選択は全学年）<select value="" onChange={e => addFilterValue('grades', e.target.value)} className="mt-1 w-full rounded-input border border-line p-3 text-sm"><option value="">学年を追加</option>{GRADE_OPTIONS.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label><div className="mt-2 flex flex-wrap gap-1">{values(form.grades).map(grade => <button type="button" key={grade} onClick={() => removeFilterValue('grades', grade)} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-xs font-bold text-accent">{grade}<X size={12} aria-hidden/></button>)}</div></div>
          </div>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full rounded-input border border-line p-3 font-bold" placeholder="タイトル" maxLength={120}/>
          <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="min-h-48 w-full rounded-input border border-line p-3 text-sm" placeholder="お知らせ本文" maxLength={5000}/>
          <label className="block text-xs font-bold text-slate-500"><CalendarClock size={15} className="mr-1 inline"/>予約配信日時（空欄は即時）<input type="datetime-local" value={form.publish_at} onChange={e => setForm({ ...form, publish_at: e.target.value })} className="mt-1 w-full rounded-input border border-line p-3 text-sm"/></label>
          <label className="flex items-start gap-2 rounded-btn border border-line p-3 text-sm font-bold text-slate-700"><input type="checkbox" className="mt-1" checked={pushChecked(form)} onChange={e => setForm({ ...form, push: e.target.checked ? '1' : '0' })}/><span><Smartphone size={15} className="mr-1 inline" aria-hidden/>端末にも通知する<span className="mt-1 block text-xs font-normal text-slate-500">「この端末に通知を送る」をオンにしている対象者に、タイトルだけを知らせます（重要・緊急は最初からオン）。予約配信は、配信時刻を過ぎてから一覧の「端末に通知」で送ります。</span></span></label>
          <div className="rounded-btn border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-relaxed text-amber-900"><Bell size={14} className="mr-1 inline"/>この画面はアプリ内の「お知らせ」に掲載します。LINE・メール・個別のアプリ内通知も送る場合は<Link href="/master/line" className="ml-1 underline">通知を送る</Link>を使ってください。</div>
          <label className="block rounded-btn border border-dashed border-line p-3 text-xs font-bold text-slate-500"><Paperclip size={15} className="mr-1 inline"/>添付（PDF・画像・Word・Excel／3件、各10MBまで）<input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 3))} className="mt-2 block w-full text-xs"/></label>
          <div className="flex gap-2"><Button variant="secondary" size="sm" className="flex-1" onClick={saveTemplate} icon={<FileText size={14} aria-hidden/>}>テンプレート保存</Button><Button variant="secondary" size="sm" className="flex-1" onClick={saveGroup} icon={<Users size={14} aria-hidden/>}>グループ保存</Button></div>
          <Button size="lg" fullWidth onClick={submit} loading={loading} icon={<Send size={18} aria-hidden/>}>{form.publish_at ? '配信予約する' : '配信する'}</Button>
        </section>

        <section className="space-y-4">
          <div className="rounded-card border border-sky-100 bg-sky-50 p-4 text-sm font-bold text-sky-800"><BookOpen size={17} className="mr-2 inline"/>お知らせは正式連絡、掲示板は公開交流です。用途を混在させないでください。</div>
          {fetching ? <ListSkeleton rows={4}/> : loadError ? <ErrorState message={loadError} onRetry={() => { setFetching(true); void load(); }}/> : list.length === 0 ? <EmptyState icon={Megaphone} title="配信したお知らせはまだありません" description="左のフォームから最初のお知らせを配信できます。"/> : list.map(item => <article key={item.id} className={`rounded-card bg-white p-5 shadow-sm ${item.archived ? 'opacity-50' : ''}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold"><span className="rounded-full bg-accent-soft px-2 py-1 text-accent">{LABELS[item.label] || 'お知らせ'}</span><span className="rounded-full bg-slate-100 px-2 py-1">{TARGETS[item.target] || '全員'}</span>{item.archived ? <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-600">取り下げ済み</span> : item.status === 'scheduled' && new Date(item.publish_at).getTime() > Date.now() ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">予約中</span> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">配信済み</span>}<span className="ml-auto flex items-center gap-1 text-slate-400"><Eye size={13}/>既読 {item.read_count || 0}件</span></div>
            <h2 className="mt-3 text-lg font-bold">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{item.content}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-400"><span>配信: {item.publish_at ? formatDateTime(item.publish_at, { withYear: true }) : '-'}</span>{item.attachments?.length > 0 && <span><Paperclip size={13} className="mr-1 inline"/>{item.attachments.length}件</span>}{item.push_notified_at ? <span><Smartphone size={13} className="mr-1 inline" aria-hidden/>端末に通知済み{typeof item.push_recipient_count === 'number' ? `（${item.push_recipient_count}人）` : ''}</span> : isPublished(item) && item.target !== 'admin' && <Button variant="secondary" size="sm" onClick={() => notifyPush(item)} icon={<Smartphone size={14} aria-hidden/>}>端末に通知</Button>}{!item.archived && <IconButton label="このお知らせを取り下げる" onClick={() => archive(item.id)} className="ml-auto text-rose-500"><Trash2 size={16} aria-hidden/></IconButton>}</div>
          </article>)}
        </section>
      </div>
    </div>
  </div>;
}
