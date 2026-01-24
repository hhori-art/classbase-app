'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Trophy, Settings,
  Bot, Brain, Sparkles, Clock, Coffee
} from 'lucide-react';

// コンポーネントのインポート
import BottomNav from '@/app/components/BottomNav';
import LogoutButton from '@/app/components/LogoutButton';
import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget';
import TrophyModal from '@/app/components/TrophyModal';
import SmartClassButton from '@/app/components/SmartClassButton';
import ActivityLogger from '@/app/components/ActivityLogger';

import { BADGES } from '@/lib/gamification';

// 授業時間定義
const CLASS_TIMES = {
  period1: { start: '19:20', end: '20:25' },
  period2: { start: '20:35', end: '21:40' }
};

type Props = { initialProfile: any; };

export default function StudentDashboard({ initialProfile }: Props) {
  
  const [userData, setUserData] = useState<any>(initialProfile);
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);

  // ★追加: 現在時刻の管理（初期値はnullでハイドレーションエラー防止）
  const [now, setNow] = useState<Date | null>(null);

  // 日付・挨拶
  const today = new Date();
  const dateStr = today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const getGreeting = () => {
    const h = today.getHours();
    if (h < 11) return 'おはよう！';
    if (h < 17) return 'こんにちは！';
    return 'こんばんは！';
  };

  // リアルタイム監視 & 時計の更新
  useEffect(() => {
    // ユーザー監視
    if (initialProfile?.uid) {
      const unsub = onSnapshot(doc(db, 'users', initialProfile.uid), (docSnap) => {
        if (docSnap.exists()) setUserData(docSnap.data());
      });
      
      // 時計の初期化と更新（1分ごとにチェック）
      setNow(new Date());
      const timer = setInterval(() => setNow(new Date()), 60000);

      return () => {
        unsub();
        clearInterval(timer);
      };
    }
  }, [initialProfile]);

  // ★追加: 時間内か判定する関数
  const isClassActive = (start: string, end: string) => {
    if (!now) return false;

    // 現在時刻を「分」に変換 (例: 19:30 → 1170)
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // 開始時間を「分」に変換
    const [startH, startM] = start.split(':').map(Number);
    const startTotal = startH * 60 + startM;

    // 終了時間を「分」に変換
    const [endH, endM] = end.split(':').map(Number);
    const endTotal = endH * 60 + endM;

    // 判定: 「開始15分前」から「終了時間」までなら表示
    // ※ 15分前を表示させたくない場合は `- 15` を削除してください
    return currentMinutes >= (startTotal - 15) && currentMinutes <= endTotal;
  };

  const currentBadgeId = userData?.selected_badge;
  const currentBadge = BADGES.find(b => b.id === currentBadgeId);

  // 各時限が表示対象かどうか
  const showPeriod1 = isClassActive(CLASS_TIMES.period1.start, CLASS_TIMES.period1.end);
  const showPeriod2 = isClassActive(CLASS_TIMES.period2.start, CLASS_TIMES.period2.end);

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-32 font-sans relative overflow-hidden">
      
      <ActivityLogger uid={userData?.uid} />

      {popMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-white px-6 py-3 rounded-full shadow-lg font-black text-lg z-[150] animate-bounce border-4 border-white whitespace-nowrap">
          ✨ {popMessage}
        </div>
      )}

      <TrophyModal 
        isOpen={isTrophyOpen} 
        onClose={() => setIsTrophyOpen(false)} 
        userData={userData}
      />

      {/* ヒーローセクション */}
      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 pt-10 pb-24 px-6 rounded-b-[40px] shadow-lg relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div className="flex justify-between items-start text-white relative z-10">
          <div>
            <p className="text-sm font-bold opacity-90 mb-1 flex items-center gap-2"><Calendar size={14}/> {dateStr}</p>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">{getGreeting()} <br/><span className="text-yellow-300 text-3xl">{userData?.student_name || '生徒'}</span> さん</h1>
            {userData && <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold"><Clock size={12}/> {userData.day_of_week}曜クラス | {userData.classroom}</div>}
          </div>
          <div className="bg-white/20 p-1.5 rounded-xl backdrop-blur-sm"><LogoutButton /></div>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-20 space-y-6">
        
        {/* ステータスカード */}
        <button 
          onClick={() => setIsTrophyOpen(true)}
          className="w-full bg-white p-5 rounded-3xl shadow-xl shadow-indigo-100 flex justify-between items-center transform hover:scale-[1.02] active:scale-95 transition-all text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-4xl shadow-inner border border-indigo-100">
              {currentBadge ? currentBadge.icon : '🎓'}
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase group-hover:text-indigo-500 transition-colors">My Badge</p>
              <p className="text-lg font-extrabold text-gray-800 flex items-center gap-2">
                {currentBadge ? currentBadge.name : 'バッジ未設定'}
                {currentBadge && <span className="bg-yellow-400 text-yellow-900 text-[10px] px-2 py-0.5 rounded-full">Equipped</span>}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-bold uppercase">Total Coins</p>
            <div className="flex items-center gap-1 justify-end text-yellow-500 font-black text-xl">
              <div className="bg-yellow-100 p-1 rounded-full"><Trophy size={14} className="fill-yellow-500"/></div>
              {userData?.coins || 0}
            </div>
          </div>
        </button>

        {/* 自動Zoomボタン (時間内のみ表示) */}
        {/* どちらかの時間が有効なときだけエリアを表示、あるいは個別に出し分け */}
        <div className="space-y-4 animate-in slide-in-from-top-4">
          
          {/* 1限目の表示判定 */}
          {showPeriod1 && (
            <SmartClassButton 
              profile={userData}
              period={1}
              startTime={CLASS_TIMES.period1.start}
              endTime={CLASS_TIMES.period1.end}
            />
          )}

          {/* 2限目の表示判定 */}
          {showPeriod2 && (
            <SmartClassButton 
              profile={userData}
              period={2}
              startTime={CLASS_TIMES.period2.start}
              endTime={CLASS_TIMES.period2.end}
            />
          )}

          {/* 授業時間外のときのメッセージ（オプション） */}
          {!showPeriod1 && !showPeriod2 && now && (
            <div className="bg-white/60 p-4 rounded-3xl border border-white flex items-center justify-center gap-2 text-gray-400 text-sm font-bold">
              <Coffee size={18} />
              <span>現在は授業時間外です</span>
            </div>
          )}
        </div>

        {/* メインメニュー */}
        <div className="grid grid-cols-2 gap-4">
          <Link href="/student/homework/adaptive" className="col-span-2 block group">
            <div className="bg-gradient-to-r from-teal-400 to-emerald-500 p-5 rounded-3xl shadow-lg text-white flex items-center justify-between relative overflow-hidden">
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                  <Brain size={28}/>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-bold">AI学習クエスト</span>
                    <span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse"><Sparkles size={10} fill="currentColor"/> NEW</span>
                  </div>
                  <p className="text-xs opacity-90">キミに最適な問題をAIが出題！</p>
                </div>
              </div>
              <ChevronRight size={24} className="opacity-70 group-hover:translate-x-1 transition-transform"/>
            </div>
          </Link>

          <Link href="/student/chat" className="block group">
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-indigo-100 hover:border-indigo-300 transition-all flex flex-col items-center text-center h-full">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Bot size={24}/>
              </div>
              <h2 className="font-bold text-gray-800">AIチューター</h2>
              <p className="text-[10px] text-gray-400 mt-1">24時間 質問OK!</p>
            </div>
          </Link>

          <Link href="/student/homework" className="block group">
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-orange-200 transition-all flex flex-col items-center text-center h-full">
              <div className="w-12 h-12 bg-orange-100 text-orange-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <BookOpen size={24}/>
              </div>
              <h2 className="font-bold text-gray-800">宿題提出</h2>
              <p className="text-[10px] text-gray-400 mt-1">写真を送信</p>
            </div>
          </Link>

          <Link href="/student/recordings" className="block group">
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-red-200 transition-all flex flex-col items-center text-center h-full">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Video size={24}/>
              </div>
              <h2 className="font-bold text-gray-800">授業録画</h2>
              <p className="text-[10px] text-gray-400 mt-1">見逃し配信</p>
            </div>
          </Link>

          <Link href="/student/absence" className="block group">
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-green-200 transition-all flex flex-col items-center text-center h-full">
              <div className="w-12 h-12 bg-green-100 text-green-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <AlertTriangle size={24}/>
              </div>
              <h2 className="font-bold text-gray-800">欠席連絡</h2>
              <p className="text-[10px] text-gray-400 mt-1">お休み申請</p>
            </div>
          </Link>
        </div>

        <NewsWidget role="student" />
        
        <div className="bg-white p-2 rounded-3xl shadow-sm border border-gray-100">
          <CalendarWidget />
        </div>
        
        <Link href="/student/change-request" className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:bg-gray-50 transition-colors no-underline mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-gray-100 p-2 rounded-lg text-gray-500"><Settings size={18}/></div>
            <span className="text-sm font-bold text-gray-600">科目・曜日の変更申請</span>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </Link>
      </div>

      <BottomNav />
      
    </div>
  );
}