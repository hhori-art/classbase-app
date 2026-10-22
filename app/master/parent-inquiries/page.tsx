'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { FileText, MessageCircle, MessageSquareReply, Pencil, Plus, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { applyReplyTemplate, REPLY_TEMPLATE_BODY_MAX, REPLY_TEMPLATE_MAX_COUNT, REPLY_TEMPLATE_TITLE_MAX, type ReplyTemplate } from '@/lib/reply-templates';

const dateLabel = (value: any) => {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : new Date((value._seconds || value.seconds || 0) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : formatDateTime(date, { withYear: true });
};
const messages = (item: any) => Array.isArray(item.messages) && item.messages.length ? item.messages : [
  { sender_role: 'parent', sender_name: item.parent_name || '保護者', text: item.content || '' },
  ...(item.response ? [{ sender_role: 'staff', sender_name: item.responded_by_name || '担当者', text: item.response }] : []),
];

export default function ParentInquiriesPage() {
  const [items, setItems] = useState<any[]>([]), [status, setStatus] = useState('open'), [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({}), [savingId, setSavingId] = useState(''), [expandedId, setExpandedId] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null), [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [keyword, setKeyword] = useState('');
  // 返信のひな形はマスターだけが使える。API が 403 を返したら機能ごと隠す。
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]), [templatesAvailable, setTemplatesAvailable] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false), [templateDraft, setTemplateDraft] = useState<{ id: string; title: string; body: string } | null>(null), [templateSaving, setTemplateSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const token = async () => await auth.currentUser?.getIdToken() || '';
  const templateRequest = async (method: string, body?: unknown, query = '') => {
    const response = await fetch(`/api/admin/reply-templates${query}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };
  const loadTemplates = useCallback(async () => {
    try {
      const { response, data } = await templateRequest('GET');
      if (response.status === 403) { setTemplatesAvailable(false); return; }
      if (!response.ok || data.ok === false) throw new Error(data.error || 'ひな形を読み込めませんでした');
      setTemplates(data.templates || []); setTemplatesAvailable(true);
    } catch (error: any) { console.error(error); toast.error(error.message || 'ひな形を読み込めませんでした'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);
  const saveTemplate = async () => {
    if (!templateDraft) return;
    if (!templateDraft.title.trim() || !templateDraft.body.trim()) return toast.error('名前と本文を入力してください。');
    setTemplateSaving(true);
    try {
      const { response, data } = await templateRequest(templateDraft.id ? 'PATCH' : 'POST', templateDraft);
      if (!response.ok || data.ok === false) throw new Error(data.error || '保存に失敗しました');
      toast.success('ひな形を保存しました'); setTemplateDraft(null); await loadTemplates();
    } catch (error: any) { toast.error(error.message || '保存に失敗しました'); } finally { setTemplateSaving(false); }
  };
  const deleteTemplate = async (template: ReplyTemplate) => {
    if (!await confirm({ title: 'ひな形を削除しますか？', message: `「${template.title}」を削除します。元に戻せません。`, confirmLabel: '削除する', tone: 'danger' })) return;
    try {
      const { response, data } = await templateRequest('DELETE', undefined, `?id=${encodeURIComponent(template.id)}`);
      if (!response.ok || data.ok === false) throw new Error(data.error || '削除に失敗しました');
      toast.success('ひな形を削除しました'); if (templateDraft?.id === template.id) setTemplateDraft(null); await loadTemplates();
    } catch (error: any) { toast.error(error.message || '削除に失敗しました'); }
  };
  const insertTemplate = (item: any, templateId: string) => {
    const template = templates.find(value => value.id === templateId); if (!template) return;
    const text = applyReplyTemplate(template.body, { parentName: item.parent_name, studentName: item.student_name });
    setResponses(current => { const existing = String(current[item.id] || '').trimEnd(); return { ...current, [item.id]: existing ? `${existing}\n\n${text}` : text }; });
  };
  const visibleItems = useMemo(() => {
    const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter(item => {
      const haystack = [item.parent_name, item.student_name, item.subject].map(value => String(value || '').toLowerCase()).join(' ');
      return words.every(word => haystack.includes(word));
    });
  }, [items, keyword]);
  const fetchPage = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
    const response = await fetch(`/api/admin/parent-inquiries?${query}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
    return { inquiries: (data.inquiries || []) as any[], nextCursor: (data.next_cursor || null) as string | null };
  }, [status]);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const page = await fetchPage();
      setItems(page.inquiries); setNextCursor(page.nextCursor);
    } catch (error: any) { console.error(error); setLoadError(error.message || '読み込みに失敗しました'); } finally { setLoading(false); }
  }, [fetchPage]);
  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      setItems(current => [...current, ...page.inquiries.filter(item => !current.some(existing => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (error: any) { console.error(error); toast.error(error.message || '続きを読み込めませんでした'); } finally { setLoadingMore(false); }
  };
  useEffect(() => { void load(); }, [load]);
  const patch = async (body: any) => {
    const response = await fetch('/api/admin/parent-inquiries', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '処理に失敗しました');
  };
  const open = async (item: any) => {
    const opening = expandedId !== item.id; setExpandedId(opening ? item.id : '');
    if (opening && item.unread_for_admin) {
      setItems(current => current.map(value => value.id === item.id ? { ...value, unread_for_admin: false } : value));
      try { await patch({ action: 'mark_read', id: item.id }); } catch { /* 返信時にも既読になる */ }
    }
  };
  const reply = async (item: any) => {
    const response = String(responses[item.id] || '').trim(); if (!response) return toast.error('返信内容を入力してください。');
    setSavingId(item.id);
    try { await patch({ action: 'reply', id: item.id, response, status: 'answered' }); setResponses(current => ({ ...current, [item.id]: '' })); toast.success('返信しました'); await load(); }
    catch (error: any) { toast.error(error.message || '返信に失敗しました'); } finally { setSavingId(''); }
  };

  return <div className="text-slate-800">
    <AdminPageHeader
      description={<>保護者から教室への連絡と、その返信です。保護者と教室だけが確認できます。正式な一斉配信は<Link href="/master/announcements" className="mx-1 text-accent underline">お知らせ</Link>、公開交流は<Link href="/master/community" className="mx-1 text-accent underline">掲示板</Link>を使用します。</>}
      actions={<><select aria-label="表示する連絡" value={status} onChange={e => setStatus(e.target.value)} className="min-h-10 rounded-input border border-line bg-white px-3 text-sm font-bold"><option value="open">要対応</option><option value="answered">回答済み</option><option value="all">すべて</option></select>{templatesAvailable && <Button variant="secondary" icon={<FileText size={16} aria-hidden />} onClick={() => setTemplateManagerOpen(true)}>返信のひな形</Button>}<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void load()} loading={loading}>再読み込み</Button></>}
    />
    <div className="space-y-5">
    <label className="relative block max-w-md"><span className="sr-only">保護者名・生徒名・件名で探す</span><Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="search" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="保護者名・生徒名・件名で探す" className="min-h-11 w-full rounded-input border border-line bg-white pl-9 pr-3 text-sm"/></label>
    {keyword.trim() && !loading && !loadError && <p className="text-xs font-bold text-slate-500">読み込み済みの{items.length}件のうち{visibleItems.length}件{nextCursor ? '（さらに読み込むと検索対象が増えます）' : ''}</p>}
    {loading ? <ListSkeleton rows={4}/> : loadError ? <ErrorState message={loadError} onRetry={() => void load()}/> : visibleItems.length === 0 ? <EmptyState icon={MessageCircle} title="該当する連絡はありません" description={keyword.trim() ? '検索の言葉を変えてお試しください。' : status === 'open' ? '要対応の連絡はすべて返信済みです。' : undefined}/> : <div className="space-y-3">{visibleItems.map(item => {
      const expanded = expandedId === item.id;
      return <article key={item.id} className={`overflow-hidden rounded-card border bg-white shadow-sm ${item.unread_for_admin ? 'border-accent ring-2 ring-accent/20' : 'border-slate-100'}`}>
        <button onClick={() => void open(item)} className="flex w-full items-start justify-between gap-3 p-5 text-left"><div><div className="mb-2 flex flex-wrap gap-2"><StatusPill tone={item.status === 'answered' ? 'success' : 'warning'}>{item.status === 'answered' ? '回答済み' : '要対応'}</StatusPill>{item.unread_for_admin && <StatusPill tone="accent">新着</StatusPill>}<StatusPill>{item.category || 'その他'}</StatusPill></div><h2 className="font-bold">{item.subject || '教室への連絡'}</h2><p className="mt-1 text-xs font-bold text-slate-500">{item.parent_name || '保護者'} / {item.student_name || '生徒未指定'} / {item.school_name || item.school_id || '校舎未設定'}</p><p className="mt-1 text-xs font-bold text-slate-400">受付 {dateLabel(item.created_at)}{item.updated_at ? ` / 最終更新 ${dateLabel(item.updated_at)}` : ''}</p></div><span className="shrink-0 text-xs font-bold text-accent">{expanded ? '閉じる' : '会話を見る'}</span></button>
        {expanded && <div className="border-t bg-slate-50 p-5"><div className="max-h-96 space-y-3 overflow-y-auto">{messages(item).map((message: any, index: number) => <div key={index} className={`flex ${message.sender_role === 'staff' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-card px-4 py-3 text-sm font-medium ${message.sender_role === 'staff' ? 'bg-accent text-accent-ink' : 'bg-white text-slate-700 shadow-sm'}`}><p className="mb-1 text-xs font-bold opacity-70">{message.sender_name || (message.sender_role === 'staff' ? '担当者' : '保護者')} {dateLabel(message.created_at_iso)}</p><p className="whitespace-pre-wrap leading-6">{message.text}</p></div></div>)}</div>{templatesAvailable && templates.length > 0 && <label className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500"><FileText size={14} aria-hidden/>ひな形から入れる<select value="" onChange={e => { insertTemplate(item, e.target.value); e.target.value = ''; }} className="min-h-10 rounded-input border border-line bg-white px-3 text-sm font-bold text-slate-700"><option value="">選んでください</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select></label>}<label className="mt-4 block text-xs font-bold text-slate-500"><MessageSquareReply size={14} className="mr-1 inline"/>返信<textarea value={responses[item.id] || ''} onChange={e => setResponses(current => ({ ...current, [item.id]: e.target.value }))} className="mt-2 min-h-24 w-full rounded-input border border-line bg-white p-3 text-sm" placeholder="保護者への返信"/></label><Button className="mt-3" onClick={() => void reply(item)} loading={savingId === item.id} disabled={!String(responses[item.id] || '').trim()} icon={<Send size={16} aria-hidden/>}>返信する</Button></div>}
      </article>;
    })}{nextCursor && <Button variant="secondary" fullWidth onClick={() => void loadMore()} loading={loadingMore}>さらに読み込む</Button>}</div>}
  </div>
    <Modal open={templateManagerOpen} onClose={() => { setTemplateManagerOpen(false); setTemplateDraft(null); }} title="返信のひな形" size="lg"
      description={<>返信欄の「ひな形から入れる」で使えます。本文の {'{保護者名}'} {'{生徒名}'} は、入れるときにその連絡の名前に置き換わります（{REPLY_TEMPLATE_MAX_COUNT}件まで）。</>}>
      {templateDraft ? <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-500">名前<input data-autofocus value={templateDraft.title} maxLength={REPLY_TEMPLATE_TITLE_MAX} onChange={e => setTemplateDraft({ ...templateDraft, title: e.target.value })} className="mt-1 min-h-11 w-full rounded-input border border-line bg-white px-3 text-sm" placeholder="例：欠席連絡へのお礼"/></label>
        <label className="block text-xs font-bold text-slate-500">本文<textarea value={templateDraft.body} maxLength={REPLY_TEMPLATE_BODY_MAX} onChange={e => setTemplateDraft({ ...templateDraft, body: e.target.value })} className="mt-1 min-h-40 w-full rounded-input border border-line bg-white p-3 text-sm" placeholder={'{保護者名}様\nご連絡ありがとうございます。{生徒名}さんの…'}/></label>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => setTemplateDraft(null)}>やめる</Button><Button onClick={() => void saveTemplate()} loading={templateSaving}>保存する</Button></div>
      </div> : <div className="space-y-3">
        {templates.length === 0 ? <EmptyState icon={FileText} title="ひな形はまだありません" description="よく使う返信を登録しておくと、すぐに入れられます。"/> : <ul className="divide-y divide-slate-100 rounded-card border border-line">{templates.map(template => <li key={template.id} className="flex items-start gap-2 p-3"><div className="min-w-0 flex-1"><p className="font-bold">{template.title}</p><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{template.body}</p></div><IconButton label={`「${template.title}」を編集`} size="sm" onClick={() => setTemplateDraft({ id: template.id, title: template.title, body: template.body })}><Pencil size={16} aria-hidden/></IconButton><IconButton label={`「${template.title}」を削除`} size="sm" onClick={() => void deleteTemplate(template)}><Trash2 size={16} aria-hidden className="text-rose-600"/></IconButton></li>)}</ul>}
        <Button variant="secondary" icon={<Plus size={16} aria-hidden/>} disabled={templates.length >= REPLY_TEMPLATE_MAX_COUNT} onClick={() => setTemplateDraft({ id: '', title: '', body: '' })}>ひな形を追加</Button>
      </div>}
    </Modal>
  </div>;
}
