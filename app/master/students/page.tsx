'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, Search, Save, Loader2, GraduationCap } from 'lucide-react';
import Link from 'next/link';

export default function StudentListPage() {
  const { user, loading: authLoading } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // 編集用ステート
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  // データ取得
  useEffect(() => {
    if (!user) return;
    
    const fetchStudents = async () => {
      try {
        const q = query(collection(db, 'users'), where('role', '==', 'student'));
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
        setStudents(list);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStudents();
  }, [user]);

  // 更新処理
  const handleUpdate = async (uid: string) => {
    if (!confirm('変更を保存しますか？')) return;
    try {
      await updateDoc(doc(db, 'users', uid), editForm);
      setStudents(prev => prev.map(s => s.uid === uid ? { ...s, ...editForm } : s));
      setEditingId(null);
      alert('保存しました');
    } catch (e: any) {
      alert('エラー: ' + e.message);
    }
  };

  // 編集モード開始
  const startEdit = (student: any) => {
    setEditingId(student.uid);
    setEditForm(student);
  };

  // フィルタリング
  const filtered = students.filter(s => 
    (s.student_name || '').includes(search) || 
    (s.grade || '').includes(search)
  );

  if (authLoading || loading) return <div className="p-10 text-center">読み込み中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="text-green-600"/> 生徒リスト管理
          </h1>
        </div>

        {/* 検索バー */}
        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex gap-2">
          <Search className="text-gray-400" />
          <input 
            type="text" 
            placeholder="名前や学年で検索..." 
            className="w-full outline-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* リスト表示 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100 text-gray-600 border-b">
              <tr>
                <th className="p-4">氏名</th>
                <th className="p-4">ID</th>
                <th className="p-4">学年</th>
                <th className="p-4">教室</th>
                <th className="p-4">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.uid} className="hover:bg-gray-50">
                  <td className="p-4 font-bold">
                    {editingId === s.uid ? (
                      <input 
                        className="border rounded p-1" 
                        value={editForm.student_name || ''} 
                        onChange={e => setEditForm({...editForm, student_name: e.target.value})}
                      />
                    ) : s.student_name}
                  </td>
                  <td className="p-4 text-gray-500">{s.lifetime_id}</td>
                  <td className="p-4">
                    {editingId === s.uid ? (
                      <select 
                        className="border rounded p-1"
                        value={editForm.grade || ''}
                        onChange={e => setEditForm({...editForm, grade: e.target.value})}
                      >
                        <option>中1</option><option>中2</option><option>中3</option>
                      </select>
                    ) : <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs">{s.grade}</span>}
                  </td>
                  <td className="p-4">
                    {editingId === s.uid ? (
                      <input 
                        className="border rounded p-1 w-20" 
                        value={editForm.classroom || ''} 
                        onChange={e => setEditForm({...editForm, classroom: e.target.value})}
                      />
                    ) : s.classroom}
                  </td>
                  <td className="p-4">
                    {editingId === s.uid ? (
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(s.uid)} className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center gap-1">
                          <Save size={14}/> 保存
                        </button>
                        <button onClick={() => setEditingId(null)} className="bg-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-400">
                          中止
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(s)} className="text-blue-600 hover:underline">
                        編集
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-gray-400">該当する生徒がいません</div>}
        </div>
      </div>
    </div>
  );
}