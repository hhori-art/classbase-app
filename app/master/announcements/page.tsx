'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { ArrowLeft, Send, Trash2, BellRing, Loader2, Tag, Filter, XCircle } from 'lucide-react';
import Link from 'next/link';

// タグの定義
const LABELS = {
  important: { label: '重要', color: 'bg-red-50 text-red-600 border-red-200' },
  event:     { label: 'イベント', color: 'bg-orange-50 text-orange-600 border-orange-200' },
  info:      { label: 'お知らせ', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  alert:     { label: '緊急', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
};

// 送信先の表示名
const TARGET_NAMES: {[key: string]: string} = {
  all: '全員',
  student: '生徒',
  teacher: '先生'
};

export default function AnnouncementsPage() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', content: '', target: 'all', label: 'info' });
  
  // ★フィルター用ステート
  const [filterLabel, setFilterLabel] = useState('all');   // 'all' | 'important' | ...
  const [filterTarget, setFilterTarget] = useState('any'); // 'any'(全て表示) | 'all'(全員宛) | 'student' | 'teacher'

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
      setForm({ title: '', content: '', target: 'all', label: 'info' });
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

  // ★フィルタリングロジック
  const filteredList = list.filter(item => {
    const itemLabel = item.label || 'info';
    
    // タグフィルター (選択なし or 一致)
    const matchLabel = filterLabel === 'all' || itemLabel === filterLabel;
    
    // 送信先フィルター ('any'なら全件表示、それ以外は target が一致するもの)
    const matchTarget = filterTarget === 'any' || item.target === filterTarget;

    return matchLabel && matchTarget;
  });

  return (
    <div className="min-h-screen bg-gray-100 p-8 pb-32 font-sans">
      <div className="max-w-5xl mx-auto">
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
              <h2 className="font-bold text-gray-700 mb-2 flex items-center gap-2"><Send size={16}/> 新規作成</h2>
              
              <div>
                <label className="text-xs font-bold text-gray-500">送信先</label>
                <select 
                  className="w-full p-2 border rounded mt-1 bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  value={form.target}
                  onChange={e => setForm({...form, target: e.target.value})}
                >
                  <option value="all">全員</option>
                  <option value="student">生徒のみ</option>
                  <option value="teacher">先生のみ</option>
                </select>
              </div>

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
                  className="w-full p-2 border rounded mt-1 outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="タイトル"
                  value={form.title}
                  onChange={e => setForm({...form, title: e.target.value})}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">内容</label>
                <textarea 
                  className="w-full p-2 border rounded mt-1 h-32 resize-none outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="内容を入力..."
                  value={form.content}
                  onChange={e => setForm({...form, content: e.target.value})}
                />
              </div>
              <button 
                onClick={handleSubmit}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-95 shadow-lg shadow-blue-200"
              >
                {loading ? <Loader2 className="animate-spin" size={16}/> : <Send size={16}/>} 
                送信する
              </button>
            </div>
          </div>

          {/* 右: 履歴リスト */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex flex-col gap-3">
              <h2 className="font-bold text-gray-700 flex justify-between items-center">
                送信履歴 <span className="text-xs font-normal text-gray-400">全{list.length}件 / 表示{filteredList.length}件</span>
              </h2>

              {/* ★フィルターUI */}
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2 text-gray-400">
                  <Filter size={14}/>
                  <span className="text-xs font-bold">絞り込み:</span>
                </div>
                
                {/* 送信先フィルター */}
                <select 
                  value={filterTarget} 
                  onChange={(e) => setFilterTarget(e.target.value)}
                  className="bg-gray-50 border border-gray-200 text-xs font-bold text-gray-700 rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <option value="any">送信先: 全て</option>
                  <option value="all">全員宛て</option>
                  <option value="student">生徒宛て</option>
                  <option value="teacher">先生宛て</option>
                </select>

                {/* タグフィルター */}
                <div className="flex flex-wrap gap-1 items-center">
                  <button 
                    onClick={() => setFilterLabel('all')}
                    className={`text-[10px] px-3 py-1.5 rounded-md font-bold transition-colors border ${filterLabel === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >
                    全タグ
                  </button>
                  {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
                    <button
                      key={key}
                      onClick={() => setFilterLabel(key)}
                      className={`text-[10px] px-2 py-1.5 rounded-md font-bold transition-colors border ${
                        filterLabel === key 
                          ? LABELS[key].color 
                          : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {LABELS[key].label}
                    </button>
                  ))}
                </div>

                {/* リセットボタン */}
                {(filterLabel !== 'all' || filterTarget !== 'any') && (
                  <button 
                    onClick={() => { setFilterLabel('all'); setFilterTarget('any'); }} 
                    className="ml-auto text-xs text-red-400 hover:text-red-600 flex items-center gap-1 font-bold bg-red-50 px-2 py-1 rounded-full hover:bg-red-100 transition-colors"
                  >
                    <XCircle size={12}/> 解除
                  </button>
                )}
              </div>
            </div>

            {fetching ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400"/></div>
            ) : filteredList.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 text-sm font-bold">
                条件に一致するお知らせはありません
              </div>
            ) : (
              filteredList.map(item => {
                const labelKey = (item.label || 'info') as keyof typeof LABELS;
                const labelInfo = LABELS[labelKey] || LABELS.info;

                return (
                  <div key={item.id} className="bg-white p-5 rounded-xl shadow-sm relative group border border-gray-100 hover:border-blue-200 transition-colors">
                    <button 
                      onClick={() => handleDelete(item.id)}
                      className="absolute top-4 right-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all bg-white p-1 rounded-full shadow-sm"
                    >
                      <Trash2 size={16} />
                    </button>
                    <div className="flex flex-wrap gap-2 mb-2 items-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${labelInfo.color}`}>
                        {labelInfo.label}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">
                        {item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
                      </span>
                      <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                        To: {TARGET_NAMES[item.target] || '全員'}
                      </span>
                    </div>
                    <h3 className="font-bold text-gray-800 text-lg">{item.title}</h3>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2 whitespace-pre-wrap">{item.content}</p>
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