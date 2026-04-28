'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { HelpCircle, Loader2, MessageSquareReply, RefreshCw, Send } from 'lucide-react';

const toDateTime = (value: any) => {
  const date = value?._seconds ? new Date(value._seconds * 1000) : value?.seconds ? new Date(value.seconds * 1000) : value?.toDate ? value.toDate() : null;
  return date ? date.toLocaleString('ja-JP') : '-';
};

export default function ParentInquiriesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/parent-inquiries?status=${status}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
      setItems(data.inquiries || []);
      setResponses(Object.fromEntries((data.inquiries || []).map((item: any) => [item.id, item.response || ''])));
    } catch (e: any) {
      alert(e.message || '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const reply = async (item: any) => {
    const response = (responses[item.id] || '').trim();
    if (!response) return alert('返信内容を入力してください。');
    setSavingId(item.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/parent-inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: item.id, response, status: 'answered' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '返信に失敗しました');
      await load();
    } catch (e: any) {
      alert(e.message || '返信に失敗しました');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-24 text-slate-800">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-black text-indigo-500"><HelpCircle size={16} /> Support Center</p>
              <h1 className="mt-2 text-2xl font-black">保護者お問い合わせ</h1>
              <p className="mt-1 text-sm font-bold text-slate-500">よくある質問で回答できなかった内容、保護者からサポートセンターへ送信された問い合わせを確認します。</p>
            </div>
            <div className="flex gap-2">
              <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                <option value="open">未対応</option>
                <option value="answered">回答済み</option>
                <option value="all">すべて</option>
              </select>
              <button onClick={load} className="rounded-2xl bg-slate-900 px-4 text-white"><RefreshCw size={18} /></button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-[28px] bg-white p-10 text-center text-sm font-black text-slate-400 shadow-sm">該当する問い合わせはありません</div>
        ) : (
          <div className="space-y-4">
            {items.map(item => (
              <section key={item.id} className="rounded-[28px] bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.status === 'answered' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {item.status === 'answered' ? '回答済み' : '未対応'}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{item.source === 'faq_unanswered' ? 'FAQ未解決' : 'サポート送信'}</span>
                    </div>
                    <h2 className="mt-2 text-lg font-black text-slate-900">{item.parent_name || '保護者'}</h2>
                    <p className="mt-1 text-xs font-bold text-slate-400">{toDateTime(item.created_at)}</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="mb-1 text-[10px] font-black text-slate-400">問い合わせ内容</p>
                  <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-700">{item.content}</p>
                </div>
                {item.response && (
                  <div className="mt-3 rounded-2xl bg-emerald-50 p-4">
                    <p className="mb-1 text-[10px] font-black text-emerald-600">回答済み内容</p>
                    <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-emerald-800">{item.response}</p>
                  </div>
                )}
                <div className="mt-4">
                  <label className="mb-2 flex items-center gap-2 text-xs font-black text-slate-500"><MessageSquareReply size={14} /> 返信内容</label>
                  <textarea
                    value={responses[item.id] || ''}
                    onChange={e => setResponses(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="保護者への返信を入力"
                  />
                  <button onClick={() => reply(item)} disabled={savingId === item.id} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                    {savingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    回答を保存
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
