'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore'; 
import { useAuth } from '@/app/context/AuthContext'; 
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Trophy, Settings,
  Bot, Brain, Sparkles, Clock, Coffee, CalendarCheck, ClipboardList, Timer,
  LogOut, Loader2, RefreshCw
} from 'lucide-react';

import BottomNav from '@/app/components/BottomNav';
import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget';
import TrophyModal from '@/app/components/TrophyModal';
import SmartClassButton from '@/app/components/SmartClassButton';
import ActivityLogger from '@/app/components/ActivityLogger';

import { BADGES } from '@/lib/gamification';

const CLASS_TIMES = {
  period1: { start: '19:20', end: '20:25' },
  period2: { start: '20:35', end: '21:40' }
};

const ErrorFallback = ({ message, onRetry }: { message: string, onRetry: () => void }) => (
  <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-center">
    <AlertTriangle className="text-red-500 mb-4" size={48} />
    <h2 className="text-lg font-bold text-slate-800 mb-2">エラーが発生しました</h2>
    <p className="text-xs text-slate-500 font-mono bg-slate-200 p-2 rounded mb-6 break-all max-w-full">
      {message}
    </p>
    <div className="flex gap-4">
      <button onClick={() => window.location.reload()} className="bg-slate-800 text-white px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
        <RefreshCw size={16} /> 再読み込み
      </button>
      <button onClick={onRetry} className="bg-red-100 text-red-600 px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
        <LogOut size={16} /> 強制ログアウト
      </button>
    </div>
  </div>
);

