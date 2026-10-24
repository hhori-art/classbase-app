'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, query, where, orderBy, limit, getDocs, onSnapshot
} from 'firebase/firestore';
import { 
  MessageCircle, Heart, MessageSquare, Plus, Send, Loader2, 
  ChevronDown, ChevronUp, UserCircle, X, Trash2, PlusCircle,
  BarChart2, MessagesSquare, LayoutGrid, Flag, Hourglass
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, StatusPill, useToast } from '@/app/components/ui';
import { COMMUNITY_REPORT_REASONS, type CommunityReportReason } from '@/lib/community-reports';

type ReportTarget = { type: 'topic' | 'comment'; topicId: string; commentId?: string; excerpt: string };
type PendingTopic = { id: string; title: string; type: 'thread' | 'vote'; created_at_ms: number };
const reportKey = (target: Pick<ReportTarget, 'type' | 'topicId' | 'commentId'>) => `${target.type}_${target.topicId}_${target.commentId || ''}`;

const FILTER_ITEMS = [
  { id: 'all', label: 'すべての投稿', icon: LayoutGrid, color: 'text-fg-muted' },
  { id: 'thread', label: 'スレッド (会話)', icon: MessagesSquare, color: 'text-sky-500' },
  { id: 'vote', label: '投票アンケート', icon: BarChart2, color: 'text-amber-500' },
] as const;

