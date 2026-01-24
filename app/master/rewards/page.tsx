'use client';

import { useState, useEffect, useRef } from 'react';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Loader2, Plus, Trash2, Image as ImageIcon, Coins, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function RewardsManagementPage() {
  const [rewards, setRewards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // フォーム入力用
  const [name, setName] = useState('');
  const [coins, setCoins] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // データ取得
  const fetchRewards = async () => {
    try {
      const q = query(collection(db, 'rewards'), orderBy('required_coins', 'asc'));
      const snapshot = await getDocs(q);
      setRewards(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRewards();
  }, []);

  // 画像選択時の処理
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  // 登録処理
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !coins || !imageFile) return alert('全ての項目を入力してください');
    
    setSubmitting(true);
    try {
      // 1. 画像をStorageにアップロード
      const storageRef = ref(storage, `rewards/${Date.now()}_${imageFile.name}`);
      const uploadSnap = await uploadBytes(storageRef, imageFile);
      const imageUrl = await getDownloadURL(uploadSnap.ref);

      // 2. Firestoreに保存
      await addDoc(collection(db, 'rewards'), {
        name: name,
        required_coins: Number(coins),
        image_url: imageUrl,
        created_at: serverTimestamp()
      });

      alert('景品を追加しました！');
      // フォームリセット
      setName('');
      setCoins('');
      setImageFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // リスト更新
      fetchRewards();

    } catch (error) {
      console.error(error);
      alert('登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // 削除処理
  const handleDelete = async (id: string) => {
    if (!confirm('本当にこの景品を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'rewards', id));
      setRewards(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      alert('削除に失敗しました');
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-3 rounded-full shadow-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">景品アイテム登録・管理</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* 左側：登録フォーム */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit">
            <h2 className="font-bold text-gray-700 mb-6 flex items-center gap-2">
              <Plus className="bg-yellow-100 text-yellow-600 rounded p-1" size={24} />
              新しい景品を追加
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 画像アップロード */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">景品画像</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-video bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden relative"
                >
                  {previewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <ImageIcon className="mx-auto mb-2" />
                      <span className="text-xs">クリックして画像を選択</span>
                    </div>
                  )}
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageSelect} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>

              {/* 名前入力 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">景品名</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: 消しゴム、ノートなど"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none font-bold"
                />
              </div>

              {/* コイン数入力 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">交換に必要なコイン数</label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500" size={20} />
                  <input 
                    type="number" 
                    value={coins}
                    onChange={(e) => setCoins(e.target.value)}
                    placeholder="例: 500"
                    className="w-full pl-10 pr-3 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none font-bold"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={submitting}
                className="w-full bg-yellow-500 text-white font-bold py-3 rounded-xl hover:bg-yellow-600 transition-colors shadow-lg shadow-yellow-200 disabled:opacity-50"
              >
                {submitting ? '登録中...' : 'この内容で登録する'}
              </button>
            </form>
          </div>

          {/* 右側：一覧表示 */}
          <div className="lg:col-span-2">
            <h2 className="font-bold text-gray-700 mb-6">登録済みの景品一覧</h2>
            
            {rewards.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
                まだ登録された景品はありません
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {rewards.map((item) => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 group hover:border-yellow-200 transition-all">
                    <div className="w-20 h-20 relative shrink-0 bg-gray-100 rounded-lg overflow-hidden">
                      {item.image_url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-800">{item.name}</h3>
                      <p className="text-yellow-600 font-black flex items-center gap-1 mt-1">
                        <Coins size={16} /> {item.required_coins.toLocaleString()}
                      </p>
                    </div>
                    <button 
                      onClick={() => handleDelete(item.id)}
                      className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}