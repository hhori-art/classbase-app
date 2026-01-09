'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { Video } from 'lucide-react';

// プロップス: 時間指定を追加
export default function ZoomButton({ 
  url, 
  label = "Zoomに参加する", 
  subLabel = "現在開催中の授業",
  color = "blue",
  startTime, // "19:20" のような形式
  endTime    // "20:30" のような形式
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
  const supabase = createClient();

  // 時間チェック機能
  useEffect(() => {
    // 時間指定がない場合は常に表示
    if (!startTime || !endTime) {
      setIsVisible(true);
      return;
    }

    const checkTime = () => {
      const now = new Date();
      
      // 今日の日付で開始時刻オブジェクトを作成
      const [startH, startM] = startTime.split(':').map(Number);
      const start = new Date();
      start.setHours(startH, startM, 0, 0);

      // 表示開始時刻（開始の30分前）
      const visibleStart = new Date(start.getTime() - 30 * 60 * 1000);

      // 今日の日付で終了時刻オブジェクトを作成
      const [endH, endM] = endTime.split(':').map(Number);
      const end = new Date();
      end.setHours(endH, endM, 0, 0);

      // 現在時刻が「表示開始〜終了」の間ならOK
      if (now >= visibleStart && now <= end) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    // 初回チェック
    checkTime();

    // 1分ごとに再チェック（時間になったら自動で出るように）
    const timer = setInterval(checkTime, 60000);
    return () => clearInterval(timer);
  }, [startTime, endTime]);

  const handleJoinClass = async () => {
    if (!url) return;
    if (!confirm(`${label}しますか？（出席として記録されます）`)) return;

    setLoading(true);
    const today = new Date().toISOString().split('T')[0];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.open(url, '_blank');
        setLoading(false);
        return;
      }
      // 出席記録
      await supabase.from('attendance').upsert({
        user_id: user.id,
        target_date: today,
        type: 'present',
        contacted_by: 'student',
        reason: 'Zoom参加ボタンより自動登録'
      }, { onConflict: 'user_id, target_date' });
      
      // ポイント加算
      await supabase.rpc('add_points', { user_id: user.id, amount: 10 });
      
    } catch (err) { console.error(err); }

    window.open(url, '_blank');
    setLoading(false);
  };

  // 表示期間外なら何も表示しない
  if (!isVisible) return null;

  // URLがない場合も表示しない（あるいは「準備中」と出すかはお好みで）
  if (!url) return null;

  // 色の切り替え
  const gradientClass = color === 'blue' 
    ? 'from-blue-500 to-blue-600 shadow-blue-200' 
    : 'from-purple-500 to-purple-600 shadow-purple-200';
  
  const pulseColor = color === 'blue' ? 'bg-green-300' : 'bg-yellow-300';

  return (
    <button
      onClick={handleJoinClass}
      disabled={loading}
      className={`w-full bg-gradient-to-r ${gradientClass} text-white p-5 rounded-2xl shadow-lg flex items-center justify-between group active:scale-[0.98] transition-all`}
    >
      <div className="flex flex-col items-start">
        <span className="text-sm opacity-90 font-bold mb-1 flex items-center gap-1">
          <span className={`w-2 h-2 ${pulseColor} rounded-full animate-pulse`}></span>
          {subLabel}
        </span>
        <span className="text-xl font-bold flex items-center gap-2">
          <Video className="fill-white" /> {label}
        </span>
      </div>
      <div className="bg-white/20 p-2 rounded-full group-hover:bg-white/30 transition-colors">
        <span className="text-2xl">🚀</span>
      </div>
    </button>
  );
}