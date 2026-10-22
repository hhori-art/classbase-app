'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import ReviewPeriodEntryCard from '@/app/components/ReviewPeriodEntryCard';
import { useAuth } from '@/app/context/AuthContext';
import { 
  Video, BookOpen, AlertTriangle, 
  ChevronRight, Calendar, Trophy, Settings,
  Bot, Brain, Sparkles, Clock, Coffee, CalendarCheck, ClipboardList, Timer, LogOut, FileImage, Repeat, CheckCircle, X, BookOpenCheck, CalendarDays
} from 'lucide-react';

import CalendarWidget from '@/app/components/CalendarWidget';
import NewsWidget from '@/app/components/NewsWidget';
import TrophyModal from '@/app/components/TrophyModal';
import SmartClassButton from '@/app/components/SmartClassButton';
import ActivityLogger from '@/app/components/ActivityLogger';
import StudentCourseRegistrationPrompt from '@/app/components/StudentCourseRegistrationPrompt';
import NextLessonCard from '@/app/components/student/NextLessonCard';
import { findNextLesson, minutesUntilLesson, type StudentTimetable } from '@/lib/timetable';

import { BADGES } from '@/lib/gamification';
import {
  DEFAULT_CLASS_BUTTON_SETTINGS,
  isClassButtonVisible,
  normalizeClassButtonSettings,
} from '@/lib/class-button-settings';
import {
  normalizeStudentAppearance,
  studentBadgeFrameStyle,
  STUDENT_CARD_STYLES,
  STUDENT_DENSITIES,
  STUDENT_HEADER_STYLES,
  STUDENT_THEMES,
} from '@/lib/student-customization';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import { presetTitleText } from '@/lib/reward-presets';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { getCourseDay } from '@/app/components/CourseRegistrationCalendar';
import { formatClassDays, parseClassDays } from '@/lib/class-days';
import { loadAppAvailability } from '@/lib/client-app-availability';
import { jstDateKey } from '@/lib/date-key';
import { loadStudentHomework } from '@/lib/client-student-homework';
import { courseOptionMatchesSelection } from '@/lib/course-registration-selection';
import { AbsenceRequestError } from '@/lib/absence-request-errors';
import { formatDate, formatShortDate } from '@/lib/format';
import { Button, Spinner, useConfirm, useToast } from '@/app/components/ui';

