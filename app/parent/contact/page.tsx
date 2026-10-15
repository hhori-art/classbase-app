'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, HelpCircle, Loader2, MessageCircle, Send, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const FAQ_LIST = ['欠席連絡はどこからできますか？', '振替受講はできますか？', '録画はどこで確認できますか？', '宿題提出状況を確認したいです', '通知設定を変更したいです', '受講講座の登録はどこで行いますか？', 'ログインできない場合はどうすればよいですか？'];
const CATEGORIES = [{ value: 'lesson', label: '授業・受講' }, { value: 'absence', label: '欠席・振替' }, { value: 'homework', label: '宿題・学習状況' }, { value: 'account', label: 'アカウント・操作' }, { value: 'other', label: 'その他' }];
type FaqMessage = { role: 'parent' | 'bot'; text: string; faq?: string };
type ThreadMessage = { sender_role: 'parent' | 'staff'; sender_name?: string; text: string };

export default function ParentContactPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'contact' | 'faq'>('contact');
  const [students, setStudents] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [form, setForm] = useState({ student_id: '', category: 'lesson', subject: '', question: '' });
  const [replyById, setReplyById] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState('');
  const [faqInput, setFaqInput] = useState('');
  const [faqMessages, setFaqMessages] = useState<FaqMessage[]>([{ role: 'bot', text: 'よくある質問を選ぶか、知りたい内容を入力してください。解決しない場合は教室への連絡として引き継げます。' }]);

  const headers = useCallback(async () => ({ Authorization: `Bearer ${await user!.getIdToken()}`, 'Content-Type': 'application/json' }), [user]);
  const load = useCallback(async () => {
    if (!user) return;
    setHistoryError('');
    try {
      const res = await fetch('/api/parent/faq?mine=1', { headers: await headers(), cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setStudents(data.students || []); setInquiries(data.inquiries || []);
      setForm(current => ({ ...current, student_id: current.student_id || data.students?.[0]?.id || '' }));
    } catch (error) { console.warn(error); setHistoryError('教室との連絡履歴を読み込めませんでした。'); }
    finally { setLoading(false); }
  }, [headers, user]);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/parent/faq', { method: 'POST', headers: await headers(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || '送信できませんでした');
    return data;
  };
  const createInquiry = async () => {
    if (!form.subject.trim() || !form.question.trim()) return alert('件名と連絡内容を入力してください。');
    setSaving(true);
    try { const data = await post({ action: 'send', ...form }); setForm(current => ({ ...current, subject: '', question: '' })); await load(); setExpandedId(data.inquiry_id || ''); }
    catch (error: any) { alert(`送信できませんでした: ${error.message || error}`); }
    finally { setSaving(false); }
  };
  const reply = async (id: string) => {
    const question = String(replyById[id] || '').trim(); if (!question) return;
    setSaving(true);
    try { await post({ action: 'reply', inquiry_id: id, question }); setReplyById(current => ({ ...current, [id]: '' })); await load(); }
    catch (error: any) { alert(error.message || '送信できませんでした'); }
    finally { setSaving(false); }
  };
  const toggleThread = async (item: any) => {
    const opening = expandedId !== item.id;
    setExpandedId(opening ? item.id : '');
    if (opening && item.unread_for_parent) {
      setInquiries(current => current.map(value => value.id === item.id ? { ...value, unread_for_parent: false } : value));
      try { await post({ action: 'mark_read', inquiry_id: item.id }); } catch { /* 次回取得時に再試行 */ }
    }
  };
  const askFaq = async (question?: string) => {
    const value = String(question ?? faqInput).trim(); if (!value || !user) return;
    setSaving(true);
    try { const data = await post({ action: 'answer', question: value }); setFaqMessages(current => [...current, { role: 'parent', text: value }, { role: 'bot', text: data.answer || '回答がありません。', faq: data.faq }]); setFaqInput(''); if (data.needs_support) await load(); }
    catch (error: any) { setFaqMessages(current => [...current, { role: 'bot', text: `エラー: ${error.message || error}` }]); }
    finally { setSaving(false); }
  };
  const threadMessages = (item: any): ThreadMessage[] => Array.isArray(item.messages) && item.messages.length ? item.messages : [{ sender_role: 'parent', sender_name: item.parent_name || '保護者', text: item.content || '' }, ...(item.response ? [{ sender_role: 'staff' as const, sender_name: item.responded_by_name || '担当者', text: item.response }] : [])];

  return <div className="space-y-5">
    <header className="rounded-[28px] bg-slate-950 p-6 text-white shadow-sm"><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">Parent Communication</p><h1 className="mt-2 text-2xl font-black">教室への連絡・FAQ</h1><p className="mt-2 text-sm font-bold text-slate-300">個別の連絡は教室とのスレッドに残ります。全体向けの正式連絡は「お知らせ」で確認します。</p></header>
    <div className="grid grid-cols-2 rounded-2xl bg-white p-1 shadow-sm"><button onClick={() => setTab('contact')} className={`rounded-xl py-3 text-sm font-black ${tab === 'contact' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><MessageCircle size={17} className="mr-1 inline" />教室へ連絡</button><button onClick={() => setTab('faq')} className={`rounded-xl py-3 text-sm font-black ${tab === 'faq' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><HelpCircle size={17} className="mr-1 inline" />よくある質問</button></div>

    {tab === 'contact' ? <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <section className="h-fit rounded-[28px] bg-white p-5 shadow-sm lg:sticky lg:top-24"><h2 className="font-black text-slate-900">新しい連絡</h2><p className="mt-1 text-xs font-bold leading-5 text-slate-400">欠席は欠席連絡画面を使い、相談や確認はこちらから送ってください。</p><div className="mt-4 space-y-3">
        <label className="block text-xs font-black text-slate-500">対象のお子さま<select value={form.student_id} onChange={event => setForm({ ...form, student_id: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold">{students.map(student => <option key={student.id} value={student.id}>{student.name} {student.grade}</option>)}</select></label>
        <label className="block text-xs font-black text-slate-500">分類<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold">{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="block text-xs font-black text-slate-500">件名<input maxLength={120} value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm font-bold" placeholder="例：次回授業について" /></label>
        <label className="block text-xs font-black text-slate-500">内容<textarea maxLength={2000} value={form.question} onChange={event => setForm({ ...form, question: event.target.value })} className="mt-1 min-h-32 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm font-bold" placeholder="教室に確認したい内容" /></label>
        <button onClick={() => void createInquiry()} disabled={saving || !form.subject.trim() || !form.question.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black text-white disabled:opacity-40">{saving ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}教室へ送信</button>
      </div></section>
      <section className="space-y-3"><div className="flex items-center justify-between px-1"><h2 className="font-black text-slate-900">連絡履歴</h2><span className="text-xs font-black text-slate-400">{inquiries.length}件</span></div>
        {loading ? <div className="grid min-h-40 place-items-center rounded-3xl bg-white"><Loader2 className="animate-spin text-indigo-500" /></div> : historyError ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">{historyError}<button onClick={() => void load()} className="ml-3 rounded-lg bg-rose-600 px-3 py-2 text-white">再読み込み</button></div> : inquiries.length === 0 ? <div className="rounded-3xl bg-white p-10 text-center text-sm font-bold text-slate-400">連絡履歴はありません</div> : inquiries.map(item => { const expanded = expandedId === item.id; return <article key={item.id} className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${item.unread_for_parent ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-100'}`}><button onClick={() => void toggleThread(item)} className="flex w-full items-start justify-between gap-4 p-5 text-left"><div><div className="mb-2 flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.status === 'answered' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.status === 'answered' ? '回答あり' : '教室確認中'}</span>{item.unread_for_parent && <span className="rounded-full bg-indigo-600 px-2 py-1 text-[10px] font-black text-white">新着</span>}</div><h3 className="font-black text-slate-900">{item.subject || 'お問い合わせ'}</h3><p className="mt-1 text-xs font-bold text-slate-400">{[item.student_name, item.school_name].filter(Boolean).join(' / ') || '対象未設定'}</p></div><span className="text-xs font-black text-indigo-600">{expanded ? '閉じる' : '会話を見る'}</span></button>{expanded && <div className="border-t border-slate-100 bg-slate-50 p-4"><div className="max-h-80 space-y-3 overflow-y-auto">{threadMessages(item).map((message, index) => <div key={`${item.id}_${index}`} className={`flex ${message.sender_role === 'parent' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm font-bold leading-6 ${message.sender_role === 'parent' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}><p className="mb-1 text-[10px] font-black opacity-70">{message.sender_role === 'parent' ? '保護者' : message.sender_name || '担当者'}</p><p className="whitespace-pre-wrap">{message.text}</p></div></div>)}</div><div className="mt-4 flex gap-2"><textarea value={replyById[item.id] || ''} onChange={event => setReplyById(current => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} className="min-h-14 flex-1 resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold" placeholder="追加の質問・返信" /><button onClick={() => void reply(item.id)} disabled={saving || !String(replyById[item.id] || '').trim()} className="rounded-2xl bg-slate-900 px-4 text-white disabled:opacity-40"><Send size={18} /></button></div></div>}</article>; })}
      </section>
    </div> : <div className="grid gap-5 lg:grid-cols-[1fr_340px]"><section className="overflow-hidden rounded-[28px] bg-white shadow-sm"><div className="bg-indigo-600 p-5 text-white"><h2 className="flex items-center gap-2 text-xl font-black"><Bot />FAQチャット</h2><p className="mt-1 text-xs font-bold text-indigo-100">一般的な操作方法をすぐに確認できます。</p></div><div className="max-h-[52vh] space-y-3 overflow-y-auto p-5">{faqMessages.map((message, index) => <div key={index} className={`flex ${message.role === 'parent' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm font-bold leading-6 ${message.role === 'parent' ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-700'}`}>{message.faq && <p className="mb-1 text-[10px] text-indigo-500">参照：{message.faq}</p>}<p>{message.text}</p></div></div>)}</div><div className="flex gap-2 border-t bg-slate-50 p-4"><input value={faqInput} onChange={event => setFaqInput(event.target.value)} className="min-w-0 flex-1 rounded-2xl border bg-white px-4 text-sm font-bold" placeholder="知りたい内容" /><button onClick={() => void askFaq()} disabled={saving || !faqInput.trim()} className="rounded-2xl bg-indigo-600 p-3 text-white disabled:opacity-40"><Send /></button></div></section><aside className="rounded-[28px] bg-white p-5 shadow-sm"><h3 className="font-black text-slate-900">よくある質問</h3><div className="mt-4 space-y-2">{FAQ_LIST.map(question => <button key={question} onClick={() => void askFaq(question)} className="w-full rounded-xl bg-slate-50 p-3 text-left text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">{question}</button>)}</div><button onClick={() => setTab('contact')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 py-3 text-xs font-black text-indigo-700"><UserRound size={16} />解決しない場合は教室へ連絡</button></aside></div>}
    <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold leading-6 text-emerald-800"><CheckCircle2 className="shrink-0" size={18} />教室との個別連絡はこの画面、お知らせは運営からの正式な一斉配信、掲示板は参加者同士の公開交流です。</div>
  </div>;
}
