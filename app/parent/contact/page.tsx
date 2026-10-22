'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, HelpCircle, Inbox, MessagesSquare, Send, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ParentCard, ParentPageHeader, ParentSectionTitle } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, StatusPill, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';

const FAQ_LIST = ['欠席連絡はどこからできますか？', '振替受講はできますか？', '録画はどこで確認できますか？', '宿題提出状況を確認したいです', '通知設定を変更したいです', '受講講座の登録はどこで行いますか？', 'ログインできない場合はどうすればよいですか？'];
const CATEGORIES = [{ value: 'lesson', label: '授業・受講' }, { value: 'absence', label: '欠席・振替' }, { value: 'homework', label: '宿題・学習状況' }, { value: 'account', label: 'アカウント・操作' }, { value: 'other', label: 'その他' }];
type FaqMessage = { role: 'parent' | 'bot'; text: string; faq?: string; pendingQuestion?: string; sent?: boolean };
type ThreadMessage = { sender_role: 'parent' | 'staff'; sender_name?: string; text: string; created_at_iso?: string };
const timeLabel = (value: any) => {
  if (!value) return '';
  const ms = typeof value === 'string' ? value : (value._seconds || value.seconds || 0) * 1000;
  return ms ? formatDateTime(ms) : '';
};

export default function ParentContactPage() {
  const { user } = useAuth();
  const toast = useToast();
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
      setForm(current => ({ ...current, student_id: pickChildId(user.uid, (data.students || []).map((student: any) => String(student.id)), current.student_id) }));
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
    if (!form.subject.trim() || !form.question.trim()) return toast.error('件名と連絡内容を入力してください。');
    setSaving(true);
    try { const data = await post({ action: 'send', ...form }); setForm(current => ({ ...current, subject: '', question: '' })); await load(); setExpandedId(data.inquiry_id || ''); toast.success('教室へ送信しました。'); }
    catch (error: any) { toast.error(`送信できませんでした: ${error.message || error}`); }
    finally { setSaving(false); }
  };
  const reply = async (id: string) => {
    const question = String(replyById[id] || '').trim(); if (!question) return;
    setSaving(true);
    try { await post({ action: 'reply', inquiry_id: id, question }); setReplyById(current => ({ ...current, [id]: '' })); await load(); }
    catch (error: any) { toast.error(error.message || '送信できませんでした'); }
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
    try { const data = await post({ action: 'answer', question: value }); setFaqMessages(current => [...current, { role: 'parent', text: value }, { role: 'bot', text: data.answer || '回答がありません。', faq: data.faq, pendingQuestion: data.needs_support ? value : undefined }]); setFaqInput(''); }
    catch (error: any) { setFaqMessages(current => [...current, { role: 'bot', text: `エラー: ${error.message || error}` }]); }
    finally { setSaving(false); }
  };
  // FAQで解決しなかった質問は、保護者が明示的に押したときだけ教室へ送る。
  const sendFaqToClassroom = async (index: number, question: string) => {
    setSaving(true);
    try {
      const data = await post({ action: 'send', question, from_faq: true, student_id: form.student_id || undefined, category: 'other', subject: 'FAQで解決しなかった質問' });
      setFaqMessages(current => [...current.map((message, i) => i === index ? { ...message, sent: true } : message), { role: 'bot', text: `教室へ質問を送りました。返信は「${TERMS.parentContact}」の連絡履歴に届きます。` }]);
      await load(); setExpandedId(data.inquiry_id || '');
    } catch (error: any) { setFaqMessages(current => [...current, { role: 'bot', text: `送信できませんでした: ${error.message || error}` }]); }
    finally { setSaving(false); }
  };
  /** 保護者の最後のメッセージを教室が読んだか。開いた時刻（admin_read_at）か、その後の教室からの返信で判断する。 */
  const parentReadReceipt = (item: any, messages: ThreadMessage[]) => {
    let lastParent = -1;
    messages.forEach((message, index) => { if (message.sender_role === 'parent') lastParent = index; });
    if (lastParent < 0) return { index: -1, readAt: '', read: false };
    const sentAt = Date.parse(String(messages[lastParent].created_at_iso || ''));
    const openedAt = Date.parse(String(item.admin_read_at_iso || ''));
    if (Number.isFinite(openedAt) && (!Number.isFinite(sentAt) || openedAt >= sentAt)) return { index: lastParent, readAt: String(item.admin_read_at_iso), read: true };
    const staffReply = messages.slice(lastParent + 1).find(message => message.sender_role === 'staff');
    return staffReply ? { index: lastParent, readAt: String(staffReply.created_at_iso || ''), read: true } : { index: lastParent, readAt: '', read: false };
  };
  const threadMessages = (item: any): ThreadMessage[] => Array.isArray(item.messages) && item.messages.length ? item.messages : [{ sender_role: 'parent', sender_name: item.parent_name || '保護者', text: item.content || '' }, ...(item.response ? [{ sender_role: 'staff' as const, sender_name: item.responded_by_name || '担当者', text: item.response }] : [])];

  const fieldClass = 'mt-1 w-full rounded-input border border-line bg-surface px-3 text-sm font-normal text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';
  const tabs = [
    { id: 'contact' as const, label: TERMS.parentContact, icon: MessagesSquare },
    { id: 'faq' as const, label: 'よくある質問', icon: HelpCircle },
  ];

  return <div className="space-y-5">
    <ParentPageHeader eyebrow="教室とのやりとり" title={TERMS.parentContact} description="個別のご相談は教室とのやりとりとして残ります。よくある質問もここで確認できます。全体へのご案内は「お知らせ」でご確認ください。" icon={MessagesSquare} />
    <div role="tablist" aria-label="表示の切り替え" className="grid grid-cols-2 gap-1 rounded-card border border-line bg-surface p-1 shadow-card">
      {tabs.map(item => {
        const Icon = item.icon;
        const active = tab === item.id;
        return <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(item.id)} className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-btn text-sm font-bold transition-colors', active ? 'bg-accent text-accent-ink' : 'text-fg-muted hover:bg-accent-soft hover:text-accent')}><Icon size={17} aria-hidden />{item.label}</button>;
      })}
    </div>

    {tab === 'contact' ? <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <ParentCard className="h-fit lg:sticky lg:top-24">
        <ParentSectionTitle icon={Send} title="新しい連絡" description="欠席は欠席連絡（ホームの通塾カレンダー）から、相談や確認はこちらから送ってください。" />
        <div className="space-y-3">
          {students.length > 1 ? (
            <div>
              <p className="mb-1 text-sm font-bold text-fg">対象のお子さま</p>
              <ChildSwitcher label="対象のお子さま" options={students.map(student => ({ id: String(student.id), name: student.name, grade: student.grade }))} value={form.student_id} onChange={id => setForm(current => ({ ...current, student_id: id }))} />
            </div>
          ) : students[0] && <p className="text-sm text-fg-muted">対象のお子さま：<span className="font-bold text-fg">{students[0].name} {students[0].grade}</span></p>}
          <label className="block text-sm font-bold text-fg">分類<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} className={`${fieldClass} min-h-11`}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="block text-sm font-bold text-fg">件名<input maxLength={120} value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} className={`${fieldClass} min-h-11`} placeholder="例：次回授業について" /></label>
          <label className="block text-sm font-bold text-fg">内容<textarea maxLength={2000} value={form.question} onChange={event => setForm({ ...form, question: event.target.value })} className={`${fieldClass} min-h-32 resize-none py-2`} placeholder="教室に確認したい内容" /></label>
          <Button onClick={() => void createInquiry()} loading={saving} disabled={!form.subject.trim() || !form.question.trim()} fullWidth icon={<Send size={17} aria-hidden />}>教室へ送信</Button>
        </div>
      </ParentCard>
      <section className="space-y-3" aria-label="連絡履歴">
        <div className="flex items-center justify-between px-1"><h2 className="text-base font-bold text-fg">連絡履歴</h2><span className="text-sm text-fg-muted">{inquiries.length}件</span></div>
        {loading ? <ListSkeleton rows={3} /> : historyError ? <ErrorState message={historyError} onRetry={() => void load()} /> : inquiries.length === 0 ? <EmptyState icon={Inbox} title="連絡履歴はありません" description="教室へ送った連絡と、その返信がここに残ります。" /> : inquiries.map(item => {
          const expanded = expandedId === item.id;
          return <article key={item.id} className={cn('overflow-hidden rounded-card border bg-surface shadow-card', item.unread_for_parent ? 'border-accent/40 ring-2 ring-accent/10' : 'border-line')}>
            <button type="button" onClick={() => void toggleThread(item)} aria-expanded={expanded} className="flex w-full items-start justify-between gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-2">
                  <StatusPill tone={item.status === 'answered' ? 'success' : 'warning'}>{item.status === 'answered' ? '回答あり' : '教室確認中'}</StatusPill>
                  {item.unread_for_parent && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold bg-accent text-accent-ink">新着</span>}
                </div>
                <h3 className="text-base font-bold text-fg">{item.subject || TERMS.parentContact}</h3>
                <p className="mt-1 text-sm text-fg-muted">{[item.student_name, item.school_name].filter(Boolean).join(' / ') || '対象未設定'}</p>
                {timeLabel(item.updated_at || item.created_at) && <p className="mt-1 text-xs text-fg-muted">最終更新 {timeLabel(item.updated_at || item.created_at)}</p>}
              </div>
              <span className="shrink-0 text-sm font-bold text-accent">{expanded ? '閉じる' : '会話を見る'}</span>
            </button>
            {expanded && <div className="border-t border-line bg-canvas p-4">
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {(() => {
                  const messages = threadMessages(item);
                  const receipt = parentReadReceipt(item, messages);
                  return messages.map((message, index) => <div key={`${item.id}_${index}`} className={`flex flex-col ${message.sender_role === 'parent' ? 'items-end' : 'items-start'}`}>
                    <div className={cn('max-w-[85%] rounded-card px-4 py-3 text-sm leading-6', message.sender_role === 'parent' ? 'bg-accent text-accent-ink' : 'bg-surface text-fg shadow-sm')}>
                      <p className="mb-1 text-xs font-bold opacity-80">{message.sender_role === 'parent' ? '保護者' : message.sender_name || '担当者'}{timeLabel(message.created_at_iso) && <span className="ml-2 font-medium">{timeLabel(message.created_at_iso)}</span>}</p>
                      <p className="whitespace-pre-wrap">{message.text}</p>
                    </div>
                    {index === receipt.index && receipt.read && <p className="mt-1 px-1 text-xs text-fg-muted">既読{timeLabel(receipt.readAt) && ` ${timeLabel(receipt.readAt)}`}</p>}
                  </div>);
                })()}
              </div>
              <div className="mt-4 flex items-end gap-2">
                <label className="sr-only" htmlFor={`reply-${item.id}`}>追加の質問・返信</label>
                <textarea id={`reply-${item.id}`} value={replyById[item.id] || ''} onChange={event => setReplyById(current => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} className="min-h-14 flex-1 resize-none rounded-input border border-line bg-surface p-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" placeholder="追加の質問・返信" />
                <IconButton label="返信を送る" variant="primary" onClick={() => void reply(item.id)} disabled={saving || !String(replyById[item.id] || '').trim()}><Send size={18} aria-hidden /></IconButton>
              </div>
            </div>}
          </article>;
        })}
      </section>
    </div> : <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="cb-card overflow-hidden" aria-label="FAQチャット">
        <div className="bg-accent p-5 text-accent-ink"><h2 className="flex items-center gap-2 text-lg font-bold"><Bot aria-hidden />FAQチャット</h2><p className="mt-1 text-sm text-accent-ink/80">一般的な操作方法をすぐに確認できます。</p></div>
        <div className="max-h-[52vh] space-y-3 overflow-y-auto p-5" aria-live="polite">{faqMessages.map((message, index) => <div key={index} className={`flex ${message.role === 'parent' ? 'justify-end' : 'justify-start'}`}>
          <div className={cn('max-w-[85%] rounded-card px-4 py-3 text-sm leading-6', message.role === 'parent' ? 'bg-accent text-accent-ink' : 'bg-canvas text-fg')}>
            {message.faq && <p className="mb-1 text-xs font-bold text-accent">参照：{message.faq}</p>}
            <p>{message.text}</p>
            {message.pendingQuestion && (message.sent
              ? <p className="mt-2 text-xs font-bold text-success">教室へ送信済み</p>
              : <Button size="sm" className="mt-2" onClick={() => void sendFaqToClassroom(index, message.pendingQuestion!)} disabled={saving} icon={<Send size={13} aria-hidden />}>教室に質問として送る</Button>)}
          </div>
        </div>)}</div>
        <form className="flex gap-2 border-t border-line bg-canvas p-4" onSubmit={event => { event.preventDefault(); void askFaq(); }}>
          <label className="sr-only" htmlFor="faq-input">知りたい内容</label>
          <input id="faq-input" value={faqInput} onChange={event => setFaqInput(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" placeholder="知りたい内容" />
          <IconButton type="submit" label="質問する" variant="primary" disabled={saving || !faqInput.trim()}><Send size={18} aria-hidden /></IconButton>
        </form>
      </section>
      <ParentCard as="aside">
        <ParentSectionTitle icon={HelpCircle} title="よくある質問" />
        <div className="space-y-2">{FAQ_LIST.map(question => <button key={question} type="button" onClick={() => void askFaq(question)} className="flex min-h-11 w-full items-center rounded-btn bg-canvas px-3 py-2 text-left text-sm text-fg hover:bg-accent-soft hover:text-accent">{question}</button>)}</div>
        <Button variant="secondary" fullWidth className="mt-5" onClick={() => setTab('contact')} icon={<UserRound size={16} aria-hidden />}>解決しない場合は{TERMS.parentContact}へ</Button>
      </ParentCard>
    </div>}
    <div className="flex gap-3 rounded-card border border-success/20 bg-success-soft p-4 text-sm leading-6 text-success"><CheckCircle2 className="shrink-0" size={18} aria-hidden />教室との個別のやりとりはこの画面、お知らせは運営からの正式な一斉配信、掲示板は参加者同士の公開交流です。</div>
  </div>;
}
