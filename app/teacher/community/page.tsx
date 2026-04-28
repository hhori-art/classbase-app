'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp, 
  doc, updateDoc, increment, arrayUnion, onSnapshot, deleteDoc
} from 'firebase/firestore';
import { 
  MessageCircle, Heart, MessageSquare, Plus, Send, Loader2, 
  ChevronDown, ChevronUp, UserCircle, ArrowLeft, X, Trash2, PlusCircle, 
  BarChart2, MessagesSquare, LayoutGrid, Ghost, BookOpen, Briefcase, Users 
} from 'lucide-react';
import Link from 'next/link';

// 定数設定
const LIKE_REWARD_THRESHOLD = 10; 

// カテゴリ定義
const CATEGORIES = {
  instruction: { label: '指導・教材', icon: BookOpen, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', active: 'bg-emerald-600 text-white' },
  operation: { label: '業務相談', icon: Briefcase, color: 'bg-blue-50 text-blue-600 border-blue-100', active: 'bg-blue-600 text-white' },
  chat: { label: '雑談', icon: MessageCircle, color: 'bg-orange-50 text-orange-600 border-orange-100', active: 'bg-orange-500 text-white' }
};

export default function TeacherCommunityPage() {
  const { user, profile } = useAuth();
  
  // ユーザー名 (講師名)
  const currentName = profile?.name || profile?.student_name || user?.displayName || '名無し先生';
  const uid = user?.uid;

  const [topics, setTopics] = useState<any[]>([]);
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

  const handlePostSubmit = async () => {
    if (!newTitle.trim()) return alert('タイトルまたは内容を入力してください');
    if (newType === 'vote' && voteOptions.some(o => !o.trim())) return alert('空欄の選択肢があります');
    if (!uid) return;

    setPostLoading(true);
    try {
      await addDoc(collection(db, 'teacher_community_topics'), {
        title: newTitle,
        type: newType,
        category: newCategory,
        is_anonymous: isAnonymous,
        options: newType === 'vote' ? voteOptions : null,
        votes: {},
        voted_by: [],
        creator_uid: uid,
        creator_name: isAnonymous ? '匿名講師' : currentName,
        is_approved: true, // 講師間のやり取りは即時反映
        likes: 0,
        liked_by: [],
        created_at: serverTimestamp(),
        reward_given: false
      });
      setIsPosting(false); 
      setNewTitle(''); 
      setVoteOptions(['', '']);
      setIsAnonymous(false);
    } catch (e) { alert('送信失敗'); } finally { setPostLoading(false); }
  };

  // ★追加: トピックの削除機能
  const handleDeleteTopic = async (e: React.MouseEvent, topicId: string) => {
    e.stopPropagation(); // クリック時にトピックが展開されるのを防ぐ
    if (!confirm('この投稿を削除しますか？\n削除するとコメントや投票データも失われます。')) return;

    try {
      await deleteDoc(doc(db, 'teacher_community_topics', topicId));
      if (expandedTopicId === topicId) {
        setExpandedTopicId(null);
      }
    } catch (error) {
      alert('削除に失敗しました。');
      console.error(error);
    }
  };

  // ★追加: コメントの削除機能
  const handleDeleteComment = async (commentId: string) => {
    if (!expandedTopicId) return;
    if (!confirm('このコメントを削除しますか？')) return;

    try {
      await deleteDoc(doc(db, 'teacher_community_topics', expandedTopicId, 'comments', commentId));
    } catch (error) {
      alert('コメントの削除に失敗しました。');
      console.error(error);
    }
  };

  const handleLike = async (e: React.MouseEvent, topic: any) => {
    e.stopPropagation();
    if (!uid || topic.liked_by?.includes(uid)) return;

    // オプティミスティック更新
    setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, likes: (t.likes || 0) + 1, liked_by: [...(t.liked_by || []), uid] } : t));

    try {
      const topicRef = doc(db, 'teacher_community_topics', topic.id);
      await updateDoc(topicRef, { likes: increment(1), liked_by: arrayUnion(uid) });
      
      if (!topic.reward_given && (topic.likes || 0) + 1 >= LIKE_REWARD_THRESHOLD) {
        const token = await user?.getIdToken();
        if (token) {
          await fetch('/api/coin-transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'community_like_reward', collection_name: 'teacher_community_topics', topic_id: topic.id }),
          });
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleVote = async (topicId: string, optionIndex: number) => {
    if (!uid) return;
    try {
      const topicRef = doc(db, 'teacher_community_topics', topicId);
      await updateDoc(topicRef, { [`votes.${optionIndex}`]: increment(1), voted_by: arrayUnion(uid) });
    } catch (e) { alert('投票失敗'); }
  };

  const handleCommentSubmit = async () => {
    if (!newComment.trim() || !expandedTopicId || !uid) return;
    setCommentLoading(true);
    try {
      await addDoc(collection(db, 'teacher_community_topics', expandedTopicId, 'comments'), { 
        text: newComment, 
        uid: uid, 
        name: newCommentIsAnonymous ? '匿名講師' : currentName, 
        is_anonymous: newCommentIsAnonymous,
        created_at: serverTimestamp() 
      });
      setNewComment('');
      setNewCommentIsAnonymous(false);
    } catch (e) { alert('送信失敗'); } finally { setCommentLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-40 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        
        {/* レスポンシブレイアウト: PCでは2カラム、スマホでは1カラム */}
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          
          {/* === 左サイドバー (固定メニュー & 投稿フォーム) === */}
          <div className="w-full lg:w-80 lg:shrink-0 lg:sticky lg:top-8 space-y-6 z-20">
            
            {/* ヘッダー */}
            <div className="flex items-center gap-3 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
              <Link href="/teacher" className="bg-slate-100 p-2 rounded-full hover:bg-slate-200 transition-colors">
                <ArrowLeft size={20} className="text-slate-600" />
              </Link>
              <h1 className="text-lg md:text-xl font-extrabold text-slate-800 flex items-center gap-2">
                <Users className="text-indigo-600" fill="currentColor" /> 講師コミュニティ
              </h1>
            </div>

            {/* 投稿作成カード */}
            {!isPosting ? (
              <button 
                onClick={() => setIsPosting(true)}
                className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-5 rounded-3xl shadow-lg shadow-indigo-200 flex items-center justify-center gap-3 font-bold hover:scale-[1.02] active:scale-95 transition-all group"
              >
                <div className="bg-white/20 p-2 rounded-full group-hover:rotate-90 transition-transform">
                  <Plus size={24} />
                </div>
                相談・話題を投稿する
              </button>
            ) : (
              <div className="bg-white p-5 rounded-3xl shadow-xl border border-indigo-200 animate-in zoom-in-95 duration-200">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><MessageSquare size={18} className="text-indigo-500"/> 投稿を作成</h3>
                    <button onClick={() => setIsPosting(false)} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-1 rounded-full"><X size={18}/></button>
                  </div>
                  
                  {/* カテゴリ選択 */}
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">カテゴリ</label>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(CATEGORIES).map(([key, cat]) => (
                        <button
                          key={key}
                          onClick={() => setNewCategory(key as any)}
                          className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex flex-col items-center gap-1 ${
                            newCategory === key ? cat.active : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <cat.icon size={14}/>
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* タイトル/内容入力 */}
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">内容</label>
                    <textarea 
                      placeholder="相談したいこと、共有したいこと..." 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-indigo-400 outline-none transition-colors min-h-[100px] resize-none"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>

                  {/* 形式切り替え */}
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                    <button onClick={() => setNewType('thread')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newType === 'thread' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>💬 スレッド</button>
                    <button onClick={() => setNewType('vote')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newType === 'vote' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>📊 投票機能</button>
                  </div>
                  
                  {newType === 'vote' && (
                    <div className="space-y-2 pl-2 border-l-2 border-orange-100">
                      <p className="text-xs font-bold text-slate-400 mb-1">選択肢 (最大5つ)</p>
                      {voteOptions.map((opt, i) => (
                        <div key={i} className="flex gap-2">
                          <input type="text" placeholder={`選択肢 ${i+1}`} className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold" value={opt} onChange={(e) => changeOption(i, e.target.value)} />
                          {voteOptions.length > 2 && <button onClick={() => removeOption(i)} className="text-slate-300 hover:text-red-500 px-1"><Trash2 size={16}/></button>}
                        </div>
                      ))}
                      {voteOptions.length < 5 && <button onClick={addOption} className="text-xs font-bold text-orange-500 flex items-center gap-1 hover:text-orange-600 py-1"><PlusCircle size={14}/> 追加</button>}
                    </div>
                  )}

                  {/* 匿名チェック */}
                  <div className="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <input 
                      type="checkbox" 
                      id="anon" 
                      checked={isAnonymous} 
                      onChange={(e) => setIsAnonymous(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <label htmlFor="anon" className="text-xs font-bold text-slate-600 flex items-center gap-1 cursor-pointer w-full">
                      <Ghost size={14} className={isAnonymous ? "text-indigo-500" : "text-slate-400"}/> 匿名で投稿する
                    </label>
                  </div>

                  <button onClick={handlePostSubmit} disabled={postLoading} className="w-full bg-slate-800 text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-black transition-all active:scale-95 shadow-md">
                    {postLoading ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} 投稿する
                  </button>
                </div>
              </div>
            )}

            {/* カテゴリフィルタ */}
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex lg:flex-col overflow-x-auto lg:overflow-visible gap-2 no-scrollbar">
              <button
                  onClick={() => setFilterCategory('all')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all text-left ${
                    filterCategory === 'all' ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <LayoutGrid size={18} className={filterCategory === 'all' ? 'text-white' : 'text-slate-400'} /> すべて
              </button>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button
                  key={key}
                  onClick={() => setFilterCategory(key as any)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all text-left ${
                    filterCategory === key ? cat.active + ' shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <cat.icon size={18} className={filterCategory === key ? 'text-white' : 'text-slate-400'} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* === 右メインコンテンツ (タイムライン) === */}
          <div className="flex-1 min-w-0 space-y-4">
            {filteredTopics.length === 0 ? (
              <div className="text-center py-20 text-slate-400 text-sm bg-white rounded-3xl border border-dashed border-slate-200">
                該当する投稿がありません。<br/>最初のトピックを作成してみましょう！
              </div>
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
                  <div key={topic.id} className={`bg-white rounded-[24px] shadow-sm border transition-all duration-300 overflow-hidden ${isExpanded ? 'border-indigo-300 ring-4 ring-indigo-50 shadow-md' : 'border-slate-200 hover:border-slate-300'}`}>
                    
                    {/* カードヘッダー */}
                    <div onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)} className="p-5 sm:p-6 cursor-pointer relative group">
                      
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded border flex items-center gap-1 ${categoryInfo.color}`}>
                          <categoryInfo.icon size={12}/>
                          {categoryInfo.label}
                        </span>
                        
                        {topic.type === 'vote' && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1">
                            <BarChart2 size={12}/> 投票
                          </span>
                        )}

                        <span className={`text-xs font-bold flex items-center gap-1 ml-2 ${topic.is_anonymous ? 'text-slate-400' : 'text-slate-600'}`}>
                          {topic.is_anonymous ? <Ghost size={14}/> : <UserCircle size={14}/>} 
                          {topic.creator_name}
                        </span>
                        
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded-full">
                            {topic.created_at?.toDate ? topic.created_at.toDate().toLocaleString('ja-JP', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}
                          </span>
                          
                          {/* ★追加: 自分の投稿なら削除ボタンを表示 */}
                          {isMyTopic && (
                            <button 
                              onClick={(e) => handleDeleteTopic(e, topic.id)}
                              className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                              title="この投稿を削除"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      <h4 className="font-bold text-slate-800 text-base sm:text-lg mb-4 leading-relaxed group-hover:text-indigo-700 transition-colors whitespace-pre-wrap">{topic.title}</h4>
                      
                      <div className="flex items-center justify-between mt-2 pt-4 border-t border-slate-100">
                          <button onClick={(e) => handleLike(e, topic)} className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-full transition-all ${isLiked ? 'bg-rose-50 text-rose-500 border border-rose-100' : 'bg-slate-50 text-slate-400 border border-transparent hover:bg-slate-100'}`}>
                            <Heart size={16} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "animate-bounce-short" : ""} /> {topic.likes || 0}
                          </button>
                          <div className={`flex items-center gap-1 text-xs font-bold transition-colors bg-slate-50 px-4 py-2 rounded-full border ${isExpanded ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'text-slate-500 border-transparent group-hover:bg-slate-100'}`}>
                            <MessageSquare size={16}/> コメント・詳細 {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                          </div>
                      </div>
                    </div>

                    {/* 展開エリア */}
                    {isExpanded && (
                      <div className="bg-slate-50/80 border-t border-slate-200 p-5 sm:p-6 animate-in slide-in-from-top-4 duration-300">
                        
                        {/* 投票 UI */}
                        {topic.type === 'vote' && topic.options && (
                          <div className="mb-8 space-y-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <h5 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2"><BarChart2 size={14}/> アンケート結果 ({totalVotes}票)</h5>
                            {topic.options.map((opt: string, i: number) => {
                              const count = (topic.votes && topic.votes[i]) || 0;
                              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                              return (
                                <button key={i} disabled={isVoted} onClick={() => handleVote(topic.id, i)} className={`w-full relative overflow-hidden text-left p-3 rounded-xl border transition-all ${isVoted ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'}`}>
                                  {isVoted && <div className="absolute top-0 left-0 h-full bg-indigo-100/50 transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }} />}
                                  <div className="relative flex justify-between items-center z-10">
                                    <span className={`text-sm font-bold ${isVoted ? 'text-slate-600' : 'text-slate-700'}`}>{opt}</span>
                                    {isVoted && <span className="text-sm font-bold text-indigo-600">{percentage}% <span className="text-xs text-slate-400 ml-1">({count}票)</span></span>}
                                  </div>
                                </button>
                              );
                            })}
                            {isVoted && <p className="text-xs text-center text-slate-400 font-bold mt-3">投票済み</p>}
                          </div>
                        )}

                        {/* コメント UI */}
                        <div>
                          <h5 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-2"><MessagesSquare size={14}/> コメント ({comments.length})</h5>
                          <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {comments.length === 0 ? <div className="text-center text-xs text-slate-400 py-8 bg-white rounded-2xl border border-dashed border-slate-200">コメントはまだありません。<br/>アドバイスや感想を書いてみましょう！</div> : comments.map((c) => (
                              <div key={c.id} className="bg-white p-4 rounded-2xl border border-slate-100 text-sm shadow-sm flex flex-col gap-2 group/comment">
                                <div className="flex justify-between items-center">
                                  <div className={`font-bold text-xs flex items-center gap-1 ${c.is_anonymous ? 'text-slate-400' : 'text-indigo-700'}`}>
                                    {c.is_anonymous ? <Ghost size={12}/> : <UserCircle size={12}/>} {c.name}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] text-slate-400">
                                      {c.created_at?.toDate ? c.created_at.toDate().toLocaleString('ja-JP', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}
                                    </span>
                                    
                                    {/* ★追加: 自分のコメントなら削除ボタンを表示 */}
                                    {uid === c.uid && (
                                      <button 
                                        onClick={() => handleDeleteComment(c.id)}
                                        className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                        title="コメントを削除"
                                      >
                                        <Trash2 size={12}/>
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="text-slate-700 leading-relaxed font-medium whitespace-pre-wrap">{c.text}</div>
                              </div>
                            ))}
                          </div>

                          {/* コメント入力枠 */}
                          <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                            <textarea 
                              value={newComment} 
                              onChange={(e) => setNewComment(e.target.value)} 
                              placeholder="コメントを入力..." 
                              className="w-full p-2 text-sm bg-transparent outline-none font-medium text-slate-700 placeholder:text-slate-300 resize-none h-16" 
                            />
                            <div className="flex justify-between items-center mt-2 border-t border-slate-50 pt-2">
                              <label className="flex items-center gap-1 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700">
                                <input type="checkbox" checked={newCommentIsAnonymous} onChange={e => setNewCommentIsAnonymous(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                                <Ghost size={14}/> 匿名にする
                              </label>
                              <button 
                                onClick={handleCommentSubmit} 
                                disabled={commentLoading || !newComment.trim()} 
                                className="bg-slate-800 text-white px-4 py-2 rounded-xl hover:bg-black disabled:opacity-50 transition-all flex items-center justify-center gap-1 text-xs font-bold shadow-md active:scale-95"
                              >
                                {commentLoading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>} 送信
                              </button>
                            </div>
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
    </div>
  );
}
