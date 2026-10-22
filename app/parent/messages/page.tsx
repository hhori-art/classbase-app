'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, MessageCircle, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ParentCard, ParentPageHeader } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { Button, EmptyState, ErrorState, ListSkeleton, useToast } from '@/app/components/ui';
import { formatDate, formatTime, jstDateKey } from '@/lib/format';

type Student = { id: string; student_name?: string; grade?: string };
type ChatMessage = { id: string; request_id: string; role: 'user' | 'assistant'; message_type?: string; content: string; created_at_ms: number };
type Exchange = { id: string; question?: ChatMessage; answer?: ChatMessage; at: number };

const dateKey = (ms: number) => jstDateKey(new Date(ms));
const dayLabel = (ms: number) => formatDate(ms, { withYear: true });
const timeLabel = (ms: number) => (ms ? formatTime(ms) : '時刻不明');

/** 質問と、それに対するAIの返信を1組にまとめる（同じ request_id の組）。 */
function toExchanges(messages: ChatMessage[]): Exchange[] {
  const byRequest = new Map<string, Exchange>();
  messages.forEach(message => {
    const key = message.request_id || message.id;
    const exchange = byRequest.get(key) || { id: key, at: 0 };
    if (message.role === 'user') exchange.question = message; else exchange.answer = message;
    exchange.at = exchange.question?.created_at_ms || exchange.answer?.created_at_ms || 0;
    byRequest.set(key, exchange);
  });
  return Array.from(byRequest.values()).sort((a, b) => b.at - a.at);
}