export default function CommunityPage() {
  const { user, profile } = useAuth();
  
  // ユーザー名
  const currentName = profile?.student_name || user?.displayName || '名無し';
  const uid = user?.uid;

  const [topics, setTopics] = useState<any[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState(false);
  const toast = useToast();
  const [filterType, setFilterType] = useState<'all' | 'thread' | 'vote'>('all');

  // 投稿用
  const [isPosting, setIsPosting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'thread' | 'vote'>('thread');
  const [voteOptions, setVoteOptions] = useState(['', '']); 
  const [postLoading, setPostLoading] = useState(false);

  // 詳細・コメント用
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  // 通報（未成年の安全のため）。送っても自動では消えず、先生・管理者が確認する。
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState<CommunityReportReason | ''>('');
  const [reportSending, setReportSending] = useState(false);
  const [reportedKeys, setReportedKeys] = useState<Set<string>>(() => new Set());

  // 自分の申請中（まだ承認されていない）投稿
  const [pendingTopics, setPendingTopics] = useState<PendingTopic[] | null>(null);
  const [pendingError, setPendingError] = useState(false);

  // 初期ロード
  const fetchTopics = useCallback(async () => {
    setTopicsLoading(true);
    setTopicsError(false);
    try {
      const q = query(collection(db, 'community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'), limit(50));
      const snap = await getDocs(q);
      setTopics(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error(error);
      setTopicsError(true);
    } finally {
      setTopicsLoading(false);
    }
  }, []);
  useEffect(() => {
    void fetchTopics();
  }, [fetchTopics]);

  const fetchPendingTopics = useCallback(async () => {
    if (!user) return;
    setPendingError(false);
    try {
      const res = await fetch('/api/student/community', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'pending-failed');
      setPendingTopics(Array.isArray(data.topics) ? data.topics : []);
    } catch (error) {
      console.warn(error);
      setPendingError(true);
    }
  }, [user]);
  useEffect(() => {
    void fetchPendingTopics();
  }, [fetchPendingTopics]);

  // コメント監視
  useEffect(() => {
    if (!expandedTopicId) {
      setComments([]);
      return;
    }
    const q = query(collection(db, 'community_topics', expandedTopicId, 'comments'), orderBy('created_at', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [expandedTopicId]);

  // フィルタリング
  const filteredTopics = topics.filter(topic => {
    if (filterType === 'all') return true;
    return topic.type === filterType;
  });

  // 投票選択肢操作
  const addOption = () => { if (voteOptions.length < 5) setVoteOptions([...voteOptions, '']); };
  const removeOption = (index: number) => { if (voteOptions.length > 2) setVoteOptions(voteOptions.filter((_, i) => i !== index)); };
  const changeOption = (index: number, val: string) => { const n = [...voteOptions]; n[index] = val; setVoteOptions(n); };

  // --- アクション ---
  const postCommunityAction = async (payload: Record<string, unknown>) => {
    const token = await user?.getIdToken();
    const res = await fetch('/api/student/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'community-action-failed');
    return data;
  };

  const handlePostSubmit = async () => {
    if (!newTitle.trim()) return toast.error('タイトルを入力してください');
    if (newType === 'vote' && voteOptions.some(o => !o.trim())) return toast.error('空欄の選択肢があります');
    if (!uid) return;

    setPostLoading(true);
    try {
      await postCommunityAction({
        action: 'create_topic',
        title: newTitle,
        type: newType,
        options: newType === 'vote' ? voteOptions : [],
      });
      toast.success('申請しました！承認をお待ちください。');
      setIsPosting(false); setNewTitle(''); setVoteOptions(['', '']);
      void fetchPendingTopics();
    } catch (e) { toast.error('投稿を申請できませんでした。時間を置いてもう一度お試しください。'); } finally { setPostLoading(false); }
  };

  const handleLike = async (e: React.MouseEvent, topic: any) => {
    e.stopPropagation();
    if (!uid || topic.liked_by?.includes(uid)) return;
    setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, likes: (t.likes || 0) + 1, liked_by: [...(t.liked_by || []), uid] } : t));

    try {
      await postCommunityAction({ action: 'like', topic_id: topic.id });
    } catch (e) { console.error(e); toast.error('いいねできませんでした。'); }
  };

  const handleVote = async (topicId: string, optionIndex: number) => {
    if (!uid) return;
    try {
      await postCommunityAction({ action: 'vote', topic_id: topicId, option_index: optionIndex });
      setTopics(prev => prev.map(t => {
        if (t.id !== topicId) return t;
        const newVotes = { ...t.votes };
        newVotes[optionIndex] = (newVotes[optionIndex] || 0) + 1;
        return { ...t, votes: newVotes, voted_by: [...(t.voted_by || []), uid] };
      }));
    } catch (e) { toast.error('投票できませんでした。もう一度お試しください。'); }
  };

  const handleCommentSubmit = async () => {
    if (!newComment.trim() || !expandedTopicId || !uid) return;
    setCommentLoading(true);
    try {
      await postCommunityAction({ action: 'comment', topic_id: expandedTopicId, text: newComment });
      setNewComment('');
    } catch (e) { toast.error('コメントを送信できませんでした。もう一度お試しください。'); } finally { setCommentLoading(false); }
  };

  const openReport = (event: React.MouseEvent, target: ReportTarget) => {
    event.stopPropagation();
    setReportReason('');
    setReportTarget(target);
  };

  const submitReport = async () => {
    if (!reportTarget || !reportReason) return;
    setReportSending(true);
    try {
      await postCommunityAction({
        action: 'report',
        target_type: reportTarget.type,
        topic_id: reportTarget.topicId,
        ...(reportTarget.commentId ? { comment_id: reportTarget.commentId } : {}),
        reason: reportReason,
      });
      setReportedKeys(prev => new Set(prev).add(reportKey(reportTarget)));
      setReportTarget(null);
      toast.success('通報しました。先生が確認します。教えてくれてありがとう。');
    } catch (e) {
      console.error(e);
      toast.error('通報を送れませんでした。時間を置いてもう一度お試しください。');
    } finally {
      setReportSending(false);
    }
  };

  const reportButton = (target: ReportTarget) => {
    const reported = reportedKeys.has(reportKey(target));
    return (
      <button
        type="button"
        onClick={(event) => reported ? event.stopPropagation() : openReport(event, target)}
        disabled={reported}
        aria-label={reported ? '通報済み' : target.type === 'topic' ? 'この投稿を通報する' : 'このコメントを通報する'}
        className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-bold text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-fg-muted"
      >
        <Flag size={14} aria-hidden /> {reported ? '通報済み' : '通報'}
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <Modal
        open={Boolean(reportTarget)}
        onClose={() => { if (!reportSending) setReportTarget(null); }}
        title={reportTarget?.type === 'comment' ? 'このコメントを通報しますか？' : 'この投稿を通報しますか？'}
        description="いやな気持ちになった・危ないと思った投稿を先生に知らせます。だれが通報したかは、ほかの生徒にはわかりません。"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReportTarget(null)} disabled={reportSending}>やめる</Button>
            <Button variant="danger" onClick={submitReport} loading={reportSending} disabled={!reportReason} icon={<Flag size={16} aria-hidden />}>通報する</Button>
          </>
        )}
      >
        {reportTarget && (
          <div className="space-y-3">
            <p className="line-clamp-3 rounded-btn bg-canvas p-3 text-sm text-fg">{reportTarget.excerpt}</p>
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-fg">理由をえらんでください</legend>
              <div className="space-y-2">
                {(Object.entries(COMMUNITY_REPORT_REASONS) as [CommunityReportReason, string][]).map(([value, label]) => (
                  <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-btn border px-3 py-2 text-sm font-bold transition-colors ${reportReason === value ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-surface text-fg hover:bg-canvas'}`}>
                    <input type="radio" name="report-reason" value={value} checked={reportReason === value} onChange={() => setReportReason(value)} className="h-4 w-4 accent-rose-600" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-fg-muted">こわいことや困ったことがあったら、すぐに先生やおうちの人に相談してね。</p>
          </div>
        )}
      </Modal>

      <PageHeader tone="hero" title="交流掲示板" description="ここは参加者同士に公開される交流の場です。運営からの正式連絡は「お知らせ」、教室への個別連絡は専用画面で確認してください。" icon={MessageCircle} backHref="/student" />

      {/* レスポンシブレイアウト: PCでは2カラム、スマホでは1カラム */}
      <div className="flex flex-col items-start gap-6 lg:flex-row">

        {/* === 左サイドバー (投稿フォーム & フィルタ) === */}
        <div className="z-20 w-full space-y-5 lg:sticky lg:top-8 lg:w-80 lg:shrink-0">

          {/* 投稿作成カード */}
          {!isPosting ? (
            <button
              onClick={() => setIsPosting(true)}
              className="group flex min-h-14 w-full items-center justify-center gap-3 rounded-card bg-accent p-4 font-bold text-accent-ink shadow-card transition-all hover:bg-accent-hover active:scale-95"
            >
              <div className="rounded-full bg-white/20 p-2 transition-transform group-hover:rotate-90">
                <Plus size={22} aria-hidden />
              </div>
              新しい話題を投稿
            </button>
          ) : (
            <div className="cb-card p-card animate-in zoom-in-95 duration-200">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-fg">投稿を作成</h3>
                  <IconButton size="sm" label="投稿作成を閉じる" onClick={() => setIsPosting(false)}><X size={18} aria-hidden /></IconButton>
                </div>

                <input
                  type="text"
                  placeholder="タイトルを入力..."
                  aria-label="タイトル"
                  className="min-h-11 w-full rounded-input border border-line bg-slate-50 p-3 text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />

                <div className="flex gap-2 rounded-btn bg-slate-100 p-1">
                  <button onClick={() => setNewType('thread')} className={`min-h-9 flex-1 rounded-btn text-xs font-bold transition-all ${newType === 'thread' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted hover:text-fg'}`}>💬 スレッド</button>
                  <button onClick={() => setNewType('vote')} className={`min-h-9 flex-1 rounded-btn text-xs font-bold transition-all ${newType === 'vote' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted hover:text-fg'}`}>📊 投票</button>
                </div>

                {newType === 'vote' && (
                  <div className="space-y-2 border-l-2 border-accent/30 pl-2">
                    <p className="mb-1 text-xs font-bold text-fg-muted">選択肢 (最大5つ)</p>
                    {voteOptions.map((opt, i) => (
                      <div key={i} className="flex gap-2">
                        <input type="text" placeholder={`選択肢 ${i+1}`} aria-label={`選択肢 ${i+1}`} className="min-h-9 flex-1 rounded-input border border-line bg-surface p-2 text-sm text-fg focus:border-accent focus:outline-none" value={opt} onChange={(e) => changeOption(i, e.target.value)} />
                        {voteOptions.length > 2 && <IconButton size="sm" label={`選択肢 ${i+1}を削除`} onClick={() => removeOption(i)} className="hover:text-danger"><Trash2 size={16} aria-hidden /></IconButton>}
                      </div>
                    ))}
                    {voteOptions.length < 5 && <button onClick={addOption} className="flex min-h-9 items-center gap-1 text-xs font-bold text-accent hover:text-accent-hover"><PlusCircle size={14} aria-hidden /> 追加</button>}
                  </div>
                )}

                <button onClick={handlePostSubmit} disabled={postLoading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-btn bg-accent text-sm font-bold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
                  {postLoading ? <Loader2 className="animate-spin" size={16} aria-hidden /> : <Send size={16} aria-hidden />} 申請する
                </button>
              </div>
            </div>
          )}

          {/* フィルタ (PC用: 縦並び / スマホ用: 横スクロール) */}
          <div className="cb-card no-scrollbar flex gap-2 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
            {FILTER_ITEMS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                aria-pressed={filterType === f.id}
                className={`flex min-h-11 items-center gap-3 whitespace-nowrap rounded-btn px-4 text-left text-sm font-bold transition-all ${
                  filterType === f.id
                  ? 'bg-accent text-accent-ink shadow-sm'
                  : 'text-fg-muted hover:bg-accent-soft'
                }`}
              >
                <f.icon size={18} className={filterType === f.id ? 'text-accent-ink' : f.color} aria-hidden />
                {f.label}
              </button>
            ))}
          </div>

          {/* 自分の申請中の投稿（承認されるまでは自分にだけ見える） */}
          <section aria-labelledby="pending-topics-heading" className="cb-card p-card">
            <h3 id="pending-topics-heading" className="mb-2 flex items-center gap-2 text-sm font-bold text-fg">
              <Hourglass size={16} className="text-warning" aria-hidden /> 自分の申請中の投稿
            </h3>
            {pendingError ? (
              <ErrorState title="申請中の投稿を読み込めませんでした" onRetry={() => void fetchPendingTopics()} className="py-4" />
            ) : pendingTopics === null ? (
              <ListSkeleton rows={1} />
            ) : pendingTopics.length === 0 ? (
              <p className="text-xs text-fg-muted">申請中の投稿はありません。投稿すると、先生が確認してから公開されます。</p>
            ) : (
              <ul className="space-y-2">
                {pendingTopics.map(topic => (
                  <li key={topic.id} className="rounded-btn border border-line bg-canvas p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <StatusPill tone="warning">確認待ち</StatusPill>
                      <span className="text-xs text-fg-muted">{topic.created_at_ms ? formatDate(topic.created_at_ms) : ''}</span>
                    </div>
                    <p className="line-clamp-2 text-sm font-bold text-fg">{topic.type === 'vote' ? '📊 ' : '💬 '}{topic.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* === 右メインコンテンツ (タイムライン) === */}
        <div className="min-w-0 w-full flex-1 space-y-4">
          {topicsLoading ? (
            <ListSkeleton rows={4} />
          ) : topicsError ? (
            <ErrorState onRetry={() => void fetchTopics()} />
          ) : filteredTopics.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="表示できる投稿がありません" description="フィルタを変更するか、新しく投稿してみましょう！" className="py-16" />
          ) : (
            filteredTopics.map((topic) => {
              const isLiked = uid ? topic.liked_by?.includes(uid) : false;
              const isExpanded = expandedTopicId === topic.id;
              const isVoted = uid ? topic.voted_by?.includes(uid) : false;
              const totalVotes = Object.values(topic.votes || {}).reduce((a: any, b: any) => a + b, 0) as number;

              return (
                <div key={topic.id} className={`cb-card overflow-hidden transition-all duration-300 ${isExpanded ? 'outline outline-2 outline-accent/40' : ''}`}>

                  {/* カードヘッダー */}
                  <div onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)} className="group relative cursor-pointer p-5">
                    {topic.reward_given && <div className="absolute right-0 top-0 rounded-bl-card bg-amber-400 px-3 py-1 text-xs font-bold text-white shadow-sm">👑 殿堂入り</div>}

                    <div className="mb-3 flex items-center gap-3">
                      <span className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold ${topic.type === 'vote' ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-sky-100 bg-sky-50 text-sky-700'}`}>
                        {topic.type === 'vote' ? <BarChart2 size={12} aria-hidden /> : <MessagesSquare size={12} aria-hidden />}
                        {topic.type === 'vote' ? '投票' : 'スレッド'}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-bold text-fg-muted">
                        <UserCircle size={14} aria-hidden /> {topic.creator_name}
                      </span>
                      <span className="ml-auto text-xs text-fg-muted">
                        {topic.created_at?.toDate ? formatDate(topic.created_at.toDate(), { withYear: true }) : ''}
                      </span>
                    </div>

                    <h4 className="mb-4 text-lg font-bold leading-relaxed text-fg transition-colors group-hover:text-accent">{topic.title}</h4>

                    <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                        <button onClick={(e) => handleLike(e, topic)} aria-label={`いいね ${topic.likes || 0}件`} aria-pressed={isLiked} className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition-all ${isLiked ? 'bg-rose-50 text-rose-500' : 'bg-slate-50 text-fg-muted hover:bg-slate-100'}`}>
                          <Heart size={16} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "motion-safe:animate-bounce-short" : ""} aria-hidden /> {topic.likes || 0}
                        </button>
                        <div className="flex items-center gap-1">
                          {topic.creator_uid !== uid && reportButton({ type: 'topic', topicId: topic.id, excerpt: String(topic.title || '') })}
                          <div className={`flex items-center gap-1 text-xs font-bold transition-colors ${isExpanded ? 'text-accent' : 'text-fg-muted group-hover:text-accent'}`}>
                            <MessageSquare size={16} aria-hidden /> コメント・詳細 {isExpanded ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                          </div>
                        </div>
                    </div>
                  </div>

                  {/* 展開エリア */}
                  {isExpanded && (
                    <div className="border-t border-line bg-slate-50/50 p-5 animate-in slide-in-from-top-4 duration-300">

                      {/* 投票 UI */}
                      {topic.type === 'vote' && topic.options && (
                        <div className="mb-8 space-y-3 rounded-card border border-line bg-surface p-4 shadow-sm">
                          <h5 className="mb-2 flex items-center gap-2 text-xs font-bold text-fg-muted"><BarChart2 size={14} aria-hidden /> アンケート結果 ({totalVotes}票)</h5>
                          {topic.options.map((opt: string, i: number) => {
                            const count = (topic.votes && topic.votes[i]) || 0;
                            const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                            return (
                              <button key={i} disabled={isVoted} onClick={() => handleVote(topic.id, i)} className={`relative min-h-11 w-full overflow-hidden rounded-btn border p-3 text-left transition-all ${isVoted ? 'border-line bg-slate-50' : 'border-line bg-surface hover:border-accent/30 hover:bg-accent-soft'}`}>
                                {isVoted && <div className="absolute left-0 top-0 h-full bg-accent-soft transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }} />}
                                <div className="relative z-10 flex items-center justify-between">
                                  <span className="text-sm font-bold text-fg">{opt}</span>
                                  {isVoted && <span className="text-sm font-bold text-accent">{percentage}% <span className="ml-1 text-xs text-fg-muted">({count}票)</span></span>}
                                </div>
                              </button>
                            );
                          })}
                          {isVoted && <p className="mt-2 text-center text-xs font-bold text-fg-muted">投票ありがとうございました！</p>}
                        </div>
                      )}

                      {/* コメント UI */}
                      <div>
                        <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-fg-muted"><MessagesSquare size={14} aria-hidden /> コメント ({comments.length})</h5>
                        <div className="custom-scrollbar mb-4 max-h-[400px] space-y-3 overflow-y-auto pr-2">
                          {comments.length === 0 ? <EmptyState title="コメントはまだありません" description="最初のコメントを書いてみましょう！" className="bg-surface py-6" /> : comments.map((c) => (
                            <div key={c.id} className="rounded-btn border border-line bg-surface p-3.5 text-sm shadow-sm">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1 text-xs font-bold text-fg-muted"><UserCircle size={12} aria-hidden /> {c.name}</span>
                                {c.uid !== uid && reportButton({ type: 'comment', topicId: topic.id, commentId: c.id, excerpt: String(c.text || '') })}
                              </div>
                              <div className="leading-relaxed text-fg">{c.text}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 rounded-card border border-line bg-surface p-2 shadow-sm transition-all focus-within:ring-2 focus-within:ring-accent/30">
                          <input
                            type="text"
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="コメントを入力..."
                            aria-label="コメント"
                            className="flex-1 bg-transparent p-2 text-sm text-fg outline-none placeholder:text-fg-muted/60"
                          />
                          <IconButton
                            variant="primary"
                            label="コメントを送信"
                            onClick={handleCommentSubmit}
                            disabled={commentLoading || !newComment.trim()}
                          >
                            {commentLoading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} className="ml-0.5" aria-hidden />}
                          </IconButton>
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
