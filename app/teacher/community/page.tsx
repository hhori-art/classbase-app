'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, query, where, orderBy, limit, onSnapshot
} from 'firebase/firestore';
import { 
  MessageCircle, Heart, MessageSquare, Plus, Send,
  ChevronDown, ChevronUp, UserCircle, X, Trash2, PlusCircle,
  BarChart2, MessagesSquare, LayoutGrid, Ghost, BookOpen, Briefcase, Users
} from 'lucide-react';
import {
  Button, IconButton, Card, PageHeader, useToast, useConfirm,
  ListSkeleton, EmptyState, ErrorState,
} from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';

// カテゴリ定義
const CATEGORIES = {
  instruction: { label: '指導・教材', icon: BookOpen, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', active: 'bg-emerald-600 text-white' },
  operation: { label: '業務相談', icon: Briefcase, color: 'bg-sky-50 text-sky-600 border-sky-100', active: 'bg-sky-600 text-white' },
  chat: { label: '雑談', icon: MessageCircle, color: 'bg-amber-50 text-amber-600 border-amber-100', active: 'bg-amber-500 text-white' }
};

export default function TeacherCommunityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const uid = user?.uid;

  const [topics, setTopics] = useState<any[]>([]);
  const [topicsLoaded, setTopicsLoaded] = useState(false);
  const [topicsError, setTopicsError] = useState(false);
  const [filterCategory, setFilterCategory] = useState<'all' | 'instruction' | 'operation' | 'chat'>('all');

  // 投稿用
  const [isPosting, setIsPosting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'thread' | 'vote'>('thread');
  const [newCategory, setNewCategory] = useState<'instruction' | 'operation' | 'chat'>('instruction');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [voteOptions, setVoteOptions] = useState(['', '']); 
  const [postLoading, setPostLoading] = useState(false);

  // 詳細・コメント用
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [newCommentIsAnonymous, setNewCommentIsAnonymous] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);

  // 初期ロード (講師用コミュニティから取得)
  useEffect(() => {
    // 講師用は即時反映とするため is_approved は最初から true で運用
    const q = query(collection(db, 'teacher_community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'), limit(50));
    
    // リアルタイム更新
    const unsubscribe = onSnapshot(q, (snap) => {
      setTopics(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTopicsLoaded(true);
      setTopicsError(false);
    }, (error) => {
      console.error(error);
      setTopicsError(true);
    });
    return () => unsubscribe();
  }, []);

  // コメント監視
  useEffect(() => {
    if (!expandedTopicId) {
      setComments([]);
      return;
    }
    const q = query(collection(db, 'teacher_community_topics', expandedTopicId, 'comments'), orderBy('created_at', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [expandedTopicId]);

  // フィルタリング
  const filteredTopics = topics.filter(topic => {
    if (filterCategory === 'all') return true;
    return topic.category === filterCategory;
  });

  // 投票選択肢操作
  const addOption = () => { if (voteOptions.length < 5) setVoteOptions([...voteOptions, '']); };
  const removeOption = (index: number) => { if (voteOptions.length > 2) setVoteOptions(voteOptions.filter((_, i) => i !== index)); };
  const changeOption = (index: number, val: string) => { const n = [...voteOptions]; n[index] = val; setVoteOptions(n); };

  // --- アクション ---

  const postCommunityAction = async (payload: Record<string, unknown>) => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('login-required');
    const response = await fetch('/api/teacher/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, audience: 'teacher' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'community-action-failed');
    return data;
  };

  const handlePostSubmit = async () => {
    if (!newTitle.trim()) return toast.error('タイトルまたは内容を入力してください');
    if (newType === 'vote' && voteOptions.some(o => !o.trim())) return toast.error('空欄の選択肢があります');
    if (!uid) return;

    setPostLoading(true);
    try {
      await postCommunityAction({
        action: 'create_topic',
        title: newTitle,
        type: newType,
        category: newCategory,
        is_anonymous: isAnonymous,
        options: newType === 'vote' ? voteOptions : null,
      });
      setIsPosting(false); 
      setNewTitle(''); 
      setVoteOptions(['', '']);
      setIsAnonymous(false);
    } catch (e) { toast.error('送信に失敗しました'); } finally { setPostLoading(false); }
  };

  // ★追加: トピックの削除機能
  const handleDeleteTopic = async (e: React.MouseEvent, topicId: string) => {
    e.stopPropagation(); // クリック時にトピックが展開されるのを防ぐ
    if (!(await confirm({
      title: 'この投稿を削除しますか？',
      message: '削除するとコメントや投票データも失われます。',
      tone: 'danger',
      confirmLabel: '削除する',
    }))) return;

    try {
      await postCommunityAction({ action: 'delete_topic', topic_id: topicId });
      if (expandedTopicId === topicId) {
        setExpandedTopicId(null);
      }
    } catch (error) {
      toast.error('削除に失敗しました。');
      console.error(error);
    }
  };

  // ★追加: コメントの削除機能
  const handleDeleteComment = async (commentId: string) => {
    if (!expandedTopicId) return;
    if (!(await confirm({ title: 'このコメントを削除しますか？', tone: 'danger', confirmLabel: '削除する' }))) return;

    try {
      await postCommunityAction({ action: 'delete_comment', topic_id: expandedTopicId, comment_id: commentId });
    } catch (error) {
      toast.error('コメントの削除に失敗しました。');
      console.error(error);
    }
  };

  const handleLike = async (e: React.MouseEvent, topic: any) => {
    e.stopPropagation();
    if (!uid || topic.liked_by?.includes(uid)) return;

    // オプティミスティック更新
    setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, likes: (t.likes || 0) + 1, liked_by: [...(t.liked_by || []), uid] } : t));

    try {
      await postCommunityAction({ action: 'like', topic_id: topic.id });
    } catch (e) { console.error(e); }
  };

  const handleVote = async (topicId: string, optionIndex: number) => {
    if (!uid) return;
    try {
      await postCommunityAction({ action: 'vote', topic_id: topicId, option_index: optionIndex });
    } catch (e) { toast.error('投票に失敗しました'); }
  };

  const handleCommentSubmit = async () => {
    if (!newComment.trim() || !expandedTopicId || !uid) return;
    setCommentLoading(true);
    try {
      await postCommunityAction({
        action: 'comment',
        topic_id: expandedTopicId,
        text: newComment, 
        is_anonymous: newCommentIsAnonymous,
      });
      setNewComment('');
      setNewCommentIsAnonymous(false);
    } catch (e) { toast.error('送信に失敗しました'); } finally { setCommentLoading(false); }
  };

  return (
    <div className="px-4 py-5 pb-40 text-fg sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          tone="plain"
          title="講師交流掲示板"
          icon={Users}
          description="講師同士に公開される交流掲示板です。運営からの正式連絡は「お知らせ」で確認してください。"
          backHref="/teacher"
        />

        {/* レスポンシブレイアウト: PCでは2カラム、スマホでは1カラム */}
        <div className="flex flex-col items-start gap-8 lg:flex-row">

          {/* === 左サイドバー (固定メニュー & 投稿フォーム) === */}
          <div className="z-20 w-full space-y-6 lg:sticky lg:top-8 lg:w-80 lg:shrink-0">

            {/* 投稿作成カード */}
            {!isPosting ? (
              <Button size="lg" fullWidth onClick={() => setIsPosting(true)} icon={<Plus size={22} aria-hidden />}>
                相談・話題を投稿する
              </Button>
            ) : (
              <Card className="border-accent/30">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-bold text-fg"><MessageSquare size={18} className="text-accent" aria-hidden /> 投稿を作成</h3>
                    <IconButton label="閉じる" size="sm" onClick={() => setIsPosting(false)}><X size={18} aria-hidden /></IconButton>
                  </div>

                  {/* カテゴリ選択 */}
                  <div>
                    <label className="mb-2 block text-xs font-bold text-fg-muted">カテゴリ</label>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(CATEGORIES).map(([key, cat]) => (
                        <button
                          type="button"
                          key={key}
                          aria-pressed={newCategory === key}
                          onClick={() => setNewCategory(key as any)}
                          className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-btn border py-2 text-xs font-bold transition-colors ${
                            newCategory === key ? cat.active : 'border-line bg-surface text-slate-500 hover:bg-canvas'
                          }`}
                        >
                          <cat.icon size={14} aria-hidden />
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* タイトル/内容入力 */}
                  <div>
                    <label htmlFor="community-new-title" className="mb-2 block text-xs font-bold text-fg-muted">内容</label>
                    <textarea
                      id="community-new-title"
                      placeholder="相談したいこと、共有したいこと..."
                      className="min-h-[100px] w-full resize-none rounded-input border border-line bg-surface p-3 text-sm font-medium outline-none transition-colors focus:border-accent"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>

                  {/* 形式切り替え */}
                  <div className="flex gap-2 rounded-btn bg-slate-100 p-1">
                    <button type="button" aria-pressed={newType === 'thread'} onClick={() => setNewType('thread')} className={`min-h-9 flex-1 rounded-input py-2 text-xs font-bold transition-colors ${newType === 'thread' ? 'bg-surface text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>💬 スレッド</button>
                    <button type="button" aria-pressed={newType === 'vote'} onClick={() => setNewType('vote')} className={`min-h-9 flex-1 rounded-input py-2 text-xs font-bold transition-colors ${newType === 'vote' ? 'bg-surface text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>📊 投票機能</button>
                  </div>

                  {newType === 'vote' && (
                    <div className="space-y-2 border-l-2 border-amber-100 pl-2">
                      <p className="mb-1 text-xs font-bold text-fg-muted">選択肢 (最大5つ)</p>
                      {voteOptions.map((opt, i) => (
                        <div key={i} className="flex gap-2">
                          <input type="text" placeholder={`選択肢 ${i+1}`} aria-label={`選択肢 ${i+1}`} className="min-h-9 flex-1 rounded-input border border-line bg-surface p-2 text-xs font-bold" value={opt} onChange={(e) => changeOption(i, e.target.value)} />
                          {voteOptions.length > 2 && (
                            <IconButton label={`選択肢 ${i+1} を削除`} size="sm" onClick={() => removeOption(i)} className="text-slate-400 hover:bg-danger-soft hover:text-danger">
                              <Trash2 size={16} aria-hidden />
                            </IconButton>
                          )}
                        </div>
                      ))}
                      {voteOptions.length < 5 && (
                        <Button variant="ghost" size="sm" onClick={addOption} icon={<PlusCircle size={14} aria-hidden />} className="text-amber-600">
                          追加
                        </Button>
                      )}
                    </div>
                  )}

                  {/* 匿名チェック */}
                  <div className="flex items-center gap-2 rounded-btn border border-line bg-canvas p-3">
                    <input
                      type="checkbox"
                      id="anon"
                      checked={isAnonymous}
                      onChange={(e) => setIsAnonymous(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                    />
                    <label htmlFor="anon" className="flex w-full cursor-pointer items-center gap-1 text-xs font-bold text-slate-600">
                      <Ghost size={14} className={isAnonymous ? 'text-accent' : 'text-slate-400'} aria-hidden /> 匿名で投稿する
                    </label>
                  </div>

                  <Button fullWidth loading={postLoading} onClick={handlePostSubmit} icon={<Send size={18} aria-hidden />}>
                    投稿する
                  </Button>
                </div>
              </Card>
            )}

            {/* カテゴリフィルタ */}
            <Card padded={false} className="no-scrollbar flex gap-2 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
              <button
                type="button"
                aria-pressed={filterCategory === 'all'}
                onClick={() => setFilterCategory('all')}
                className={`flex min-h-11 items-center gap-3 whitespace-nowrap rounded-btn px-4 py-3 text-left text-xs font-bold transition-colors ${
                  filterCategory === 'all' ? 'bg-slate-800 text-white shadow-md' : 'bg-surface text-slate-500 hover:bg-canvas'
                }`}
              >
                <LayoutGrid size={18} className={filterCategory === 'all' ? 'text-white' : 'text-slate-400'} aria-hidden /> すべて
              </button>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={filterCategory === key}
                  onClick={() => setFilterCategory(key as any)}
                  className={`flex min-h-11 items-center gap-3 whitespace-nowrap rounded-btn px-4 py-3 text-left text-xs font-bold transition-colors ${
                    filterCategory === key ? cat.active + ' shadow-md' : 'bg-surface text-slate-500 hover:bg-canvas'
                  }`}
                >
                  <cat.icon size={18} className={filterCategory === key ? 'text-white' : 'text-slate-400'} aria-hidden />
                  {cat.label}
                </button>
              ))}
            </Card>
          </div>

          {/* === 右メインコンテンツ (タイムライン) === */}
          <div className="min-w-0 flex-1 space-y-4">
            {topicsError ? (
              <ErrorState message="掲示板を読み込めませんでした。ページを再読み込みしてください。" />
            ) : !topicsLoaded ? (
              <ListSkeleton rows={4} />
            ) : filteredTopics.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="該当する投稿がありません"
                description="最初のトピックを作成してみましょう！"
              />
            ) : (
              filteredTopics.map((topic) => {
                const isLiked = uid ? topic.liked_by?.includes(uid) : false;
                const isExpanded = expandedTopicId === topic.id;
                const isVoted = uid ? topic.voted_by?.includes(uid) : false;
                const isMyTopic = uid === topic.creator_uid; // 自分が作成した投稿か判定
                const totalVotes = Object.values(topic.votes || {}).reduce((a: any, b: any) => a + b, 0) as number;

                // カテゴリ情報取得
                const categoryInfo = CATEGORIES[topic.category as keyof typeof CATEGORIES] || CATEGORIES.chat;

                return (
                  <Card key={topic.id} padded={false} className={`overflow-hidden transition-colors ${isExpanded ? 'border-accent/40 shadow-md ring-4 ring-accent-soft' : 'hover:border-slate-300'}`}>

                    {/* カードヘッダー */}
                    <div onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)} className="group relative cursor-pointer p-5 sm:p-6">

                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold ${categoryInfo.color}`}>
                          <categoryInfo.icon size={12} aria-hidden />
                          {categoryInfo.label}
                        </span>

                        {topic.type === 'vote' && (
                          <span className="flex items-center gap-1 rounded border border-line bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                            <BarChart2 size={12} aria-hidden /> 投票
                          </span>
                        )}

                        <span className={`ml-2 flex items-center gap-1 text-xs font-bold ${topic.is_anonymous ? 'text-slate-400' : 'text-slate-600'}`}>
                          {topic.is_anonymous ? <Ghost size={14} aria-hidden /> : <UserCircle size={14} aria-hidden />}
                          {topic.creator_name}
                        </span>

                        <div className="ml-auto flex items-center gap-2">
                          <span className="rounded-full bg-canvas px-2 py-1 text-xs font-medium text-slate-400">
                            {topic.created_at?.toDate ? formatDateTime(topic.created_at) : ''}
                          </span>

                          {/* 自分の投稿なら削除ボタンを表示 */}
                          {isMyTopic && (
                            <IconButton
                              label="この投稿を削除"
                              size="sm"
                              onClick={(e) => handleDeleteTopic(e, topic.id)}
                              className="text-slate-400 hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2 size={14} aria-hidden />
                            </IconButton>
                          )}
                        </div>
                      </div>

                      <h4 className="mb-4 whitespace-pre-wrap text-base font-bold leading-relaxed text-fg transition-colors group-hover:text-accent sm:text-lg">{topic.title}</h4>

                      <div className="mt-2 flex items-center justify-between border-t border-line pt-4">
                        <button type="button" aria-label={`いいね ${topic.likes || 0}`} aria-pressed={isLiked} onClick={(e) => handleLike(e, topic)} className={`flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-colors ${isLiked ? 'border border-rose-100 bg-rose-50 text-rose-500' : 'border border-transparent bg-canvas text-slate-500 hover:bg-slate-100'}`}>
                          <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} aria-hidden /> {topic.likes || 0}
                        </button>
                        <div className={`flex items-center gap-1 rounded-full border px-4 py-2 text-xs font-bold transition-colors ${isExpanded ? 'border-accent/20 bg-accent-soft text-accent' : 'border-transparent bg-canvas text-slate-500 group-hover:bg-slate-100'}`}>
                          <MessageSquare size={16} aria-hidden /> コメント・詳細 {isExpanded ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア */}
                    {isExpanded && (
                      <div className="border-t border-line bg-canvas/80 p-5 sm:p-6">

                        {/* 投票 UI */}
                        {topic.type === 'vote' && topic.options && (
                          <div className="mb-8 space-y-3 rounded-card border border-line bg-surface p-5 shadow-sm">
                            <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-fg-muted"><BarChart2 size={14} aria-hidden /> アンケート結果 ({totalVotes}票)</h5>
                            {topic.options.map((opt: string, i: number) => {
                              const count = (topic.votes && topic.votes[i]) || 0;
                              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                              return (
                                <button type="button" key={i} disabled={isVoted} onClick={() => handleVote(topic.id, i)} className={`relative min-h-11 w-full overflow-hidden rounded-btn border p-3 text-left transition-colors ${isVoted ? 'border-line bg-canvas' : 'border-line bg-surface hover:border-accent/40 hover:bg-accent-soft'}`}>
                                  {isVoted && <div className="absolute left-0 top-0 h-full bg-accent-soft motion-safe:transition-all motion-safe:duration-1000 motion-safe:ease-out" style={{ width: `${percentage}%` }} />}
                                  <div className="relative z-10 flex items-center justify-between">
                                    <span className={`text-sm font-bold ${isVoted ? 'text-slate-600' : 'text-slate-700'}`}>{opt}</span>
                                    {isVoted && <span className="text-sm font-bold text-accent">{percentage}% <span className="ml-1 text-xs text-slate-400">({count}票)</span></span>}
                                  </div>
                                </button>
                              );
                            })}
                            {isVoted && <p className="mt-3 text-center text-xs font-bold text-slate-400">投票済み</p>}
                          </div>
                        )}

                        {/* コメント UI */}
                        <div>
                          <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-fg-muted"><MessagesSquare size={14} aria-hidden /> コメント ({comments.length})</h5>
                          <div className="custom-scrollbar mb-4 max-h-[400px] space-y-3 overflow-y-auto pr-2">
                            {comments.length === 0 ? (
                              <EmptyState
                                icon={MessagesSquare}
                                title="コメントはまだありません"
                                description="アドバイスや感想を書いてみましょう！"
                                className="bg-surface py-8"
                              />
                            ) : comments.map((c) => (
                              <div key={c.id} className="group/comment flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-sm shadow-sm">
                                <div className="flex items-center justify-between">
                                  <div className={`flex items-center gap-1 text-xs font-bold ${c.is_anonymous ? 'text-slate-400' : 'text-accent'}`}>
                                    {c.is_anonymous ? <Ghost size={12} aria-hidden /> : <UserCircle size={12} aria-hidden />} {c.name}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400">
                                      {c.created_at?.toDate ? formatDateTime(c.created_at) : ''}
                                    </span>

                                    {/* 自分のコメントなら削除ボタンを表示 */}
                                    {uid === c.uid && (
                                      <IconButton
                                        label="コメントを削除"
                                        size="sm"
                                        onClick={() => handleDeleteComment(c.id)}
                                        className="text-slate-400 hover:bg-danger-soft hover:text-danger"
                                      >
                                        <Trash2 size={14} aria-hidden />
                                      </IconButton>
                                    )}
                                  </div>
                                </div>
                                <div className="whitespace-pre-wrap font-medium leading-relaxed text-slate-700">{c.text}</div>
                              </div>
                            ))}
                          </div>

                          {/* コメント入力枠 */}
                          <div className="rounded-card border border-line bg-surface p-3 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-accent/30">
                            <textarea
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
                              placeholder="コメントを入力..."
                              aria-label="コメント"
                              className="h-16 w-full resize-none bg-transparent p-2 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-300"
                            />
                            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                              <label className="flex min-h-9 cursor-pointer items-center gap-1 text-xs font-bold text-fg-muted hover:text-slate-700">
                                <input type="checkbox" checked={newCommentIsAnonymous} onChange={e => setNewCommentIsAnonymous(e.target.checked)} className="rounded text-accent focus:ring-accent" />
                                <Ghost size={14} aria-hidden /> 匿名にする
                              </label>
                              <Button
                                size="sm"
                                onClick={handleCommentSubmit}
                                loading={commentLoading}
                                disabled={!newComment.trim()}
                                icon={<Send size={14} aria-hidden />}
                              >
                                送信
                              </Button>
                            </div>
                          </div>
                        </div>

                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
