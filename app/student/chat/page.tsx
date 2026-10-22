'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useAuth } from '@/app/context/AuthContext';
import { auth } from '@/lib/firebase';
import { Send, User, Bot, Loader2, Mail, Sparkles, MessageCircle, Info } from 'lucide-react';
import { logActivity } from '@/lib/logActivity';
import { EmptyState, ErrorState, IconButton, useConfirm, useToast } from '@/app/components/ui';

const AI_CONTEXT_WINDOW = 40;

type StoredChatMessage = { id?: string; role?: string; content?: string };

/** サーバーに保存した会話（role と content）を画面用のメッセージに変換する。 */
const toUiMessage = (message: StoredChatMessage, index: number): UIMessage => ({
  id: String(message.id || `stored-${index}`),
  role: message.role === 'assistant' ? 'assistant' : 'user',
  parts: [{ type: 'text', text: String(message.content || '') }],
});

const messageText = (message: UIMessage) =>
  message.parts.map(part => (part.type === 'text' ? part.text : '')).join('');

export default function StudentChat() {
  const { user, profile } = useAuth();
  const [isSendingToTeacher, setIsSendingToTeacher] = useState(false);
  const [teacherMessages, setTeacherMessages] = useState<any[]>([]);
  const [teacherReply, setTeacherReply] = useState('');
  const [teacherReplyLoading, setTeacherReplyLoading] = useState(false);
  const showChatDestination = process.env.NEXT_PUBLIC_SHOW_CHAT_DESTINATION !== 'false';
  const stamps = ['ありがとう', 'わかった', '質問です', '復習します'];
  const [rateLimited, setRateLimited] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  
  const [input, setInput] = useState('');
  const userRef = useRef(user);
  userRef.current = user;

  // 送信のたびに最新のログイントークンを付け、サーバーへは直近の会話だけを role と content で送る
  // （長い会話でも送信できるよう。サーバー側も直近だけを使う）。
  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: '/api/chat',
    prepareSendMessagesRequest: async ({ messages: all }) => {
      const token = await (userRef.current || auth.currentUser)?.getIdToken();
      return {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : undefined,
        body: { messages: all.slice(-AI_CONTEXT_WINDOW).map(message => ({ role: message.role, content: messageText(message) })) },
      };
    },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      setRateLimited(response.status === 429);
      return response;
    },
  }), []);

  // useChat フック
  const { messages, sendMessage, status, setMessages, error: aiError } = useChat({
    transport,
    onFinish: async ({ isAbort, isDisconnect, isError }) => {
      if (!user || isAbort || isDisconnect || isError) return;
      try {
        await logActivity(
          user.uid,
          profile?.student_name || '生徒',
          'chat',
          `AIチューターと会話しました`
        );
      } catch (e) {
        console.error("保存エラー", e);
      }
    },
  });

  // --- 1. 会話履歴の読み込み ---
  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryError(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/chat/history', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'history-load-failed');
      const history = data.messages || [];

      if (history.length > 0) {
        setMessages(history.map(toUiMessage));
      }
    } catch (e) {
      console.error("履歴読み込みエラー", e);
      setHistoryError(true);
    }
  }, [user, setMessages]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadTeacherMessages = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/student/teacher-chat', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'teacher-chat-load-failed');
      setTeacherMessages(data.messages || []);
    } catch (error) { console.error('先生チャット読み込みエラー', error); }
  }, [user]);
  useEffect(() => { void loadTeacherMessages(); }, [loadTeacherMessages]);

  // --- 2. ユーザーのメッセージ送信時に保存 ---
  const isLoading = status === 'submitted' || status === 'streaming';
  const customSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input;
    if (!user || !text.trim() || isLoading) return;

    setInput('');
    void sendMessage({ text });
  };

  // --- 3. 先生に送信機能 ---
  const handleSendToTeacher = async () => {
    if (!user || messages.length === 0) return;
    if (!(await confirm({ title: 'この会話の内容を先生に送信しますか？', message: '先生が後で確認してアドバイスをくれます。', confirmLabel: '送信する' }))) return;

    setIsSendingToTeacher(true);
    try {
      const response = await fetch('/api/student/teacher-chat', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'report_ai_chat' }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'report-failed');
      toast.success('先生に送信しました！確認まで少し待っててね。');
    } catch (e) {
      console.error(e);
      toast.error('先生に送信できませんでした。時間を置いてもう一度お試しください。');
    } finally {
      setIsSendingToTeacher(false);
    }
  };

  const sendStamp = async (stamp: string) => {
    if (!user) return;
    try {
      const response = await fetch('/api/chat/history', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stamp', stamp }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'stamp-failed');
      setMessages(current => [...current, toUiMessage(data.message, current.length)]);
    } catch (e) {
      console.error(e);
      toast.error('スタンプを送れませんでした。もう一度お試しください。');
    }
  };

  const sendTeacherReply = async () => {
    if (!user || !teacherReply.trim()) return;
    setTeacherReplyLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/student/teacher-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: teacherReply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'teacher-chat-send-failed');
      setTeacherReply('');
      await loadTeacherMessages();
    } catch (e) {
      console.error(e);
      toast.error('先生へ返信できませんでした。時間を置いてもう一度お試しください。');
    } finally {
      setTeacherReplyLoading(false);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-[calc(100dvh-85px-env(safe-area-inset-bottom))] flex-col overflow-hidden">

      {/* ヘッダー */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-11 w-11 items-center justify-center rounded-btn bg-accent text-accent-ink shadow-card">
              <Bot size={22} className="fill-white/20" aria-hidden />
            </div>
            <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400" aria-hidden></div>
          </div>
          <div>
            <h1 className="flex items-center gap-1 text-lg font-bold leading-tight text-fg">
              AIチューター <Sparkles size={14} className="fill-amber-400 text-amber-500 motion-safe:animate-pulse" aria-hidden />
            </h1>
            <p className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-fg-muted">
              {showChatDestination ? '宛先: AIチューター' : '24時間いつでも質問OK'}
            </p>
          </div>
        </div>

        {/* 先生に送信ボタン */}
        <button
          onClick={handleSendToTeacher}
          disabled={messages.length === 0 || isSendingToTeacher}
          className="group flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-btn px-1 disabled:cursor-not-allowed disabled:opacity-50"
          title="先生に会話を送る"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-amber-600 shadow-sm transition-all group-hover:bg-amber-100">
            {isSendingToTeacher ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />}
          </div>
          <span className="text-xs font-bold text-amber-700">先生へ報告</span>
        </button>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <details className="mx-auto max-w-3xl rounded-card border border-accent/30 bg-accent-soft px-4 py-3">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-bold text-accent"><Info size={15} aria-hidden />AIと先生、どちらに届く？</summary>
          <div className="mt-2 space-y-1 text-xs leading-6 text-fg"><p>下の入力欄はAIチューター宛です。先生に直接送る場合は「先生からのメッセージ」の返信欄を使います。</p><p>AIとの会話を先生に見せたい場合だけ、右上の「先生へ報告」を押してください。パスワードや個人情報は送らないでください。</p></div>
        </details>
        <section className="cb-card mx-auto max-w-3xl p-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="rounded-btn bg-amber-50 p-2 text-amber-600"><MessageCircle size={18} aria-hidden /></div>
              <div>
                <h2 className="text-sm font-bold text-fg">先生からのメッセージ</h2>
                <p className="text-xs text-fg-muted">先生宛の返信もここから送れます</p>
              </div>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{teacherMessages.length}件</span>
          </div>

          {teacherMessages.length === 0 ? (
            <EmptyState icon={MessageCircle} title="まだ先生からのメッセージはありません" className="mb-3 py-6" />
          ) : (
            <div className="mb-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {teacherMessages.slice(-8).map((m) => {
                const isTeacher = m.role === 'teacher';
                return (
                  <div key={m.id} className={`rounded-btn px-3 py-2 text-sm leading-relaxed ${isTeacher ? 'bg-amber-50 text-fg' : 'bg-accent-soft text-fg'}`}>
                    <div className="mb-1 text-xs font-bold text-fg-muted">{isTeacher ? '先生' : '自分'}</div>
                    <div className="whitespace-pre-wrap">{m.message || m.content}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={teacherReply}
              onChange={(e) => setTeacherReply(e.target.value)}
              maxLength={2000}
              placeholder="先生へ返信..."
              aria-label="先生への返信"
              className="min-h-11 min-w-0 flex-1 rounded-input border border-line bg-slate-50 px-4 py-2 text-sm text-fg outline-none focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30"
            />
            <IconButton
              variant="primary"
              onClick={sendTeacherReply}
              disabled={!teacherReply.trim() || teacherReplyLoading}
              label="先生へ返信"
            >
              {teacherReplyLoading ? <Loader2 className="animate-spin" size={18} aria-hidden /> : <Send size={18} aria-hidden />}
            </IconButton>
          </div>
        </section>

        {historyError && (
          <ErrorState className="mx-auto max-w-3xl" title="これまでの会話を読み込めませんでした" onRetry={() => void loadHistory()} />
        )}

        {messages.length === 0 && !historyError && (
          <div className="flex h-full flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500">
            <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full border-4 border-accent-soft bg-surface shadow-card">
              <Sparkles size={40} className="fill-accent-soft text-accent" aria-hidden />
            </div>
            <h3 className="mb-2 text-lg font-bold text-fg">理科・社会のことを聞いてね！</h3>
            <p className="rounded-btn border border-line bg-surface px-4 py-2 text-xs font-medium text-fg-muted shadow-sm">
              「光合成のしくみを教えて」<br/>
              「鎌倉幕府と室町幕府のちがいは？」<br/>
              「理科・社会の暗記のコツを教えて」
            </p>
          </div>
        )}

        {messages.map((m, index) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={index}
              className={`flex items-end gap-2.5 ${isUser ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2 duration-300`}
            >
              {/* アイコン */}
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm ${isUser ? 'bg-slate-400 text-white' : 'bg-accent text-accent-ink'}`}>
                {isUser ? <User size={14} aria-hidden /> : <Bot size={14} aria-hidden />}
              </div>

              {/* 吹き出し */}
              <div className={`relative max-w-[80%] rounded-card p-3.5 text-sm leading-relaxed shadow-sm ${isUser
                ? 'rounded-br-none bg-accent text-accent-ink'
                : 'rounded-bl-none border border-line bg-surface text-fg'
              }`}>
                <div className="whitespace-pre-wrap">{messageText(m)}</div>
              </div>
            </div>
          );
        })}

        {/* ローディング表示 */}
        {isLoading && (
          <div role="status" className="ml-10 flex items-center gap-2">
            <div className="flex gap-1" aria-hidden>
              <div className="h-2 w-2 rounded-full bg-accent/60 motion-safe:animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="h-2 w-2 rounded-full bg-accent/60 motion-safe:animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="h-2 w-2 rounded-full bg-accent/60 motion-safe:animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <span className="text-xs font-bold text-accent">考え中...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="p-3 pb-6 sm:p-4">
        {aiError && <div role="alert" className="mx-auto mb-2 max-w-3xl rounded-btn border border-danger/20 bg-danger-soft px-4 py-3 text-xs font-bold text-danger">{rateLimited || /rate-limit/.test(aiError.message || '')
          ? '短い時間にたくさん質問したため、少し休憩中です。1分ほど待ってからもう一度送ってね。（1時間に送れる回数にも上限があります）'
          : 'AIチューターへ送信できませんでした。通信状態を確認し、時間を置いてもう一度お試しください。'}</div>}
        <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
          {stamps.map(stamp => (
            <button key={stamp} onClick={() => sendStamp(stamp)} className="min-h-9 shrink-0 rounded-full border border-accent/30 bg-surface px-3 text-xs font-bold text-accent shadow-sm hover:bg-accent-soft">
              {stamp}
            </button>
          ))}
        </div>
        <form onSubmit={customSubmit} className="relative mx-auto flex max-w-3xl items-end gap-2">
          <div className="flex flex-1 items-center rounded-hero border border-line bg-surface p-1.5 pl-4 shadow-card transition-all focus-within:ring-2 focus-within:ring-accent/30">
            <input
              className="w-full bg-transparent py-2 text-sm text-fg placeholder:text-fg-muted/60 focus:outline-none"
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="メッセージを入力..."
              aria-label="AIチューターへのメッセージ"
              disabled={isLoading}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              aria-label="送信"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 ${!input.trim() || isLoading
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'bg-accent text-accent-ink shadow-sm hover:bg-accent-hover'
              }`}
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} className="ml-0.5" aria-hidden />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
