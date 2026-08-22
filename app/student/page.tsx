'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Trophy, Settings,
  Bot, Brain, Sparkles, Clock, Coffee, CalendarCheck, ClipboardList, Timer, Loader2, LogOut, FileImage, Repeat, CheckCircle
} from 'lucide-react';

import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget';
import TrophyModal from '@/app/components/TrophyModal';
import SmartClassButton from '@/app/components/SmartClassButton';
import ActivityLogger from '@/app/components/ActivityLogger';

import { BADGES } from '@/lib/gamification';
import {
  DEFAULT_CLASS_BUTTON_SETTINGS,
  isClassButtonVisible,
  normalizeClassButtonSettings,
} from '@/lib/class-button-settings';
import {
  normalizeStudentAppearance,
  studentBackgroundPatternStyle,
  STUDENT_CARD_STYLES,
  STUDENT_DENSITIES,
  STUDENT_HEADER_STYLES,
  STUDENT_THEMES,
} from '@/lib/student-customization';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { getCourseDay } from '@/app/components/CourseRegistrationCalendar';
import { formatClassDays, parseClassDays } from '@/lib/class-days';

export default function StudentDashboard() {
  const { user, profile: authProfile, loading: authLoading, logout } = useAuth();
  const pathname = usePathname();
  const isTeacherPreview = pathname.startsWith('/teacher/student-preview');
  
  const [mounted, setMounted] = useState(false);
  const [userData, setUserData] = useState<any>(authProfile || null);
  
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [classButtonSettings, setClassButtonSettings] = useState(DEFAULT_CLASS_BUTTON_SETTINGS);
  const [registeredClassDays, setRegisteredClassDays] = useState<string[]>([]);
  const [registeredShiftIds, setRegisteredShiftIds] = useState<string[] | null>(null);

  const [dateStr, setDateStr] = useState('');
  const [greeting, setGreeting] = useState('');

  const [nextClassInfo, setNextClassInfo] = useState<{ date: string; status: 'open' | 'closed' | 'checking' } | null>(null);
  const [urgentHomework, setUrgentHomework] = useState<{ title: string; deadline: string; daysLeft: number } | null>(null);
  const [requiredTransfer, setRequiredTransfer] = useState<any | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const { visibility, loaded: visibilityLoaded } = usePortalVisibility('student');

  const mergeUserUpdates = useCallback((updates: Record<string, any>) => {
    setUserData((prev: any) => {
      if (!prev) return prev;
      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      );
      return { ...prev, ...cleanedUpdates };
    });
  }, []);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      mergeUserUpdates((event as CustomEvent<Record<string, any>>).detail || {});
    };
    window.addEventListener('classbase:user-profile-updated', handleProfileUpdated);
    return () => window.removeEventListener('classbase:user-profile-updated', handleProfileUpdated);
  }, [mergeUserUpdates]);

  // 初期化 (日時・挨拶)
  useEffect(() => {
    setMounted(true);
    const d = new Date();
    try {
      setDateStr(d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }));
    } catch (e) {
      setDateStr('');
    }
    const h = d.getHours();
    if (h < 11) setGreeting('おはよう！');
    else if (h < 17) setGreeting('こんにちは！');
    else setGreeting('こんばんは！');
    setNow(d);
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadClassButtonSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'class_button'));
        setClassButtonSettings(normalizeClassButtonSettings(snap.exists() ? snap.data() : {}));
      } catch (error) {
        console.warn('class button settings fetch failed:', error);
        setClassButtonSettings(DEFAULT_CLASS_BUTTON_SETTINGS);
      }
    };
    loadClassButtonSettings();
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    if (authProfile) {
      setUserData(authProfile);
      setRegisteredClassDays(parseClassDays(authProfile.day_of_week));
      if (authProfile.day_of_week) checkNextClass(authProfile.day_of_week);
      if (authProfile.grade) checkUrgentHomework(authProfile.grade, authProfile.subjects);
      return;
    }

    let cancelled = false;
    const loadFallbackProfile = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setUserData(data);
          setRegisteredClassDays(parseClassDays(data.day_of_week));
          if (data.day_of_week) checkNextClass(data.day_of_week);
          if (data.grade) checkUrgentHomework(data.grade, data.subjects);
        } else {
          setUserData({
            uid: user.uid,
            student_name: user.displayName || 'ゲスト',
            coins: 0,
            selected_badge: 'beginner',
          });
        }
      } catch (error) {
        console.error("Firestore Read Error (Permissions?):", error);
        if (!cancelled) {
          setUserData((prev: any) => prev || {
            uid: user.uid,
            student_name: '読み込みエラー',
            coins: 0,
            error_mode: true,
          });
        }
      }
    };
    loadFallbackProfile();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, authProfile]);

  useEffect(() => {
    if (!user?.uid || isTeacherPreview) return;
    let cancelled = false;
    const loadRequiredTransfer = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/student/transfer-options?required_only=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok !== false && Array.isArray(data.absences) && data.absences.length > 0) {
          setRequiredTransfer(data);
          setSelectedTransferId(data.options?.[0]?.id || '');
        } else {
          setRequiredTransfer(null);
          setSelectedTransferId('');
        }
      } catch (error) {
        console.warn('required transfer fetch failed:', error);
      }
    };
    loadRequiredTransfer();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, isTeacherPreview]);

  useEffect(() => {
    if (!user || !userData?.grade || isTeacherPreview) return;
    const prefetch = () => {
      loadCourseRegistrationOptions({
        grade: String(userData.grade),
        getToken: () => user.getIdToken(),
      }).then(payload => {
        const selectedIds = new Set(
          (Array.isArray(userData.selected_course_ids) ? userData.selected_course_ids : [])
            .map((id: unknown) => String(id))
        );
        if (selectedIds.size === 0) {
          setRegisteredShiftIds([]);
          return;
        }
        const selectedOptions = (Array.isArray(payload.options) ? payload.options : []).filter((option: any) => (
          selectedIds.has(String(option.id || '')) ||
          selectedIds.has(String(option.parent_course_option_id || '')) ||
          selectedIds.has(String(option.fallback_curriculum_option_id || ''))
        ));
        const resolvedShiftIds = Array.from(new Set(selectedOptions.flatMap((option: any) => (
          Array.isArray(option.matched_shift_ids) ? option.matched_shift_ids.map(String) : []
        ))));
        setRegisteredShiftIds(resolvedShiftIds);
        const resolvedDays = parseClassDays(selectedOptions.map(getCourseDay));
        if (resolvedDays.length === 0) return;
        setRegisteredClassDays(resolvedDays);
        checkNextClass(resolvedDays);
      }).catch(error => console.warn('course options prefetch failed:', error));
    };
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(prefetch, 1200);
    return () => window.clearTimeout(timer);
  }, [isTeacherPreview, user, userData?.grade, userData?.selected_course_ids]);

  const handleLogout = async () => {
    if (isTeacherPreview) return;
    if (confirm('ログアウトしますか？')) {
      try {
        await logout();
      } catch (error) {
        console.error("Logout failed", error);
        window.location.href = '/';
      }
    }
  };

  const checkNextClass = async (dayOfWeek: unknown) => {
    const classDays = parseClassDays(dayOfWeek);
    if (classDays.length === 0) return;
    const dayOrder = ['日','月','火','水','木','金','土'];
    const today = new Date();
    const candidates = classDays.map(day => {
      const targetDayIndex = dayOrder.indexOf(day);
      let daysUntil = (targetDayIndex + 7 - today.getDay()) % 7;
      if (daysUntil === 0 && today.getHours() >= 22) daysUntil = 7;
      const date = new Date(today);
      date.setDate(date.getDate() + daysUntil);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }).sort();

    setNextClassInfo({ date: candidates[0], status: 'checking' });
    try {
      const results = await Promise.all(candidates.map(async date => {
        const q = query(collection(db, 'shift_assignments'), where('target_date', '==', date), limit(1));
        const snap = await getDocs(q);
        return { date, open: !snap.empty };
      }));
      const nextOpen = results.find(result => result.open);
      setNextClassInfo(nextOpen
        ? { date: nextOpen.date, status: 'open' }
        : { date: candidates[0], status: 'closed' });
    } catch (e) {
      // エラー時は非表示にせず、とりあえず開催扱いで表示しておく(安全策)
      setNextClassInfo({ date: candidates[0], status: 'open' });
    }
  };

  const checkUrgentHomework = async (grade: string, subjects: string[] = []) => {
    if (!grade) return;
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      const q = query(collection(db, 'homework_assignments'), where('target_grade', '==', grade), where('deadline', '>=', todayStr), orderBy('deadline', 'asc'), limit(5));
      const snap = await getDocs(q);
      let foundHw = null;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.subject || subjects.length === 0 || subjects.includes(data.subject)) { foundHw = data; break; }
      }
      if (foundHw && foundHw.deadline) {
        const deadlineDate = new Date(foundHw.deadline.replace(/-/g, '/'));
        const nowTime = new Date();
        const diffTime = deadlineDate.getTime() - nowTime.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setUrgentHomework({ title: foundHw.title || '宿題', deadline: foundHw.deadline, daysLeft: diffDays });
      } else { setUrgentHomework(null); }
    } catch (e) { console.error("Homework fetch error:", e); }
  };

  const safeDateString = (dateStr: string) => {
    if (!dateStr) return '';
    try { return new Date(dateStr.replace(/-/g, '/')).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }); } catch (e) { return dateStr; }
  };

  const submitRequiredTransfer = async () => {
    if (!user || !requiredTransfer?.selected_absence?.id || !selectedTransferId) return;
    setTransferSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/student/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          absence_id: requiredTransfer.selected_absence.id,
          transfer_shift_id: selectedTransferId,
          note: '生徒画面の必須振替選択から登録',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setRequiredTransfer(null);
      setSelectedTransferId('');
    } catch (error) {
      console.error(error);
      alert('振替登録に失敗しました。もう一度お試しください。');
    } finally {
      setTransferSubmitting(false);
    }
  };

  const currentBadgeId = userData?.selected_badge === 'beginner' ? 'badge_1' : userData?.selected_badge;
  const currentBadge = BADGES.find(b => b.id === currentBadgeId);
  const appearance = normalizeStudentAppearance(userData?.settings?.appearance);
  const theme = STUDENT_THEMES[appearance.theme];
  const cardStyle = STUDENT_CARD_STYLES[appearance.cardStyle];
  const density = STUDENT_DENSITIES[appearance.density];
  const headerStyle = STUDENT_HEADER_STYLES[appearance.headerStyle];

  const showPeriod1 = isTeacherPreview || isClassButtonVisible(now, classButtonSettings.period1_start, classButtonSettings.period1_end, classButtonSettings);
  const showPeriod2 = isTeacherPreview || isClassButtonVisible(now, classButtonSettings.period2_start, classButtonSettings.period2_end, classButtonSettings);

  // --- Render ---

  if (!mounted || authLoading || !userData || !visibilityLoaded) {
    return <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  }
  if (!user) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  const displayProfile = userData;
  const displayClassDays = registeredClassDays.length > 0
    ? registeredClassDays
    : parseClassDays(displayProfile.day_of_week);
  const displayClassDayLabel = formatClassDays(displayClassDays) || '-';

  return (
    <div className={`min-h-screen ${theme.pageBg} pb-32 font-sans relative overflow-hidden`} style={studentBackgroundPatternStyle(appearance.backgroundPattern)}>
      
      {/* ユーザーIDがあればログ出力 (なければスキップ) */}
      {!isTeacherPreview && displayProfile?.uid && <ActivityLogger uid={displayProfile.uid} onRewardApplied={mergeUserUpdates} />}

      {popMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-white px-6 py-3 rounded-full shadow-lg font-black text-lg z-[150] animate-bounce border-4 border-white whitespace-nowrap">
          ✨ {popMessage}
        </div>
      )}

      <TrophyModal isOpen={isTrophyOpen} onClose={() => setIsTrophyOpen(false)} userData={displayProfile} canUseShop={visibility.shop !== false} />

      {requiredTransfer && !isTeacherPreview && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <Repeat size={26} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-indigo-500">Transfer Required</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">振替先を選択してください</h2>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  保護者から欠席連絡が届いています。振替先を選ぶまで、この画面を閉じることはできません。
                </p>
              </div>
            </div>
            <div className="mb-4 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
              欠席日: {requiredTransfer.selected_absence?.target_date || '-'}
            </div>
            <div className="space-y-3">
              {Array.isArray(requiredTransfer.options) && requiredTransfer.options.length > 0 ? requiredTransfer.options.map((option: any) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedTransferId(option.id)}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition ${selectedTransferId === option.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-indigo-200'}`}
                >
                  <p className="font-black">{option.title}</p>
                  <p className="mt-1 text-xs font-bold text-slate-400">{option.unit || '単元名未設定'} / {option.period ? `${option.period}限` : '時限未設定'}</p>
                </button>
              )) : (
                <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-700">
                  同じ単元の振替候補がまだありません。校舎へお問い合わせください。
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={submitRequiredTransfer}
              disabled={transferSubmitting || !selectedTransferId || !requiredTransfer.options?.length}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {transferSubmitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
              この振替先で確定する
            </button>
          </div>
        </div>
      )}

      <div className={`${theme.heroBg} pt-10 ${density.heroBottom} px-6 ${headerStyle.heroShape} relative overflow-hidden`}>
        <div className={`absolute top-[-50px] right-[-50px] w-40 h-40 ${theme.heroAccent} rounded-full blur-2xl transition-transform ${headerStyle.decoration}`}></div>
        {appearance.showMascot && (
          <div className="absolute bottom-5 right-6 rounded-full bg-white/15 px-4 py-2 text-3xl shadow-sm backdrop-blur-sm" aria-hidden="true">
            {currentBadge ? currentBadge.icon : '🎓'}
          </div>
        )}
        <div className="flex justify-between items-start text-white relative z-10">
          <div>
            <p className="text-sm font-bold opacity-90 mb-1 flex items-center gap-2"><Calendar size={14}/> {dateStr}</p>
            <h1 className="text-2xl font-extrabold tracking-tight leading-tight">{greeting} <br/><span className={`${theme.nameColor} text-3xl`}>{displayProfile.student_name}</span> さん</h1>
            {displayProfile.error_mode ? (
              <div className="mt-3 inline-flex items-center gap-2 bg-red-500/80 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold animate-pulse">
                <AlertTriangle size={12}/> プロフィール読み込みエラー (管理者へご連絡ください)
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                <Clock size={12}/> {displayClassDayLabel}曜クラス | {displayProfile.classroom || '-'}
              </div>
            )}
          </div>
          {!isTeacherPreview && (
            <div className="bg-white/20 p-1.5 rounded-xl backdrop-blur-sm">
              <button onClick={handleLogout} className="p-2 text-white hover:bg-white/20 rounded-lg transition-colors flex flex-col items-center justify-center gap-0.5" title="ログアウト">
                <LogOut size={20} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`px-5 -mt-16 relative z-20 ${density.sectionGap}`}>
        <button onClick={() => setIsTrophyOpen(true)} className={`w-full ${cardStyle.panel} ${density.cardPadding} flex justify-between items-center transform hover:scale-[1.02] active:scale-95 transition-all text-left group`}>
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl ${theme.badgeBg} flex items-center justify-center text-4xl shadow-inner border ${theme.ring}`}>{currentBadge ? currentBadge.icon : '🎓'}</div>
            <div>
              <p className={`text-[10px] text-gray-400 font-bold uppercase ${theme.primaryText} transition-colors`}>My Badge</p>
              <p className="text-lg font-extrabold text-gray-800 flex items-center gap-2">{currentBadge ? currentBadge.name : 'バッジ未設定'} {currentBadge && <span className="bg-yellow-400 text-yellow-900 text-[10px] px-2 py-0.5 rounded-full">Equipped</span>}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-bold uppercase">Total Coins</p>
            <div className="flex items-center gap-1 justify-end text-yellow-500 font-black text-xl"><div className="bg-yellow-100 p-1 rounded-full"><Trophy size={14} className="fill-yellow-500"/></div>{displayProfile.coins || 0}</div>
          </div>
        </button>

        <div className={`${density.sectionGap} animate-in slide-in-from-top-4`}>
          {showPeriod1 && <SmartClassButton profile={displayProfile} period={1} startTime={classButtonSettings.period1_start} endTime={classButtonSettings.period1_end} previewMode={isTeacherPreview} allowBetaTransfer={visibility.transfer !== false} />}
          {showPeriod2 && <SmartClassButton profile={displayProfile} period={2} startTime={classButtonSettings.period2_start} endTime={classButtonSettings.period2_end} previewMode={isTeacherPreview} allowBetaTransfer={visibility.transfer !== false} />}
          {!showPeriod1 && !showPeriod2 && now && (
            <div className={`${cardStyle.panel} p-4 flex items-center justify-center gap-2 text-gray-400 text-sm font-bold`}>
              <Coffee size={18} />
              <span>現在は授業時間外です</span>
            </div>
          )}
        </div>

        {/* --- 省略（元のリンクやウィジェットはそのままです） --- */}
        <div className="space-y-3">
          {nextClassInfo && (
            <div className={`${cardStyle.panel} p-4 flex items-center justify-between`}>
              <div><p className={`text-xs ${theme.primaryText} font-bold flex items-center gap-1 mb-1`}><CalendarCheck size={14}/> 次回の授業予定</p><p className="text-sm font-bold text-gray-700">{safeDateString(nextClassInfo.date)}</p></div>
              <div>{nextClassInfo.status === 'checking' ? <span className="text-xs text-gray-400">確認中...</span> : nextClassInfo.status === 'open' ? <span className={`${theme.badgeBg} ${theme.badgeText} text-xs font-bold px-3 py-1.5 rounded-full`}>実施予定</span> : <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">休講 / お休み</span>}</div>
            </div>
          )}
          {visibility.homework && urgentHomework && (
            <Link href="/student/homework" className="block no-underline">
              <div className={`p-4 rounded-3xl shadow-sm border flex items-center justify-between transition-transform active:scale-95 ${urgentHomework.daysLeft <= 1 ? 'bg-red-50 border-red-100' : urgentHomework.daysLeft <= 3 ? 'bg-orange-50 border-orange-100' : 'bg-blue-50 border-blue-100'}`}>
                <div><div className={`text-xs font-bold flex items-center gap-1 mb-1 ${urgentHomework.daysLeft <= 1 ? 'text-red-600' : urgentHomework.daysLeft <= 3 ? 'text-orange-600' : 'text-blue-600'}`}>{urgentHomework.daysLeft <= 1 ? <Timer size={14} className="animate-pulse"/> : <ClipboardList size={14}/>}{urgentHomework.daysLeft <= 0 ? '期限切れ間近！' : `提出期限まで あと${urgentHomework.daysLeft}日`}</div><p className="text-sm font-bold text-gray-800 line-clamp-1">{urgentHomework.title}</p></div>
                <div><span className={`text-xs font-black px-3 py-1.5 rounded-full ${urgentHomework.daysLeft <= 1 ? 'bg-red-500 text-white shadow-md shadow-red-200' : urgentHomework.daysLeft <= 3 ? 'bg-orange-400 text-white' : 'bg-white text-blue-500 border border-blue-200'}`}>{urgentHomework.daysLeft <= 0 ? '今日まで' : new Date(urgentHomework.deadline.replace(/-/g, '/')).getDate() + '日提出'}</span></div>
              </div>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {visibility.adaptiveQuest && <Link href="/student/homework/adaptive" className="col-span-2 block group"><div className={`${theme.questBg} ${density.featurePadding} rounded-3xl shadow-lg text-white flex items-center justify-between relative overflow-hidden`}><div className="flex items-center gap-4 relative z-10"><div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center"><Brain size={28}/></div><div><div className="flex items-center gap-2 mb-1"><span className="text-lg font-bold">AI学習クエスト</span><span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse"><Sparkles size={10} fill="currentColor"/> NEW</span></div><p className="text-xs opacity-90">キミに最適な問題をAIが出題！</p></div></div><ChevronRight size={24} className="opacity-70 group-hover:translate-x-1 transition-transform"/></div></Link>}
          {visibility.ocrQuiz && <Link href="/student/ocr-quiz" className="col-span-2 block group"><div className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg transition-all active:scale-[0.99] flex items-center justify-between"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><FileImage size={26}/></div><div><div className="flex items-center gap-2"><span className="text-lg font-bold">OCR問題作成</span><span className="rounded-full bg-emerald-300 px-2 py-0.5 text-[10px] font-black text-emerald-950">私用限定</span></div><p className="text-xs text-white/70">手元の画像から、自分だけの類題を作成</p></div></div><ChevronRight size={24} className="text-white/60 group-hover:translate-x-1 transition-transform"/></div></Link>}
          {visibility.chat && <Link href="/student/chat" className="block group"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className={`w-12 h-12 ${theme.badgeBg} ${theme.badgeText} rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}><Bot size={24}/></div><h2 className="font-bold text-gray-800">AIチューター</h2><p className="text-[10px] text-gray-400 mt-1">24時間 質問OK!</p></div></Link>}
          {visibility.homework && <Link href="/student/homework" className="block group"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-orange-100 text-orange-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><BookOpen size={24}/></div><h2 className="font-bold text-gray-800">Monoxer</h2><p className="text-[10px] text-gray-400 mt-1">宿題に取り組む</p></div></Link>}
          {visibility.recordings && <Link href="/student/recordings" className="block group"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Video size={24}/></div><h2 className="font-bold text-gray-800">授業録画</h2><p className="text-[10px] text-gray-400 mt-1">見逃し配信</p></div></Link>}
          {visibility.absence && <Link href="/student/absence" className="block group"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-green-100 text-green-500 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><AlertTriangle size={24}/></div><h2 className="font-bold text-gray-800">欠席連絡</h2><p className="text-[10px] text-gray-400 mt-1">お休み申請</p></div></Link>}
        </div>

        {visibility.news && <NewsWidget role="student" />}
        
        {visibility.calendar && <div className={`${cardStyle.panel} p-2`}>
          <CalendarWidget
            classDay={displayClassDays}
            grade={displayProfile.grade}
            studentShiftIds={registeredShiftIds}
          />
        </div>}
        
        {visibility.changeRequest && <Link href="/student/change-request" className={`flex items-center justify-between ${cardStyle.panel} p-4 hover:bg-gray-50 transition-colors no-underline mb-8`}>
          <div className="flex items-center gap-3"><div className="bg-gray-100 p-2 rounded-lg text-gray-500"><Settings size={18}/></div><span className="text-sm font-bold text-gray-600">受講講座・曜日時間の変更</span></div><ChevronRight size={20} className="text-gray-400" />
        </Link>}
      </div>
    </div>
  );
}
