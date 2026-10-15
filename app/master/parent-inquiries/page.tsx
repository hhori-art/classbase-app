'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { Loader2, MessageSquareReply, RefreshCw, Send } from 'lucide-react';

const dateLabel = (value: any) => {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : new Date((value._seconds || value.seconds || 0) * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ja-JP');
};
const messages = (item: any) => Array.isArray(item.messages) && item.messages.length ? item.messages : [
  { sender_role: 'parent', sender_name: item.parent_name || '保護者', text: item.content || '' },
  ...(item.response ? [{ sender_role: 'staff', sender_name: item.responded_by_name || '担当者', text: item.response }] : []),
];

export default function ParentInquiriesPage() {
  const [items, setItems] = useState<any[]>([]), [status, setStatus] = useState('open'), [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({}), [savingId, setSavingId] = useState(''), [expandedId, setExpandedId] = useState('');
  const token = async () => await auth.currentUser?.getIdToken() || '';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/parent-inquiries?status=${status}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
      setItems(data.inquiries || []);
    } catch (error: any) { alert(error.message || '読み込みに失敗しました'); } finally { setLoading(false); }
  }, [status]);
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
    const response = String(responses[item.id] || '').trim(); if (!response) return alert('返信内容を入力してください。');
    setSavingId(item.id);
    try { await patch({ action: 'reply', id: item.id, response, status: 'answered' }); setResponses(current => ({ ...current, [item.id]: '' })); await load(); }
    catch (error: any) { alert(error.message || '返信に失敗しました'); } finally { setSavingId(''); }
  };

  return <div className="min-h-screen bg-slate-50 p-5 pb-24 text-slate-800"><div className="mx-auto max-w-6xl space-y-5">
    <header className="rounded-[28px] bg-white p-6 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-500">Private Communication</p><h1 className="mt-2 text-2xl font-black">保護者との個別連絡</h1><p className="mt-1 text-sm font-bold text-slate-500">保護者と教室だけが確認する個別スレッドです。正式な一斉配信は<Link href="/master/announcements" className="mx-1 text-blue-600 underline">お知らせ</Link>、公開交流は<Link href="/master/community" className="mx-1 text-fuchsia-600 underline">掲示板</Link>を使用します。</p></div><div className="flex gap-2"><select value={status} onChange={e => setStatus(e.target.value)} className="rounded-xl border bg-slate-50 px-4 py-3 text-sm font-black"><option value="open">要対応</option><option value="answered">回答済み</option><option value="all">すべて</option></select><button onClick={() => void load()} className="rounded-xl bg-slate-900 px-4 text-white"><RefreshCw size={18}/></button></div></div></header>
    {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin"/></div> : items.length === 0 ? <div className="rounded-3xl bg-white p-12 text-center text-sm font-black text-slate-400">該当する連絡はありません</div> : <div className="space-y-3">{items.map(item => {
      const expanded = expandedId === item.id;
      return <article key={item.id} className={`overflow-hidden rounded-[24px] border bg-white shadow-sm ${item.unread_for_admin ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-100'}`}>
        <button onClick={() => void open(item)} className="flex w-full items-start justify-between gap-3 p-5 text-left"><div><div className="mb-2 flex flex-wrap gap-2 text-[10px] font-black"><span className={`rounded-full px-2 py-1 ${item.status === 'answered' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.status === 'answered' ? '回答済み' : '要対応'}</span>{item.unread_for_admin && <span className="rounded-full bg-indigo-600 px-2 py-1 text-white">新着</span>}<span className="rounded-full bg-slate-100 px-2 py-1">{item.category || 'その他'}</span></div><h2 className="font-black">{item.subject || 'お問い合わせ'}</h2><p className="mt-1 text-xs font-bold text-slate-500">{item.parent_name || '保護者'} / {item.student_name || '生徒未指定'} / {item.school_name || item.school_id || '校舎未設定'}</p><p className="mt-1 text-[11px] font-bold text-slate-400">{dateLabel(item.created_at)}</p></div><span className="text-xs font-black text-indigo-600">{expanded ? '閉じる' : '会話を見る'}</span></button>
        {expanded && <div className="border-t bg-slate-50 p-5"><div className="max-h-96 space-y-3 overflow-y-auto">{messages(item).map((message: any, index: number) => <div key={index} className={`flex ${message.sender_role === 'staff' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm font-bold ${message.sender_role === 'staff' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}><p className="mb-1 text-[10px] opacity-70">{message.sender_name || (message.sender_role === 'staff' ? '担当者' : '保護者')} {dateLabel(message.created_at_iso)}</p><p className="whitespace-pre-wrap leading-6">{message.text}</p></div></div>)}</div><label className="mt-4 block text-xs font-black text-slate-500"><MessageSquareReply size={14} className="mr-1 inline"/>返信<textarea value={responses[item.id] || ''} onChange={e => setResponses(current => ({ ...current, [item.id]: e.target.value }))} className="mt-2 min-h-24 w-full rounded-2xl border bg-white p-4 text-sm" placeholder="保護者への返信"/></label><button onClick={() => void reply(item)} disabled={savingId === item.id} className="mt-3 flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{savingId === item.id ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}返信する</button></div>}
      </article>;
    })}</div>}
  </div></div>;
}
