'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, Search, Save, Users, Loader2 } from 'lucide-react';
// import Link from 'next/link'; // Linkは削除

export default function TeacherListPage() {
  const { user, loading: authLoading } = useAuth();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    if (!user) return;
    const fetchTeachers = async () => {
      try {
        const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
        const snapshot = await getDocs(q);
        setTeachers(snapshot.docs.map(d => ({ uid: d.id, ...d.data() })));
      } catch (e) { console.error(e); } 
      finally { setLoading(false); }
    };
    fetchTeachers();
  }, [user]);

  const handleUpdate = async (uid: string) => {
    if (!confirm('変更を保存しますか？')) return;
    try {
      await updateDoc(doc(db, 'users', uid), editForm);
      setTeachers(prev => prev.map(t => t.uid === uid ? { ...t, ...editForm } : t));
      setEditingId(null);
      alert('保存しました');
    } catch (e: any) {
      alert('エラー: ' + e.message);
    }
  };

  const startEdit = (teacher: any) => {
    setEditingId(teacher.uid);
    setEditForm(teacher);
  };

  const filtered = teachers.filter(t => (t.name || '').includes(search));

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center gap-2"><Loader2 className="animate-spin"/> 読み込み中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          {/* ★修正ポイント: 強制的にマスター画面へ戻るボタンに変更 */}
          <button 
            onClick={() => window.location.href = '/master'} 
            className="bg-white p-2 rounded-full shadow hover:bg-gray-100 transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-800">
            <Users className="text-purple-600"/> 講師リスト管理
          </h1>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex gap-2 border border-gray-100">
          <Search className="text-gray-400" />
          <input 
            type="text" 
            placeholder="講師名で検索..." 
            className="w-full outline-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b">
              <tr>
                <th className="p-4 w-1/4">氏名</th>
                <th className="p-4 w-1/4">メールアドレス</th>
                <th className="p-4 w-1/4">担当教科 (メモ)</th>
                <th className="p-4 w-1/4">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(t => (
                <tr key={t.uid} className="hover:bg-gray-50">
                  <td className="p-4 font-bold text-gray-800">
                    {editingId === t.uid ? (
                      <input className="border rounded p-1 w-full" value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})}/>
                    ) : t.name}
                  </td>
                  <td className="p-4 text-gray-500">{t.email}</td>
                  <td className="p-4">
                    {editingId === t.uid ? (
                      <input className="border rounded p-1 w-full" placeholder="英語, 数学" value={editForm.subject || ''} onChange={e => setEditForm({...editForm, subject: e.target.value})}/>
                    ) : <span className="text-gray-500">{t.subject || '-'}</span>}
                  </td>
                  <td className="p-4">
                    {editingId === t.uid ? (
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(t.uid)} className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center gap-1"><Save size={14}/> 保存</button>
                        <button onClick={() => setEditingId(null)} className="bg-gray-300 text-gray-700 px-3 py-1 rounded">中止</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(t)} className="text-blue-600 hover:underline font-bold">編集</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-gray-400">登録講師がいません</div>}
        </div>
      </div>
    </div>
  );
}