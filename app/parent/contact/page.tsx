'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, HelpCircle, Loader2, Send, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const FAQ_LIST = [
  { q: '欠席連絡はどこからできますか？', a: '保護者ホームのカレンダーで日付を選ぶか、「AI・連絡」から欠席連絡を送信できます。送信後は管理者側で確認されます。', keywords: ['欠席', '休み', '休む', '遅刻', '連絡'] },
  { q: '振替受講はできますか？', a: '保護者ホームのカレンダーで希望日を選び、「振替」を選択して希望内容を送信してください。校舎側の確認後に案内されます。', keywords: ['振替', '変更', '別日', '受講日'] },
  { q: '録画はどこで確認できますか？', a: '保護者ダッシュボードの録画視聴欄で、お子さまの録画視聴状況を確認できます。生徒本人は生徒画面の授業録画から視聴できます。', keywords: ['録画', '視聴', '動画', '見逃し'] },
  { q: '宿題提出状況を確認したいです', a: '保護者ホームの宿題提出欄に、提出履歴や提出日時が表示されます。表示がない場合はまだ提出記録がありません。', keywords: ['宿題', '提出', '課題'] },
  { q: '通知設定を変更したいです', a: '下部ナビの「通知設定」から、メール・LINE・アプリ内通知などのオンオフを変更できます。', keywords: ['通知', 'メール', 'LINE', 'ライン', '設定'] },
  { q: '受講講座の登録はどこで行いますか？', a: '管理者から登録依頼が出ると、保護者画面にポップアップが表示されます。期間内に受講講座を選択して登録してください。', keywords: ['講座', '登録', 'カリキュラム', '受講', '科目'] },
  { q: 'ログインできない場合はどうすればよいですか？', a: 'ID・パスワードをご確認ください。解決しない場合は、この画面下部の問い合わせ送信からサポートセンターへご連絡ください。', keywords: ['ログイン', 'パスワード', 'id', 'ID', '入れない'] },
];

type Message = { role: 'parent' | 'bot'; text: string; faq?: string };

export default function ParentContactPage() {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: 'よくある質問から選ぶか、お問い合わせ内容を入力してください。回答できない内容はサポートセンターへ送信されます。' },
  ]);
  const [loading, setLoading] = useState(false);
  const [inquiries, setInquiries] = useState<any[]>([]);

  const latestQuestion = useMemo(() => [...messages].reverse().find(item => item.role === 'parent')?.text || '', [messages]);

  const loadInquiries = async () => {
    try {
      const token = await user?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/parent/faq?mine=1', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) setInquiries(data.inquiries || []);
    } catch (e) {
      console.warn('Parent inquiries read failed:', e);
    }
  };

  useEffect(() => {
    loadInquiries();
  }, [user]);

  const ask = async (value?: string) => {
    const question = (value ?? input).trim();
    if (!question) return;
    setLoading(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/parent/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'answer', question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '回答に失敗しました');
      setMessages(prev => [
        ...prev,
        { role: 'parent', text: question },
        { role: 'bot', faq: data.faq, text: data.answer || '回答を作成できませんでした。' },
      ]);
      setInput('');
      if (data.needs_support) await loadInquiries();
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'bot', text: `エラー: ${e.message || e}` }]);
    } finally {
      setLoading(false);
    }
  };

  const sendInquiry = async () => {
    if (!user || !latestQuestion) return alert('問い合わせ内容を入力してください。');
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/parent/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'send', question: latestQuestion }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '送信に失敗しました');
      alert('サポートセンターへ問い合わせを送信しました。');
      await loadInquiries();
    } catch (e: any) {
      alert(`送信に失敗しました: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="overflow-hidden rounded-[28px] bg-white shadow-sm">
        <div className="bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-indigo-300">FAQ Chat</p>
          <h2 className="mt-2 flex items-center gap-2 text-2xl font-black"><HelpCircle /> お問い合わせ</h2>
          <p className="mt-2 text-sm font-bold text-slate-300">よくある質問を基準にAPI経由で回答します。</p>
        </div>
        <div className="max-h-[58vh] space-y-4 overflow-y-auto p-5">
          {messages.map((message, index) => {
            const isParent = message.role === 'parent';
            return (
              <div key={index} className={`flex gap-3 ${isParent ? 'justify-end' : 'justify-start'}`}>
                {!isParent && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Bot size={18} /></div>}
                <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm font-bold leading-relaxed ${isParent ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  {message.faq && <p className="mb-1 text-[10px] font-black text-indigo-500">参照FAQ: {message.faq}</p>}
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </div>
                {isParent && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UserRound size={18} /></div>}
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-100 bg-slate-50 p-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="例: 欠席連絡はどこからできますか？"
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button onClick={() => ask()} disabled={loading} className="rounded-2xl bg-slate-900 px-4 text-white hover:bg-slate-800 disabled:opacity-50"><Send size={18} /></button>
          </div>
          <button onClick={sendInquiry} disabled={loading || !latestQuestion} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} サポートセンターに問い合わせを送信
          </button>
        </div>
      </section>

      <aside className="rounded-[28px] bg-white p-5 shadow-sm">
        <h3 className="text-sm font-black text-slate-800">よくある質問</h3>
        <div className="mt-4 space-y-2">
          {FAQ_LIST.map(faq => (
            <button key={faq.q} onClick={() => ask(faq.q)} disabled={loading} className="w-full rounded-2xl bg-slate-50 p-3 text-left text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50">
              {faq.q}
            </button>
          ))}
        </div>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-black text-slate-800">問い合わせ履歴</h3>
          <div className="mt-3 space-y-3">
            {inquiries.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-400">まだ問い合わせ履歴はありません</p>
            ) : inquiries.map(item => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.status === 'answered' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {item.status === 'answered' ? '回答済み' : '確認中'}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs font-bold text-slate-600">{item.content}</p>
                {item.response && <p className="mt-2 rounded-xl bg-white p-2 text-xs font-bold text-emerald-700">{item.response}</p>}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
