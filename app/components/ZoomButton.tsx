'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, increment, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { Video, Loader2, Coins, Sparkles, ExternalLink, Play } from 'lucide-react';

export default function ZoomButton({ 
  url, 
  label = "Zoomに参加する", 
  subLabel = "現在開催中の授業",
  color = "blue",
  startTime,
  endTime
}: { 
  url?: string | null, 
  label?: string,
  subLabel?: string,
  color?: "blue" | "purple",
  startTime?: string,
  endTime?: string
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  // 時間チェック機能
  useEffect(() => {
    if (!startTime || !endTime) {
      setIsVisible(true);
      return;
    }

    const checkTime = () => {
      const now = new Date();
      const [startH, startM] = startTime.split(':').map(Number);
      const start = new Date();
      start.setHours(startH, startM, 0, 0);
      const visibleStart = new Date(start.getTime() - 30 * 60 * 1000); // 30分前から

      const [endH, endM] = endTime.split(':').map(Number);
      const end = new Date();
      end.setHours(endH, endM, 0, 0);

      if (now >= visibleStart && now <= end) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    checkTime();
    const timer = setInterval(checkTime, 60000);
    return () => clearInterval(timer);
  }, [startTime, endTime]);

  const handleJoinClass = async () => {
    if (!url) return;
    if (loading) return;

    if (!confirm(`${label}しますか？\n（出席として記録され、コインを獲得します！）`)) return;

    setLoading(true);
    const today = new Date().toISOString().split('T')[0];

    try {
      const user = auth.currentUser;
      
      if (!user) {
        window.open(url, '_blank');
        setLoading(false);
        return;
      }

      // 1. 出席記録
      const attendanceId = `${user.uid}_${today}`;
      const attendanceRef = doc(db, 'attendance', attendanceId);
      
      await setDoc(attendanceRef, {
        user_id: user.uid,
        target_date: today,
        type: 'present',
        contacted_by: 'student',
        reason: 'Zoom参加ボタンより自動登録',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      }, { merge: true });
      
      // 2. ゲーミフィケーション処理
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        coins: increment(30),
        total_coins: increment(30),
        attendance_count: increment(1),
        earned_badges: arrayUnion('badge_1') 
      });

    } catch (err) { 
      console.error("出席処理エラー:", err);
    }

    window.open(url, '_blank');
    setLoading(false);
  };

  if (!isVisible || !url) return null;

  // カラーテーマの設定
  const theme = color === 'blue' 
    ? {
        bg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
        shadow: 'shadow-blue-200',
        ring: 'group-hover:ring-cyan-300',
        iconBg: 'bg-blue-500'
      }
    : {
        bg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
        shadow: 'shadow-purple-200',
        ring: 'group-hover:ring-fuchsia-300',
        iconBg: 'bg-purple-500'
      };

  return (
    <div className="w-full py-2">
      <button
        onClick={handleJoinClass}
        disabled={loading}
        className={`
          relative w-full overflow-hidden rounded-3xl ${theme.bg} text-white shadow-xl ${theme.shadow}
          group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]
          disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100
        `}
      >
        {/* 背景の装飾効果 */}
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity"></div>
        <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-24 h-24 bg-black opacity-10 rounded-full blur-xl"></div>

        <div className="relative p-1">
          {/* インナーコンテナ */}
          <div className="flex items-stretch bg-white/10 backdrop-blur-[2px] rounded-[20px] border border-white/20 p-4">
            
            {/* 左側：メイン情報 */}
            <div className="flex-1 flex flex-col justify-center text-left mr-4">
              {/* ライブバッジ */}
              <div className="flex items-center gap-2 mb-2">
                <span className="flex items-center gap-1.5 bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-md shadow-sm border border-white/10">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  Live Class
                </span>
                <span className="text-[10px] opacity-80 font-medium truncate">{subLabel}</span>
              </div>

              {/* メインラベル */}
              <div className="flex items-center gap-2">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight drop-shadow-sm">
                  {loading ? '準備中...' : label}
                </h3>
              </div>
            </div>

            {/* 右側：アクション & 報酬 */}
            <div className="flex flex-col items-center justify-between gap-2 pl-4 border-l border-white/20">
              
              {/* コイン報酬バッジ */}
              <div className="bg-yellow-400 text-yellow-950 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-lg transform group-hover:-translate-y-1 transition-transform duration-300 border-2 border-white/30">
                <Coins size={14} className="fill-yellow-600 stroke-yellow-800" />
                <span className="text-xs font-black">+30</span>
                <Sparkles size={12} className="text-yellow-700 animate-pulse" />
              </div>

              {/* アイコンボタン */}
              <div className={`
                w-10 h-10 rounded-full bg-white text-gray-800 flex items-center justify-center shadow-lg
                group-hover:bg-white group-hover:text-${color === 'blue' ? 'blue' : 'purple'}-600 transition-colors
              `}>
                {loading ? (
                  <Loader2 size={20} className="animate-spin text-gray-400" />
                ) : (
                  <ExternalLink size={20} className="ml-0.5" strokeWidth={2.5} />
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ホバー時の光るエフェクト（ボーダー） */}
        <div className={`absolute inset-0 rounded-3xl border-2 border-white/0 group-hover:border-white/30 transition-colors pointer-events-none`}></div>
      </button>
    </div>
  );
}