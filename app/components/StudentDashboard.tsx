'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Star, Trophy, ArrowRight, Settings,
  Bot, Brain, Sparkles, Clock
} from 'lucide-react';

// コンポーネントのインポート
import BottomNav from '@/app/components/BottomNav';
import LogoutButton from '@/app/components/LogoutButton';
import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget'; // NewsWidgetのインポート
import TrophyModal from '@/app/components/TrophyModal';

// ロジックのインポート
import { addPoints, getRank, RANKS } from '@/lib/gamification';

const CLASS_TIMES = {
  period1: { start: '19:20', end: '20:25', showFrom: '18:50', lateLimit: '19:20' },
  period2: { start: '20:35', end: '21:40', showFrom: '20:05', lateLimit: '20:35' }
};

type Props = { initialProfile: any; };

export default function StudentDashboard({ initialProfile }: Props) {
  
  // stateの初期値に initialProfile を使用
  const [userData, setUserData] = useState<any>(initialProfile);
  
  // UI状態管理
  const [showZoom1, setShowZoom1] = useState(false);
  const [showZoom2, setShowZoom2] = useState(false);
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);

  // 日付・挨拶
  const today = new Date();
  const dateStr = today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const getGreeting = () => {
    const h = today.getHours();
    if (h < 11) return 'おはよう！';
    if (h < 17) return 'こんにちは！';
    return 'こんばんは！';
  };

  // リアルタイム監視
  useEffect(() => {
    if (!initialProfile?.uid) return;
    
    const unsub = onSnapshot(doc(db, 'users', initialProfile.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserData(docSnap.data());
      }
    });
    return () => unsub();
  }, [initialProfile]);

  // 時間割チェック
  useEffect(() => {
    if (initialProfile?.day_of_week) {
      checkZoomTime(initialProfile.day_of_week);
      const interval = setInterval(() => checkZoomTime(initialProfile.day_of_week), 60000);
      return () => clearInterval(interval);
    }
  }, [initialProfile]);

  const checkZoomTime = (dayOfWeek: string) => {
    const now = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    if (days[now.getDay()] !== dayOfWeek) { setShowZoom1(false); setShowZoom2(false); return; }

    const cur = now.getHours() * 60 + now.getMinutes();
    const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

    setShowZoom1(cur >= toMin(CLASS_TIMES.period1.showFrom) && cur < toMin(CLASS_TIMES.period1.end));
    setShowZoom2(cur >= toMin(CLASS_TIMES.period2.showFrom) && cur < toMin(CLASS_TIMES.period2.end));
  };

  // 授業参加処理
  const handleJoinClass = async (url: string, period: 1 | 2) => {
    if (!url) return alert('Zoom URLが設定されていません');
    
    window.open(url, '_blank');
    
    try {
      if (!initialProfile?.uid) return;

      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      const week = settingsSnap.exists() ? settingsSnap.data().current_week : '1';
      
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      const limit = period === 1 ? CLASS_TIMES.period1.lateLimit : CLASS_TIMES.period2.lateLimit;
      const [lh, lm] = limit.split(':').map(Number);
      const status = cur > (lh * 60 + lm) ? '遅' : '出';

      const pfRef = doc(db, 'pf_records', `${initialProfile.uid}_w${week}`);
      await setDoc(pfRef, { 
        student_id: initialProfile.uid, 
        week_number: week, 
        attendance_status: status, 
        created_at: new Date().toISOString() 
      }, { merge: true });

      const result = await addPoints(initialProfile.uid, 'ATTENDANCE');
      if (result && result.success) {
        setPopMessage(`出席ポイント GET! +${result.earned}pt`);
        setTimeout(() => setPopMessage(null), 3000);
      }

    } catch (e) { console.error(e); }
  };

  // ランク計算
  const points = userData?.points || 0;
  const rank = getRank(points);
  const nextRank = RANKS.find(r => r.min > points);
  const pointsToNext = nextRank ? nextRank.min - points : 0;

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-32 font-sans relative overflow-hidden">
      
      {popMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-white px-6 py-3 rounded-full shadow-lg font-black text-lg z-[150] animate-bounce border-4 border-white whitespace-nowrap">
          ✨ {popMessage}
        </div>
      )}

      <TrophyModal 
        isOpen={isTrophyOpen} 
        onClose={() => setIsTrophyOpen(false)} 
        points={points}
        earnedBadges={userData?.badges || []}
      />

      {/* ヒーローセクション */}
      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 pt-10 pb-24 px-6 rounded-b-[40px] shadow-lg relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div className="flex justify-between items-start text-white relative z-10">
          <div>
            <p className="text-sm font-bold opacity-90 mb-1 flex items-center gap-2"><Calendar size={14}/> {dateStr}</p>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">{getGreeting()} <br/><span className="text-yellow-300 text-3xl">{userData?.student_name || '生徒'}</span> さん</h1>
            {initialProfile && <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold"><Clock size={12}/> {initialProfile.day_of_week}曜クラス | {initialProfile.classroom}</div>}
          </div>
          <div className="bg-white/20 p-1.5 rounded-xl backdrop-blur-sm"><LogoutButton /></div>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-20 space-y-6">
        
        {/* ステータスカード */}
        <button 
          onClick={() => setIsTrophyOpen(true)}
          className="w-full bg-white p-4 rounded-3xl shadow-xl shadow-indigo-100 flex justify-between items-center transform hover:scale-[1.02] active:scale-95 transition-all text-left group"
        >
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-3xl shadow-sm ${rank.name === 'マスター' ? 'bg-purple-100' : 'bg-yellow-100'}`}>
              {rank.icon}
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase group-hover:text-indigo-500 transition-colors">Current Rank</p>
              <p className={`text-lg font-extrabold ${rank.color}`}>
                {rank.name} <span className="text-xs text-gray-400 font-normal">Rank</span>
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-bold uppercase">Next Goal</p>
            <div className="flex items-center gap-1 justify-end text-indigo-600 font-bold">
              <Star size={14} fill="currentColor"/> {nextRank ? `${pointsToNext} pt` : 'MAX'}
            </div>
          </div>
        </button>

        {/* Zoomボタン (アクティブ時のみ表示) */}
        {(showZoom1 || showZoom2) && (
          <div className="space-y-4 animate-in slide-in-from-top-4">
            {showZoom1 && (
              <button onClick={() => handleJoinClass(initialProfile.zoom_url, 1)} className="group w-full bg-gradient-to-r from-blue-500 to-cyan-400 p-5 rounded-3xl shadow-lg text-white text-left relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Video size={80}/></div>
                <div className="relative z-10 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold">NOW</span>
                      <span className="text-blue-100 text-xs font-bold">19:20 - 20:25</span>
                    </div>
                    <h3 className="text-xl font-bold flex items-center gap-2">1時間目に参加</h3>
                    <p className="text-xs opacity-90">{initialProfile.subject_1}</p>
                  </div>
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"><ArrowRight size={20}/></div>
                </div>
              </button>
            )}
            {showZoom2 && (
              <button onClick={() => handleJoinClass(initialProfile.zoom_url_2, 2)} className="group w-full bg-gradient-to-r from-purple-500 to-pink-500 p-5 rounded-3xl shadow-lg text-white text-left relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Video size={80}/></div>
                <div className="relative z-10 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold">NOW</span>
                      <span className="text-purple-100 text-xs font-bold">20:35 - 21:40</span>
                    </div>
                    <h3 className="text-xl font-bold flex items-center gap-2">2時間目に参加</h3>
                    <p className="text-xs opacity-90">{initialProfile.subject_2}</p>
                  </div>
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"><ArrowRight size={20}/></div>
                </div>
              </button>
            )}
          </div>
        )}

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

        {/* ウィジェットエリア：ニュースとカレンダー */}
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