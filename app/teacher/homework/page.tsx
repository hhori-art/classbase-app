'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { ArrowLeft, Plus, Trash2, Calendar, BookOpen, ChevronRight, Loader2, X } from 'lucide-react';
import Link from 'next/link';

export default function TeacherHomeworkPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // 新規作成フォーム
  const [form, setForm] = useState({
    title: '',
    content: '',
    subject: '理科',
    grade: '中1',
    deadline: ''
  });

  // データ取得
  const fetchAssignments = async () => {
    if (!user) return;
    try {
      // 作成日順などで並べたいが、複合インデックスが必要になる可能性があるため
      // シンプルに取得してからJSでソートします
      const q = query(collection(db, 'assignments'));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 締め切りが近い順にソート
      list.sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
      
      setAssignments(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchAssignments();
  }, [user]);

  // 新規作成
  const handleCreate = async () => {
    if (!form.title || !form.deadline) return alert('タイトルと提出期限は必須です');
    if (!confirm('この内容で課題を配信しますか？')) return;

    try {
      await addDoc(collection(db, 'assignments'), {
        ...form,
        created_by: user?.uid,
        created_at: new Date().toISOString(),
        status: 'active'
      });
      alert('課題を作成しました');
      setShowModal(false);
      setForm({ title: '', content: '', subject: '理科', grade: '中1', deadline: '' });
      fetchAssignments();
    } catch (e: any) {
      alert('エラー: ' + e.message);
    }
  };

  // 削除
  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？\n(提出されたデータも見えなくなります)')) return;
    try {
      await deleteDoc(doc(db, 'assignments', id));
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      alert('削除エラー: ' + e.message);
    }
  };

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin"/></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32">
      <div className="max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/teacher" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <BookOpen className="text-orange-500" /> 宿題管理
            </h1>
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="bg-orange-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:bg-orange-700 flex items-center gap-2"
          >
            <Plus size={20}/> 新規作成
          </button>
        </div>

        {/* リスト表示 */}
        <div className="space-y-4">
          {assignments.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border border-dashed">
              現在、宿題はありません
            </div>
          ) : (
            assignments.map((assign) => (
              <div key={assign.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:border-orange-200 transition-colors">
                
                <Link href={`/teacher/homework/${assign.id}`} className="flex-1 cursor-pointer">
                  <div className="flex items-start gap-4">
                    <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white ${assign.subject === '理科' ? 'bg-green-500' : assign.subject === '数学' ? 'bg-blue-500' : 'bg-orange-400'}`}>
                      {assign.subject?.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded font-bold">{assign.grade}</span>
                        <h3 className="font-bold text-gray-800 text-lg group-hover:text-orange-600 transition-colors">
                          {assign.title}
                        </h3>
                      </div>
                      <p className="text-xs text-red-500 font-bold flex items-center gap-1">
                        <Calendar size={12}/> 期限: {assign.deadline}
                      </p>
                    </div>
                  </div>
                </Link>

                <div className="flex items-center justify-end gap-3 border-t md:border-t-0 pt-3 md:pt-0">
                  <Link href={`/teacher/homework/${assign.id}`} className="text-sm font-bold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-1">
                    提出確認 <ChevronRight size={16}/>
                  </Link>
                  <button onClick={() => handleDelete(assign.id)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg">
                    <Trash2 size={18}/>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 新規作成モーダル */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
              <div className="flex justify-between items-center mb-6 border-b pb-2">
                <h2 className="font-bold text-lg text-gray-800">新しい課題を作成</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">タイトル</label>
                  <input type="text" className="w-full p-3 border rounded-lg bg-gray-50" placeholder="例: 電流と磁界の復習" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">教科</label>
                    <select className="w-full p-3 border rounded-lg bg-gray-50" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}>
                      <option>理科</option><option>社会</option><option>数学</option><option>英語</option><option>国語</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">対象学年</label>
                    <select className="w-full p-3 border rounded-lg bg-gray-50" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}>
                      <option>中1</option><option>中2</option><option>中3</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">提出期限</label>
                  <input type="date" className="w-full p-3 border rounded-lg bg-gray-50" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">詳細・説明</label>
                  <textarea className="w-full p-3 border rounded-lg bg-gray-50 h-24" placeholder="テキストのP.20〜22を解いて提出してください" value={form.content} onChange={e => setForm({...form, content: e.target.value})} />
                </div>

                <button onClick={handleCreate} className="w-full bg-orange-600 text-white font-bold py-3 rounded-xl hover:bg-orange-700 shadow-lg mt-2">
                  作成する
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}