export default function StudentDashboard() {
  const { user, profile: authProfile, loading: authLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isTeacherPreview = pathname.startsWith('/teacher/student-preview');
  
  const [mounted, setMounted] = useState(false);
  const [userData, setUserData] = useState<any>(authProfile || null);
  
  const [isTrophyOpen, setIsTrophyOpen] = useState(false);
  const [popMessage, setPopMessage] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [classButtonSettings, setClassButtonSettings] = useState(DEFAULT_CLASS_BUTTON_SETTINGS);
  const [registeredClassDays, setRegisteredClassDays] = useState<string[]>([]);
  const [registeredShiftIds, setRegisteredShiftIds] = useState<string[] | null>(null);
  const [registeredShiftDates, setRegisteredShiftDates] = useState<string[] | null>(null);

  const [dateStr, setDateStr] = useState('');
  const [greeting, setGreeting] = useState('');

  const [nextClassInfo, setNextClassInfo] = useState<{ date: string; status: 'open' | 'closed' | 'checking' } | null>(null);
  const [urgentHomework, setUrgentHomework] = useState<{ title: string; deadline: string; daysLeft: number } | null>(null);
  const [requiredTransfer, setRequiredTransfer] = useState<any | null>(null);
  const [requiredTransferError, setRequiredTransferError] = useState(false);
  const [requiredTransferReload, setRequiredTransferReload] = useState(0);
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [onlineSchoolEnabled, setOnlineSchoolEnabled] = useState(false);
  const [timetable, setTimetable] = useState<StudentTimetable | null>(null);

  const { visibility, loaded: visibilityLoaded } = usePortalVisibility('student');

  useEffect(() => {
    if (mounted && !authLoading && !user && !isTeacherPreview) router.replace('/');
  }, [authLoading, isTeacherPreview, mounted, router, user]);

  useEffect(() => {
    if (!user || isTeacherPreview) {
      setOnlineSchoolEnabled(false);
      return;
    }
    let active = true;
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => { if (active) setOnlineSchoolEnabled(data?.apps?.online_school === true); })
      .catch(() => { if (active) setOnlineSchoolEnabled(false); });
    return () => { active = false; };
  }, [isTeacherPreview, user]);

  // 次の授業（授業時間外に表示）。時間割APIの14日分から求める。参加は授業ボタンのまま。
  useEffect(() => {
    if (!user || isTeacherPreview) {
      setTimetable(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/student/timetable', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'timetable-failed');
        if (active) setTimetable(body as StudentTimetable);
      } catch (error) {
        // 取れなければ従来の「授業時間外」表示に戻す。
        console.warn('next lesson fetch failed:', error);
        if (active) setTimetable(null);
      }
    })();
    return () => { active = false; };
  }, [isTeacherPreview, user]);

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
    setDateStr(formatDate(d));
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
      setUserData({ ...authProfile, uid: user.uid });
      setRegisteredClassDays(parseClassDays(authProfile.day_of_week));
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
          setUserData({ ...data, uid: user.uid });
          setRegisteredClassDays(parseClassDays(data.day_of_week));
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
  }, [user?.uid, user?.displayName, authProfile]);

  useEffect(() => {
    if (!user?.uid || isTeacherPreview) return;
    let cancelled = false;
    const loadRequiredTransfer = async () => {
      setRequiredTransferError(false);
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/student/transfer-options?required_only=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.ok === false) throw new Error(data.error || 'required transfer fetch failed');
        if (Array.isArray(data.absences) && data.absences.length > 0) {
          setRequiredTransfer(data);
          setSelectedTransferId(data.options?.[0]?.id || '');
        } else {
          setRequiredTransfer(null);
          setSelectedTransferId('');
        }
      } catch (error) {
        console.warn('required transfer fetch failed:', error);
        if (!cancelled) setRequiredTransferError(true);
      }
    };
    loadRequiredTransfer();
    return () => {
      cancelled = true;
    };
  }, [user, isTeacherPreview, requiredTransferReload]);

  useEffect(() => {
    if (!user || !userData?.grade || isTeacherPreview) return;
    const prefetch = () => {
      loadCourseRegistrationOptions({
        grade: String(userData.grade),
        getToken: forceRefresh => user.getIdToken(forceRefresh),
      }).then(payload => {
        const selectedIds = new Set(
          [
            ...(Array.isArray(userData.selected_course_ids) ? userData.selected_course_ids : []),
            ...(Array.isArray(userData.selected_course_keys) ? userData.selected_course_keys : []),
          ]
            .map((id: unknown) => String(id))
        );
        if (selectedIds.size === 0) {
          setRegisteredShiftIds([]);
          setRegisteredShiftDates([]);
          return;
        }
        const selectedOptions = (Array.isArray(payload.options) ? payload.options : [])
          .filter((option: any) => courseOptionMatchesSelection(option, selectedIds));
        const resolvedShiftIds = Array.from(new Set(selectedOptions.flatMap((option: any) => (
          Array.isArray(option.matched_shift_ids) ? option.matched_shift_ids.map(String) : []
        ))));
        setRegisteredShiftIds(resolvedShiftIds);
        setRegisteredShiftDates(Array.from(new Set(selectedOptions.flatMap((option: any) => (
          Array.isArray(option.matched_dates) ? option.matched_dates.map((date: unknown) => String(date).slice(0, 10)) : []
        )))).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)));
        const resolvedDays = parseClassDays(selectedOptions.map(getCourseDay));
        if (resolvedDays.length > 0) setRegisteredClassDays(resolvedDays);
        const today = jstDateKey();
        const jstHour = Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23',
        }).format(new Date()));
        const nextDate = Array.from(new Set(selectedOptions.flatMap((option: any) => (
          Array.isArray(option.matched_dates) ? option.matched_dates.map((date: unknown) => String(date).slice(0, 10)) : []
        )))).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && (jstHour >= 22 ? date > today : date >= today)).sort()[0];
        setNextClassInfo(nextDate ? { date: nextDate, status: 'open' } : null);
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
  }, [isTeacherPreview, user, userData?.grade, userData?.selected_course_ids, userData?.selected_course_keys]);

  const handleLogout = async () => {
    if (isTeacherPreview) return;
    if (await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' })) {
      try {
        await logout();
      } catch (error) {
        console.error("Logout failed", error);
        window.location.href = '/';
      }
    }
  };

  const checkUrgentHomework = async (grade: string, subjects: string[] = []) => {
    if (!grade) return;
    const todayStr = jstDateKey();
    try {
      const foundHw = (await loadStudentHomework({ start: todayStr, limit: 5 }))[0] || null;
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
    return formatDate(dateStr) || dateStr;
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
          transfer_token: requiredTransfer.options?.find((option: any) => option.id === selectedTransferId)?.transfer_token || '',
          note: '生徒画面の必須振替選択から登録',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new AbsenceRequestError(data, '振替登録に失敗しました。もう一度お試しください。');
      setRequiredTransfer(null);
      setSelectedTransferId('');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : '振替登録に失敗しました。もう一度お試しください。');
    } finally {
      setTransferSubmitting(false);
      // 成功しても失敗しても、最新の振替候補（期限つきの署名・ほかの必須振替）を読み込み直す。
      setRequiredTransferReload(value => value + 1);
    }
  };

  const currentBadgeId = userData?.selected_badge === 'beginner' ? 'badge_1' : userData?.selected_badge;
  const currentBadge = BADGES.find(b => b.id === currentBadgeId);
  const appearance = normalizeStudentAppearance(userData?.settings?.appearance, userData?.owned_cosmetics);
  const theme = STUDENT_THEMES[appearance.theme];
  const cardStyle = STUDENT_CARD_STYLES[appearance.cardStyle];
  const density = STUDENT_DENSITIES[appearance.density];
  const headerStyle = STUDENT_HEADER_STYLES[appearance.headerStyle];

  const showPeriod1 = isTeacherPreview || isClassButtonVisible(now, classButtonSettings.period1_start, classButtonSettings.period1_end, classButtonSettings);
  const showPeriod2 = isTeacherPreview || isClassButtonVisible(now, classButtonSettings.period2_start, classButtonSettings.period2_end, classButtonSettings);
  const nextLesson = timetable && now ? findNextLesson(timetable.lessons, now)?.lesson || null : null;
  const minutesToNext = nextLesson && now ? minutesUntilLesson(nextLesson, now) : Number.POSITIVE_INFINITY;
  // 開始10分前から目立たせる（授業ボタンが出ていても上に出す）。
  const nextLessonSoon = minutesToNext > 0 && minutesToNext <= 10;

  // --- Render ---

  if (!mounted || authLoading || !visibilityLoaded) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner size={32} /></div>;
  }
  if (!user) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner size={32} /></div>;
  }
  if (!userData) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner size={32} /></div>;
  }

  const displayProfile = userData;
  const displayClassDays = registeredClassDays.length > 0
    ? registeredClassDays
    : parseClassDays(displayProfile.day_of_week);
  const displayClassDayLabel = formatClassDays(displayClassDays) || '-';

  return (
    <div className="relative overflow-hidden">
      
      {/* ユーザーIDがあればログ出力 (なければスキップ) */}
      {!isTeacherPreview && displayProfile?.uid && <ActivityLogger uid={displayProfile.uid} onRewardApplied={mergeUserUpdates} />}
      {!isTeacherPreview && <StudentCourseRegistrationPrompt />}

      {popMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-amber-400 text-white px-6 py-3 rounded-full shadow-lg font-bold text-lg z-[150] motion-safe:animate-bounce border-4 border-white whitespace-nowrap">
          ✨ {popMessage}
        </div>
      )}

      <TrophyModal isOpen={isTrophyOpen} onClose={() => setIsTrophyOpen(false)} userData={displayProfile} canUseShop={isStudentFeatureEnabled(visibility, displayProfile, 'shop')} />

      {requiredTransferError && !isTeacherPreview && (
        <div className="fixed inset-0 z-[270] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-labelledby="required-transfer-error-title" className="w-full max-w-md rounded-hero bg-surface p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-btn bg-danger-soft text-danger">
              <AlertTriangle size={28} aria-hidden />
            </div>
            <h2 id="required-transfer-error-title" className="mt-4 text-xl font-bold text-fg">振替情報を確認できません</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              必須の振替選択が残っている可能性があるため、確認が完了するまで操作を停止しています。
            </p>
            <Button
              size="lg"
              fullWidth
              className="mt-5"
              icon={<Repeat size={18} aria-hidden />}
              onClick={() => setRequiredTransferReload(value => value + 1)}
            >
              もう一度確認する
            </Button>
          </div>
        </div>
      )}

      {requiredTransfer && !isTeacherPreview && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="required-transfer-title" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-hero bg-surface p-6 shadow-2xl">
            {(!Array.isArray(requiredTransfer.options) || requiredTransfer.options.length === 0) && (
              <button
                type="button"
                aria-label="振替先選択を閉じる"
                onClick={() => {
                  setRequiredTransfer(null);
                  setSelectedTransferId('');
                }}
                className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-fg-muted hover:bg-slate-200 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={19} aria-hidden />
              </button>
            )}
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent">
                <Repeat size={26} aria-hidden />
              </div>
              <div className="pr-10">
                <p className="text-xs font-bold tracking-wide text-accent">振替が必要です</p>
                <h2 id="required-transfer-title" className="mt-1 text-xl font-bold text-fg">振替先を選択してください</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  {Array.isArray(requiredTransfer.options) && requiredTransfer.options.length > 0
                    ? '保護者から欠席連絡が届いています。振替先を選ぶまで、この画面を閉じることはできません。'
                    : '保護者から欠席連絡が届いています。現在は候補がないため、閉じて後から振替登録できます。'}
                </p>
              </div>
            </div>
            <div className="mb-4 rounded-card bg-canvas p-4 text-sm font-bold text-fg">
              欠席日: {requiredTransfer.selected_absence?.target_date ? formatDate(requiredTransfer.selected_absence.target_date) : '-'}
            </div>
            <div className="space-y-3">
              {Array.isArray(requiredTransfer.options) && requiredTransfer.options.length > 0 ? requiredTransfer.options.map((option: any) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selectedTransferId === option.id}
                  onClick={() => setSelectedTransferId(option.id)}
                  className={`w-full rounded-card border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selectedTransferId === option.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-canvas text-fg hover:border-accent/30'}`}
                >
                  <p className="font-bold">{option.title}</p>
                  <p className="mt-1 text-xs text-fg-muted">{option.unit || '単元名未設定'} / {option.period ? `${option.period}限` : '時限未設定'}</p>
                </button>
              )) : (
                <div className="rounded-card bg-warning-soft p-4 text-sm font-bold text-warning">
                  <p>同じ単元の振替候補がまだありません。校舎へお問い合わせください。</p>
                  <button
                    type="button"
                    onClick={() => {
                      setRequiredTransfer(null);
                      setSelectedTransferId('');
                    }}
                    className="mt-3 min-h-11 w-full rounded-btn border border-warning/40 bg-surface px-4 py-3 text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                  >
                    閉じて後で選択する
                  </button>
                </div>
              )}
            </div>
            <Button
              size="lg"
              fullWidth
              className="mt-5"
              onClick={submitRequiredTransfer}
              loading={transferSubmitting}
              disabled={!selectedTransferId || !requiredTransfer.options?.length}
              icon={<CheckCircle size={18} aria-hidden />}
            >
              この振替先で確定する
            </Button>
          </div>
        </div>
      )}

      <div className={`${theme.heroBg} pt-10 ${density.heroBottom} px-6 ${headerStyle.heroShape} relative overflow-hidden`}>
        <div className={`absolute top-[-50px] right-[-50px] w-40 h-40 ${theme.heroAccent} rounded-full blur-2xl transition-transform ${headerStyle.decoration}`}></div>
        {appearance.showMascot && (
          <div className="absolute bottom-5 right-6 rounded-full" style={studentBadgeFrameStyle(appearance.frame)} aria-hidden="true">
            <div className={`rounded-full px-4 py-2 text-3xl shadow-sm backdrop-blur-sm ${appearance.frame ? 'bg-white/90' : 'bg-white/15'}`}>
              {currentBadge ? currentBadge.icon : '🎓'}
            </div>
          </div>
        )}
        <div className="flex justify-between items-start text-white relative z-10">
          <div>
            <p className="text-sm font-bold opacity-90 mb-1 flex items-center gap-2"><Calendar size={14} aria-hidden /> {dateStr}</p>
            <h1 className="text-2xl font-black tracking-tight leading-tight">{greeting} <br/>
              {appearance.title && (
                <span className="mb-1 mt-1 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-0.5 text-xs font-bold text-accent shadow-sm">👑 {presetTitleText(appearance.title)}</span>
              )}
              {appearance.title && <br/>}
              <span className={`${theme.nameColor} text-3xl`}>{displayProfile.student_name}</span> さん</h1>
            {displayProfile.error_mode ? (
              <div className="mt-3 inline-flex items-center gap-2 bg-danger/80 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold motion-safe:animate-pulse">
                <AlertTriangle size={12} aria-hidden /> プロフィール読み込みエラー (管理者へご連絡ください)
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                <Clock size={12} aria-hidden /> {displayClassDayLabel}曜日の授業 | {displayProfile.classroom || '-'}
              </div>
            )}
          </div>
          {!isTeacherPreview && (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="bg-white/20 p-1 rounded-btn backdrop-blur-sm">
                <button type="button" onClick={handleLogout} aria-label="ログアウト" title="ログアウト" className="grid h-11 w-11 place-items-center rounded-btn text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <LogOut size={20} aria-hidden />
                </button>
              </div>
              <AppSwitcherLink variant="inverse" />
            </div>
          )}
        </div>
      </div>

      <div className={`px-5 -mt-16 relative z-20 ${density.sectionGap}`}>
        <button onClick={() => setIsTrophyOpen(true)} className={`w-full ${cardStyle.panel} ${density.cardPadding} flex justify-between items-center transform hover:scale-[1.02] active:scale-95 transition-all text-left group`}>
          <div className="flex items-center gap-4">
            <div className="rounded-btn" style={studentBadgeFrameStyle(appearance.frame)}>
              <div className={`w-14 h-14 rounded-btn ${theme.badgeBg} flex items-center justify-center text-4xl shadow-inner border ${theme.ring}`}>{currentBadge ? currentBadge.icon : '🎓'}</div>
            </div>
            <div>
              <p className={`text-xs font-bold ${theme.primaryText} transition-colors`}>マイバッジ</p>
              <p className="text-lg font-bold text-fg flex items-center gap-2">{currentBadge ? currentBadge.name : 'バッジ未設定'} {currentBadge && <span className="bg-amber-400 text-amber-900 text-[11px] font-bold px-2 py-0.5 rounded-full">装備中</span>}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-fg-muted font-bold">コイン合計</p>
            <div className="flex items-center gap-1 justify-end text-amber-500 font-black text-xl"><div className="bg-amber-100 p-1 rounded-full"><Trophy size={14} className="fill-amber-500" aria-hidden /></div>{displayProfile.coins || 0}</div>
          </div>
        </button>

        <div className={`${density.sectionGap} animate-in slide-in-from-top-4`}>
          {nextLesson && now && (nextLessonSoon || (!showPeriod1 && !showPeriod2)) && (
            <NextLessonCard lesson={nextLesson} now={now} prominent={nextLessonSoon} />
          )}
          {showPeriod1 && <SmartClassButton profile={displayProfile} period={1} startTime={classButtonSettings.period1_start} endTime={classButtonSettings.period1_end} previewMode={isTeacherPreview} allowBetaTransfer={visibility.transfer !== false} />}
          {showPeriod2 && <SmartClassButton profile={displayProfile} period={2} startTime={classButtonSettings.period2_start} endTime={classButtonSettings.period2_end} previewMode={isTeacherPreview} allowBetaTransfer={visibility.transfer !== false} />}
          {!showPeriod1 && !showPeriod2 && now && !nextLesson && (
            <div className={`${cardStyle.panel} p-4 flex items-center justify-center gap-2 text-fg-muted text-sm font-bold`}>
              <Coffee size={18} aria-hidden />
              <span>現在は授業時間外です</span>
            </div>
          )}
        </div>

        {/* --- 省略（元のリンクやウィジェットはそのままです） --- */}
        <div className="space-y-3">
          {nextClassInfo && !timetable && (
            <div className={`${cardStyle.panel} p-4 flex items-center justify-between`}>
              <div><p className={`text-xs ${theme.primaryText} font-bold flex items-center gap-1 mb-1`}><CalendarCheck size={14} aria-hidden /> 次回の授業予定</p><p className="text-sm font-bold text-fg">{safeDateString(nextClassInfo.date)}</p></div>
              <div>{nextClassInfo.status === 'checking' ? <span className="text-xs text-fg-muted">確認中...</span> : nextClassInfo.status === 'open' ? <span className={`${theme.badgeBg} ${theme.badgeText} text-xs font-bold px-3 py-1.5 rounded-full`}>実施予定</span> : <span className="bg-danger-soft text-danger text-xs font-bold px-3 py-1.5 rounded-full">休講 / お休み</span>}</div>
            </div>
          )}
          {visibility.homework && urgentHomework && (
            <Link href="/student/homework" className="block no-underline rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <div className={`p-4 rounded-card shadow-sm border flex items-center justify-between gap-3 transition-transform active:scale-95 ${urgentHomework.daysLeft <= 1 ? 'bg-danger-soft border-danger/20' : urgentHomework.daysLeft <= 3 ? 'bg-warning-soft border-warning/20' : 'bg-info-soft border-info/20'}`}>
                <div className="min-w-0"><div className={`text-xs font-bold flex items-center gap-1 mb-1 ${urgentHomework.daysLeft <= 1 ? 'text-danger' : urgentHomework.daysLeft <= 3 ? 'text-warning' : 'text-info'}`}>{urgentHomework.daysLeft <= 1 ? <Timer size={14} aria-hidden className="motion-safe:animate-pulse"/> : <ClipboardList size={14} aria-hidden />}{urgentHomework.daysLeft <= 0 ? '期限切れ間近！' : `提出期限まで あと${urgentHomework.daysLeft}日`}</div><p className="text-sm font-bold text-fg line-clamp-1">{urgentHomework.title}</p></div>
                <div className="shrink-0"><span className={`whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full ${urgentHomework.daysLeft <= 1 ? 'bg-danger text-white shadow-md' : urgentHomework.daysLeft <= 3 ? 'bg-warning text-white' : 'bg-surface text-info border border-info/30'}`}>{urgentHomework.daysLeft <= 0 ? '今日まで' : `${formatShortDate(urgentHomework.deadline.replace(/-/g, '/'))}提出`}</span></div>
              </div>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Link href="/student/timetable" className="col-span-2 block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <div className="cb-card p-card transition-transform active:scale-[0.99]">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-accent text-accent-ink shadow-sm"><CalendarDays size={26} aria-hidden /></div>
                  <div className="min-w-0"><h2 className="text-base font-bold text-fg">受講講座・時間割</h2><p className="mt-1 text-xs font-medium text-fg-muted">毎週の授業と、2週間の予定・休講を確認</p></div>
                </div>
                <ChevronRight size={24} aria-hidden className="shrink-0 text-accent transition-transform group-hover:translate-x-1"/>
              </div>
            </div>
          </Link>
          <Link href="/student/test-prep" className="col-span-2 block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <div className="cb-card p-card transition-transform active:scale-[0.99]">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-amber-500 text-white shadow-sm"><BookOpenCheck size={26} aria-hidden /></div>
                  <div className="min-w-0"><h2 className="text-base font-bold text-fg">テスト期間一覧</h2><p className="mt-1 text-xs font-medium text-fg-muted">期間・受付状況・科目・受講日時を確認</p></div>
                </div>
                <ChevronRight size={24} aria-hidden className="shrink-0 text-amber-500 transition-transform group-hover:translate-x-1"/>
              </div>
            </div>
          </Link>
          {/* 復習期間（理社講座）の受付中だけ表示する */}
          <ReviewPeriodEntryCard disabled={isTeacherPreview} className="col-span-2" />
          {onlineSchoolEnabled && <Link href="/student/online-school" className="col-span-2 block group"><div className="rounded-card bg-accent p-5 text-accent-ink shadow-card transition-all active:scale-[0.99] flex items-center justify-between"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-btn bg-white/15"><BookOpen size={26} aria-hidden /></div><div><div className="flex items-center gap-2"><span className="text-lg font-bold">オンライン校</span><span className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-bold text-amber-950">10分学習</span></div><p className="text-xs text-accent-ink/80">算数・数学と国語をLevel別に学習</p></div></div><ChevronRight size={24} aria-hidden className="text-accent-ink/60 group-hover:translate-x-1 transition-transform"/></div></Link>}
          {visibility.adaptiveQuest && <Link href="/student/homework/adaptive" className="col-span-2 block group"><div className={`${theme.questBg} ${density.featurePadding} rounded-card shadow-lg text-white flex items-center justify-between relative overflow-hidden`}><div className="flex items-center gap-4 relative z-10"><div className="w-12 h-12 bg-white/20 rounded-btn flex items-center justify-center"><Brain size={28} aria-hidden /></div><div><div className="flex items-center gap-2 mb-1"><span className="text-lg font-bold">AI学習クエスト</span><span className="bg-amber-400 text-amber-900 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 motion-safe:animate-pulse"><Sparkles size={12} fill="currentColor" aria-hidden /> 新機能</span></div><p className="text-xs opacity-90">キミに最適な問題をAIが出題！</p></div></div><ChevronRight size={24} className="opacity-70 group-hover:translate-x-1 transition-transform"/></div></Link>}
          {visibility.ocrQuiz && <Link href="/student/ocr-quiz" className="col-span-2 block group"><div className="rounded-card bg-slate-900 p-5 text-white shadow-lg transition-all active:scale-[0.99] flex items-center justify-between"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-btn bg-white/15"><FileImage size={26} aria-hidden /></div><div><div className="flex items-center gap-2"><span className="text-lg font-bold">OCR問題作成</span><span className="rounded-full bg-emerald-300 px-2 py-0.5 text-xs font-bold text-emerald-950">私用限定</span></div><p className="text-xs text-white/70">手元の画像から、自分だけの類題を作成</p></div></div><ChevronRight size={24} className="text-white/60 group-hover:translate-x-1 transition-transform"/></div></Link>}
          {visibility.chat && <Link href="/student/chat" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className={`w-12 h-12 ${theme.badgeBg} ${theme.badgeText} rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}><Bot size={24}/></div><h2 className="font-bold text-fg">AIチューター</h2><p className="text-xs text-fg-muted mt-1">24時間 質問OK!</p></div></Link>}
          {visibility.homework && <Link href="/student/homework" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><BookOpen size={24}/></div><h2 className="font-bold text-fg">Monoxer</h2><p className="text-xs text-fg-muted mt-1">宿題に取り組む</p></div></Link>}
          {visibility.recordings && <Link href="/student/recordings" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Video size={24}/></div><h2 className="font-bold text-fg">授業録画</h2><p className="text-xs text-fg-muted mt-1">授業の録画を見る</p></div></Link>}
          {visibility.absence && <Link href="/student/absence" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><AlertTriangle size={24}/></div><h2 className="font-bold text-fg">欠席連絡</h2><p className="text-xs text-fg-muted mt-1">お休み申請</p></div></Link>}
          {visibility.transfer && <Link href="/student/absence?mode=transfer" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-accent-soft text-accent rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Repeat size={24}/></div><h2 className="font-bold text-fg">振替登録</h2><p className="text-xs text-fg-muted mt-1">候補から直接選択</p></div></Link>}
          <Link href="/student/records" className="block group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className={`${cardStyle.feature} ${theme.ring} ${density.featurePadding} transition-all flex flex-col items-center text-center h-full`}><div className="w-12 h-12 bg-accent-soft text-accent rounded-btn flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Trophy size={24} aria-hidden /></div><h2 className="font-bold text-fg">自分の記録</h2><p className="text-xs text-fg-muted mt-1">がんばりをチェック</p></div></Link>
        </div>

        {visibility.news && <NewsWidget role="student" />}
        
        {visibility.calendar && <div className={`${cardStyle.panel} p-2`}>
          <CalendarWidget
            classDay={displayClassDays}
            grade={displayProfile.grade}
            studentShiftIds={registeredShiftIds}
            studentShiftDates={registeredShiftDates}
          />
        </div>}
        
        <Link href="/student/change-request" className={`flex items-center justify-between ${cardStyle.panel} p-4 min-h-14 hover:bg-canvas transition-colors no-underline mb-8`}>
          <div className="flex items-center gap-3"><div className="bg-accent-soft p-2 rounded-input text-accent"><Settings size={18} aria-hidden /></div><span className="text-sm font-bold text-fg">受講講座を登録・変更</span></div><ChevronRight size={20} aria-hidden className="text-fg-muted" />
        </Link>
      </div>
    </div>
  );
}
