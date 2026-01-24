'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
// arrayUnion を追加
import { doc, setDoc, updateDoc, increment, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { Video, Loader2, Coins } from 'lucide-react';

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

    // 確認ダイアログにコイン獲得のメッセージを追加
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
      
      // 2. ゲーミフィケーション処理 (コイン加算 & バッジ付与)
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        coins: increment(30),          // 所持コイン +30
        total_coins: increment(30),    // 累計コイン +30 (ランキング用)
        attendance_count: increment(1), // 出席回数 +1 (クエスト用)
        // 最初のバッジ(badge_1: 双葉)を持っていない場合は自動付与
        earned_badges: arrayUnion('badge_1') 
      });
      
      // 必要であればここで「コイン獲得！」などのトースト表示を入れるとより良いです

    } catch (err) { 
      console.error("出席処理エラー:", err);
    }

    window.open(url, '_blank');
    setLoading(false);
  };

  if (!isVisible || !url) return null;

  const gradientClass = color === 'blue' 
    ? 'from-blue-500 to-blue-600 shadow-blue-200' 
    : 'from-purple-500 to-purple-600 shadow-purple-200';
  
  const pulseColor = color === 'blue' ? 'bg-green-300' : 'bg-yellow-300';

  return (
    <button
      onClick={handleJoinClass}
      disabled={loading}
      className={`w-full bg-gradient-to-r ${gradientClass} text-white p-5 rounded-2xl shadow-lg flex items-center justify-between group active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed`}
    >
      <div className="flex flex-col items-start">
        <span className="text-sm opacity-90 font-bold mb-1 flex items-center gap-1">
          <span className={`w-2 h-2 ${pulseColor} rounded-full animate-pulse`}></span>
          {subLabel}
        </span>
        <span className="text-xl font-bold flex items-center gap-2">
          {loading ? <Loader2 className="animate-spin" /> : <Video className="fill-white" />} 
          {loading ? '処理中...' : label}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="bg-white/20 p-2 rounded-full group-hover:bg-white/30 transition-colors">
          <span className="text-2xl">🚀</span>
        </div>
        <span className="text-[10px] font-bold bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full flex items-center gap-1">
          <Coins size={10} /> +30
        </span>
      </div>
    </button>
  );
}