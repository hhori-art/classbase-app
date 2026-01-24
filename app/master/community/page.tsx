'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, MessageCircle, Check, Trash2, Loader2, User, Clock, ShieldAlert } from 'lucide-react';

export default function CommunityManagerPage() {
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeTopics, setActiveTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
      // インデックス作成中のエラー回避用
      try {
        const q1 = query(collection(db, 'community_topics'), where('is_approved', '==', false));
        const snap1 = await getDocs(q1);
        setPendingRequests(snap1.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const q2 = query(collection(db, 'community_topics'), where('is_approved', '==', true));
        const snap2 = await getDocs(q2);
        setActiveTopics(snap2.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch(e2) { alert('読み込みエラー'); }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // 承認
  const handleApprove = async (id: string) => {
    if (!confirm('承認して公開しますか？')) return;
    await updateDoc(doc(db, 'community_topics', id), { is_approved: true });
    fetchAll(); // リロード
  };

  // 削除 (共通)
  const handleDelete = async (id: string, isPublic: boolean) => {
    if (!confirm(isPublic ? '【警告】公開中の投稿を削除します。よろしいですか？' : '申請を却下・削除しますか？')) return;
    await deleteDoc(doc(db, 'community_topics', id));
    if (isPublic) {
      setActiveTopics(prev => prev.filter(r => r.id !== id));
    } else {
      setPendingRequests(prev => prev.filter(r => r.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-800">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors"><ArrowLeft size={24} /></Link>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2"><MessageCircle className="text-pink-500" /> コミュニティ申請管理</h1>
        </div>

        {/* 1. 承認待ちエリア */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-pink-100 mb-8">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">承認待ち <span className="bg-pink-100 text-pink-600 text-xs px-2 py-0.5 rounded-full">{pendingRequests.length}</span></h2>
          {loading ? <Loader2 className="animate-spin text-gray-400"/> : pendingRequests.length === 0 ? <p className="text-sm text-gray-400">承認待ちはありません</p> : (
            <div className="space-y-4">{pendingRequests.map(req => (
              <div key={req.id} className="border border-gray-200 rounded-xl p-4 bg-pink-50/30">
                <div className="flex justify-between mb-2">
                  <div className="flex gap-2 items-center"><span className="text-xs font-bold bg-white border px-2 rounded">{req.type === 'vote' ? '投票' : 'スレッド'}</span><span className="text-xs font-bold text-gray-600">{req.creator_name}</span></div>
                  <span className="text-[10px] text-gray-400">{req.created_at?.toDate().toLocaleDateString()}</span>
                </div>
                <h3 className="font-bold text-gray-800 mb-3">{req.title}</h3>
                <div className="flex justify-end gap-2">
                  <button onClick={() => handleDelete(req.id, false)} className="text-xs font-bold text-red-400 px-3 py-2 hover:bg-red-50 rounded">却下</button>
                  <button onClick={() => handleApprove(req.id)} className="text-xs font-bold bg-pink-500 text-white px-4 py-2 rounded hover:bg-pink-600 shadow">承認する</button>
                </div>
              </div>
            ))}</div>
          )}
        </div>

        {/* 2. 公開中エリア (削除機能付き) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-700">公開中の投稿 (削除可能)</h2>
          {activeTopics.length === 0 ? <p className="text-sm text-gray-400">公開中の投稿はありません</p> : (
            <div className="space-y-4">{activeTopics.map(topic => (
              <div key={topic.id} className="border border-gray-200 rounded-xl p-4 flex justify-between items-center group hover:bg-gray-50 transition-colors">
                <div>
                  <div className="flex gap-2 items-center mb-1">
                    <span className="text-[10px] font-bold bg-gray-100 px-2 rounded text-gray-500">{topic.type === 'vote' ? '投票' : 'スレッド'}</span>
                    <span className="text-xs text-gray-500">{topic.creator_name}</span>
                    <span className="text-[10px] text-gray-300">いいね: {topic.likes || 0}</span>
                  </div>
                  <h3 className="font-bold text-gray-800 text-sm">{topic.title}</h3>
                </div>
                <button 
                  onClick={() => handleDelete(topic.id, true)} 
                  className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                  title="投稿を削除"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}</div>
          )}
        </div>

      </div>
    </div>
  );
}