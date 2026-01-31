'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore'; 
import { useAuth } from '@/app/context/AuthContext'; // ★追加: useAuthをインポート
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Trophy, Settings,
  Bot, Brain, Sparkles, Clock, Coffee, CalendarCheck, ClipboardList, Timer, Loader2 
} from 'lucide-react';

// コンポーネントのインポート
import BottomNav from '@/app/components/BottomNav';
import LogoutButton from '@/app/components/LogoutButton';
import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget';
import TrophyModal from '@/app/components/TrophyModal';
import SmartClassButton from '@/app/components/SmartClassButton';
import ActivityLogger from '@/app/components/ActivityLogger';
import RegistrationModal from '@/app/components/RegistrationModal';

import { BADGES } from '@/lib/gamification';

const CLASS_TIMES = {
  period1: { start: '19:20', end: '20:25' },
  period2: { start: '20:35', end: '21:40' }
};

type Props = { 
  initialProfile?: any; // ★修正: undefinedの可能性を考慮して ? を付与
};

export default function StudentDashboard({ initialProfile }: Props) {
  // ★修正: useAuthからもデータを取得（バックアップ用）
  const { user, profile: authProfile, loading: authLoading } = useAuth();
  
  // 初期データの決定 (Props優先 -> AuthContext -> null)
  const [userData, setUserData] = useState<any>(initialProfile || authProfile || null);
  
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const [nextClassInfo, setNextClassInfo] = useState<{ date: string; status: 'open' | 'closed' | 'checking' } | null>(null);
  const [urgentHomework, setUrgentHomework] = useState<{ title: string; deadline: string; daysLeft: number } | null>(null);

  // 登録依頼用ステート
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [targetRequest, setTargetRequest] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const today = new Date();
  const dateStr = today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const getGreeting = () => {
    const h = today.getHours();
    if (h < 11) return 'おはよう！';
    if (h < 17) return 'こんにちは！';
    return 'こんばんは！';
  };

  // ★修正: userDataの同期と初期化ロジック
  useEffect(() => {
    // ユーザーIDの特定 (Props または AuthContext から)
    const targetUid = initialProfile?.uid || user?.uid;

    if (targetUid) {
      // リアルタイムリスナーの設定
      const unsub = onSnapshot(doc(db, 'users', targetUid), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setUserData(data);
          
          // データ取得後にチェック関数を実行
          if (data.day_of_week) checkNextClass(data.day_of_week);
          if (data.grade) checkUrgentHomework(data.grade, data.subjects); 
        }
      });
      
      setNow(new Date());
      const timer = setInterval(() => setNow(new Date()), 60000);

      // 初期データがある場合の一回目実行
      const initialData = initialProfile || authProfile;
      if (initialData) {
        if (initialData.day_of_week) checkNextClass(initialData.day_of_week);
        if (initialData.grade) checkUrgentHomework(initialData.grade, initialData.subjects);
      }

      return () => {
        unsub();
        clearInterval(timer);
      };
    }
  }, [initialProfile, user, authProfile]);

  // ★修正: 未回答依頼チェック (targetUidを使用)
  useEffect(() => {
    const targetUid = initialProfile?.uid || user?.uid;
    if (!targetUid) return;

    const checkRegistrations = async () => {
      try {
        const reqQuery = query(collection(db, 'registration_requests'), where('is_active', '==', true));
        const reqSnap = await getDocs(reqQuery);
        const activeRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (activeRequests.length === 0) return;

        const myRegQuery = query(collection(db, 'student_registrations'), where('student_id', '==', targetUid));
        const myRegSnap = await getDocs(myRegQuery);
        const myAnsweredIds = myRegSnap.docs.map(d => d.data().request_id);

        const pending = activeRequests.filter(req => !myAnsweredIds.includes(req.id));
        setPendingRequests(pending);

        if (pending.length > 0) {
          setTargetRequest(pending[0]);
          setIsModalOpen(true);
        }

      } catch (e) {
        console.error(e);
      }
    };

    checkRegistrations();
  }, [initialProfile, user]);

  const checkNextClass = async (dayOfWeek: string) => {
    if (!dayOfWeek) return;
    const targetDayIndex = ['日','月','火','水','木','金','土'].indexOf(dayOfWeek);
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
      if (!snap.empty) setNextClassInfo({ date: targetDateStr, status: 'open' });
      else setNextClassInfo({ date: targetDateStr, status: 'closed' });
    } catch (e) {
      console.error(e);
      setNextClassInfo({ date: targetDateStr, status: 'open' });
    }
  };

  const checkUrgentHomework = async (grade: string, subjects: string[] = []) => {
    if (!grade) return;
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    try {
      const q = query(
        collection(db, 'homework_assignments'), 
        where('target_grade', '==', grade),
        where('deadline', '>=', todayStr),
        orderBy('deadline', 'asc'),
        limit(5)
      );
      
      const snap = await getDocs(q);
      
      let foundHw = null;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.subject || subjects.length === 0 || subjects.includes(data.subject)) {
          foundHw = data;
          break;
        }
      }
      
      if (foundHw) {
        const deadlineDate = new Date(foundHw.deadline);
        const now = new Date();
        const diffTime = deadlineDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        setUrgentHomework({
          title: foundHw.title || '宿題',
          deadline: foundHw.deadline,
          daysLeft: diffDays
        });
      } else {
        setUrgentHomework(null);
      }
    } catch (e) {
      console.error("Homework fetch error:", e);
    }
  };

  const isClassActive = (start: string, end: string) => {
    if (!now) return false;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const [endH, endM] = end.split(':').map(Number);
    const endTotal = endH * 60 + endM;
    return currentMinutes >= (startTotal - 15) && currentMinutes <= endTotal;
  };

  const currentBadgeId = userData?.selected_badge;
  const currentBadge = BADGES.find(b => b.id === currentBadgeId);

  const showPeriod1 = isClassActive(CLASS_TIMES.period1.start, CLASS_TIMES.period1.end);
  const showPeriod2 = isClassActive(CLASS_TIMES.period2.start, CLASS_TIMES.period2.end);

  const handleRegistrationComplete = () => {
    setIsModalOpen(false);
    if (targetRequest) {
      setPendingRequests(prev => prev.filter(req => req.id !== targetRequest.id));
    }
    setTargetRequest(null);
  };

  const handleOpenRequest = (req: any) => {
    setTargetRequest(req);
    setIsModalOpen(true);
  };

  // ★追加: データ読み込み中のガード
  // プロフィール情報が全くない場合はローディングを表示し、クラッシュを防ぐ
  if (!userData && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  // ★追加: ログインはしているがプロフィールがない場合 (テストアカウント作成直後など)
  if (!userData && user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F4F8] p-6 text-center">
        <AlertTriangle className="text-yellow-500 mb-4" size={48} />
        <h2 className="text-xl font-bold text-gray-800 mb-2">プロフィール準備中</h2>
        <p className="text-gray-500 text-sm mb-6">
          生徒データの登録が完了していません。<br/>管理者に連絡するか、しばらくお待ちください。
        </p>
        <LogoutButton />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-32 font-sans relative overflow-hidden">
      
      {/* userDataが存在する場合のみuidを渡す */}
      <ActivityLogger uid={userData?.uid} />

      {popMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-white px-6 py-3 rounded-full shadow-lg font-black text-lg z-[150] animate-bounce border-4 border-white whitespace-nowrap">
          ✨ {popMessage}
        </div>
      )}

      {/* 登録モーダル */}
      <RegistrationModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onComplete={handleRegistrationComplete}
        request={targetRequest}
        studentId={userData?.uid}
      />

      <TrophyModal 
        isOpen={isTrophyOpen} 
        onClose={() => setIsTrophyOpen(false)} 
        userData={userData}
      />

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

        <div className="space-y-4 animate-in slide-in-from-top-4">
          {showPeriod1 && <SmartClassButton profile={userData} period={1} startTime={CLASS_TIMES.period1.start} endTime={CLASS_TIMES.period1.end} />}
          {showPeriod2 && <SmartClassButton profile={userData} period={2} startTime={CLASS_TIMES.period2.start} endTime={CLASS_TIMES.period2.end} />}
          {!showPeriod1 && !showPeriod2 && now && (
            <div className="bg-white/60 p-4 rounded-3xl border border-white flex items-center justify-center gap-2 text-gray-400 text-sm font-bold">
              <Coffee size={18} />
              <span>現在は授業時間外です</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          
          {nextClassInfo && (
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-indigo-50 flex items-center justify-between">
              <div>
                <p className="text-xs text-indigo-500 font-bold flex items-center gap-1 mb-1">
                  <CalendarCheck size={14}/> 次回の授業予定
                </p>
                <p className="text-sm font-bold text-gray-700">
                  {new Date(nextClassInfo.date).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
                </p>
              </div>
              <div>
                {nextClassInfo.status === 'checking' ? (
                  <span className="text-xs text-gray-400">確認中...</span>
                ) : nextClassInfo.status === 'open' ? (
                  <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1.5 rounded-full">実施予定</span>
                ) : (
                  <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">休講 / お休み</span>
                )}
              </div>
            </div>
          )}

          {urgentHomework && (
            <Link href="/student/homework" className="block no-underline">
              <div className={`p-4 rounded-3xl shadow-sm border flex items-center justify-between transition-transform active:scale-95 ${
                urgentHomework.daysLeft <= 1 
                  ? 'bg-red-50 border-red-100'
                  : urgentHomework.daysLeft <= 3 
                    ? 'bg-orange-50 border-orange-100'
                    : 'bg-blue-50 border-blue-100'
              }`}>
                <div>
                  <div className={`text-xs font-bold flex items-center gap-1 mb-1 ${
                    urgentHomework.daysLeft <= 1 ? 'text-red-600' : urgentHomework.daysLeft <= 3 ? 'text-orange-600' : 'text-blue-600'
                  }`}>
                    {urgentHomework.daysLeft <= 1 ? <Timer size={14} className="animate-pulse"/> : <ClipboardList size={14}/>}
                    {urgentHomework.daysLeft <= 0 ? '期限切れ間近！' : `提出期限まで あと${urgentHomework.daysLeft}日`}
                  </div>
                  <p className="text-sm font-bold text-gray-800 line-clamp-1">
                    {urgentHomework.title}
                  </p>
                </div>
                <div>
                  <span className={`text-xs font-black px-3 py-1.5 rounded-full ${
                    urgentHomework.daysLeft <= 1 
                      ? 'bg-red-500 text-white shadow-md shadow-red-200' 
                      : urgentHomework.daysLeft <= 3 
                        ? 'bg-orange-400 text-white'
                        : 'bg-white text-blue-500 border border-blue-200'
                  }`}>
                    {urgentHomework.daysLeft === 0 ? '今日まで' : new Date(urgentHomework.deadline).getDate() + '日提出'}
                  </span>
                </div>
              </div>
            </Link>
          )}

        </div>

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

        {/* お知らせウィジェット */}
        <NewsWidget 
          role="student" 
          pendingRequests={pendingRequests}
          onOpenRequest={handleOpenRequest}
        />
        
        <div className="bg-white p-2 rounded-3xl shadow-sm border border-gray-100">
          <CalendarWidget classDay={userData?.day_of_week} grade={userData?.grade} />
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