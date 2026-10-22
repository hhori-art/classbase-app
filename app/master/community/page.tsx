'use client';

import { useState, useEffect, useMemo } from 'react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import CommunityReportsPanel from '@/app/components/master/CommunityReportsPanel';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, deleteDoc, writeBatch, getDoc, serverTimestamp } from 'firebase/firestore';
import { reportAuditLog } from '@/app/components/master/audit-log-client';
import { MessageCircle, Check, Trash2, User, Clock, ShieldAlert, X, Search, MessageSquare, ListChecks } from 'lucide-react';

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
  const [loadError, setLoadError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  // データ取得
  const fetchAll = async () => {
    setLoading(true);
    setLoadError('');
    try {
      // 承認待ち
      const q1 = query(collection(db, 'community_topics'), where('is_approved', '==', false), orderBy('created_at', 'desc'));
      const snap1 = await getDocs(q1);
      setPendingRequests(snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((item: any) => item.archived !== true));

      // 公開中 (承認済み)
      const q2 = query(collection(db, 'community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'));
      const snap2 = await getDocs(q2);
      setActiveTopics(snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((item: any) => item.archived !== true));

    } catch (e) {
      console.error(e);
      try {
        const q1 = query(collection(db, 'community_topics'), where('is_approved', '==', false));
        const snap1 = await getDocs(q1);
        setPendingRequests(snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((item: any) => item.archived !== true));

        const q2 = query(collection(db, 'community_topics'), where('is_approved', '==', true));
        const snap2 = await getDocs(q2);
        setActiveTopics(snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((item: any) => item.archived !== true));
      } catch (e2) {
        console.error(e2);
        setLoadError('投稿を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
      }
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
    } catch (e) { console.error(e); toast.error('コメントを読み込めませんでした。もう一度投稿を選んでください。'); }
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
    if (!(await confirm({ title: `${selectedIds.size}件を一括承認して公開しますか？`, message: '承認すると参加者全員に公開されます。', confirmLabel: '承認して公開' }))) return;
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
      toast.success('承認して公開しました');
    } catch (e) { console.error(e); toast.error('承認できませんでした。もう一度お試しください。'); }
    finally { setProcessing(false); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: activeTab === 'pending' ? `選択した${selectedIds.size}件の申請を却下（削除）しますか？` : `公開中の投稿${selectedIds.size}件を削除しますか？`,
      message: activeTab === 'active' ? '削除すると参加者の画面からも見えなくなります。' : undefined,
      confirmLabel: activeTab === 'pending' ? '却下する' : '削除する',
      tone: 'danger',
    });
    if (!ok) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'community_topics', id);
        batch.update(ref, { archived: true, is_approved: false, archived_at: serverTimestamp() });
      });
      await batch.commit();

      if (activeTab === 'pending') setPendingRequests(prev => prev.filter(r => !selectedIds.has(r.id)));
      else setActiveTopics(prev => prev.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      setSelectedTopic(null);
    } catch (e) { console.error(e); toast.error('削除できませんでした。もう一度お試しください。'); }
    finally { setProcessing(false); }
  };

  // 個別操作
  const handleApprove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const topic = pendingRequests.find(r => r.id === id);
    if (!(await confirm({ title: `「${topic?.title || 'この投稿'}」を承認して公開しますか？`, confirmLabel: '承認して公開' }))) return;
    try {
      await updateDoc(doc(db, 'community_topics', id), { is_approved: true });
      const target = pendingRequests.find(r => r.id === id);
      if (target) {
        setPendingRequests(prev => prev.filter(r => r.id !== id));
        setActiveTopics(prev => [{ ...target, is_approved: true }, ...prev]);
      }
      if (selectedTopic?.id === id) setSelectedTopic(null);
    } catch (e) { console.error(e); toast.error('承認できませんでした。もう一度お試しください。'); }
  };

  const handleDeleteTopic = async (e: React.MouseEvent | null, id: string) => {
    if (e) e.stopPropagation();
    const topic = (activeTab === 'active' ? activeTopics : pendingRequests).find(r => r.id === id);
    const name = topic?.title || 'この投稿';
    const ok = await confirm({
      title: activeTab === 'active' ? `公開中の「${name}」を削除しますか？` : `「${name}」の申請を却下（削除）しますか？`,
      message: activeTab === 'active' ? '削除すると参加者の画面からも見えなくなります。' : undefined,
      confirmLabel: activeTab === 'active' ? '削除する' : '却下する',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'community_topics', id), { archived: true, is_approved: false, archived_at: serverTimestamp() });
      void reportAuditLog({ action: 'community_topic_archive', target_type: 'community_topic', target_id: id, target_label: name, details: { was_approved: activeTab === 'active' } });
      if (activeTab === 'active') setActiveTopics(prev => prev.filter(r => r.id !== id));
      else setPendingRequests(prev => prev.filter(r => r.id !== id));
      if (selectedTopic?.id === id) setSelectedTopic(null);
    } catch (e) { console.error(e); toast.error('削除できませんでした。もう一度お試しください。'); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedTopic) return;
    const comment = comments.find(c => c.id === commentId);
    if (!(await confirm({ title: `${comment?.display_name ? `${comment.display_name}さんの` : 'この'}コメントを削除しますか？`, message: String(comment?.text || comment?.content || '').slice(0, 80) || undefined, confirmLabel: '削除する', tone: 'danger' }))) return;
    try {
      await deleteDoc(doc(db, `community_topics/${selectedTopic.id}/comments`, commentId));
      setComments(prev => prev.filter(c => c.id !== commentId));
      void reportAuditLog({
        action: 'community_comment_delete',
        target_type: 'community_comment',
        target_id: `${selectedTopic.id}/${commentId}`,
        target_label: String(comment?.display_name || ''),
        details: { topic_id: selectedTopic.id, text: String(comment?.text || comment?.content || '').slice(0, 80) },
      });
    } catch (e) { console.error(e); toast.error('コメントを削除できませんでした。もう一度お試しください。'); }
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
      return <div className="text-xs text-slate-400 bg-slate-100 p-2 rounded-btn">選択肢データなし</div>;
    }

    return options.map((opt: any, i: number) => {
      // オブジェクトか文字列か判定
      const text = typeof opt === 'object' ? (opt.text || opt.label || opt.option || `選択肢${i+1}`) : opt;
      const votes = typeof opt === 'object' ? (opt.votes || opt.count || 0) : 0;

      return (
        <div key={i} className="bg-white border border-slate-200 p-3 rounded-btn text-xs font-bold text-slate-600 flex justify-between items-center shadow-sm">
          <span>{text}</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded-full text-slate-500">{votes}票</span>
        </div>
      );
    });
  };

  return (
    <div className="font-sans text-slate-800">
      <div className="h-[calc(100vh-100px)] flex flex-col">
        <div className="shrink-0">
          <AdminPageHeader
            description="参加者同士に公開される投稿・コメントを管理します。正式な一方向連絡は「お知らせ配信」を使用してください。"
          />
        </div>

        <CommunityReportsPanel />

        <div className="flex gap-6 flex-1 min-h-0">
          
          {/* 左カラム: リスト */}
          <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col gap-4">
            
            {/* コントロールバー */}
            <div className="bg-white p-2 rounded-card shadow-sm border border-line flex flex-col gap-3 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AdminTabs
                  size="sm"
                  ariaLabel="投稿の状態"
                  urlParam="tab"
                  value={activeTab}
                  onChange={setActiveTab}
                  tabs={[
                    { id: 'pending', icon: ShieldAlert, label: '承認待ち', badge: pendingRequests.length },
                    { id: 'active', icon: Check, label: '公開中' },
                  ]}
                />
                <div className="relative flex-1 min-w-[140px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden/>
                  <input type="text" aria-label="タイトル・名前で検索" placeholder="タイトル・名前で検索" className="w-full min-h-10 pl-9 pr-3 py-2 bg-slate-50 border border-line rounded-input text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
              </div>

              {/* 一括操作バー */}
              <div className="flex items-center justify-between px-1 pt-1 border-t border-slate-100">
                <Button variant="ghost" size="sm" onClick={toggleSelectAll} icon={<ListChecks size={16} aria-hidden/>}>
                  {displayedList.length > 0 && displayedList.every(i => selectedIds.has(i.id)) ? '選択解除' : 'すべて選択'}
                </Button>
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-5 duration-300">
                    <span className="text-xs font-bold text-slate-400">{selectedIds.size}件選択中</span>
                    <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={processing} icon={<Trash2 size={14} aria-hidden/>}>削除</Button>
                    {activeTab === 'pending' && <Button size="sm" onClick={handleBulkApprove} loading={processing} icon={<Check size={14} aria-hidden/>}>承認</Button>}
                  </div>
                )}
              </div>
            </div>

            {/* リスト本体 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
              {loading ? (
                <ListSkeleton rows={4}/>
              ) : loadError ? (
                <ErrorState message={loadError} onRetry={fetchAll}/>
              ) : displayedList.length === 0 ? (
                <EmptyState
                  icon={MessageCircle}
                  title={searchQuery ? '条件に合う投稿はありません' : activeTab === 'pending' ? '承認待ちの投稿はありません' : '公開中の投稿はありません'}
                />
              ) : (
                displayedList.map(item => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <div key={item.id} onClick={() => handleSelectTopic(item)} className={`bg-white p-4 rounded-card border-2 transition-all cursor-pointer group hover:shadow-md relative overflow-hidden ${isSelected ? 'border-accent bg-accent-soft/40' : selectedTopic?.id === item.id ? 'border-accent/60 bg-white ring-2 ring-accent/20' : 'border-slate-100 hover:border-accent/40'}`}>
                      <div className="absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center z-10" onClick={(e) => toggleSelect(item.id, e)}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-accent border-accent text-accent-ink' : 'bg-white border-slate-300 group-hover:border-accent/60'}`}>
                          {isSelected && <Check size={12} strokeWidth={4}/>}
                        </div>
                      </div>
                      <div className="pl-8">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.type === 'vote' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{item.type === 'vote' ? '投票' : 'スレッド'}</span>
                            <span className="text-xs font-bold text-slate-500 truncate max-w-[100px]">{item.creator_name}</span>
                          </div>
                          <span className="text-xs text-slate-400 shrink-0">{item.created_at?.seconds ? formatDate(new Date(item.created_at.seconds * 1000), { withYear: true }) : '新着'}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-sm mb-3 line-clamp-2">{item.title}</h3>
                        <div className="flex gap-2 border-t border-slate-100 pt-2 mt-1">
                          {activeTab === 'pending' && <Button size="sm" className="flex-1" onClick={(e) => handleApprove(e, item.id)} icon={<Check size={14} strokeWidth={3} aria-hidden/>}>承認</Button>}
                          <IconButton label={activeTab === 'pending' ? '却下（削除）する' : '削除する'} size="sm" onClick={(e) => handleDeleteTopic(e, item.id)} className="ml-auto text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={16} aria-hidden/></IconButton>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 右カラム: 詳細プレビュー & コメント管理 */}
          <div className="hidden lg:flex flex-1 bg-white rounded-card border border-line shadow-sm overflow-hidden flex-col relative">
            {selectedTopic ? (
              <>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 overflow-y-auto max-h-[50vh] custom-scrollbar">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${selectedTopic.type === 'vote' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                      {selectedTopic.type === 'vote' ? '投票機能付き' : '通常スレッド'}
                    </span>
                    <IconButton label="詳細を閉じる" onClick={() => setSelectedTopic(null)} className="text-slate-400"><X size={20} aria-hidden/></IconButton>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 mb-2 leading-snug">{selectedTopic.title}</h2>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-4">
                    <User size={14}/> {selectedTopic.creator_name}
                    <span className="text-slate-300">|</span>
                    <Clock size={14}/> {selectedTopic.created_at?.seconds ? formatDateTime(new Date(selectedTopic.created_at.seconds * 1000), { withYear: true }) : ''}
                  </div>
                  {selectedTopic.content && <div className="mt-4 p-4 bg-white rounded-btn border border-slate-100 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap shadow-sm">{selectedTopic.content}</div>}
                  {/* 投票オプション */}
                  {selectedTopic.type === 'vote' && <div className="mt-4 space-y-2"><p className="text-xs font-bold text-slate-400">投票項目:</p>{renderVoteOptions(selectedTopic)}</div>}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/30">
                  <h3 className="font-bold text-slate-500 text-sm mb-4 flex items-center gap-2 sticky top-0 bg-slate-50/95 py-2 backdrop-blur-sm z-10 border-b border-slate-200"><MessageSquare size={16}/> コメント管理 ({comments.length})</h3>
                  {comments.length === 0 ? <EmptyState icon={MessageSquare} title="コメントはまだありません"/> : (
                    <div className="space-y-3">
                      {comments.map((comment) => (
                        <div key={comment.id} className="bg-white p-3 rounded-btn border border-slate-100 shadow-sm flex gap-3 group hover:border-rose-100 transition-colors">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-600">{comment.display_name}</span>
                              <span className="text-xs text-slate-400">{comment.created_at?.seconds ? formatDateTime(new Date(comment.created_at.seconds * 1000), { withYear: true }) : ''}</span>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{comment.text || comment.content}</p>
                          </div>
                          <IconButton label="コメントを削除" size="sm" onClick={() => handleDeleteComment(comment.id)} className="self-start text-slate-300 hover:bg-rose-50 hover:text-rose-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Trash2 size={16} aria-hidden/></IconButton>
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