function MessageBubble({ message, kind }: { message: ChatMessage; kind: 'question' | 'answer' }) {
  const [open, setOpen] = useState(false);
  const long = message.content.length > 220 || message.content.split('\n').length > 6;
  const isQuestion = kind === 'question';
  return (
    <div className={`flex gap-3 ${isQuestion ? '' : 'pl-4 sm:pl-10'}`}>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isQuestion ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'}`}>
        {isQuestion ? <UserRound size={16} aria-hidden /> : <Bot size={16} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-fg-muted">
          {isQuestion ? (message.message_type === 'stamp' ? 'お子さまのスタンプ' : 'お子さまの質問') : 'AIの返信'}
          <span className="ml-2 font-medium">{timeLabel(message.created_at_ms)}</span>
        </p>
        <div className={`mt-1 rounded-card rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-fg ${isQuestion ? 'bg-warning-soft' : 'bg-canvas'}`}>
          <p className={`whitespace-pre-wrap break-words ${long && !open ? 'line-clamp-6' : ''}`}>{message.content || '（内容なし）'}</p>
          {long && (
            <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-btn text-sm font-bold text-accent">
              {open ? '閉じる' : '全文を見る'}<ChevronDown size={14} aria-hidden className={open ? 'rotate-180' : ''} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 保護者向け：お子さまがAIに、いつ・何を質問し、AIが何と返したかを日付ごとに表示する。 */
export default function ParentMessagesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');

  const fetchPage = useCallback(async (targetId: string, beforeId = '') => {
    if (!user) throw new Error('not-signed-in');
    const params = new URLSearchParams();
    if (targetId) params.set('student_id', targetId);
    if (beforeId) params.set('before_id', beforeId);
    const response = await fetch(`/api/parent/chat-history?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'chat-history-load-failed');
    return data as { students: Student[]; student_id: string; messages: ChatMessage[]; has_more: boolean };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError('');
    fetchPage(studentId)
      .then(data => {
        if (!active) return;
        setStudents(data.students || []);
        // 最初は最後に選んだお子さまを表示する（別の子なら、その子のやりとりを読み込み直す）。
        if (!studentId && data.student_id) {
          const preferred = pickChildId(user.uid, (data.students || []).map(student => student.id), data.student_id);
          setStudentId(preferred);
          if (preferred !== data.student_id) return;
        }
        setMessages(data.messages || []);
        setHasMore(Boolean(data.has_more));
      })
      .catch(() => { if (active) setError('AIとのやりとりを読み込めませんでした。通信状態を確認して、もう一度お試しください。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, studentId, fetchPage, reload]);

  const loadMore = async () => {
    const last = messages[messages.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(studentId, last.id);
      setMessages(current => [...current, ...(data.messages || []).filter(item => !current.some(existing => existing.id === item.id))]);
      setHasMore(Boolean(data.has_more));
    } catch {
      toast.error('続きを読み込めませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setLoadingMore(false);
    }
  };

  const exchanges = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return toExchanges(messages).filter(exchange => !text || `${exchange.question?.content || ''}\n${exchange.answer?.content || ''}`.toLowerCase().includes(text));
  }, [messages, keyword]);

  const groups = useMemo(() => {
    const result: { key: string; at: number; items: Exchange[] }[] = [];
    exchanges.forEach(exchange => {
      const key = exchange.at ? dateKey(exchange.at) : 'unknown';
      const group = result.find(item => item.key === key);
      if (group) group.items.push(exchange); else result.push({ key, at: exchange.at, items: [exchange] });
    });
    return result;
  }, [exchanges]);

  const studentName = students.find(student => student.id === studentId)?.student_name || 'お子さま';
  const latest = exchanges[0]?.at;

  return (
    <div className="space-y-5">
      <ParentPageHeader
        eyebrow="AIチューター"
        title="AI学習履歴"
        description="お子さまがAIチューターに、いつ・何を質問し、AIがどう返信したかを確認できます。家庭での声かけのヒントにご活用ください。"
        icon={MessageCircle}
      />

      <ChildSwitcher
        options={students.map(student => ({ id: student.id, name: student.student_name, grade: student.grade }))}
        value={studentId}
        onChange={id => { setMessages([]); setStudentId(id); }}
      />

      <ParentCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-base font-bold text-fg">{studentName}さんのやりとり</p>
            <p className="text-xs text-fg-muted">
              {loading ? '読み込み中…' : `表示中 ${exchanges.length}件${latest ? ` ・ 最後の利用 ${dayLabel(latest)} ${timeLabel(latest)}` : ''}`}
            </p>
          </div>
          <label className="flex min-h-11 w-full items-center gap-2 rounded-input border border-line bg-surface px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 sm:w-72">
            <Search size={16} className="text-fg-muted" aria-hidden />
            <span className="sr-only">ことばで探す</span>
            <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="ことばで探す（例：二次関数）" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>

        {loading ? (
          <ListSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReload(value => value + 1)} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={keyword ? Search : MessageCircle}
            title={keyword ? '該当するやりとりはありません。' : 'AIとのやりとりはまだありません。'}
            description={keyword ? 'ほかのことばで探してみてください。' : 'お子さまがAIチューターに質問すると、ここに表示されます。'}
          />
        ) : (
          <div className="space-y-6">
            {groups.map(group => (
              <section key={group.key}>
                <h3 className="sticky top-16 z-10 mb-3 flex items-center justify-between rounded-btn bg-accent px-4 py-2 text-sm font-bold text-accent-ink">
                  <span>{group.at ? dayLabel(group.at) : '日時不明'}</span>
                  <span className="text-xs text-accent-ink/80">{group.items.length}件</span>
                </h3>
                <ol className="space-y-4">
                  {group.items.map(exchange => (
                    <li key={exchange.id} className="space-y-3 rounded-card border border-line p-3 sm:p-4">
                      {exchange.question && <MessageBubble message={exchange.question} kind="question" />}
                      {exchange.answer
                        ? <MessageBubble message={exchange.answer} kind="answer" />
                        : exchange.question?.message_type !== 'stamp' && <p className="pl-11 text-xs text-fg-muted">AIの返信は記録されていません。</p>}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            {hasMore && (
              <Button variant="secondary" fullWidth onClick={loadMore} loading={loadingMore}>もっと前のやりとりを見る</Button>
            )}
          </div>
        )}
      </ParentCard>
    </div>
  );
}