export default function StudentDashboard() {
  const { user, profile, loading: authLoading, logout } = useAuth();
  
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  
  const [dateStr, setDateStr] = useState('');
  const [greeting, setGreeting] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);
  const [nextClassInfo, setNextClassInfo] = useState<{ date: string; status: 'open' | 'closed' | 'checking' } | null>(null);
  const [urgentHomework, setUrgentHomework] = useState<{ title: string; deadline: string; daysLeft: number } | null>(null);

  const router = useRouter();

  // ★追加：Cookie（サーバーの記憶）を強制的に消去する強力な関数
  const clearAllCookies = () => {
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
  };

  useEffect(() => {
    const errorHandler = (event: ErrorEvent) => setGlobalError(event.message || "予期せぬエラー");
    const promiseHandler = (event: PromiseRejectionEvent) => setGlobalError(typeof event.reason === 'string' ? event.reason : "通信エラー");
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', promiseHandler);
    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', promiseHandler);
    };
  }, []);

  const handleForceLogout = async () => {
    try {
      clearAllCookies(); // ★ログアウト時にCookieも確実に破壊する
      await logout();
    } catch (e) {
      clearAllCookies();
      window.location.href = '/';
    }
  };

  useEffect(() => {
    setMounted(true);
    try {
      const d = new Date();
      setDateStr(d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }));
      const h = d.getHours();
      setGreeting(h < 11 ? 'おはよう！' : h < 17 ? 'こんにちは！' : 'こんばんは！');
      setNow(d);
      const timer = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(timer);
    } catch (e: any) {
      setGlobalError("初期化エラー: " + e.message);
    }
  }, []);

  useEffect(() => {
    if (!mounted || authLoading) return;
    
    // ★無限ループを断ち切る最重要ポイント！
    if (!user || !profile) {
      // Firebaseにログイン情報がないのにこの画面にいる = ミドルウェアのCookieが原因の無限ループ！
      // サーバー側の勘違いを解くため、Cookieを粉砕してからフルリロードでログイン画面に戻す。
      clearAllCookies();
      window.location.href = '/'; 
      return;
    }
    
    setUserData(profile);
    if (profile.day_of_week) checkNextClass(profile.day_of_week).catch(console.warn);
    if (profile.grade) checkUrgentHomework(profile.grade, profile.subjects || []).catch(console.warn);
    
  }, [mounted, authLoading, user, profile]);

  const checkNextClass = async (dayOfWeek: string) => {
    const daysMap = ['日','月','火','水','木','金','土'];
    const targetDayIndex = daysMap.indexOf(dayOfWeek);
    if (targetDayIndex === -1) return;
    const d = new Date();
    let daysUntil = (targetDayIndex + 7 - d.getDay()) % 7;
    if (daysUntil === 0 && d.getHours() >= 22) daysUntil = 7;
    d.setDate(d.getDate() + daysUntil);
    const targetDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setNextClassInfo({ date: targetDateStr, status: 'checking' });
    try {
      const q = query(collection(db, 'shift_assignments'), where('target_date', '==', targetDateStr), limit(1));
      const snap = await getDocs(q);
      setNextClassInfo({ date: targetDateStr, status: !snap.empty ? 'open' : 'closed' });
    } catch { setNextClassInfo(null); }
  };

  const checkUrgentHomework = async (grade: string, subjects: string[] = []) => {
    try {
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const q = query(collection(db, 'homework_assignments'), where('target_grade', '==', grade), where('deadline', '>=', todayStr), orderBy('deadline', 'asc'), limit(5));
      const snap = await getDocs(q);
      let foundHw = null;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.deadline) continue;
        if (!data.subject || subjects.length === 0 || subjects.includes(data.subject)) { foundHw = data; break; }
      }
      if (foundHw?.deadline) {
        const deadlineDate = new Date(foundHw.deadline.replace(/-/g, '/'));
        const nowTime = new Date();
        deadlineDate.setHours(0,0,0,0); nowTime.setHours(0,0,0,0);
        const diffDays = Math.ceil((deadlineDate.getTime() - nowTime.getTime()) / (1000 * 60 * 60 * 24));
        setUrgentHomework({ title: foundHw.title || '宿題', deadline: foundHw.deadline, daysLeft: diffDays });
      }
    } catch (e) { console.warn(e); }
  };

  const isClassActive = (start: string, end: string) => {
    if (!now) return false;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const showStartMinutes = (startH * 60 + startM) - 45; 
    const endMinutes = (endH * 60 + endM);
    return currentMinutes >= showStartMinutes && currentMinutes <= endMinutes;
  };

  const safeDateString = (str: string) => {
    if (!str) return '';
    try { return new Date(str.replace(/-/g, '/')).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }); } catch { return str; }
  };

  if (globalError) return <ErrorFallback message={globalError} onRetry={handleForceLogout} />;

  if (!mounted || authLoading || !userData) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-indigo-500" size={40} />
        <p className="text-xs font-bold text-slate-400 animate-pulse">{!mounted ? '起動中...' : authLoading ? '認証中...' : 'データ読み込み中...'}</p>
        <button onClick={handleForceLogout} className="mt-8 text-[10px] text-gray-400 underline cursor-pointer">画面が動かない場合はこちら（リセット）</button>
      </div>
    );
  }

  const currentBadge = BADGES.find(b => b.id === userData?.selected_badge);
  const showPeriod1 = isClassActive(CLASS_TIMES.period1.start, CLASS_TIMES.period1.end);
  const showPeriod2 = isClassActive(CLASS_TIMES.period2.start, CLASS_TIMES.period2.end);

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] pb-32 font-sans relative overflow-hidden">
      {userData?.uid && <ActivityLogger uid={userData.uid} />}
      {popMessage && <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-white px-6 py-3 rounded-full shadow-lg font-black text-lg z-[150] animate-bounce border-4 border-white whitespace-nowrap">✨ {popMessage}</div>}
      <TrophyModal isOpen={isTrophyOpen} onClose={() => setIsTrophyOpen(false)} userData={userData} />

      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 pt-10 pb-24 px-6 rounded-b-[40px] shadow-lg relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div className="flex justify-between items-start text-white relative z-10">
          <div>
            <p className="text-sm font-bold opacity-90 mb-1 flex items-center gap-2"><Calendar size={14}/> {dateStr}</p>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">{greeting} <br/><span className="text-yellow-300 text-3xl">{userData.student_name}</span> さん</h1>
            <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold"><Clock size={12}/> {userData.day_of_week || '-'}曜クラス | {userData.classroom || '-'}</div>
          </div>
          <div className="bg-white/20 p-1.5 rounded-xl backdrop-blur-sm">
            <button onClick={() => { if(confirm('ログアウトしますか？')) handleForceLogout(); }} className="p-2 text-white hover:bg-white/20 rounded-lg transition-colors flex flex-col items-center justify-center gap-0.5"><LogOut size={20} /></button>
          </div>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-20 space-y-6">
        <button onClick={() => setIsTrophyOpen(true)} className="w-full bg-white p-5 rounded-3xl shadow-xl shadow-indigo-100 flex justify-between items-center transform hover:scale-[1.02] active:scale-95 transition-all text-left group">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-4xl shadow-inner border border-indigo-100">{currentBadge ? currentBadge.icon : '🎓'}</div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase group-hover:text-indigo-500 transition-colors">My Badge</p>
              <p className="text-lg font-extrabold text-gray-800 flex items-center gap-2">{currentBadge ? currentBadge.name : 'バッジ未設定'} {currentBadge && <span className="bg-yellow-400 text-yellow-900 text-[10px] px-2 py-0.5 rounded-full">Equipped</span>}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-bold uppercase">Total Coins</p>
            <div className="flex items-center gap-1 justify-end text-yellow-500 font-black text-xl"><div className="bg-yellow-100 p-1 rounded-full"><Trophy size={14} className="fill-yellow-500"/></div>{userData.coins || 0}</div>
          </div>
        </button>

        <div className="space-y-4 animate-in slide-in-from-top-4">
          {showPeriod1 && <SmartClassButton profile={userData} period={1} startTime={CLASS_TIMES.period1.start} endTime={CLASS_TIMES.period1.end} />}
          {showPeriod2 && <SmartClassButton profile={userData} period={2} startTime={CLASS_TIMES.period2.start} endTime={CLASS_TIMES.period2.end} />}
          
          {!showPeriod1 && !showPeriod2 && now && (
            <div className="bg-white/60 p-4 rounded-3xl border border-white flex items-center justify-center gap-2 text-gray-400 text-sm font-bold">
              <Coffee size={18} />
              <span>現在は授業時間外です ({now.getHours()}:{String(now.getMinutes()).padStart(2,'0')})</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {nextClassInfo && (
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-indigo-50 flex items-center justify-between">
              <div><p className="text-xs text-indigo-500 font-bold flex items-center gap-1 mb-1"><CalendarCheck size={14}/> 次回の授業予定</p><p className="text-sm font-bold text-gray-700">{safeDateString(nextClassInfo.date)}</p></div>
              <div>{nextClassInfo.status === 'checking' ? <span className="text-xs text-gray-400">確認中...</span> : nextClassInfo.status === 'open' ? <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1.5 rounded-full">実施予定</span> : <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">休講 / お休み</span>}</div>
            </div>
          )}
          {urgentHomework && (
            <Link href="/student/homework" className="block no-underline"><div className={`p-4 rounded-3xl shadow-sm border flex items-center justify-between transition-transform active:scale-95 ${urgentHomework.daysLeft <= 1 ? 'bg-red-50 border-red-100' : urgentHomework.daysLeft <= 3 ? 'bg-orange-50 border-orange-100' : 'bg-blue-50 border-blue-100'}`}><div><div className={`text-xs font-bold flex items-center gap-1 mb-1 ${urgentHomework.daysLeft <= 1 ? 'text-red-600' : urgentHomework.daysLeft <= 3 ? 'text-orange-600' : 'text-blue-600'}`}>{urgentHomework.daysLeft <= 1 ? <Timer size={14} className="animate-pulse"/> : <ClipboardList size={14}/>}{urgentHomework.daysLeft <= 0 ? '期限切れ間近！' : `提出期限まで あと${urgentHomework.daysLeft}日`}</div><p className="text-sm font-bold text-gray-800 line-clamp-1">{urgentHomework.title}</p></div><div><span className={`text-xs font-black px-3 py-1.5 rounded-full ${urgentHomework.daysLeft <= 1 ? 'bg-red-500 text-white shadow-md shadow-red-200' : urgentHomework.daysLeft <= 3 ? 'bg-orange-400 text-white' : 'bg-white text-blue-500 border border-blue-200'}`}>{urgentHomework.daysLeft <= 0 ? '今日まで' : new Date(urgentHomework.deadline.replace(/-/g, '/')).getDate() + '日提出'}</span></div></div></Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
           <Link href="/student/homework/adaptive" className="col-span-2 block group"><div className="bg-gradient-to-r from-teal-400 to-emerald-500 p-5 rounded-3xl shadow-lg text-white flex items-center justify-between relative overflow-hidden"><div className="flex items-center gap-4 relative z-10"><div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center"><Brain size={28}/></div><div><div className="flex items-center gap-2 mb-1"><span className="text-lg font-bold">AI学習クエスト</span><span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse"><Sparkles size={10} fill="currentColor"/> NEW</span></div><p className="text-xs opacity-90">キミに最適な問題をAIが出題！</p></div></div><ChevronRight size={24} className="opacity-70 group-hover:translate-x-1 transition-transform"/></div></Link>
           <Link href="/student/chat" className="block group"><div className="bg-white p-5 rounded-3xl shadow-sm border border-indigo-100 hover:border-indigo-300 transition-all flex flex-col items-center text-center h-full"><div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Bot size={24}/></div><h2 className="font-bold text-gray-800">AIチューター</h2><p className="text-[10px] text-gray-400 mt-1">24時間 質問OK!</p></div></Link>
           <Link href="/student/homework" className="block group"><div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-orange-200 transition-all flex flex-col items-center text-center h-full"><div className="w-12 h-12 bg-orange-100 text-orange-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><BookOpen size={24}/></div><h2 className="font-bold text-gray-800">宿題提出</h2><p className="text-[10px] text-gray-400 mt-1">写真を送信</p></div></Link>
           <Link href="/student/recordings" className="block group"><div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-red-200 transition-all flex flex-col items-center text-center h-full"><div className="w-12 h-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Video size={24}/></div><h2 className="font-bold text-gray-800">授業録画</h2><p className="text-[10px] text-gray-400 mt-1">見逃し配信</p></div></Link>
           <Link href="/student/absence" className="block group"><div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-green-200 transition-all flex flex-col items-center text-center h-full"><div className="w-12 h-12 bg-green-100 text-green-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><AlertTriangle size={24}/></div><h2 className="font-bold text-gray-800">欠席連絡</h2><p className="text-[10px] text-gray-400 mt-1">お休み申請</p></div></Link>
        </div>
        <NewsWidget role="student" />
        <div className="bg-white p-2 rounded-3xl shadow-sm border border-gray-100"><CalendarWidget classDay={userData?.day_of_week} grade={userData?.grade} /></div>
        <Link href="/student/change-request" className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:bg-gray-50 transition-colors no-underline mb-8"><div className="flex items-center gap-3"><div className="bg-gray-100 p-2 rounded-lg text-gray-500"><Settings size={18}/></div><span className="text-sm font-bold text-gray-600">科目・曜日の変更申請</span></div><ChevronRight size={20} className="text-gray-400" /></Link>
      </div>

      <BottomNav />
    </div>
  );
}
