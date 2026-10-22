'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { BADGES, BADGE_CATEGORIES, BADGE_RARITY_LABELS, BADGE_RARITY_STYLES, badgeProgress, badgeStatsFromProfile, findBadge, type BadgeStats } from '@/lib/gamification';
import { 
  Lock, Star, Coins, Trophy, UserCircle, CheckCircle2, ShoppingBag, 
  ArrowRight, Calendar, Loader2, Video, MessageCircle
} from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { 
  doc, updateDoc, getDoc, onSnapshot
} from 'firebase/firestore';
import Link from 'next/link';
import { useSound } from '@/lib/sound';
import { jstDateKey } from '@/lib/format';
import { EmptyState, ErrorState, Modal, useToast } from '@/app/components/ui';

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

const getTodayString = () => jstDateKey();

export default function TrophyModal({ isOpen, onClose, userData, canUseShop = true }: Props) {
  const { profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  const toast = useToast();
  
  const [activeTab, setActiveTab] = useState<'bonus' | 'quest' | 'badge' | 'ranking'>('bonus'); 
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [rankingError, setRankingError] = useState(false);
  const [rankingReloadKey, setRankingReloadKey] = useState(0);
  
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

  const [badgeStats, setBadgeStats] = useState<BadgeStats>(() => badgeStatsFromProfile(userData || {}));
  const [newBadgeIds, setNewBadgeIds] = useState<string[]>([]);
  const earnedBadges = currentBadges;
  const selectedBadge = currentSelectedBadge;

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

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
              setBadgeStats(badgeStatsFromProfile(data));
              setCurrentSelectedBadge(data.selected_badge && data.selected_badge !== 'beginner' ? data.selected_badge : 'badge_1');
            }
          } catch (e) {
            console.error("User data fetch error:", e);
          }
        }

        // 2. ランキング取得
        if (activeTab === 'ranking') {
          setRankingError(false);
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
              setRanking([]);
              setRankingError(true);
              return;
            }

            const res = await fetch('/api/student/ranking?limit=20', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
              console.error('Ranking fetch error:', data.error || res.statusText);
              setRanking([]);
              setRankingError(true);
              return;
            }
            setRanking(Array.isArray(data.ranking) ? data.ranking : []);
          } catch (e) {
            console.error('Ranking fetch error:', e);
            setRanking([]);
            setRankingError(true);
          }
        }
      } finally {
        setIsDataFetching(false);
      }
    };
    fetchData();
  }, [isOpen, activeTab, userData, rankingReloadKey]);

  // 開いた時に各機能の累計からバッジを確定し、新しく獲得したものを知らせる。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/badges/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || data.ok === false) return;
        if (Array.isArray(data.earned_badges)) setCurrentBadges(data.earned_badges);
        if (Array.isArray(data.added) && data.added.length > 0) setNewBadgeIds(data.added);
      } catch (error) {
        console.warn('Badge sync failed:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEquipBadge = async (badgeId: string) => {
    if (!earnedBadges.includes(badgeId)) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', userData.uid), { selected_badge: badgeId });
      setCurrentSelectedBadge(badgeId);
      window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', { detail: { selected_badge: badgeId } }));
      toast.success('バッジを設定しました！');
    } catch (e) { toast.error('バッジを設定できませんでした。時間をおいてもう一度お試しください。'); } finally { setLoading(false); }
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
      if (data.applied) toast.success(`ミッション達成！ ${data.amount || reward}コイン獲得！`);
      else toast.info('本日のミッション報酬は受取済みです。');
    } catch (e) {
      console.error(e);
      toast.error('コインを受け取れませんでした。時間をおいてもう一度お試しください。');
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
      if (data.applied) toast.success(`ミッション達成！ ${data.amount || mission.reward}コイン獲得！`);
      else toast.info('本日のミッション報酬は受取済みです。');
    } catch (e) {
      console.error(e);
      toast.error('コインを受け取れませんでした。時間をおいてもう一度お試しください。');
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

  const claimButtonClass = (done: boolean, tone: string) =>
    `inline-flex min-h-11 shrink-0 items-center gap-1 rounded-btn px-4 text-xs font-bold transition-all ${
      done ? 'cursor-not-allowed bg-slate-200 text-slate-400' : `${tone} text-white shadow-lg active:scale-95`
    }`;
  const goButtonClass = 'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-btn px-4 text-xs font-bold transition-colors';
  const missionCardClass = (done: boolean, border: string) =>
    `flex items-center justify-between gap-3 rounded-btn border p-4 transition-all ${done ? 'border-line bg-canvas' : `bg-surface shadow-md ${border}`}`;

  return (
    <Modal open onClose={onClose} title="トロフィー">
      <div className="-mx-5 -my-4">

        {/* ヘッダー（所持コインとタブ。中身をスクロールしても上に残す） */}
        <div className="sticky top-0 z-10 bg-accent p-5 text-center text-accent-ink">
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="text-xs font-bold opacity-80">所持コイン</div>
            <div className="flex items-center gap-2 text-4xl font-black text-yellow-300 drop-shadow-md">
              <Coins className="fill-yellow-300 text-yellow-500" size={32} aria-hidden />
              {currentCoins.toLocaleString()}
            </div>
            {canUseShop && (
              <Link href="/student/shop" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/20 px-4 text-xs font-bold transition-all hover:bg-white/30 active:scale-95">
                <ShoppingBag size={14} aria-hidden /> 景品交換へ <ArrowRight size={12} aria-hidden />
              </Link>
            )}
          </div>

          <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto rounded-btn bg-black/20 p-1 text-xs font-bold" role="tablist">
            {[
              { id: 'bonus', icon: Calendar, label: 'ログボ' },
              { id: 'quest', icon: Star, label: 'ミッション' },
              { id: 'badge', icon: Trophy, label: 'バッジ' },
              { id: 'ranking', icon: UserCircle, label: '順位' }
            ].map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex min-h-11 min-w-[60px] flex-1 flex-col items-center justify-center gap-1 rounded-input py-2 transition-all ${activeTab === tab.id ? 'bg-surface text-accent shadow-sm' : 'opacity-75 hover:bg-white/10 hover:opacity-100'}`}>
                <tab.icon size={16} aria-hidden /> {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* コンテンツエリア */}
        <div className="bg-canvas p-4 sm:p-6">

          {/* 1. ログインボーナス */}
          {activeTab === 'bonus' && (
             <div className="space-y-6 text-center">
               <div className="cb-card p-6">
                 <h3 className="mb-1 text-lg font-bold text-fg">ログインスタンプ</h3>
                 <p className="mb-6 text-xs text-fg-muted">
                   現在 <span className="text-lg font-bold text-accent">{currentLogins}</span> 回目 / 連続 <span className="text-lg font-bold text-rose-500">{currentStreak}</span> 日ログイン中です！
                 </p>

                 <div className="no-scrollbar flex items-end justify-start gap-3 overflow-x-auto px-2 pb-4 pt-6 sm:justify-center">
                   {bonusList.map((item) => (
                     <div key={item.dayCount} className={`relative flex min-w-[64px] shrink-0 flex-col items-center justify-center rounded-btn border-2 p-3 transition-all ${item.isCollected ? 'border-yellow-400 bg-yellow-50 opacity-80' : item.isNext ? 'z-10 scale-110 border-accent bg-surface shadow-lg' : 'border-line bg-canvas opacity-50'}`}>

                       <span className="mb-2 text-xs font-bold text-fg-muted">{item.dayCount}日目</span>

                       {item.isCollected ? (
                         <CheckCircle2 className="mb-2 text-yellow-500" size={24} aria-label="受取済"/>
                       ) : (
                         <div className="relative mb-2">
                           <Coins className={item.isNext ? "text-yellow-500 motion-safe:animate-bounce" : "text-slate-300"} size={24} aria-hidden />
                           {item.amount >= 50 && <span className="absolute -right-1 -top-1 text-[11px]" aria-hidden>✨</span>}
                         </div>
                       )}

                       <span className={`text-xs font-bold ${item.isCollected ? 'text-yellow-600' : 'text-slate-600'}`}>+{item.amount}</span>

                       {item.isNext && <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">つぎ</span>}
                     </div>
                   ))}
                 </div>
                 <p className="mt-2 text-xs text-fg-muted">※1日1回、ホーム表示時に自動でログインボーナスが付与されます</p>
               </div>
             </div>
          )}

          {/* 2. ミッション */}
          {activeTab === 'quest' && (
            <div className="space-y-6">

              {/* デイリーミッション */}
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><span className="h-4 w-1 rounded-full bg-amber-500" aria-hidden/> デイリーミッション</h4>

                <div className="space-y-3">
                  {!missionSettings.login && !missionSettings.recording && !missionSettings.community && customMissions.length === 0 && (
                    <EmptyState icon={Star} title="現在利用できるデイリーミッションはありません" className="bg-surface" />
                  )}
                  {/* ① ログインミッション */}
                  {missionSettings.login && <div className={missionCardClass(isMissionDoneToday, 'border-amber-200')}>
                    <div>
                      <p className="text-sm font-bold text-fg">アプリにログインする</p>
                      <p className="mt-1 flex items-center gap-1 text-xs font-bold text-amber-600">
                        <Coins size={12} aria-hidden/> +10 コイン
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClaimMission}
                      disabled={isMissionDoneToday || missionClaiming}
                      className={claimButtonClass(isMissionDoneToday, 'bg-amber-500 hover:bg-amber-600 shadow-amber-200')}
                    >
                      {missionClaiming ? <Loader2 className="animate-spin" size={14} aria-hidden/> : isMissionDoneToday ? <CheckCircle2 size={14} aria-hidden/> : <Coins size={14} aria-hidden/>}
                      {isMissionDoneToday ? '受取済' : '受け取る'}
                    </button>
                  </div>}

                  {/* ② 録画視聴ミッション */}
                  {missionSettings.recording && <div className={missionCardClass(isRecordingMissionDoneToday, 'border-rose-200')}>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <Video size={14} className="text-rose-500" aria-hidden/>
                        <p className="text-sm font-bold text-fg">授業録画を1本見る</p>
                      </div>
                      <p className="flex items-center gap-1 text-xs font-bold text-amber-600">
                        <Coins size={12} aria-hidden/> +15 コイン
                      </p>
                    </div>
                    {isRecordingWatchedToday ? (
                      <button
                        type="button"
                        onClick={handleClaimRecordingMission}
                        disabled={isDataFetching || isRecordingMissionDoneToday || recordingMissionClaiming}
                        className={claimButtonClass(isRecordingMissionDoneToday, 'bg-rose-500 hover:bg-rose-600 shadow-rose-200')}
                      >
                        {recordingMissionClaiming ? <Loader2 className="animate-spin" size={14} aria-hidden/> : isRecordingMissionDoneToday ? <CheckCircle2 size={14} aria-hidden/> : <Coins size={14} aria-hidden/>}
                        {isRecordingMissionDoneToday ? '受取済' : '受け取る'}
                      </button>
                    ) : (
                      <Link href="/student/recordings" className={`${goButtonClass} bg-rose-100 text-rose-600 hover:bg-rose-200`}>
                        見に行く
                      </Link>
                    )}
                  </div>}

                  {/* ③ コミュニティミッション */}
                  {missionSettings.community && <div className={missionCardClass(isCommunityMissionDoneToday, 'border-sky-200')}>
                    <div>
                      <div className="mb-1 flex items-center gap-1.5">
                        <MessageCircle size={14} className="text-sky-500" aria-hidden/>
                        <p className="text-sm font-bold text-fg">コミュニティに参加する</p>
                      </div>
                      <p className="flex items-center gap-1 text-xs font-bold text-amber-600">
                        <Coins size={12} aria-hidden/> +10 コイン
                      </p>
                    </div>
                    {isCommunityActiveToday ? (
                      <button
                        type="button"
                        onClick={handleClaimCommunityMission}
                        disabled={isDataFetching || isCommunityMissionDoneToday || communityMissionClaiming}
                        className={claimButtonClass(isCommunityMissionDoneToday, 'bg-sky-500 hover:bg-sky-600 shadow-sky-200')}
                      >
                        {communityMissionClaiming ? <Loader2 className="animate-spin" size={14} aria-hidden/> : isCommunityMissionDoneToday ? <CheckCircle2 size={14} aria-hidden/> : <Coins size={14} aria-hidden/>}
                        {isCommunityMissionDoneToday ? '受取済' : '受け取る'}
                      </button>
                    ) : (
                      <Link href="/student/community" className={`${goButtonClass} bg-sky-100 text-sky-600 hover:bg-sky-200`}>
                        参加する
                      </Link>
                    )}
                  </div>}

                  {customMissions.map((mission) => {
                    const doneToday = customMissionDates[mission.id] === getTodayString();
                    const ready = isCustomMissionReady(mission);
                    const href = getCustomMissionFallbackHref(mission);
                    const isExternal = /^https?:\/\//.test(href);
                    return (
                      <div key={mission.id} className={missionCardClass(doneToday, 'border-amber-200')}>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-fg">{mission.title}</p>
                          {mission.description && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{mission.description}</p>}
                          <p className="mt-1 flex items-center gap-1 text-xs font-bold text-amber-600">
                            <Coins size={12} aria-hidden/> +{mission.reward} コイン
                          </p>
                        </div>
                        {ready ? (
                          <button
                            type="button"
                            onClick={() => handleClaimCustomMission(mission)}
                            disabled={doneToday || customMissionClaiming[mission.id]}
                            className={claimButtonClass(doneToday, 'bg-amber-500 hover:bg-amber-600 shadow-amber-200')}
                          >
                            {customMissionClaiming[mission.id] ? <Loader2 className="animate-spin" size={14} aria-hidden/> : doneToday ? <CheckCircle2 size={14} aria-hidden/> : <Coins size={14} aria-hidden/>}
                            {doneToday ? '受取済' : '受け取る'}
                          </button>
                        ) : isExternal ? (
                          <a href={href} target="_blank" rel="noreferrer" className={`${goButtonClass} bg-amber-100 text-amber-700 hover:bg-amber-200`}>
                            {mission.link_label || '開く'}
                          </a>
                        ) : (
                          <Link href={href} className={`${goButtonClass} bg-amber-100 text-amber-700 hover:bg-amber-200`}>
                            {mission.link_label || '開く'}
                          </Link>
                        )}
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-btn border border-rose-100 bg-rose-50 p-4">
                      <p className="text-xs font-bold text-rose-500">連続ログイン</p>
                      <p className="mt-1 text-2xl font-black text-rose-700">{currentStreak}日</p>
                      <p className="mt-1 text-xs text-rose-500">3日/7日で特別バッジ</p>
                    </div>
                    <div className="rounded-btn border border-amber-100 bg-amber-50 p-4">
                      <p className="text-xs font-bold text-amber-600">次のログボ</p>
                      <p className="mt-1 text-2xl font-black text-amber-700">+{BONUS_PATTERN[currentLogins % BONUS_PATTERN.length]}</p>
                      <p className="mt-1 text-xs text-amber-600">明日の初回ログインで付与</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 累積ミッション */}
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><span className="h-4 w-1 rounded-full bg-accent" aria-hidden/> 継続実績</h4>
                <div className="space-y-3">
                  {[1, 3, 5, 10, 20, 50, 100].map((goal) => {
                    const isCleared = currentLogins >= goal;
                    return (
                      <div key={goal} className={`relative rounded-btn border p-3 ${isCleared ? 'border-yellow-400 bg-surface shadow-sm' : 'border-line bg-canvas'}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2"><p className={`text-sm font-bold ${isCleared ? 'text-fg' : 'text-fg-muted'}`}>{goal}回ログイン</p>{isCleared && <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-bold text-yellow-900">達成！</span>}</div>
                            <p className="mt-0.5 text-xs text-amber-600">達成バッジ・累計ランキングに反映</p>
                          </div>
                          <div className="text-right">{isCleared ? <CheckCircle2 className="text-emerald-500" size={24} aria-label="達成" /> : <span className="text-xs font-bold text-fg-muted">{currentLogins} / {goal}</span>}</div>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${isCleared ? 'bg-emerald-500' : 'bg-accent'}`} style={{width: `${Math.min(100, (currentLogins/goal)*100)}%`}} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 3. バッジ */}
          {activeTab === 'badge' && (
            <div className="space-y-5">
              <div className="cb-card p-3 text-center">
                <p className="text-xs text-fg-muted">獲得したバッジをタップするとアイコンに設定できるよ！</p>
                <p className="mt-1 text-sm font-bold text-accent">{BADGES.filter(badge => earnedBadges.includes(badge.id)).length} / {BADGES.length} 個 獲得</p>
              </div>
              {newBadgeIds.length > 0 && (
                <div className="rounded-btn border-2 border-amber-300 bg-amber-50 p-3 text-center">
                  <p className="text-xs font-bold text-amber-700">🎉 新しいバッジを獲得！</p>
                  <p className="mt-1 text-sm font-bold text-fg">{newBadgeIds.map(id => findBadge(id)).filter(Boolean).map(badge => `${badge!.icon} ${badge!.name}`).join('　')}</p>
                </div>
              )}
              {BADGE_CATEGORIES.map(category => {
                const badges = BADGES.filter(badge => badge.category === category.id);
                if (badges.length === 0) return null;
                return (
                  <section key={category.id}>
                    <h4 className="mb-2 text-xs font-bold text-fg-muted">{category.label}</h4>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {badges.map((badge) => {
                        const isUnlocked = earnedBadges.includes(badge.id);
                        const isEquipped = selectedBadge === badge.id;
                        const isSecretHidden = !isUnlocked && badge.secret;
                        const progress = badgeProgress(badge, badgeStats);
                        return (
                          <button key={badge.id} type="button" disabled={!isUnlocked || loading} onClick={() => handleEquipBadge(badge.id)} title={isSecretHidden ? '???' : badge.description} aria-pressed={isUnlocked ? isEquipped : undefined}
                            className={`relative flex aspect-square flex-col items-center justify-center rounded-btn border-2 p-2 text-center transition-all ${isUnlocked ? `${BADGE_RARITY_STYLES[badge.rarity]} ${isEquipped ? 'ring-2 ring-accent' : 'hover:border-accent/40'}` : 'cursor-not-allowed border-line bg-slate-100'}`}>
                            <div className={`mb-1 text-2xl ${isUnlocked ? '' : 'opacity-40 grayscale'}`}>{isSecretHidden ? <span className="font-bold text-slate-400">?</span> : isUnlocked ? badge.icon : <Lock size={20} className="text-slate-300" aria-label="未獲得"/>}</div>
                            <div className="w-full truncate text-[11px] font-bold text-slate-600">{isSecretHidden ? '???' : badge.name}</div>
                            {isUnlocked ? (
                              <div className="text-[11px] font-bold text-slate-400">{BADGE_RARITY_LABELS[badge.rarity]}</div>
                            ) : progress && !isSecretHidden ? (
                              <div className="mt-1 w-full">
                                <div className="h-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-accent" style={{ width: `${progress.rate * 100}%` }} /></div>
                                <div className="mt-0.5 text-[11px] font-bold text-slate-400">{progress.current}/{progress.target}</div>
                              </div>
                            ) : badge.metric === 'manual' ? (
                              <div className="text-[11px] font-bold text-slate-400">先生から授与</div>
                            ) : badge.metric === 'shop' ? (
                              <div className="text-[11px] font-bold text-slate-400">交換所で入手</div>
                            ) : null}
                            {isEquipped && <div className="absolute -right-1 -top-1 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-ink shadow-sm">装備中</div>}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* 4. ランキング */}
          {activeTab === 'ranking' && (
             <div className="space-y-3">
               {isDataFetching ? (
                 <div role="status" className="cb-card flex items-center justify-center gap-2 p-8 text-sm text-fg-muted"><Loader2 className="animate-spin text-accent" size={18} aria-hidden /> 読み込み中...</div>
               ) : rankingError ? (
                 <ErrorState title="ランキングを表示できませんでした" onRetry={() => setRankingReloadKey(key => key + 1)} />
               ) : ranking.length === 0 ? (
                 <EmptyState icon={Trophy} title="まだランキングはありません" className="bg-surface" />
               ) : ranking.map((player: any, index) => (
                 <div key={player.id || index} className={`flex items-center gap-3 rounded-btn border p-3 ${player.is_me || player.id === userData.uid ? 'border-yellow-300 bg-yellow-50' : 'border-line bg-surface'}`}>
                   <div className={`w-6 text-center font-bold ${index < 3 ? 'text-amber-500' : 'text-slate-400'}`}>{player.rank || index + 1}</div>
                   <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-lg">{findBadge(player.selected_badge)?.icon || '👤'}</div>
                   <div className="flex-1">
                     <p className="text-xs font-bold text-fg">{player.student_name || '生徒'}</p>
                     <p className="text-xs text-fg-muted">{Number(player.total_coins || 0).toLocaleString()} コイン / {player.login_streak || 0}日連続</p>
                   </div>
                   {index === 0 && <Trophy className="fill-yellow-500 text-yellow-500" size={20} aria-label="1位" />}
                 </div>
               ))}
             </div>
          )}

        </div>
      </div>
    </Modal>
  );
}
