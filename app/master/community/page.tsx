'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, deleteDoc, writeBatch, getDoc } from 'firebase/firestore';
import { ArrowLeft, MessageCircle, Check, Trash2, Loader2, User, Clock, ShieldAlert, X, Search, MessageSquare, CheckSquare, ListChecks } from 'lucide-react';

export default function CommunityManagerPage() {
  const [activeTab, setActiveTab] = useState<'pending' | 'active'>('pending');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeTopics, setActiveTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // 詳細表示用
  const [selectedTopic, setSelectedTopic] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  
  // フィルター・検索・選択
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // データ取得
  const fetchAll = async () => {
    setLoading(true);
    try {
      // 承認待ち
      const q1 = query(collection(db, 'community_topics'), where('is_approved', '==', false), orderBy('created_at', 'desc'));
      const snap1 = await getDocs(q1);
      setPendingRequests(snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      // 公開中 (承認済み)
      const q2 = query(collection(db, 'community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'));
      const snap2 = await getDocs(q2);
      setActiveTopics(snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })));

    } catch (e) {
      console.error(e);
      try {
        const q1 = query(collection(db, 'community_topics'), where('is_approved', '==', false));
        const snap1 = await getDocs(q1);
        setPendingRequests(snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const q2 = query(collection(db, 'community_topics'), where('is_approved', '==', true));
        const snap2 = await getDocs(q2);
        setActiveTopics(snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch(e2) {}
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedTopic(null);
  }, [activeTab]);

  // ★修正: コメント取得 & ユーザー名解決の強化
  const fetchComments = async (topicId: string) => {
    setComments([]);
    try {
      const q = query(collection(db, `community_topics/${topicId}/comments`), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      
      const rawComments = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const commentsWithUser = await Promise.all(rawComments.map(async (c) => {
        // IDフィールドのゆらぎを吸収
        const uid = c.user_id || c.userId || c.student_id || c.studentId || c.uid || c.creator_id;
        
        // 名前フィールドのゆらぎを吸収 (初期値)
        let displayName = c.user_name || c.userName || c.student_name || c.studentName || c.creator_name || c.name || '不明なユーザー';

        if (uid) {
          try {
            const userSnap = await getDoc(doc(db, 'users', uid));
            if (userSnap.exists()) {
              const userData = userSnap.data();
              // ユーザー情報のフィールドゆらぎを吸収
              displayName = userData.student_name || userData.name || userData.displayName || userData.username || displayName;
            }
          } catch (e) {
            console.error('User fetch failed', e);
          }
        }
        return { ...c, display_name: displayName };
      }));

      setComments(commentsWithUser);
    } catch (e) { console.error(e); }
  };

  const handleSelectTopic = (topic: any) => {
    setSelectedTopic(topic);
    fetchComments(topic.id);
  };

  // --- 一括操作 ---
  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const targetIds = displayedList.map(item => item.id);
    const allSelected = targetIds.length > 0 && targetIds.every(id => selectedIds.has(id));
    const newSet = new Set(selectedIds);
    if (allSelected) targetIds.forEach(id => newSet.delete(id));
    else targetIds.forEach(id => newSet.add(id));
    setSelectedIds(newSet);
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件を一括承認して公開しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'community_topics', id);
        batch.update(ref, { is_approved: true });
      });
      await batch.commit();
      
      const approvedItems = pendingRequests.filter(r => selectedIds.has(r.id)).map(r => ({ ...r, is_approved: true }));
      setPendingRequests(prev => prev.filter(r => !selectedIds.has(r.id)));
      setActiveTopics(prev => [...approvedItems, ...prev]);
      setSelectedIds(new Set());
      setSelectedTopic(null);
    } catch (e) { alert('エラーが発生しました'); }
    finally { setProcessing(false); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const msg = activeTab === 'pending' ? '選択した申請を却下（削除）しますか？' : '【警告】選択した公開中の投稿を削除しますか？';
    if (!confirm(msg)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'community_topics', id);
        batch.delete(ref);
      });
      await batch.commit();

      if (activeTab === 'pending') setPendingRequests(prev => prev.filter(r => !selectedIds.has(r.id)));
      else setActiveTopics(prev => prev.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      setSelectedTopic(null);
    } catch (e) { alert('削除エラー'); }
    finally { setProcessing(false); }
  };

  // 個別操作
  const handleApprove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('この投稿を承認して公開しますか？')) return;
    try {
      await updateDoc(doc(db, 'community_topics', id), { is_approved: true });
      const target = pendingRequests.find(r => r.id === id);
      if (target) {
        setPendingRequests(prev => prev.filter(r => r.id !== id));
        setActiveTopics(prev => [{ ...target, is_approved: true }, ...prev]);
      }
      if (selectedTopic?.id === id) setSelectedTopic(null);
    } catch (e) { alert('エラーが発生しました'); }
  };

  const handleDeleteTopic = async (e: React.MouseEvent | null, id: string) => {
    if (e) e.stopPropagation();
    const msg = activeTab === 'active' ? '【警告】公開中の投稿を削除しますか？' : 'この申請を却下（削除）しますか？';
    if (!confirm(msg)) return;
    try {
      await deleteDoc(doc(db, 'community_topics', id));
      if (activeTab === 'active') setActiveTopics(prev => prev.filter(r => r.id !== id));
      else setPendingRequests(prev => prev.filter(r => r.id !== id));
      if (selectedTopic?.id === id) setSelectedTopic(null);
    } catch (e) { alert('削除エラー'); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedTopic || !confirm('このコメントを削除しますか？')) return;
    try {
      await deleteDoc(doc(db, `community_topics/${selectedTopic.id}/comments`, commentId));
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (e) { alert('削除エラー'); }
  };

  const displayedList = useMemo(() => {
    return (activeTab === 'pending' ? pendingRequests : activeTopics).filter(item => 
      (item.title || '').includes(searchQuery) || (item.creator_name || '').includes(searchQuery)
    );
  }, [activeTab, pendingRequests, activeTopics, searchQuery]);

  // ★修正: 投票オプションの安全なレンダリング
  const renderVoteOptions = (topic: any) => {
    // フィールド名のゆらぎを吸収
    const options = topic.options || topic.choices || topic.items || [];
    
    if (!Array.isArray(options) || options.length === 0) {
      return <div className="text-xs text-slate-400 bg-slate-100 p-2 rounded">選択肢データなし</div>;
    }

    return options.map((opt: any, i: number) => {
      // オブジェクトか文字列か判定
      const text = typeof opt === 'object' ? (opt.text || opt.label || opt.option || `選択肢${i+1}`) : opt;
      const votes = typeof opt === 'object' ? (opt.votes || opt.count || 0) : 0;

      return (
        <div key={i} className="bg-white border border-slate-200 p-3 rounded-lg text-xs font-bold text-slate-600 flex justify-between items-center shadow-sm">
          <span>{text}</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-500">{votes}票</span>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto h-[calc(100vh-100px)] flex flex-col">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6 shrink-0">
          <Link href="/master" className="bg-white p-3 rounded-full shadow-sm hover:bg-slate-100 text-slate-600 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <MessageCircle className="text-pink-500" /> コミュニティ管理
            </h1>
            <p className="text-xs text-slate-500 font-bold mt-1">生徒の投稿を承認・監視・削除します</p>
          </div>
        </div>

        <div className="flex gap-6 flex-1 min-h-0">
          
          {/* 左カラム: リスト */}
          <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col gap-4">
            
            {/* コントロールバー */}
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-3 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                  <button onClick={() => setActiveTab('pending')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${activeTab === 'pending' ? 'bg-white text-pink-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    <ShieldAlert size={14}/> 承認待ち ({pendingRequests.length})
                  </button>
                  <button onClick={() => setActiveTab('active')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${activeTab === 'active' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Check size={14}/> 公開中
                  </button>
                </div>
                <div className="relative flex-1 min-w-[140px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input type="text" placeholder="タイトル/名前..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-pink-200 transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
              </div>

              {/* 一括操作バー */}
              <div className="flex items-center justify-between px-1 pt-1 border-t border-slate-100">
                <button onClick={toggleSelectAll} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
                  <ListChecks size={16}/> {displayedList.length > 0 && displayedList.every(i => selectedIds.has(i.id)) ? '選択解除' : 'すべて選択'}
                </button>
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-5 duration-300">
                    <span className="text-xs font-bold text-slate-400">{selectedIds.size}件選択中</span>
                    <button onClick={handleBulkDelete} disabled={processing} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-300 transition-colors flex items-center gap-1"><Trash2 size={14}/> 削除</button>
                    {activeTab === 'pending' && <button onClick={handleBulkApprove} disabled={processing} className="bg-pink-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-pink-600 shadow-sm transition-colors flex items-center gap-1">{processing ? <Loader2 className="animate-spin" size={14}/> : <Check size={14}/>} 承認</button>}
                  </div>
                )}
              </div>
            </div>

            {/* リスト本体 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
              {loading ? (
                <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-pink-400"/></div>
              ) : displayedList.length === 0 ? (
                <div className="text-center py-20 text-slate-400 font-bold border-2 border-dashed border-slate-200 rounded-3xl">
                  {activeTab === 'pending' ? '承認待ちはありません 🎉' : '公開中の投稿はありません'}
                </div>
              ) : (
                displayedList.map(item => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <div key={item.id} onClick={() => handleSelectTopic(item)} className={`bg-white p-4 rounded-2xl border-2 transition-all cursor-pointer group hover:shadow-md relative overflow-hidden ${isSelected ? 'border-pink-400 bg-pink-50/20' : selectedTopic?.id === item.id ? 'border-pink-300 bg-white ring-2 ring-pink-100' : 'border-slate-100 hover:border-pink-200'}`}>
                      <div className="absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center z-10" onClick={(e) => toggleSelect(item.id, e)}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-pink-500 border-pink-500 text-white' : 'bg-white border-slate-300 group-hover:border-pink-300'}`}>
                          {isSelected && <Check size={12} strokeWidth={4}/>}
                        </div>
                      </div>
                      <div className="pl-8">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${item.type === 'vote' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>{item.type === 'vote' ? '投票' : 'スレッド'}</span>
                            <span className="text-xs font-bold text-slate-500 truncate max-w-[100px]">{item.creator_name}</span>
                          </div>
                          <span className="text-[10px] text-slate-300 font-mono shrink-0">{item.created_at?.seconds ? new Date(item.created_at.seconds * 1000).toLocaleDateString() : 'New'}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-sm mb-3 line-clamp-2">{item.title}</h3>
                        <div className="flex gap-2 border-t border-slate-100 pt-2 mt-1">
                          {activeTab === 'pending' && <button onClick={(e) => handleApprove(e, item.id)} className="flex-1 bg-pink-500 text-white py-1.5 rounded-lg text-xs font-bold hover:bg-pink-600 shadow-sm flex items-center justify-center gap-1 transition-transform active:scale-95"><Check size={14} strokeWidth={3}/> 承認</button>}
                          <button onClick={(e) => handleDeleteTopic(e, item.id)} className="px-3 bg-slate-100 text-slate-400 rounded-lg hover:bg-red-100 hover:text-red-500 transition-colors ml-auto"><Trash2 size={16}/></button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 右カラム: 詳細プレビュー & コメント管理 */}
          <div className="hidden lg:flex flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden flex-col relative">
            {selectedTopic ? (
              <>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 overflow-y-auto max-h-[50vh] custom-scrollbar">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`text-xs font-black px-3 py-1 rounded-full ${selectedTopic.type === 'vote' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                      {selectedTopic.type === 'vote' ? '投票機能付き' : '通常スレッド'}
                    </span>
                    <button onClick={() => setSelectedTopic(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400"><X size={20}/></button>
                  </div>
                  <h2 className="text-xl font-black text-slate-800 mb-2 leading-snug">{selectedTopic.title}</h2>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-4">
                    <User size={14}/> {selectedTopic.creator_name}
                    <span className="text-slate-300">|</span>
                    <Clock size={14}/> {selectedTopic.created_at?.seconds ? new Date(selectedTopic.created_at.seconds * 1000).toLocaleString() : ''}
                  </div>
                  {selectedTopic.content && <div className="mt-4 p-4 bg-white rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap shadow-sm">{selectedTopic.content}</div>}
                  {/* 投票オプション */}
                  {selectedTopic.type === 'vote' && <div className="mt-4 space-y-2"><p className="text-xs font-bold text-slate-400">投票項目:</p>{renderVoteOptions(selectedTopic)}</div>}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/30">
                  <h3 className="font-bold text-slate-500 text-sm mb-4 flex items-center gap-2 sticky top-0 bg-slate-50/95 py-2 backdrop-blur-sm z-10 border-b border-slate-200"><MessageSquare size={16}/> コメント管理 ({comments.length})</h3>
                  {comments.length === 0 ? <div className="text-center py-10 text-slate-300 text-xs font-bold">コメントはまだありません</div> : (
                    <div className="space-y-3">
                      {comments.map((comment) => (
                        <div key={comment.id} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex gap-3 group hover:border-red-100 transition-colors">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-600">{comment.display_name}</span>
                              <span className="text-[10px] text-slate-300 font-mono">{comment.created_at?.seconds ? new Date(comment.created_at.seconds * 1000).toLocaleString() : ''}</span>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{comment.text || comment.content}</p>
                          </div>
                          <button onClick={() => handleDeleteComment(comment.id)} className="text-slate-200 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all self-start"><Trash2 size={16}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                <MessageCircle size={48} className="mb-4 opacity-20"/>
                <p className="font-bold">左のリストから投稿を選択してください</p>
                <p className="text-xs mt-2">詳細確認・コメント管理ができます</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}