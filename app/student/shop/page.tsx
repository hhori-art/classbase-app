'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, increment, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { ArrowLeft, ShoppingBag, Coins, Lock, Loader2, CheckCircle } from 'lucide-react';
// import Image from 'next/image'; // ★削除
import Link from 'next/link';

export default function StudentShopPage() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState<any[]>([]);
  const [userCoins, setUserCoins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        // 1. 景品リスト取得
        const q = query(collection(db, 'rewards'), orderBy('required_coins', 'asc'));
        const rewardSnap = await getDocs(q);
        setRewards(rewardSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // 2. ユーザーの現在のコイン数取得
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) {
          setUserCoins(userSnap.data().coins || 0);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // 交換申請処理
  const handleExchange = async (reward: any) => {
    if (processingId) return;
    if (userCoins < reward.required_coins) return alert('コインが足りません！');
    if (!confirm(`「${reward.name}」を交換しますか？\n${reward.required_coins}コイン消費します。`)) return;

    setProcessingId(reward.id);
    try {
      if (!user) throw new Error('Auth Error');

      // 1. コインを減らす
      await updateDoc(doc(db, 'users', user.uid), {
        coins: increment(-reward.required_coins)
      });

      // 2. 交換申請を作成（管理者が確認するため）
      await addDoc(collection(db, 'requests'), {
        type: 'exchange', // 種類: 交換
        userId: user.uid,
        userName: user.displayName || '生徒',
        rewardId: reward.id,
        rewardName: reward.name,
        cost: reward.required_coins,
        status: 'pending', // 保留中
        created_at: serverTimestamp()
      });

      // 3. 画面上のコイン表示を更新
      setUserCoins(prev => prev - reward.required_coins);
      
      alert('交換申請が完了しました！\n先生からの連絡を待ってね。');

    } catch (error) {
      console.error(error);
      alert('エラーが発生しました');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-yellow-50"><Loader2 className="animate-spin text-yellow-500" size={40}/></div>;

  return (
    <div className="min-h-screen bg-yellow-50/50 p-4 pb-24 font-sans sm:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/student" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-yellow-600 hover:shadow-md transition-all active:scale-95">
              <ArrowLeft size={24} strokeWidth={3} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
                <span className="bg-yellow-400 text-yellow-900 p-2.5 rounded-2xl shadow-lg shadow-yellow-200">
                  <ShoppingBag size={24} strokeWidth={3} />
                </span>
                コイン交換所
              </h1>
              <p className="text-xs font-bold text-gray-400 mt-1 pl-1">貯めたコインでアイテムGET！</p>
            </div>
          </div>

          {/* 所持コイン表示 */}
          <div className="bg-white px-5 py-3 rounded-2xl shadow-md border border-yellow-100 flex flex-col items-end">
            <span className="text-[10px] font-bold text-gray-400">現在の所持コイン</span>
            <div className="flex items-center gap-2 text-2xl font-black text-yellow-500">
              <Coins className="fill-yellow-400 text-yellow-600" size={24} />
              {userCoins.toLocaleString()}
            </div>
          </div>
        </div>

        {/* 景品リスト */}
        {rewards.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300">
            <p className="font-bold">現在、交換できる景品はありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {rewards.map((reward) => {
              const canAfford = userCoins >= reward.required_coins;

              return (
                <div key={reward.id} className={`bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden flex flex-col transition-all duration-300 ${canAfford ? 'hover:shadow-xl hover:shadow-yellow-100 hover:-translate-y-1' : 'opacity-70 grayscale'}`}>
                  
                  {/* 画像エリア */}
                  <div className="relative aspect-square bg-gray-50 border-b border-gray-50">
                    {reward.image_url ? (
                      // ★修正: imgタグを使用
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img 
                        src={reward.image_url} 
                        alt={reward.name} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-300">No Image</div>
                    )}
                    
                    {!canAfford && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white backdrop-blur-[1px]">
                        <Lock size={32} className="mb-1" />
                        <span className="text-xs font-bold">コイン不足</span>
                      </div>
                    )}
                  </div>

                  {/* 情報エリア */}
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-gray-800 text-sm mb-1 line-clamp-2 min-h-[2.5em]">
                      {reward.name}
                    </h3>
                    
                    <div className="flex items-center justify-between mt-auto pt-3">
                      <div className="flex items-center gap-1 font-black text-yellow-500">
                        <Coins size={16} className="fill-yellow-400" />
                        {reward.required_coins.toLocaleString()}
                      </div>
                      
                      <button
                        onClick={() => handleExchange(reward)}
                        disabled={!canAfford || !!processingId}
                        className={`px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 ${
                          canAfford 
                            ? 'bg-yellow-400 text-yellow-900 hover:bg-yellow-300' 
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {processingId === reward.id ? <Loader2 className="animate-spin" size={14}/> : '交換'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}