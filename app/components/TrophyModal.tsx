'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { BADGES } from '@/lib/gamification';
import { 
  X, Lock, Star, Coins, Trophy, UserCircle, CheckCircle2, ShoppingBag, 
  ArrowRight, Calendar, Loader2, Video, MessageCircle
} from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { 
  doc, updateDoc, getDoc, onSnapshot
} from 'firebase/firestore';
import Link from 'next/link';
import { useSound } from '@/lib/sound';

interface UserData {
  uid: string;
  name: string;
  points: number;
  coins: number;
  total_coins: number;
  login_count?: number;
  attendance_count: number;
  login_streak?: number;
  earned_badges: string[];
  selected_badge: string;
  last_login_bonus_date?: string;
  last_mission_date?: string;
  last_recording_view_date?: string;
  last_recording_mission_date?: string;
  last_community_activity_date?: string;
  last_community_mission_date?: string;
  custom_mission_dates?: Record<string, string>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userData: UserData;
  canUseShop?: boolean;
}

const BONUS_PATTERN = [10, 10, 20, 20, 30, 30, 40, 40, 50, 100];

const DEFAULT_MISSION_SETTINGS = {
  login: true,
  recording: true,
  community: false,
};

type CustomMissionCondition = 'manual' | 'login' | 'recording' | 'community';

type CustomMission = {
  id: string;
  title: string;
  description?: string;
  reward: number;
  enabled?: boolean;
  condition?: CustomMissionCondition;
  link_url?: string;
  link_label?: string;
};

