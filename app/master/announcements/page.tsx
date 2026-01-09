'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { ArrowLeft, Send, Trash2, BellRing, Loader2, Tag } from 'lucide-react';
import Link from 'next/link';

// タグの定義
const LABELS = {
  important: { label: '重要', color: 'bg-red-50 text-red-600 border-red-200' },
  event:     { label: 'イベント', color: 'bg-orange-50 text-orange-600 border-orange-200' },
  info:      { label: 'お知らせ', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  alert:     { label: '緊急', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
};

export default function AnnouncementsPage() {
  const [list, setList] = useState<any[]>([]);
  // labelの初期値を 'info' に設定
  const [form, setForm] = useState({ title: '', content: '', target: 'all', label: 'info' });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchList();
  }, []);

  const fetchList = async () => {
    try {
      const q = query(collection(db, 'announcements'), orderBy('created_at', 'desc'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setList(data);
    } catch (error) { console.error(error); } finally { setFetching(false); }
  };

  const handleSubmit = async () => {
    if (!form.title || !form.content) return alert('タイトルと内容を入力してください');
    if (!confirm('お知らせを配信しますか？')) return;

    setLoading(true);
    try {
      await addDoc(collection(db, 'announcements'), {
        ...form,
        created_at: new Date().toISOString()
      });
      setForm({ title: '', content: '', target: 'all', label: 'info' }); // リセット
      alert('送信しました');
      fetchList();
    } catch (error: any) {
      alert('エラー: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
      setList(prev => prev.filter(item => item.id !== id));
    } catch (error: any) { alert('削除エラー: ' + error.message); }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BellRing className="text-blue-600" /> 連絡事項の管理
          </h1>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* 左: 作成フォーム */}
          <div className="md:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-sm border-t-4 border-blue-500 sticky top-8 space-y-4">
              <h2 className="font-bold text-gray-700 mb-2">新規作成</h2>
              
              {/* 送信先選択 */}
              <div>
                <label className="text-xs font-bold text-gray-500">送信先</label>
                <select 
                  className="w-full p-2 border rounded mt-1 bg-gray-50 text-sm"
                  value={form.target}
                  onChange={e => setForm({...form, target: e.target.value})}
                >
                  <option value="all">全員</option>
                  <option value="student">生徒のみ</option>
                  <option value="teacher">先生のみ</option>
                </select>
              </div>

              {/* ▼▼▼ タグ選択（追加部分） ▼▼▼ */}
              <div>
                <label className="text-xs font-bold text-gray-500">タグ設定</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
                    <button
                      key={key}
                      onClick={() => setForm({...form, label: key})}
                      className={`text-xs font-bold py-2 rounded border transition-all ${
                        form.label === key 
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {LABELS[key].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500">タイトル</label>
                <input 
                  className="w-full p-2 border rounded mt-1"
                  placeholder="タイトル"
                  value={form.title}
                  onChange={e => setForm({...form, title: e.target.value})}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">内容</label>
                <textarea 
                  className="w-full p-2 border rounded mt-1 h-32 resize-none"
                  placeholder="内容を入力..."
                  value={form.content}
                  onChange={e => setForm({...form, content: e.target.value})}
                />
              </div>
              <button 
                onClick={handleSubmit}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="animate-spin" size={16}/> : <Send size={16}/>} 
                送信する
              </button>
            </div>
          </div>

          {/* 右: 履歴リスト */}
          <div className="md:col-span-2 space-y-4">
            <h2 className="font-bold text-gray-700 flex justify-between items-center">
              送信履歴 <span className="text-xs font-normal text-gray-400">{list.length}件</span>
            </h2>
            {fetching ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400"/></div>
            ) : list.map(item => {
              // 古いデータにlabelがない場合のフォールバック: 'info'
              const labelKey = (item.label || 'info') as keyof typeof LABELS;
              const labelInfo = LABELS[labelKey] || LABELS.info;

              return (
                <div key={item.id} className="bg-white p-5 rounded-xl shadow-sm relative group border border-gray-100">
                  <button 
                    onClick={() => handleDelete(item.id)}
                    className="absolute top-4 right-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="flex gap-2 mb-2 items-center">
                    {/* タグ表示 */}
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${labelInfo.color}`}>
                      {labelInfo.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
                    </span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      To: {item.target === 'all' ? '全員' : item.target === 'student' ? '生徒' : '先生'}
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-800">{item.title}</h3>
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{item.content}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}