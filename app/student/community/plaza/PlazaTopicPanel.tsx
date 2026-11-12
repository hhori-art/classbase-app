'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { BarChart2, Flag, Heart, Loader2, MessagesSquare, Send, UserCircle, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { formatDate } from '@/lib/format';
import { COMMUNITY_REPORT_REASONS, type CommunityReportReason } from '@/lib/community-reports';

/**
 * 交流広場で看板を開いたときの投稿の画面。中身は交流掲示板と同じ（いいね・投票・コメント・通報）。
 * スマホを縦持ちで90度回して見せているときも一緒に回るよう、Modal（body 直下に出る）は使わず、広場の中に出す。
 */

type ReportTarget = { type: 'topic' | 'comment'; commentId?: string; excerpt: string };

export function PlazaTopicPanel({ topic, uid, reportedKeys, onReported, onClose, onTopicChange, postAction }: {
  topic: any;
  uid: string;
  reportedKeys: Set<string>;
  onReported: (key: string) => void;
  onClose: () => void;
  onTopicChange: (topic: any) => void;
  postAction: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState<CommunityReportReason | ''>('');

  useEffect(() => {
    const q = query(collection(db, 'community_topics', topic.id, 'comments'), orderBy('created_at', 'asc'));
    return onSnapshot(q, snap => setComments(snap.docs.map(item => ({ id: item.id, ...item.data() }))), () => {
      setMessage({ tone: 'error', text: 'コメントを読み込めませんでした。' });
    });
  }, [topic.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLiked = Boolean(topic.liked_by?.includes(uid));
  const isVoted = Boolean(topic.voted_by?.includes(uid));
  const totalVotes = Object.values(topic.votes || {}).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
  const reportKey = (target: ReportTarget) => `${target.type}_${topic.id}_${target.commentId || ''}`;

  const like = async () => {
    if (isLiked) return;
    onTopicChange({ ...topic, likes: (topic.likes || 0) + 1, liked_by: [...(topic.liked_by || []), uid] });
    try {
      await postAction({ action: 'like', topic_id: topic.id });
    } catch {
      onTopicChange(topic);
      setMessage({ tone: 'error', text: 'いいねできませんでした。' });
    }
  };

  const vote = async (index: number) => {
    if (isVoted) return;
    try {
      await postAction({ action: 'vote', topic_id: topic.id, option_index: index });
      const votes = { ...(topic.votes || {}) };
      votes[index] = (votes[index] || 0) + 1;
      onTopicChange({ ...topic, votes, voted_by: [...(topic.voted_by || []), uid] });
    } catch {
      setMessage({ tone: 'error', text: '投票できませんでした。もう一度お試しください。' });
    }
  };

  const sendComment = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    setMessage(null);
    try {
      await postAction({ action: 'comment', topic_id: topic.id, text: newComment });
      setNewComment('');
    } catch {
      setMessage({ tone: 'error', text: 'コメントを送信できませんでした。もう一度お試しください。' });
    } finally {
      setSending(false);
    }
  };

  const sendReport = async () => {
    if (!reportTarget || !reportReason) return;
    setSending(true);
    try {
      await postAction({
        action: 'report',
        target_type: reportTarget.type,
        topic_id: topic.id,
        ...(reportTarget.commentId ? { comment_id: reportTarget.commentId } : {}),
        reason: reportReason,
      });
      onReported(reportKey(reportTarget));
      setReportTarget(null);
      setMessage({ tone: 'ok', text: '通報しました。先生が確認します。教えてくれてありがとう。' });
    } catch {
      setMessage({ tone: 'error', text: '通報を送れませんでした。時間を置いてもう一度お試しください。' });
    } finally {
      setSending(false);
    }
  };

  const reportButton = (target: ReportTarget) => {
    const reported = reportedKeys.has(reportKey(target));
    return (
      <button
        type="button"
        disabled={reported}
        onClick={() => { setReportReason(''); setReportTarget(target); }}
        aria-label={reported ? '通報済み' : target.type === 'topic' ? 'この投稿を通報する' : 'このコメントを通報する'}
        className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-bold text-fg-muted hover:bg-danger-soft hover:text-danger disabled:hover:bg-transparent disabled:hover:text-fg-muted"
      >
        <Flag size={14} aria-hidden /> {reported ? '通報済み' : '通報'}
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-20 flex items-stretch justify-end bg-black/30" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="plaza-topic-title" className="flex h-full w-full max-w-md select-text flex-col bg-surface shadow-2xl">
        <div className="flex items-start gap-2 border-b border-line p-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-bold text-fg-muted">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${topic.type === 'vote' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                {topic.type === 'vote' ? <BarChart2 size={12} aria-hidden /> : <MessagesSquare size={12} aria-hidden />}
                {topic.type === 'vote' ? '投票' : 'スレッド'}
              </span>
              <span className="inline-flex items-center gap-1"><UserCircle size={12} aria-hidden /> {topic.creator_name}</span>
              {topic.created_at?.toDate && <span>{formatDate(topic.created_at.toDate(), { withYear: true })}</span>}
            </div>
            <h2 id="plaza-topic-title" className="text-base font-bold leading-relaxed text-fg">{topic.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じて広場にもどる" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-fg-muted hover:bg-canvas">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
          <div className="flex items-center justify-between">
            <button type="button" onClick={like} aria-pressed={isLiked} aria-label={`いいね ${topic.likes || 0}件`} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold ${isLiked ? 'bg-rose-50 text-rose-500' : 'bg-slate-50 text-fg-muted hover:bg-slate-100'}`}>
              <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} aria-hidden /> {topic.likes || 0}
            </button>
            {topic.creator_uid !== uid && reportButton({ type: 'topic', excerpt: String(topic.title || '') })}
          </div>

          {message && (
            <p role="status" className={`rounded-btn p-2 text-xs font-bold ${message.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{message.text}</p>
          )}

          {reportTarget && (
            <fieldset className="space-y-2 rounded-card border border-danger/40 bg-danger-soft/40 p-3">
              <legend className="px-1 text-sm font-bold text-fg">{reportTarget.type === 'comment' ? 'このコメントを通報しますか？' : 'この投稿を通報しますか？'}</legend>
              <p className="line-clamp-2 text-xs text-fg-muted">{reportTarget.excerpt}</p>
              <p className="text-xs text-fg-muted">だれが通報したかは、ほかの生徒にはわかりません。理由をえらんでください。</p>
              {(Object.entries(COMMUNITY_REPORT_REASONS) as [CommunityReportReason, string][]).map(([value, label]) => (
                <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-btn border px-3 text-sm font-bold ${reportReason === value ? 'border-danger bg-surface text-danger' : 'border-line bg-surface text-fg'}`}>
                  <input type="radio" name="plaza-report-reason" value={value} checked={reportReason === value} onChange={() => setReportReason(value)} className="h-4 w-4 accent-rose-600" />
                  {label}
                </label>
              ))}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReportTarget(null)} disabled={sending} className="min-h-11 rounded-btn px-4 text-sm font-bold text-fg-muted hover:bg-surface">やめる</button>
                <button type="button" onClick={sendReport} disabled={!reportReason || sending} className="inline-flex min-h-11 items-center gap-1 rounded-btn bg-danger px-4 text-sm font-bold text-white disabled:opacity-50">
                  {sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Flag size={16} aria-hidden />} 通報する
                </button>
              </div>
              <p className="text-xs text-fg-muted">こわいことや困ったことがあったら、すぐに先生やおうちの人に相談してね。</p>
            </fieldset>
          )}

          {topic.type === 'vote' && Array.isArray(topic.options) && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1 text-xs font-bold text-fg-muted"><BarChart2 size={14} aria-hidden /> アンケート（{totalVotes}票）</h3>
              {topic.options.map((option: string, index: number) => {
                const count = Number(topic.votes?.[index] || 0);
                const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                return (
                  <button key={index} type="button" disabled={isVoted} onClick={() => vote(index)} className="relative min-h-11 w-full overflow-hidden rounded-btn border border-line bg-surface p-3 text-left hover:border-accent/40 disabled:hover:border-line">
                    {isVoted && <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${percentage}%` }} aria-hidden />}
                    <span className="relative flex items-center justify-between gap-2 text-sm font-bold text-fg">
                      <span>{option}</span>
                      {isVoted && <span className="text-accent">{percentage}%<span className="ml-1 text-xs text-fg-muted">（{count}票）</span></span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <h3 className="mb-2 flex items-center gap-1 text-xs font-bold text-fg-muted"><MessagesSquare size={14} aria-hidden /> コメント（{comments.length}）</h3>
            {comments.length === 0 ? (
              <p className="rounded-btn bg-canvas p-3 text-xs text-fg-muted">コメントはまだありません。最初のコメントを書いてみましょう！</p>
            ) : (
              <ul className="space-y-2">
                {comments.map(comment => (
                  <li key={comment.id} className="rounded-btn border border-line bg-canvas p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-fg-muted"><UserCircle size={12} aria-hidden /> {comment.name}</span>
                      {comment.uid !== uid && reportButton({ type: 'comment', commentId: comment.id, excerpt: String(comment.text || '') })}
                    </div>
                    <p className="leading-relaxed text-fg">{comment.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-line p-2">
          <input
            type="text"
            value={newComment}
            onChange={event => setNewComment(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void sendComment(); }}
            placeholder="コメントを入力..."
            aria-label="コメント"
            maxLength={500}
            className="min-h-11 flex-1 rounded-input border border-line bg-canvas px-3 text-sm text-fg outline-none focus:border-accent"
          />
          <button type="button" onClick={sendComment} disabled={sending || !newComment.trim()} aria-label="コメントを送信" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-btn bg-accent text-accent-ink disabled:opacity-50">
            {sending ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
          </button>
        </div>
      </section>
    </div>
  );
}
