'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, HelpCircle, Loader2, MessageCircle, Search, Send, Users } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, EmptyState, ErrorState, ListSkeleton, Modal, useConfirm, useToast } from '@/app/components/ui';

type Student = { id: string; student_name?: string; name?: string; grade?: string; classroom?: string; hasAlert?: boolean; unreadCount?: number };
type Message = { id: string; role: string; message?: string; content?: string };
type Inquiry = { id: string; studentId: string; studentName?: string; content?: string };

export default function TeacherChatPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [overviewError, setOverviewError] = useState(false);
  const [students, setStudents] = useState<Student[]>([]); const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [selected, setSelected] = useState<Student | null>(null); const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState(''); const [input, setInput] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false); const [bulkMessage, setBulkMessage] = useState(''); const [bulkGrades, setBulkGrades] = useState<string[]>([]);
  const authHeaders = useCallback(async () => ({ Authorization: `Bearer ${await user!.getIdToken()}` }), [user]);
  const loadOverview = useCallback(async () => {
    if (!user) return; setLoading(true); setOverviewError(false);
    try { const res = await fetch('/api/teacher/chat', { headers: await authHeaders(), cache: 'no-store' }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setStudents(data.students || []); setInquiries(data.inquiries || []);
      // 声かけリストの「返信する」から来たときは、その生徒を開く（初回だけ）。
      const requested = new URLSearchParams(window.location.search).get('student');
      if (requested) { const target = (data.students || []).find((student: Student) => student.id === requested); if (target) setSelected(current => current || target); window.history.replaceState(null, '', window.location.pathname); } }
    catch (error) { console.error(error); setOverviewError(true); toast.error('担当生徒のチャット一覧を読み込めませんでした。'); } finally { setLoading(false); }
  }, [authHeaders, toast, user]);
  const loadMessages = useCallback(async (student: Student) => {
    if (!user) return; setMessages([]); setThreadError(''); const res = await fetch(`/api/teacher/chat?student_id=${encodeURIComponent(student.id)}`, { headers: await authHeaders(), cache: 'no-store' }); const data = await res.json(); if (res.ok && data.ok) setMessages(data.messages || []); else throw new Error(data.error);
  }, [authHeaders, user]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { if (selected) void loadMessages(selected).then(loadOverview).catch(error => { console.error(error); setThreadError('メッセージを読み込めませんでした。再度生徒を選択してください。'); }); else { setMessages([]); setThreadError(''); } }, [loadMessages, loadOverview, selected]);
  const filtered = useMemo(() => students.filter(student => `${student.student_name || student.name || ''} ${student.grade || ''} ${student.classroom || ''}`.includes(search)), [search, students]);
  const grades = useMemo(() => Array.from(new Set(students.map(student => student.grade).filter(Boolean) as string[])).sort(), [students]);
  const bulkTargets = useMemo(() => bulkGrades.length ? students.filter(student => student.grade && bulkGrades.includes(student.grade)) : [], [bulkGrades, students]);
  const post = async (payload: Record<string, unknown>) => { const res = await fetch('/api/teacher/chat', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error || 'send-failed'); return data; };
  const send = async () => { if (!selected || !input.trim() || sending) return; setSending(true); try { await post({ action: 'send', student_id: selected.id, message: input }); setInput(''); await loadMessages(selected); } catch { toast.error('送信できませんでした。'); } finally { setSending(false); } };
  const sendBulk = async () => { if (!bulkMessage.trim() || !bulkTargets.length) return; const ok = await confirm({ title: `${bulkTargets.length}名へ一斉送信しますか？`, confirmLabel: '一斉送信' }); if (!ok) return; setSending(true); try { await post({ action: 'bulk', student_ids: bulkTargets.map(student => student.id), message: bulkMessage }); setBulkMessage(''); setBulkGrades([]); setBulkOpen(false); toast.success(`${bulkTargets.length}名へ送信しました。`); } catch { toast.error('一斉送信できませんでした。'); } finally { setSending(false); } };

  return <main className="flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden px-3 py-3 md:px-6 md:py-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Link href="/teacher/work" className="inline-flex min-h-9 items-center gap-1 rounded-btn pr-2 text-sm font-bold text-fg-muted hover:text-accent"><ChevronLeft size={18} aria-hidden />戻る</Link>
      <div className="flex items-center gap-2">
        <details className="relative">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-btn border border-line bg-surface px-3 text-xs font-bold text-fg-muted shadow-sm"><HelpCircle size={16} aria-hidden />使い方</summary>
          <div className="absolute right-0 z-overlay mt-2 w-72 rounded-card border border-line bg-surface p-4 text-xs font-bold leading-6 text-fg-muted shadow-card">
            <p>生徒を選び、下部から返信します。橙色はAI相談、赤い数字は未読件数です。一斉送信は学年を選んでから送信してください。</p>
            <p className="mt-2 text-rose-600">個人情報やパスワードはチャットに記載しないでください。</p>
          </div>
        </details>
        <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)} icon={<Users size={16} aria-hidden />}>一斉送信</Button>
      </div>
    </div>
    <div className="cb-card flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className="flex max-h-[42dvh] w-full flex-col border-b border-line md:max-h-none md:w-[360px] md:border-b-0 md:border-r">
        <div className="border-b border-line bg-canvas p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-fg"><MessageCircle size={19} aria-hidden />担当生徒チャット</h1>
          <p className="mt-1 text-xs font-bold text-fg-muted">所属校舎・担当生徒のみ表示</p>
          <label className="mt-3 flex items-center gap-2 rounded-input border border-line bg-surface px-3 focus-within:ring-2 focus-within:ring-accent/30">
            <Search size={16} className="text-fg-muted" aria-hidden />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="氏名・学年・校舎" aria-label="生徒を検索" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"/>
          </label>
        </div>
        {inquiries.length>0&&<div className="border-b border-line bg-amber-50 p-3">
          <p className="mb-2 flex items-center gap-1 text-xs font-bold text-amber-800"><AlertTriangle size={14} aria-hidden />講師への相談 {inquiries.length}件</p>
          {inquiries.slice(0,3).map(item=><button type="button" key={item.id} onClick={()=>{const student=students.find(value=>value.id===item.studentId);if(student)setSelected(student);}} className="mb-1 block min-h-9 w-full truncate rounded-input bg-surface px-3 py-2 text-left text-xs font-bold text-fg-muted hover:bg-amber-100">{item.studentName || '生徒'}：{item.content}</button>)}
        </div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <div className="p-3"><ListSkeleton rows={4} /></div>
          : overviewError ? <div className="p-3"><ErrorState title="チャット一覧を読み込めませんでした" onRetry={() => void loadOverview()} /></div>
          : filtered.length === 0 ? <div className="p-3"><EmptyState title={search ? '該当する生徒がいません' : '担当生徒がいません'} /></div>
          : filtered.map(student=><button type="button" key={student.id} onClick={()=>setSelected(student)} aria-current={selected?.id===student.id || undefined} className={`flex min-h-14 w-full items-center justify-between border-b border-line px-4 py-3 text-left hover:bg-canvas ${selected?.id===student.id?'bg-accent-soft':''}`}>
            <div>
              <p className="font-bold text-fg">{student.student_name || student.name || '氏名未設定'}</p>
              <p className="text-xs font-bold text-fg-muted">{[student.grade,student.classroom].filter(Boolean).join(' / ')||'所属未設定'}</p>
            </div>
            <div className="flex items-center gap-1">
              {student.hasAlert&&<span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">相談</span>}
              {Boolean(student.unreadCount)&&<span className="grid min-w-6 place-items-center rounded-full bg-rose-600 px-1.5 py-1 text-xs font-bold text-white" aria-label={`未読${student.unreadCount}件`}>{student.unreadCount}</span>}
            </div>
          </button>)}
        </div>
      </aside>
      <section className="flex min-h-0 flex-1 flex-col">
        {!selected ? <div className="grid flex-1 place-items-center p-4"><EmptyState icon={MessageCircle} title="左の一覧から生徒を選択してください" /></div> : <>
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-bold text-fg">{selected.student_name || selected.name}</h2>
            <p className="text-xs font-bold text-fg-muted">{selected.grade || ''} {selected.classroom || ''}</p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-canvas p-4">
            {threadError ? <div role="alert" className="rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{threadError}</div> : messages.length===0 && <p className="py-12 text-center text-sm font-bold text-fg-muted">メッセージはありません</p>}
            {messages.map(message=><div key={message.id} className={`flex ${message.role==='teacher'?'justify-end':'justify-start'}`}><div className={`max-w-[82%] whitespace-pre-wrap rounded-card px-4 py-3 text-sm leading-6 ${message.role==='teacher'?'bg-accent text-accent-ink':'bg-surface text-fg shadow-sm'}`}>{message.message || message.content}</div></div>)}
          </div>
          <div className="flex gap-2 border-t border-line p-3">
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send();}}} maxLength={2000} aria-label="メッセージ" placeholder="メッセージ（Ctrl/⌘ + Enterで送信）" className="min-h-12 flex-1 resize-none rounded-input border border-line bg-canvas p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
            <button type="button" onClick={()=>void send()} disabled={!input.trim()||sending||Boolean(threadError)} aria-label="送信" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-btn bg-accent px-4 text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-40">{sending?<Loader2 className="motion-safe:animate-spin" aria-hidden />:<Send aria-hidden />}</button>
          </div>
        </>}
      </section>
    </div>
    <Modal
      open={bulkOpen}
      onClose={() => setBulkOpen(false)}
      title="担当生徒へ一斉送信"
      description="学年を1つ以上選択してください"
      footer={<>
        <Button variant="secondary" onClick={() => setBulkOpen(false)}>キャンセル</Button>
        <Button onClick={() => void sendBulk()} disabled={!bulkMessage.trim()||!bulkTargets.length} loading={sending} icon={<Send size={16} aria-hidden />}>一斉送信</Button>
      </>}
    >
      <div className="flex flex-wrap gap-2">{grades.map(grade=><button type="button" key={grade} aria-pressed={bulkGrades.includes(grade)} onClick={()=>setBulkGrades(current=>current.includes(grade)?current.filter(value=>value!==grade):[...current,grade])} className={`min-h-10 rounded-full px-4 text-sm font-bold ${bulkGrades.includes(grade)?'bg-accent text-accent-ink':'bg-slate-100 text-fg-muted hover:bg-slate-200'}`}>{grade}</button>)}</div>
      <p className="mt-3 text-sm font-bold text-accent">対象 {bulkTargets.length}名</p>
      <textarea value={bulkMessage} onChange={e=>setBulkMessage(e.target.value)} maxLength={2000} aria-label="送信内容" className="mt-3 h-32 w-full rounded-input border border-line p-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" placeholder="送信内容"/>
    </Modal>
  </main>;
}
