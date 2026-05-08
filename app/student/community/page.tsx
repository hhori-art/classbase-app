'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, query, where, orderBy, limit, getDocs, onSnapshot
} from 'firebase/firestore';
import { 
  MessageCircle, Heart, MessageSquare, Plus, Send, Loader2, 
  ChevronDown, ChevronUp, UserCircle, ArrowLeft, X, Trash2, PlusCircle, 
  BarChart2, MessagesSquare, LayoutGrid
} from 'lucide-react';
import Link from 'next/link';

// 定数設定
const LIKE_REWARD_THRESHOLD = 10; 

export default function CommunityPage() {
  const { user, profile } = useAuth();
  
  // ユーザー名
  const currentName = profile?.student_name || user?.displayName || '名無し';
  const uid = user?.uid;

  const [topics, setTopics] = useState<any[]>([]);
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

  // 初期ロード
  useEffect(() => {
    const fetchTopics = async () => {
      const q = query(collection(db, 'community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'), limit(50));
      const snap = await getDocs(q);
      setTopics(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchTopics();
  }, []);

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
    if (!newTitle.trim()) return alert('タイトルを入力してください');
    if (newType === 'vote' && voteOptions.some(o => !o.trim())) return alert('空欄の選択肢があります');
    if (!uid) return;

    setPostLoading(true);
    try {
      await postCommunityAction({
        action: 'create_topic',
        title: newTitle,
        type: newType,
        options: newType === 'vote' ? voteOptions : [],
      });
      alert('申請しました！承認をお待ちください。');
      setIsPosting(false); setNewTitle(''); setVoteOptions(['', '']);
    } catch (e) { alert('送信失敗'); } finally { setPostLoading(false); }
  };

  const handleLike = async (e: React.MouseEvent, topic: any) => {
    e.stopPropagation();
    if (!uid || topic.liked_by?.includes(uid)) return;
    setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, likes: (t.likes || 0) + 1, liked_by: [...(t.liked_by || []), uid] } : t));

    try {
      await postCommunityAction({ action: 'like', topic_id: topic.id });
      if (!topic.reward_given && (topic.likes || 0) + 1 >= LIKE_REWARD_THRESHOLD) {
        const token = await user?.getIdToken();
        if (token) {
          await fetch('/api/coin-transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'community_like_reward', collection_name: 'community_topics', topic_id: topic.id }),
          });
        }
      }
    } catch (e) { console.error(e); }
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
    } catch (e) { alert('投票失敗'); }
  };

  const handleCommentSubmit = async () => {
    if (!newComment.trim() || !expandedTopicId || !uid) return;
    setCommentLoading(true);
    try {
      await postCommunityAction({ action: 'comment', topic_id: expandedTopicId, text: newComment });
      setNewComment('');
    } catch (e) { alert('送信失敗'); } finally { setCommentLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-40 font-sans">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        
        {/* レスポンシブレイアウト: PCでは2カラム、スマホでは1カラム */}
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          
          {/* === 左サイドバー (固定メニュー & 投稿フォーム) === */}
          <div className="w-full lg:w-80 lg:shrink-0 lg:sticky lg:top-8 space-y-6 z-20">
            
            {/* ヘッダー */}
            <div className="flex items-center gap-3 bg-white/80 backdrop-blur p-4 rounded-2xl shadow-sm border border-white/50">
              <Link href="/student" className="bg-gray-100 p-2 rounded-full hover:bg-gray-200 transition-colors">
                <ArrowLeft size={20} className="text-gray-600" />
              </Link>
              <h1 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                <MessageCircle className="text-pink-500" fill="currentColor" /> みんなの広場
              </h1>
            </div>

            {/* 投稿作成カード */}
            {!isPosting ? (
              <button 
                onClick={() => setIsPosting(true)}
                className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white p-5 rounded-3xl shadow-lg shadow-pink-200 flex items-center justify-center gap-3 font-bold hover:scale-[1.02] active:scale-95 transition-all group"
              >
                <div className="bg-white/20 p-2 rounded-full group-hover:rotate-90 transition-transform">
                  <Plus size={24} />
                </div>
                新しい話題を投稿
              </button>
            ) : (
              <div className="bg-white p-5 rounded-3xl shadow-xl border border-pink-200 animate-in zoom-in-95 duration-200">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-gray-800">投稿を作成</h3>
                    <button onClick={() => setIsPosting(false)} className="text-gray-400 hover:text-gray-600 bg-gray-50 p-1 rounded-full"><X size={18}/></button>
                  </div>
                  
                  <input 
                    type="text" 
                    placeholder="タイトルを入力..." 
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-pink-300 outline-none transition-colors"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />

                  <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                    <button onClick={() => setNewType('thread')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newType === 'thread' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>💬 スレッド</button>
                    <button onClick={() => setNewType('vote')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newType === 'vote' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>📊 投票</button>
                  </div>
                  
                  {newType === 'vote' && (
                    <div className="space-y-2 pl-2 border-l-2 border-orange-100">
                      <p className="text-xs font-bold text-gray-400 mb-1">選択肢 (最大5つ)</p>
                      {voteOptions.map((opt, i) => (
                        <div key={i} className="flex gap-2">
                          <input type="text" placeholder={`選択肢 ${i+1}`} className="flex-1 p-2 bg-white border border-gray-200 rounded-lg text-xs font-bold" value={opt} onChange={(e) => changeOption(i, e.target.value)} />
                          {voteOptions.length > 2 && <button onClick={() => removeOption(i)} className="text-gray-300 hover:text-red-500 px-1"><Trash2 size={16}/></button>}
                        </div>
                      ))}
                      {voteOptions.length < 5 && <button onClick={addOption} className="text-xs font-bold text-orange-500 flex items-center gap-1 hover:text-orange-600 py-1"><PlusCircle size={14}/> 追加</button>}
                    </div>
                  )}

                  <button onClick={handlePostSubmit} disabled={postLoading} className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-black transition-colors">
                    {postLoading ? <Loader2 className="animate-spin" size={16}/> : <Send size={16}/>} 申請する
                  </button>
                </div>
              </div>
            )}

            {/* フィルタ (PC用: 縦並び / スマホ用: 横スクロール) */}
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100 flex lg:flex-col overflow-x-auto lg:overflow-visible gap-2 no-scrollbar">
              {[
                { id: 'all', label: 'すべての投稿', icon: LayoutGrid, color: 'text-gray-600' },
                { id: 'thread', label: 'スレッド (会話)', icon: MessagesSquare, color: 'text-blue-500' },
                { id: 'vote', label: '投票アンケート', icon: BarChart2, color: 'text-orange-500' },
              ].map(f => (
                <button
                  key={f.id}
                  // @ts-ignore
                  onClick={() => setFilterType(f.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all text-left ${
                    filterType === f.id 
                    ? 'bg-gray-800 text-white shadow-md' 
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <f.icon size={18} className={filterType === f.id ? 'text-white' : f.color} />
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* === 右メインコンテンツ (タイムライン) === */}
          <div className="flex-1 min-w-0 space-y-4">
            {filteredTopics.length === 0 ? (
              <div className="text-center py-20 text-gray-400 text-sm bg-white rounded-3xl border border-dashed border-gray-200">
                表示できる投稿がありません。<br/>フィルタを変更するか、新しく投稿してみましょう！
              </div>
            ) : (
              filteredTopics.map((topic) => {
                const isLiked = uid ? topic.liked_by?.includes(uid) : false;
                const isExpanded = expandedTopicId === topic.id;
                const isVoted = uid ? topic.voted_by?.includes(uid) : false;
                const totalVotes = Object.values(topic.votes || {}).reduce((a: any, b: any) => a + b, 0) as number;

                return (
                  <div key={topic.id} className={`bg-white rounded-[24px] shadow-sm border transition-all duration-300 overflow-hidden ${isExpanded ? 'border-pink-300 ring-4 ring-pink-50 shadow-md' : 'border-gray-100 hover:border-gray-300'}`}>
                    
                    {/* カードヘッダー */}
                    <div onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)} className="p-5 cursor-pointer relative group">
                      {topic.reward_given && <div className="absolute top-0 right-0 bg-yellow-400 text-white text-[10px] font-black px-3 py-1 rounded-bl-2xl shadow-sm">👑 殿堂入り</div>}
                      
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1 ${topic.type === 'vote' ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                          {topic.type === 'vote' ? <BarChart2 size={12}/> : <MessagesSquare size={12}/>}
                          {topic.type === 'vote' ? '投票' : 'スレッド'}
                        </span>
                        <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                          <UserCircle size={14} className="text-gray-400"/> {topic.creator_name}
                        </span>
                        <span className="text-[10px] text-gray-300 ml-auto font-medium">
                          {topic.created_at?.toDate ? topic.created_at.toDate().toLocaleDateString() : ''}
                        </span>
                      </div>
                      
                      <h4 className="font-bold text-gray-800 text-lg mb-4 leading-relaxed group-hover:text-indigo-900 transition-colors">{topic.title}</h4>
                      
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                          <button onClick={(e) => handleLike(e, topic)} className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-full transition-all ${isLiked ? 'bg-pink-50 text-pink-500' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                            <Heart size={16} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "animate-bounce-short" : ""} /> {topic.likes || 0}
                          </button>
                          <div className={`flex items-center gap-1 text-xs font-bold transition-colors ${isExpanded ? 'text-indigo-500' : 'text-gray-400 group-hover:text-indigo-400'}`}>
                            <MessageSquare size={16}/> コメント・詳細 {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                          </div>
                      </div>
                    </div>

                    {/* 展開エリア */}
                    {isExpanded && (
                      <div className="bg-gray-50/50 border-t border-gray-100 p-5 animate-in slide-in-from-top-4 duration-300">
                        
                        {/* 投票 UI */}
                        {topic.type === 'vote' && topic.options && (
                          <div className="mb-8 space-y-3 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <h5 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-2"><BarChart2 size={14}/> アンケート結果 ({totalVotes}票)</h5>
                            {topic.options.map((opt: string, i: number) => {
                              const count = (topic.votes && topic.votes[i]) || 0;
                              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                              return (
                                <button key={i} disabled={isVoted} onClick={() => handleVote(topic.id, i)} className={`w-full relative overflow-hidden text-left p-3 rounded-xl border transition-all ${isVoted ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200 hover:border-orange-300 hover:bg-orange-50'}`}>
                                  {isVoted && <div className="absolute top-0 left-0 h-full bg-orange-100/50 transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }} />}
                                  <div className="relative flex justify-between items-center z-10">
                                    <span className={`text-sm font-bold ${isVoted ? 'text-gray-600' : 'text-gray-700'}`}>{opt}</span>
                                    {isVoted && <span className="text-sm font-bold text-orange-600">{percentage}% <span className="text-xs text-gray-400 ml-1">({count}票)</span></span>}
                                  </div>
                                </button>
                              );
                            })}
                            {isVoted && <p className="text-xs text-center text-gray-400 font-bold mt-2">投票ありがとうございました！</p>}
                          </div>
                        )}

                        {/* コメント UI */}
                        <div>
                          <h5 className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-2"><MessagesSquare size={14}/> コメント ({comments.length})</h5>
                          <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {comments.length === 0 ? <div className="text-center text-xs text-gray-400 py-6 bg-white rounded-xl border border-dashed border-gray-200">コメントはまだありません。<br/>最初のコメントを書いてみましょう！</div> : comments.map((c) => (
                              <div key={c.id} className="bg-white p-3.5 rounded-xl border border-gray-100 text-sm shadow-sm">
                                <div className="font-bold text-indigo-900 mb-1 text-xs flex items-center gap-1 opacity-70"><UserCircle size={12}/> {c.name}</div>
                                <div className="text-gray-800 leading-relaxed font-medium">{c.text}</div>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                            <input 
                              type="text" 
                              value={newComment} 
                              onChange={(e) => setNewComment(e.target.value)} 
                              placeholder="コメントを入力..." 
                              className="flex-1 p-2 text-sm bg-transparent outline-none font-bold text-gray-700 placeholder:text-gray-300" 
                            />
                            <button 
                              onClick={handleCommentSubmit} 
                              disabled={commentLoading || !newComment.trim()} 
                              className="bg-indigo-600 text-white w-10 h-10 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center shadow-md active:scale-95"
                            >
                              {commentLoading ? <Loader2 size={18} className="animate-spin"/> : <Send size={18} className="ml-0.5"/>}
                            </button>
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
