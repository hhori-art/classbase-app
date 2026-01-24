'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { BADGES } from '@/lib/gamification';
import { 
  X, Lock, Star, Coins, Trophy, UserCircle, CheckCircle2, ShoppingBag, 
  ArrowRight, Calendar
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { 
  doc, updateDoc, collection, query, orderBy, limit, getDocs 
} from 'firebase/firestore';
import Link from 'next/link';

interface UserData {
  uid: string;
  name: string;
  points: number;
  coins: number;
  total_coins: number;
  attendance_count: number;
  login_streak?: number;
  earned_badges: string[];
  selected_badge: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userData: UserData;
}

// 設定値
const LOGIN_BONUS = [10, 10, 20, 20, 30, 30, 50];

export default function TrophyModal({ isOpen, onClose, userData }: Props) {
  const { profile } = useAuth();
  
  // ★修正: タブからcommunityを削除
  const [activeTab, setActiveTab] = useState<'bonus' | 'quest' | 'badge' | 'ranking'>('bonus'); 
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const currentStreak = (userData?.login_streak || 0) % 7; 
  const attendanceCount = userData?.attendance_count || 0;
  const earnedBadges = userData?.earned_badges || [];
  const selectedBadge = userData?.selected_badge || '';

  // データ取得
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      // 1. ランキング取得
      if (activeTab === 'ranking') {
        const q = query(collection(db, 'users'), orderBy('total_coins', 'desc'), limit(10));
        const snap = await getDocs(q);
        setRanking(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }
      // ★修正: コミュニティ取得処理を削除
    };
    fetchData();
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // バッジ装備
  const handleEquipBadge = async (badgeId: string) => {
    if (!earnedBadges.includes(badgeId)) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', userData.uid), { selected_badge: badgeId });
      alert('バッジを設定しました！');
      window.location.reload(); 
    } catch (e) { alert('設定失敗'); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 font-sans">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 relative border-4 border-white">
        
        {/* ヘッダー */}
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-5 text-center text-white relative shrink-0">
          <button onClick={onClose} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors z-10"><X size={18} /></button>
          
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="text-[10px] font-bold opacity-80 tracking-widest uppercase">My Wallet</div>
            <div className="flex items-center gap-2 text-4xl font-black text-yellow-300 drop-shadow-md">
              <Coins className="fill-yellow-300 text-yellow-500" size={32} />
              {(userData?.coins || 0).toLocaleString()}
            </div>
            <Link href="/student/shop" className="mt-2 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-all active:scale-95 border border-white/20">
              <ShoppingBag size={14} /> 景品交換へ <ArrowRight size={12} />
            </Link>
          </div>

          <div className="flex mt-6 bg-black/20 rounded-xl p-1 text-[10px] font-bold overflow-x-auto gap-1 no-scrollbar">
            {/* ★修正: 広場タブを削除 */}
            {[ 
              { id: 'bonus', icon: Calendar, label: 'ログボ' }, 
              { id: 'quest', icon: Star, label: 'ミッション' }, 
              { id: 'badge', icon: Trophy, label: 'バッジ' }, 
              { id: 'ranking', icon: UserCircle, label: '順位' } 
            ].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 min-w-[60px] py-2 rounded-lg transition-all flex flex-col items-center justify-center gap-1 ${activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-white/70 hover:bg-white/10'}`}>
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* コンテンツエリア */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-[#F8FAFC]">
          
          {/* 1. ログインボーナス */}
          {activeTab === 'bonus' && (
             <div className="space-y-6 text-center">
               <div className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-100">
                 <h3 className="font-black text-indigo-800 text-lg mb-1">今週のログインボーナス</h3>
                 <p className="text-xs text-gray-500 mb-6">毎日ログインしてコインをGETしよう！</p>
                 <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                   {LOGIN_BONUS.map((amount, index) => { 
                     const day = index + 1; 
                     const isCollected = day <= currentStreak; 
                     const isToday = day === currentStreak + 1; 
                     return (
                       <div key={day} className={`relative flex flex-col items-center p-2 rounded-xl border-2 ${isCollected ? 'bg-yellow-50 border-yellow-400 opacity-50' : isToday ? 'bg-white border-indigo-500 shadow-lg scale-110 z-10' : 'bg-gray-50 border-gray-200'}`}>
                         <span className="text-[10px] font-bold text-gray-400 mb-1">{day}日</span>
                         {isCollected ? <CheckCircle2 className="text-yellow-500 mb-1" size={24}/> : <Coins className={isToday ? "text-yellow-500 animate-bounce" : "text-gray-300"} size={24} />}
                         <span className={`text-xs font-black ${isCollected ? 'text-yellow-600' : 'text-gray-600'}`}>+{amount}</span>
                         {isToday && <span className="absolute -top-2 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">NEXT</span>}
                       </div>
                     );
                   })}
                 </div>
               </div>
             </div>
          )}

          {/* 2. ミッション */}
          {activeTab === 'quest' && (
            <div className="space-y-6">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3"><span className="w-1 h-4 bg-orange-500 rounded-full"/> デイリーミッション</h4>
                <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center">
                  <div><p className="font-bold text-sm text-gray-800">アプリにログインする</p><p className="text-[10px] text-orange-500 font-bold flex items-center gap-1"><Coins size={10}/> +10 コイン</p></div>
                  <button className="bg-gray-100 text-gray-400 text-xs font-bold px-3 py-1.5 rounded-lg" disabled>完了</button>
                </div>
              </div>
              <div>
                <h4 className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3"><span className="w-1 h-4 bg-blue-500 rounded-full"/> 授業参加実績</h4>
                <div className="space-y-3">
                  {[1, 3, 5, 10, 20, 50].map((goal) => {
                    const isCleared = attendanceCount >= goal;
                    return (
                      <div key={goal} className={`relative p-3 rounded-2xl border ${isCleared ? 'bg-white border-yellow-400 shadow-sm' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <div className="flex items-center gap-2"><p className={`text-sm font-bold ${isCleared ? 'text-gray-800' : 'text-gray-500'}`}>授業に{goal}回出席</p>{isCleared && <span className="bg-yellow-400 text-yellow-900 text-[10px] font-black px-2 py-0.5 rounded-full">CLEAR!</span>}</div>
                            <p className="text-[10px] text-orange-500 font-bold mt-0.5">報酬: {goal * 10} コイン</p>
                          </div>
                          <div className="text-right">{isCleared ? <CheckCircle2 className="text-green-500" size={24} /> : <span className="text-xs font-bold text-gray-400">{attendanceCount} / {goal}</span>}</div>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className={`h-full ${isCleared ? 'bg-green-500' : 'bg-blue-500'}`} style={{width: `${Math.min(100, (attendanceCount/goal)*100)}%`}} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 3. バッジ */}
          {activeTab === 'badge' && (
            <div>
              <p className="text-xs text-gray-500 text-center mb-4">獲得したバッジをアイコンに設定できるよ！</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {BADGES.map((badge) => {
                  const isUnlocked = earnedBadges.includes(badge.id);
                  const isEquipped = selectedBadge === badge.id;
                  const isSecretHidden = !isUnlocked && (badge as any).secret;
                  return (
                    <button key={badge.id} disabled={!isUnlocked || loading} onClick={() => handleEquipBadge(badge.id)} className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center p-2 text-center border-2 transition-all ${isUnlocked ? (isEquipped ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200' : 'bg-white border-gray-200 hover:border-indigo-300') : 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed'}`}>
                      <div className="text-2xl mb-1">{isUnlocked ? badge.icon : isSecretHidden ? <span className="text-gray-400 font-black">?</span> : <Lock size={20} className="text-gray-300"/>}</div>
                      <div className="text-[9px] font-bold text-gray-600 w-full truncate">{isSecretHidden ? '???' : badge.name}</div>
                      {isEquipped && <div className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">装備中</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. ランキング */}
          {activeTab === 'ranking' && (
             <div className="space-y-3">{ranking.map((player: any, index) => (<div key={index} className={`flex items-center gap-3 p-3 rounded-xl border ${player.uid === userData.uid ? 'bg-yellow-50 border-yellow-300' : 'bg-white border-gray-100'}`}><div className={`w-6 text-center font-black ${index < 3 ? 'text-orange-500' : 'text-gray-400'}`}>{index + 1}</div><div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border text-lg">{BADGES.find(b => b.id === player.selected_badge)?.icon || '👤'}</div><div className="flex-1"><p className="text-xs font-bold text-gray-800">{player.student_name || player.name || '名無し'}</p><p className="text-[10px] text-gray-400">{player.total_coins?.toLocaleString()} pt</p></div>{index === 0 && <Trophy className="text-yellow-500 fill-yellow-500" size={20} />}</div>))}</div>
          )}

        </div>
      </div>
    </div>
  );
}