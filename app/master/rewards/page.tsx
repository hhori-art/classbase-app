'use client';

import { useState, useEffect, useRef } from 'react';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Loader2, Plus, Trash2, Image as ImageIcon, Coins, ArrowLeft, Package, Check } from 'lucide-react';
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

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-yellow-500" size={40}/></div>;

  return (
    <div className="min-h-screen bg-[#F8F9FA] p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-3 rounded-full shadow-sm hover:bg-white/80 text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <Package className="text-yellow-500" /> 景品アイテム管理
            </h1>
            <p className="text-xs font-bold text-slate-400 mt-1">生徒がコインと交換できるアイテムを登録・編集します</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* 左側：登録フォーム (幅狭め) */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-6">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 sticky top-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold text-slate-700 flex items-center gap-2">
                  <Plus className="bg-yellow-100 text-yellow-600 rounded-lg p-1" size={24} />
                  新規登録
                </h2>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* 画像アップロード */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">商品画像</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full aspect-square bg-slate-50 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative group ${previewUrl ? 'border-yellow-300' : 'border-slate-200'}`}
                  >
                    {previewUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-white text-xs font-bold bg-black/50 px-3 py-1 rounded-full">変更する</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-slate-400 group-hover:text-yellow-500 transition-colors">
                        <ImageIcon size={32} className="mx-auto mb-2" strokeWidth={1.5} />
                        <span className="text-xs font-bold">写真を選択</span>
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
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">アイテム名</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: オリジナルノート"
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-yellow-400 focus:bg-white outline-none font-bold transition-colors placeholder:font-medium placeholder:text-slate-300"
                  />
                </div>

                {/* コイン数入力 */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">必要コイン数</label>
                  <div className="relative">
                    <Coins className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500" size={20} />
                    <input 
                      type="number" 
                      value={coins}
                      onChange={(e) => setCoins(e.target.value)}
                      placeholder="500"
                      className="w-full pl-10 pr-3 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-yellow-400 focus:bg-white outline-none font-bold transition-colors placeholder:font-medium placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={submitting}
                  className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-50 active:scale-95 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18}/> : <Check size={18} strokeWidth={3}/>}
                  {submitting ? '登録中...' : '登録する'}
                </button>
              </form>
            </div>
          </div>

          {/* 右側：一覧表示 (幅広め) */}
          <div className="lg:col-span-8 xl:col-span-9">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-slate-700 text-lg flex items-center gap-2">
                <Package size={20} className="text-slate-400"/> 登録済みアイテム
                <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{rewards.length}</span>
              </h2>
            </div>
            
            {rewards.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-[32px] border-4 border-dashed border-slate-100 text-slate-300 flex flex-col items-center">
                <Package size={48} className="mb-2 text-slate-200" strokeWidth={1.5}/>
                <p className="font-bold">まだ登録された景品はありません</p>
                <p className="text-xs mt-1">左のフォームから追加してください</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {rewards.map((item) => (
                  <div key={item.id} className="bg-white p-4 rounded-[28px] border border-slate-100 shadow-sm flex flex-col gap-4 group hover:border-yellow-200 hover:shadow-md transition-all relative overflow-hidden">
                    {/* 画像 */}
                    <div className="w-full aspect-[4/3] relative bg-slate-50 rounded-2xl overflow-hidden">
                      {item.image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">No Image</div>
                      )}
                      
                      {/* 削除ボタン（ホバーで表示） */}
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="absolute top-2 right-2 bg-white/90 p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100"
                        title="削除する"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    {/* 情報 */}
                    <div className="px-1 pb-1">
                      <h3 className="font-bold text-slate-800 text-lg leading-tight mb-2 line-clamp-2">{item.name}</h3>
                      <div className="flex items-center gap-1.5 bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-full w-fit">
                        <Coins size={16} className="text-yellow-500 fill-yellow-500" />
                        <span className="font-black text-sm">{item.required_coins.toLocaleString()}</span>
                        <span className="text-[10px] font-bold opacity-70">COINS</span>
                      </div>
                    </div>
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