const normalizeCustomMission = (mission: any): CustomMission | null => {
  const id = String(mission?.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const title = String(mission?.title || '').trim();
  if (!id || !title) return null;
  const condition = ['manual', 'login', 'recording', 'community'].includes(mission?.condition) ? mission.condition : 'manual';
  return {
    id,
    title,
    description: String(mission?.description || ''),
    reward: Math.max(0, Math.min(500, Number(mission?.reward || 0))),
    enabled: mission?.enabled !== false,
    condition,
    link_url: String(mission?.link_url || ''),
    link_label: String(mission?.link_label || '開く'),
  };
};

const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function TrophyModal({ isOpen, onClose, userData, canUseShop = true }: Props) {
  const { profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  
  const [activeTab, setActiveTab] = useState<'bonus' | 'quest' | 'badge' | 'ranking'>('bonus'); 
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [missionClaiming, setMissionClaiming] = useState(false);
  const [isMissionDoneToday, setIsMissionDoneToday] = useState(false);

  const [recordingMissionClaiming, setRecordingMissionClaiming] = useState(false);
  const [isRecordingMissionDoneToday, setIsRecordingMissionDoneToday] = useState(false);
  const [isRecordingWatchedToday, setIsRecordingWatchedToday] = useState(false);
  const [communityMissionClaiming, setCommunityMissionClaiming] = useState(false);
  const [isCommunityMissionDoneToday, setIsCommunityMissionDoneToday] = useState(false);
  const [isCommunityActiveToday, setIsCommunityActiveToday] = useState(false);
  const [missionSettings, setMissionSettings] = useState(DEFAULT_MISSION_SETTINGS);
  const [customMissions, setCustomMissions] = useState<CustomMission[]>([]);
  const [customMissionDates, setCustomMissionDates] = useState<Record<string, string>>(userData?.custom_mission_dates || {});
  const [customMissionClaiming, setCustomMissionClaiming] = useState<Record<string, boolean>>({});
  const [lastLoginBonusDate, setLastLoginBonusDate] = useState(userData?.last_login_bonus_date || '');
  
  // データロード中フラグ（チラつき防止）
  const [isDataFetching, setIsDataFetching] = useState(true);

  const [currentCoins, setCurrentCoins] = useState(userData?.coins || 0);
  const [currentLogins, setCurrentLogins] = useState(userData?.login_count || userData?.attendance_count || 0);
  const [currentStreak, setCurrentStreak] = useState(userData?.login_streak || 0);
  const [currentBadges, setCurrentBadges] = useState<string[]>(userData?.earned_badges || []);
  const [currentSelectedBadge, setCurrentSelectedBadge] = useState(
    userData?.selected_badge && userData.selected_badge !== 'beginner' ? userData.selected_badge : 'badge_1'
  );

  const earnedBadges = currentBadges;
  const selectedBadge = currentSelectedBadge;

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'mission_control'),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setMissionSettings(prev => ({
          ...prev,
          login: data.login ?? prev.login,
          recording: data.recording ?? prev.recording,
          community: data.community ?? prev.community,
        }));
        const missions = Array.isArray(data.custom_missions)
          ? data.custom_missions.map(normalizeCustomMission).filter(Boolean) as CustomMission[]
          : [];
        setCustomMissions(missions.filter(mission => mission.enabled !== false && mission.reward > 0));
      },
      (error) => {
        console.warn('Mission control read failed:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  // 初期化 & データ取得
  useEffect(() => {
    if (!isOpen) return;

    // 初期状態セット (プロップスから)
    const today = getTodayString();
    setCurrentCoins(userData?.coins || 0);
    setCurrentLogins(userData?.login_count || userData?.attendance_count || 0);
    setCurrentStreak(userData?.login_streak || 0);
    setCurrentBadges(userData?.earned_badges || []);
    setCurrentSelectedBadge(userData?.selected_badge && userData.selected_badge !== 'beginner' ? userData.selected_badge : 'badge_1');
    setLastLoginBonusDate(userData?.last_login_bonus_date || '');
    setCustomMissionDates(userData?.custom_mission_dates || {});
    
    // プロップスベースで一旦判定（表示を早くするため）
    setIsMissionDoneToday(userData?.last_mission_date === today);
    setIsRecordingMissionDoneToday(userData?.last_recording_mission_date === today);
    setIsRecordingWatchedToday(userData?.last_recording_view_date === today);
    setIsCommunityMissionDoneToday(userData?.last_community_mission_date === today);
    setIsCommunityActiveToday(userData?.last_community_activity_date === today);

    setIsDataFetching(true);

    const fetchData = async () => {
      try {
        // 1. 最新のユーザー状態を取得
        // クエスト完了直後にモーダルを開いた場合、propsのuserDataは古い可能性があるため
        if (userData?.uid) {
          try {
            const userSnap = await getDoc(doc(db, 'users', userData.uid));
            if (userSnap.exists()) {
              const data = userSnap.data();
              
              // 最新データで上書き
              setIsMissionDoneToday(data.last_mission_date === today);
              setIsRecordingMissionDoneToday(data.last_recording_mission_date === today);
              setIsRecordingWatchedToday(data.last_recording_view_date === today);
              setIsCommunityMissionDoneToday(data.last_community_mission_date === today);
              setIsCommunityActiveToday(data.last_community_activity_date === today);
              setLastLoginBonusDate(data.last_login_bonus_date || '');
              setCustomMissionDates(data.custom_mission_dates || {});
              
              setCurrentCoins(data.coins || 0);
              setCurrentLogins(data.login_count || data.attendance_count || 0);
              setCurrentStreak(data.login_streak || 0);
              setCurrentBadges(Array.isArray(data.earned_badges) ? data.earned_badges : []);
              setCurrentSelectedBadge(data.selected_badge && data.selected_badge !== 'beginner' ? data.selected_badge : 'badge_1');
            }
          } catch (e) {
            console.error("User data fetch error:", e);
          }
        }

        // 2. ランキング取得
        if (activeTab === 'ranking') {
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
              setRanking([]);
              return;
            }

            const res = await fetch('/api/student/ranking?limit=20', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
              console.error('Ranking fetch error:', data.error || res.statusText);
              setRanking([]);
              return;
            }
            setRanking(Array.isArray(data.ranking) ? data.ranking : []);
          } catch (e) {
            console.error('Ranking fetch error:', e);
            setRanking([]);
          }
        }
      } finally {
        setIsDataFetching(false);
      }
    };
    fetchData();
  }, [isOpen, activeTab, userData]);

  if (!isOpen) return null;

  const handleEquipBadge = async (badgeId: string) => {
    if (!earnedBadges.includes(badgeId)) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', userData.uid), { selected_badge: badgeId });
      setCurrentSelectedBadge(badgeId);
      window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', { detail: { selected_badge: badgeId } }));
      alert('バッジを設定しました！');
    } catch (e) { alert('設定失敗'); } finally { setLoading(false); }
  };

  const handleClaimMission = async () => {
    if (isMissionDoneToday || missionClaiming) return;
    setMissionClaiming(true);
    await processMissionReward('last_mission_date', 10, setIsMissionDoneToday, setMissionClaiming);
  };

  const handleClaimRecordingMission = async () => {
    if (!isRecordingWatchedToday || isRecordingMissionDoneToday || recordingMissionClaiming) return;
    setRecordingMissionClaiming(true);
    await processMissionReward('last_recording_mission_date', 15, setIsRecordingMissionDoneToday, setRecordingMissionClaiming);
  };

  const handleClaimCommunityMission = async () => {
    if (!isCommunityActiveToday || isCommunityMissionDoneToday || communityMissionClaiming) return;
    setCommunityMissionClaiming(true);
    await processMissionReward('last_community_mission_date', 10, setIsCommunityMissionDoneToday, setCommunityMissionClaiming);
  };

  const processMissionReward = async (
    dateField: string, 
    reward: number, 
    setDoneState: (b: boolean) => void, 
    setLoadingState: (b: boolean) => void
  ) => {
    const today = getTodayString();
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const res = await fetch('/api/coin-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'mission_reward', date_field: dateField }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'reward failed');
      setDoneState(true);
      if (data.applied) {
        setCurrentCoins(typeof data.coins === 'number' ? data.coins : prev => prev + (data.amount || reward));
        window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
          detail: {
            coins: typeof data.coins === 'number' ? data.coins : undefined,
            [dateField]: today,
          },
        }));
        play(dateField === 'last_mission_date' ? 'login_bonus' : 'coin_acquired');
      }
      alert(data.applied ? `ミッション達成！ ${data.amount || reward}コイン獲得！` : '本日のミッション報酬は受取済みです。');
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    } finally {
      setLoadingState(false);
    }
  };

  const isCustomMissionReady = (mission: CustomMission) => {
    switch (mission.condition || 'manual') {
      case 'login':
        return lastLoginBonusDate === getTodayString() || isMissionDoneToday;
      case 'recording':
        return isRecordingWatchedToday;
      case 'community':
        return isCommunityActiveToday;
      default:
        return true;
    }
  };

  const getCustomMissionFallbackHref = (mission: CustomMission) => {
    if (mission.link_url) return mission.link_url;
    if (mission.condition === 'recording') return '/student/recordings';
    if (mission.condition === 'community') return '/student/community';
    return '/student';
  };

  const handleClaimCustomMission = async (mission: CustomMission) => {
    const today = getTodayString();
    if (customMissionDates[mission.id] === today || customMissionClaiming[mission.id] || !isCustomMissionReady(mission)) return;
    setCustomMissionClaiming(prev => ({ ...prev, [mission.id]: true }));
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const res = await fetch('/api/coin-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'custom_mission_reward', mission_id: mission.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'reward failed');

      const nextDates = { ...customMissionDates, [mission.id]: today };
      setCustomMissionDates(nextDates);
      if (data.applied) {
        setCurrentCoins(typeof data.coins === 'number' ? data.coins : prev => prev + (data.amount || mission.reward));
        window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
          detail: {
            coins: typeof data.coins === 'number' ? data.coins : undefined,
            custom_mission_dates: nextDates,
          },
        }));
        play('coin_acquired');
      }
      alert(data.applied ? `ミッション達成！ ${data.amount || mission.reward}コイン獲得！` : '本日のミッション報酬は受取済みです。');
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    } finally {
      setCustomMissionClaiming(prev => ({ ...prev, [mission.id]: false }));
    }
  };

  const renderLoginBonus = () => {
    const startCount = Math.max(1, currentLogins - 1); 
    const displayCount = 6; 

    const bonusItems = [];
    for (let i = 0; i < displayCount; i++) {
      const dayCount = startCount + i;
      const amount = BONUS_PATTERN[(dayCount - 1) % BONUS_PATTERN.length];
      const isCollected = dayCount <= currentLogins;
      const isNext = dayCount === currentLogins + 1;

      bonusItems.push({ dayCount, amount, isCollected, isNext });
    }
    return bonusItems;
  };

  const bonusList = renderLoginBonus();

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
              {currentCoins.toLocaleString()}
            </div>
            {canUseShop && (
              <Link href="/student/shop" className="mt-2 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-all active:scale-95 border border-white/20">
                <ShoppingBag size={14} /> 景品交換へ <ArrowRight size={12} />
              </Link>
            )}
          </div>

          <div className="flex mt-6 bg-black/20 rounded-xl p-1 text-[10px] font-bold overflow-x-auto gap-1 no-scrollbar">
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
                 <h3 className="font-black text-indigo-800 text-lg mb-1">ログインスタンプ</h3>
                 <p className="text-xs text-gray-500 mb-6">
                   現在 <span className="text-lg font-black text-indigo-600">{currentLogins}</span> 回目 / 連続 <span className="text-lg font-black text-rose-500">{currentStreak}</span> 日ログイン中です！
                 </p>
                 
                 <div className="flex gap-3 overflow-x-auto pt-6 pb-4 px-2 no-scrollbar justify-start sm:justify-center items-end">
                   {bonusList.map((item) => (
                     <div key={item.dayCount} className={`relative flex flex-col items-center justify-center p-3 rounded-xl border-2 min-w-[64px] shrink-0 transition-all ${item.isCollected ? 'bg-yellow-50 border-yellow-400 opacity-80' : item.isNext ? 'bg-white border-indigo-500 shadow-lg scale-110 z-10' : 'bg-gray-50 border-gray-200 opacity-50'}`}>
                       
                       <span className="text-[10px] font-bold text-gray-400 mb-2">{item.dayCount}日目</span>
                       
                       {item.isCollected ? (
                         <CheckCircle2 className="text-yellow-500 mb-2" size={24}/>
                       ) : (
                         <div className="relative mb-2">
                           <Coins className={item.isNext ? "text-yellow-500 animate-bounce" : "text-gray-300"} size={24} />
                           {item.amount >= 50 && <span className="absolute -top-1 -right-1 text-[8px]">✨</span>}
                         </div>
                       )}
                       
                       <span className={`text-xs font-black ${item.isCollected ? 'text-yellow-600' : 'text-gray-600'}`}>+{item.amount}</span>
                       
                       {item.isNext && <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm">NEXT</span>}
                     </div>
                   ))}
                 </div>
                 <p className="text-[10px] text-gray-400 mt-2">※1日1回、ホーム表示時に自動でログインボーナスが付与されます</p>
               </div>
             </div>
          )}

          {/* 2. ミッション */}
          {activeTab === 'quest' && (
            <div className="space-y-6">
              
              {/* デイリーミッション */}
              <div>
	                <h4 className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3"><span className="w-1 h-4 bg-orange-500 rounded-full"/> デイリーミッション</h4>
	                
	                <div className="space-y-3">
                    {!missionSettings.login && !missionSettings.recording && !missionSettings.community && customMissions.length === 0 && (
                      <div className="rounded-2xl border border-slate-100 bg-white p-6 text-center text-sm font-bold text-slate-400">
                        現在利用できるデイリーミッションはありません
                      </div>
                    )}
	                  {/* ① ログインミッション */}
	                  {missionSettings.login && <div className={`p-4 rounded-xl border shadow-sm flex justify-between items-center transition-all ${isMissionDoneToday ? 'bg-gray-50 border-gray-200' : 'bg-white border-orange-200 shadow-md'}`}>
	                    <div>
	                      <p className="font-bold text-sm text-gray-800">アプリにログインする</p>
                      <p className="text-[10px] text-orange-500 font-bold flex items-center gap-1 mt-1">
                        <Coins size={12}/> +10 コイン
                      </p>
                    </div>
                    <button 
                      onClick={handleClaimMission}
                      disabled={isMissionDoneToday || missionClaiming}
                      className={`text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all ${
                        isMissionDoneToday 
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                          : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-200 shadow-lg active:scale-95'
                      }`}
                    >
	                      {missionClaiming ? <Loader2 className="animate-spin" size={14}/> : isMissionDoneToday ? <CheckCircle2 size={14}/> : <Coins size={14}/>}
	                      {isMissionDoneToday ? '受取済' : '受け取る'}
	                    </button>
	                  </div>}

	                  {/* ② 録画視聴ミッション */}
	                  {missionSettings.recording && <div className={`p-4 rounded-xl border shadow-sm flex justify-between items-center transition-all ${isRecordingMissionDoneToday ? 'bg-gray-50 border-gray-200' : 'bg-white border-red-200 shadow-md'}`}>
	                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Video size={14} className="text-red-500"/>
                        <p className="font-bold text-sm text-gray-800">授業録画を1本見る</p>
                      </div>
                      <p className="text-[10px] text-orange-500 font-bold flex items-center gap-1">
                        <Coins size={12}/> +15 コイン
                      </p>
                    </div>
                    {isRecordingWatchedToday ? (
                      <button 
                        onClick={handleClaimRecordingMission}
                        disabled={isDataFetching || isRecordingMissionDoneToday || recordingMissionClaiming}
                        className={`text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all ${
                          isRecordingMissionDoneToday 
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                            : 'bg-red-500 hover:bg-red-600 text-white shadow-red-200 shadow-lg active:scale-95'
                        }`}
                      >
                        {recordingMissionClaiming ? <Loader2 className="animate-spin" size={14}/> : isRecordingMissionDoneToday ? <CheckCircle2 size={14}/> : <Coins size={14}/>}
                        {isRecordingMissionDoneToday ? '受取済' : '受け取る'}
                      </button>
                    ) : (
                      <Link href="/student/recordings" className="text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 bg-red-100 text-red-500">
	                        見に行く
	                      </Link>
	                    )}
	                  </div>}

	                  {/* ③ コミュニティミッション */}
	                  {missionSettings.community && <div className={`p-4 rounded-xl border shadow-sm flex justify-between items-center transition-all ${isCommunityMissionDoneToday ? 'bg-gray-50 border-gray-200' : 'bg-white border-sky-200 shadow-md'}`}>
	                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageCircle size={14} className="text-sky-500"/>
                        <p className="font-bold text-sm text-gray-800">コミュニティに参加する</p>
                      </div>
                      <p className="text-[10px] text-orange-500 font-bold flex items-center gap-1">
                        <Coins size={12}/> +10 コイン
                      </p>
                    </div>
                    {isCommunityActiveToday ? (
                      <button 
                        onClick={handleClaimCommunityMission}
                        disabled={isDataFetching || isCommunityMissionDoneToday || communityMissionClaiming}
                        className={`text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all ${
                          isCommunityMissionDoneToday 
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                          : 'bg-sky-500 hover:bg-sky-600 text-white shadow-sky-200 shadow-lg active:scale-95'
                        }`}
                      >
                        {communityMissionClaiming ? <Loader2 className="animate-spin" size={14}/> : isCommunityMissionDoneToday ? <CheckCircle2 size={14}/> : <Coins size={14}/>}
                        {isCommunityMissionDoneToday ? '受取済' : '受け取る'}
                      </button>
                    ) : (
                      <Link href="/student/community" className="text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 bg-sky-100 text-sky-500">
	                        参加する
	                      </Link>
	                    )}
	                  </div>}

                    {customMissions.map((mission) => {
                      const doneToday = customMissionDates[mission.id] === getTodayString();
                      const ready = isCustomMissionReady(mission);
                      const href = getCustomMissionFallbackHref(mission);
                      const isExternal = /^https?:\/\//.test(href);
                      const actionClass = "text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all";
                      return (
                        <div key={mission.id} className={`p-4 rounded-xl border shadow-sm flex justify-between items-center gap-3 transition-all ${doneToday ? 'bg-gray-50 border-gray-200' : 'bg-white border-amber-200 shadow-md'}`}>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-gray-800">{mission.title}</p>
                            {mission.description && <p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-400">{mission.description}</p>}
                            <p className="text-[10px] text-orange-500 font-bold flex items-center gap-1 mt-1">
                              <Coins size={12}/> +{mission.reward} コイン
                            </p>
                          </div>
                          {ready ? (
                            <button
                              onClick={() => handleClaimCustomMission(mission)}
                              disabled={doneToday || customMissionClaiming[mission.id]}
                              className={`${actionClass} ${doneToday ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200 shadow-lg active:scale-95'}`}
                            >
                              {customMissionClaiming[mission.id] ? <Loader2 className="animate-spin" size={14}/> : doneToday ? <CheckCircle2 size={14}/> : <Coins size={14}/>}
                              {doneToday ? '受取済' : '受け取る'}
                            </button>
                          ) : isExternal ? (
                            <a href={href} target="_blank" rel="noreferrer" className={`${actionClass} bg-amber-100 text-amber-600 shrink-0`}>
                              {mission.link_label || '開く'}
                            </a>
                          ) : (
                            <Link href={href} className={`${actionClass} bg-amber-100 text-amber-600 shrink-0`}>
                              {mission.link_label || '開く'}
                            </Link>
                          )}
                        </div>
                      );
                    })}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
                      <p className="text-[10px] font-black text-rose-500">連続ログイン</p>
                      <p className="mt-1 text-2xl font-black text-rose-700">{currentStreak}日</p>
                      <p className="mt-1 text-[10px] font-bold text-rose-400">3日/7日で特別バッジ</p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <p className="text-[10px] font-black text-amber-600">次のログボ</p>
                      <p className="mt-1 text-2xl font-black text-amber-700">+{BONUS_PATTERN[currentLogins % BONUS_PATTERN.length]}</p>
                      <p className="mt-1 text-[10px] font-bold text-amber-500">明日の初回ログインで付与</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 累積ミッション */}
              <div>
                <h4 className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3"><span className="w-1 h-4 bg-blue-500 rounded-full"/> 継続実績</h4>
                <div className="space-y-3">
                  {[1, 3, 5, 10, 20, 50, 100].map((goal) => {
                    const isCleared = currentLogins >= goal;
                    return (
                      <div key={goal} className={`relative p-3 rounded-2xl border ${isCleared ? 'bg-white border-yellow-400 shadow-sm' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <div className="flex items-center gap-2"><p className={`text-sm font-bold ${isCleared ? 'text-gray-800' : 'text-gray-500'}`}>{goal}回ログイン</p>{isCleared && <span className="bg-yellow-400 text-yellow-900 text-[10px] font-black px-2 py-0.5 rounded-full">CLEAR!</span>}</div>
                            <p className="text-[10px] text-orange-500 font-bold mt-0.5">達成バッジ・累計ランキングに反映</p>
                          </div>
                          <div className="text-right">{isCleared ? <CheckCircle2 className="text-green-500" size={24} /> : <span className="text-xs font-bold text-gray-400">{currentLogins} / {goal}</span>}</div>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className={`h-full ${isCleared ? 'bg-green-500' : 'bg-blue-500'}`} style={{width: `${Math.min(100, (currentLogins/goal)*100)}%`}} /></div>
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
             <div className="space-y-3">
               {isDataFetching ? (
                 <div className="flex items-center justify-center gap-2 rounded-2xl bg-white p-8 text-sm font-bold text-gray-400"><Loader2 className="animate-spin" size={18} /> 読み込み中...</div>
               ) : ranking.length === 0 ? (
                 <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-gray-400">ランキングを表示できませんでした</div>
               ) : ranking.map((player: any, index) => (
                 <div key={player.id || index} className={`flex items-center gap-3 p-3 rounded-xl border ${player.is_me || player.id === userData.uid ? 'bg-yellow-50 border-yellow-300' : 'bg-white border-gray-100'}`}>
                   <div className={`w-6 text-center font-black ${index < 3 ? 'text-orange-500' : 'text-gray-400'}`}>{player.rank || index + 1}</div>
                   <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border text-lg">{BADGES.find(b => b.id === player.selected_badge)?.icon || '👤'}</div>
                   <div className="flex-1">
                     <p className="text-xs font-bold text-gray-800">{player.student_name || '生徒'}</p>
                     <p className="text-[10px] text-gray-400">{Number(player.total_coins || 0).toLocaleString()} pt / {player.login_streak || 0}日連続</p>
                   </div>
                   {index === 0 && <Trophy className="text-yellow-500 fill-yellow-500" size={20} />}
                 </div>
               ))}
             </div>
          )}

        </div>
      </div>
    </div>
  );
}
