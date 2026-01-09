'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { Video, Plus, Trash2, ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function MasterRecordingsPage() {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    grade: '中1',
    subject: '理科',
    title: '',
    url: ''
  });

  const fetchRecordings = async () => {
    try {
      // 授業日の降順で取得
      const q = query(
        collection(db, 'class_recordings'),
        orderBy('target_date', 'desc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRecordings(data);
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.url.startsWith('http')) return alert('URLは http から始まる形式で入力してください');
    if (!confirm('この動画をアーカイブに追加しますか？')) return;
    
    setLoading(true);
    
    try {
      await addDoc(collection(db, 'class_recordings'), {
        target_date: form.date,
        grade: form.grade,
        subject: form.subject,
        title: form.title || 'タイトルなし',
        video_url: form.url,
        created_at: new Date().toISOString()
      });

      setForm({ ...form, title: '', url: '' });
      alert('登録しました');
      fetchRecordings();

    } catch (error: any) {
      console.error(error);
      alert('エラー: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この録画情報を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'class_recordings', id));
      // ステートから除外して即時反映
      setRecordings(prev => prev.filter(r => r.id !== id));
    } catch (error: any) {
      alert('削除エラー: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Video className="text-red-600" /> 授業動画アーカイブ管理
          </h1>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* 左カラム: 登録フォーム */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-sm border-t-4 border-red-500 sticky top-8">
              <h2 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                <Plus size={20} /> 新規登録
              </h2>
              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">授業日</label>
                  <input type="date" required className="w-full p-3 border rounded-lg bg-gray-50 font-bold text-gray-700" value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">学年</label>
                    <select className="w-full p-3 border rounded-lg bg-gray-50 font-bold text-gray-700" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}>
                      <option>中1</option><option>中2</option><option>中3</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">科目</label>
                    <select className="w-full p-3 border rounded-lg bg-gray-50 font-bold text-gray-700" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}>
                      <option>理科</option><option>社会</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">タイトル</label>
                  <input type="text" placeholder="例: 電流の性質 パート1" className="w-full p-3 border rounded-lg bg-gray-50" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Zoom録画 URL</label>
                  <input type="url" required placeholder="https://..." className="w-full p-3 border rounded-lg bg-gray-50 text-sm" value={form.url} onChange={e => setForm({...form, url: e.target.value})} />
                </div>
                <button 
                  type="submit" 
                  disabled={loading} 
                  className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {loading ? <Loader2 className="animate-spin" size={20}/> : 'アーカイブに追加'}
                </button>
              </form>
            </div>
          </div>

          {/* 右カラム: リスト */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
              <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <h3 className="font-bold text-gray-700">登録済みリスト</h3>
                <span className="text-xs font-bold text-gray-400">{recordings.length}件</span>
              </div>
              
              {fetching ? (
                 <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recordings.map((rec) => (
                    <div key={rec.id} className="p-4 flex items-start justify-between hover:bg-gray-50 transition-colors group">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded border border-gray-200">
                            {rec.target_date}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${rec.subject === '理科' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {rec.grade} {rec.subject}
                          </span>
                        </div>
                        <div className="font-bold text-gray-800 mb-1">{rec.title}</div>
                        <a href={rec.video_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-mono">
                          <ExternalLink size={10} /> {rec.video_url}
                        </a>
                      </div>
                      <button 
                        onClick={() => handleDelete(rec.id)} 
                        className="text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        title="削除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  {recordings.length === 0 && (
                    <div className="p-10 text-center text-gray-400">データがありません</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}