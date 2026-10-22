'use client';

import { useEffect, useState } from 'react';
import { 
  Calendar as CalendarIcon, MonitorPlay, MapPin, User, Star,
  ChevronLeft, ChevronRight, LayoutList, Layout, Maximize2, Minimize2,
  Briefcase, Clock, KeyRound, Smartphone,
  Video, Loader2, Zap,
  LogOut, Megaphone
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import NewsWidget from '@/app/components/NewsWidget';
import ShiftMonitorButton from '@/app/components/ShiftMonitorButton';
import NextClassWidget from '@/app/components/NextClassWidget';
import FutureClassesModal from '@/app/components/FutureClassesModal'; // ★カレンダーモーダル
import CalendarWidget from '@/app/components/CalendarWidget';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import { jstDateKey, weekdayFromDateKey } from '@/lib/date-key';
import { formatDate } from '@/lib/format';
import { Button, Card, IconButton, useConfirm, useToast } from '@/app/components/ui';
import { prepareZoomWindow, requestZoomHostStart } from '@/lib/zoom-host-start';
import { isDedicatedProfile } from '@/lib/employment-category';
import { WorkDetailReminderCard, useWorkDetailReminders } from '@/app/teacher/attendance/work-detail-reminder';

// --- 型定義 ---
type ShiftAssignment = {
  id: string;
  user_id?: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_place?: string | null;
  target_meeting_id?: string | null; 
  target_password?: string | null;
  target_signin_address?: string | null;
  unit: string | null;
  note: string;
  parent_id?: string;
  start_url?: string; 
};

type ClassGroup = {
  id: string;
  main: ShiftAssignment | null;
  subs: ShiftAssignment[];
  subject: string | null;
  grade: string | null;
  unit: string | null;
  place: string | null;
  studio: string | null;
  url: string | null;
  start_url: string | null;
  signin_address: string | null;
  meeting_id: string | null;
};

type Props = {
  profile: any;
  allAssignments: any[];
  pendingCount: number; 
  currentDate: string;
  onDateChange: (date: string) => void;
  viewMode: 'day' | 'week';
  onViewModeChange: (mode: 'day' | 'week') => void;
  isExpanded: boolean;
  onExpandChange: (expanded: boolean) => void;
};

const normalizeMeetingId = (value?: string | null) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[^\d]/g, '');

const buildMeetingJoinUrl = (meetingId?: string | null, passcode?: string | null) => {
  const cleanMeetingId = normalizeMeetingId(meetingId);
  if (!cleanMeetingId) return null;
  const url = new URL(`https://zoom.us/j/${cleanMeetingId}`);
  if (passcode) url.searchParams.set('pwd', passcode);
  return url.toString();
};

// YYYY-MM-DD の日付キーに日数を加算する（端末のタイムゾーンに依存しない）
const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return jstDateKey();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const EmptySlot = ({ text }: { text: string }) => (
  <div className="flex h-full min-h-[60px] items-center justify-center rounded-card border border-dashed border-line bg-surface/50">
    <span className="flex items-center gap-1 text-xs font-bold text-fg-muted">
      {text}
    </span>
  </div>
);

// --- クラスカード ---
const TeacherClassCard = ({ info, color, currentUserProfile, isExpanded }: { info: ClassGroup, color: 'emerald' | 'amber', currentUserProfile: any, isExpanded: boolean }) => {
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  
  const currentUserId = currentUserProfile?.id || currentUserProfile?.uid || '';
  const isMyClass = (info.main?.user_id === currentUserId) || info.subs.some(s => s.user_id === currentUserId);

  const loginEmail = info.signin_address?.trim();
  const hasHostPermission = !!loginEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail);
  
  const displayLoginId = loginEmail ? loginEmail.split('@')[0] : '';

  const isEmerald = color === 'emerald';
  const theme = isEmerald ? {
    border: isMyClass ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-emerald-100',
    headerBg: isMyClass ? 'bg-emerald-600' : 'bg-emerald-50',
    headerText: isMyClass ? 'text-white' : 'text-emerald-800',
    badge: isMyClass ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800',
    iconBg: 'bg-emerald-500',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white',
  } : {
    border: isMyClass ? 'border-amber-500 ring-2 ring-amber-100' : 'border-amber-100',
    headerBg: isMyClass ? 'bg-amber-500' : 'bg-amber-50',
    headerText: isMyClass ? 'text-white' : 'text-amber-900',
    badge: isMyClass ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800',
    iconBg: 'bg-amber-500',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white',
  };

  const myName = currentUserProfile?.student_name || currentUserProfile?.name || '講師';
  const confno = normalizeMeetingId(info.meeting_id) || normalizeMeetingId(info.url ? info.url.split('/').pop()?.split('?')[0] : '');

  const launchWebUrl = (url: string, targetWindow?: Window | null) => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.replace(url);
      return;
    }

    // API待機後の window.open は、Safariやポップアップ制限中の
    // ブラウザでは null になる。その場合もホスト開始URLを失わないよう、
    // 現在のタブで確実に開く。
    const openedWindow = window.open(url, '_blank');
    if (!openedWindow) window.location.assign(url);
  };
  const handleEnterZoom = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confno) {
      toast.error("ミーティングIDが設定されていません。");
      return;
    }

    if (hasHostPermission) {
      // 担当外の授業（代行・引き継ぎ）は、誤操作防止のため確認してから開始する
      if (!isMyClass) {
        const ownerName = info.main?.teacher_name ? `${info.main.teacher_name}講師` : '他の講師';
        const classLabel = [info.grade, info.place, info.unit].filter(Boolean).join(' / ');
        const ok = await confirm({
          title: '代行としてホスト開始しますか？',
          message: `${ownerName}の授業${classLabel ? `（${classLabel}）` : ''}です。開始した講師と授業は記録されます。`,
          confirmLabel: 'ホスト開始',
        });
        if (!ok) return;
      }
      const popup = prepareZoomWindow();
      setLoading(true);
      try {
        if (!user) throw new Error('not-authenticated');
        const token = await user.getIdToken();
        const result = await requestZoomHostStart({ token, email: loginEmail || '', meetingId: confno, shiftId: info.main?.id || info.id, name: myName });

        if (result.ok) {
          launchWebUrl(result.url, popup);
        } else {
          if (popup && !popup.closed) popup.close();
          console.error("API Error:", result);
          const joinNormally = await confirm({
            title: 'ホスト権限の取得に失敗しました',
            message: <span className="whitespace-pre-line">{`理由: ${result.error}${result.detail ? `\n詳細: ${result.detail}` : ''}\n通常参加で開きますか？`}</span>,
            confirmLabel: '通常参加で開く',
          });
          if (joinNormally) {
             launchWebUrl(info.url || `https://zoom.us/j/${confno}`);
          }
        }
      } catch (err) {
        if (popup && !popup.closed) popup.close();
        console.error(err);
        toast.error('通信エラーが発生しました。');
      } finally {
        setLoading(false);
      }
    } else {
      let targetUrl = info.url || `zoommtg://zoom.us/join?confno=${confno}`;
      if (info.url) {
        try {
          const urlObj = new URL(info.url);
          const pwd = urlObj.searchParams.get('pwd');
          targetUrl = `https://zoom.us/j/${confno}?pwd=${pwd || ''}&uname=${encodeURIComponent(myName)}`;
        } catch (e) {}
      }
      launchWebUrl(targetUrl);
    }
  };

  const widthClass = isExpanded ? 'w-full' : 'w-[168px] shrink-0';
  let buttonLabel = hasHostPermission ? (isMyClass ? 'ホスト開始' : 'ホスト開始（代行）') : '入室';
  if (loading) buttonLabel = '準備中...';

  return (
    <div className={`${widthClass} flex flex-col overflow-hidden rounded-card border bg-surface shadow-sm transition-shadow ${theme.border} ${isMyClass ? 'z-10 shadow-md' : 'hover:shadow-md'}`}>
      <div className={`${theme.headerBg} relative px-2.5 py-2`}>
        <div className="mb-1 flex items-start justify-between gap-1">
          <span className={`max-w-[85%] truncate whitespace-nowrap rounded-input px-1.5 py-0.5 text-xs font-bold ${theme.badge}`}>
            {info.grade}/{info.place}
          </span>
          {info.studio && (
            <div className="flex max-w-[72px] items-center gap-0.5 truncate whitespace-nowrap rounded bg-black/20 px-1.5 py-0.5 text-xs font-bold text-white/90" title={info.studio}>
              <MapPin size={12} className="shrink-0" aria-hidden /> {info.studio}
            </div>
          )}
        </div>
        <div className={`line-clamp-1 text-xs font-bold leading-tight ${theme.headerText}`}>
          {info.unit || <span className="font-normal opacity-60">未設定</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 bg-surface p-2">
        <div className="flex flex-col gap-1">
           <div className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${theme.iconBg}`}>
                <User size={12} aria-hidden />
              </div>
              <div className={`truncate text-xs font-bold ${isMyClass ? 'text-fg' : 'text-fg-muted'}`}>
                {info.main?.teacher_name || '未定'}
              </div>
           </div>
           {displayLoginId ? (
              <button 
                type="button"
                onClick={handleEnterZoom}
                disabled={loading}
                className={`group flex min-h-8 w-full cursor-pointer items-center justify-between gap-1 rounded-input border px-1.5 font-mono text-xs transition-colors ${
                  hasHostPermission 
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' 
                    : 'border-line bg-canvas text-fg-muted hover:bg-slate-100'
                }`}
                title={`ログインID: ${loginEmail}`}
              >
                <div className="flex min-w-0 items-center gap-1">
                  <KeyRound size={12} className="shrink-0 opacity-70" aria-hidden />
                  <span className="truncate">{displayLoginId}</span>
                </div>
                {loading ? <Loader2 size={12} className="shrink-0 motion-safe:animate-spin" aria-hidden /> : <Zap size={12} className={`shrink-0 ${hasHostPermission ? "text-rose-500" : "text-slate-400"}`} aria-hidden />}
              </button>
            ) : (
              <div className="flex min-h-8 items-center border border-transparent pl-1 text-xs text-slate-400">ID未登録</div> 
            )}
        </div>
        <div className="border-t border-line pt-1.5">
          <div className="space-y-0.5">
            {info.subs.length > 0 ? info.subs.map((s) => {
              const isMe = s.user_id === currentUserId;
              return (
                <div key={s.id} className={`flex items-center gap-1 rounded p-0.5 text-xs ${isMe ? 'border border-accent/20 bg-accent-soft font-bold text-accent' : 'text-fg-muted'}`}>
                  <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${isMe ? 'bg-accent' : 'bg-slate-300'}`}></div> 
                  <span className="truncate">{s.teacher_name}</span>
                </div>
              );
            }) : (
              <div className="pl-1 text-xs text-slate-400">-</div>
            )}
          </div>
        </div>
        <div className="mt-auto pt-0.5">
          {confno ? (
            <button 
              type="button" 
              onClick={handleEnterZoom}
              disabled={loading}
              className={`flex min-h-10 w-full items-center justify-center gap-1 rounded-btn px-2 text-xs font-bold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-70 ${theme.btn}`}
            >
              {loading ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden /> : hasHostPermission ? <Zap size={14} aria-hidden /> : <Video size={14} aria-hidden />}
              {buttonLabel}
            </button>
          ) : (
            <div className="flex min-h-10 w-full cursor-not-allowed items-center justify-center gap-1 rounded-btn border border-line bg-slate-100 text-xs font-bold text-slate-400" aria-label="ミーティングID未設定">
              <Video size={14} aria-hidden /> -
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- シフト表示エリア ---
const DailyShiftViewer = ({ assignments, currentUserProfile, isExpanded, date }: { assignments: ShiftAssignment[], currentUserProfile: any, isExpanded: boolean, date: string }) => {
  const getAllClasses = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => a.note?.includes(`【${time}】`) && a.target_subject === subject && a.target_date === date);
    if (slotAssignments.length === 0) return [];
    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');
    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub => 
        sub.parent_id === main.id || 
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );
      return { 
        id: main.id, main, subs: relatedSubs, subject: main.target_subject, 
        grade: main.target_grade, unit: main.unit, place: main.target_detail_subject, 
        studio: main.target_place || null, url: buildMeetingJoinUrl(main.target_meeting_id, main.target_password),
        signin_address: main.target_signin_address || null, meeting_id: main.target_meeting_id || null, start_url: main.start_url || null
      };
    });
    return classes.sort((a, b) => (a.grade || '').localeCompare(b.grade || ''));
  };
  const getGeneralSupport = (time: string) => assignments.filter(a => a.role_type === 'general' && a.note?.includes(`【${time}】`) && a.target_date === date);
  const containerClass = 'cb-card flex flex-col overflow-hidden';
  const listLayoutClass = isExpanded ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3' : 'flex gap-3 min-w-max'; 
  const scrollAreaClass = isExpanded ? 'p-4 bg-canvas/50 flex-1 overflow-y-auto custom-scrollbar' : 'overflow-x-auto p-3 bg-canvas/50 custom-scrollbar';

  return (
    <div className="h-full space-y-4">
      {['1限', '2限'].map(period => (
        <div key={period} className={containerClass}>
          <div className={`flex shrink-0 items-center justify-between px-3 py-2 ${period === '1限' ? 'bg-slate-800 text-white' : 'bg-slate-700 text-slate-100'}`}>
            <div className="flex items-center gap-2 text-sm font-bold"><Clock size={14} className={period === '1限' ? 'text-sky-400' : 'text-indigo-300'} aria-hidden />{period}</div>
            <div className="flex gap-2 text-xs font-bold"><span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-100">理 {getAllClasses(period, '理科').length}</span><span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-100">社 {getAllClasses(period, '社会').length}</span></div>
          </div>
          <div className={scrollAreaClass}>
            <div className={`flex ${isExpanded ? 'flex-col gap-4' : 'flex-row items-start gap-4'}`}>
              <div className={`flex flex-col gap-2 ${isExpanded ? 'w-full' : 'min-w-[168px] shrink-0'}`}>
                {isExpanded && <div className="mb-1 flex items-center gap-1 border-b border-emerald-100 pb-1 text-xs font-bold text-emerald-700"><MonitorPlay size={12} aria-hidden /> 理科グループ</div>}
                {getAllClasses(period, '理科').length > 0 ? (
                  <div className={listLayoutClass}>{getAllClasses(period, '理科').map(info => (<TeacherClassCard key={info.id} info={info} color="emerald" currentUserProfile={currentUserProfile} isExpanded={isExpanded} />))}</div>
                ) : (<EmptySlot text="理科なし" />)}
              </div>
              {!isExpanded && <div className="my-1 w-px shrink-0 self-stretch bg-line"></div>}
              {isExpanded && <div className="my-1 h-px w-full bg-line"></div>}
              <div className={`flex flex-col gap-2 ${isExpanded ? 'w-full' : 'min-w-[168px] shrink-0'}`}>
                {isExpanded && <div className="mb-1 flex items-center gap-1 border-b border-amber-100 pb-1 text-xs font-bold text-amber-700"><MapPin size={12} aria-hidden /> 社会グループ</div>}
                {getAllClasses(period, '社会').length > 0 ? (
                  <div className={listLayoutClass}>{getAllClasses(period, '社会').map(info => (<TeacherClassCard key={info.id} info={info} color="amber" currentUserProfile={currentUserProfile} isExpanded={isExpanded} />))}</div>
                ) : (<EmptySlot text="社会なし" />)}
              </div>
              {getGeneralSupport(period).length > 0 && (
                <>
                  {!isExpanded && <div className="my-1 w-px shrink-0 self-stretch bg-line"></div>}
                  {isExpanded && <div className="my-1 h-px w-full bg-line"></div>}
                  <div className={`flex flex-col gap-1 ${isExpanded ? 'w-full' : 'ml-1 shrink-0'}`}>
                    <div className={`rounded-card border border-line bg-slate-100 p-2 ${isExpanded ? 'w-full' : 'h-full w-[132px]'}`}>
                      <div className="mb-2 flex shrink-0 items-center gap-1 text-xs font-bold text-fg-muted"><User size={12} aria-hidden /> サポート</div>
                      <div className={`gap-2 ${isExpanded ? 'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6' : 'custom-scrollbar flex max-h-[140px] flex-col overflow-y-auto'}`}>
                        {getGeneralSupport(period).map(a => (<div key={a.id} className={`flex items-center gap-2 rounded-input border border-line p-1.5 text-xs font-bold shadow-sm ${a.user_id===currentUserProfile?.id ? 'bg-slate-800 text-white' : 'bg-surface text-fg'}`}><User size={12} className="shrink-0" aria-hidden /><span className="truncate">{a.teacher_name}</span></div>))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const segmentClass = (active: boolean, dark = false) =>
  `flex min-h-9 items-center gap-1 rounded-btn px-3 text-xs font-bold transition-colors ${
    dark
      ? active ? 'bg-slate-200 text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'
      : active ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted hover:text-fg'
  }`;

// --- メインコンポーネント ---
export default function TeacherDashboard({ profile, allAssignments, pendingCount, currentDate, onDateChange, viewMode, onViewModeChange, isExpanded, onExpandChange }: Props) {
  const { logout, user: authUser } = useAuth();
  const confirm = useConfirm();
  const { visibility } = usePortalVisibility('teacher');
  // 専任は勤務詳細の入力がない（時間外申請で管理）ため、準専任のときだけ未入力を知らせる。
  const showDetailReminder = visibility.attendance !== false && Boolean(profile) && !isDedicatedProfile(profile);
  const detailReminders = useWorkDetailReminders(authUser?.uid, showDetailReminder);
  const dayOfWeek = weekdayFromDateKey(currentDate);
  const teacherName = profile?.student_name || profile?.name || '講師';
  
  // カレンダーモーダル用ステート
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  const handleLogout = async () => {
    const ok = await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' });
    if (ok) await logout();
  };
  const handleDateChange = (direction: number) => { const increment = viewMode === 'week' ? 7 : 1; onDateChange(addDaysToDateKey(currentDate, direction * increment)); };
  const targetDates = [currentDate];
  if (viewMode === 'week') { for (let i = 1; i < 7; i++) { targetDates.push(addDaysToDateKey(currentDate, i)); } }
  const containerClasses = isExpanded ? 'fixed inset-0 z-overlay bg-slate-100 flex flex-col h-[100dvh] overflow-hidden' : 'text-fg pb-24';
  const contentClasses = isExpanded ? 'flex-1 overflow-hidden p-2 lg:p-6' : 'max-w-7xl mx-auto px-4 py-5 sm:px-6 space-y-6';

  return (
    <div className={containerClasses}>
      {!isExpanded && (
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b border-line bg-surface/90 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-2"><div className="rounded-btn bg-slate-900 p-2 text-white shadow-sm"><Briefcase size={20} aria-hidden /></div><span className="hidden text-lg font-bold tracking-tight text-fg md:inline">講師ポータル</span></div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/teacher/student-preview" className="hidden min-h-10 items-center gap-2 rounded-full bg-emerald-50 px-3 text-xs font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 sm:flex" title="生徒画面プレビュー">
                <Smartphone size={16} aria-hidden /> 生徒画面
              </Link>
              {visibility.attendance !== false && (
                <Link href="/teacher/attendance" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent transition-colors hover:bg-accent-soft/70" title="勤怠打刻" aria-label="勤怠打刻">
                  <Clock size={20} aria-hidden />
                </Link>
              )}

              <div className="hidden items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5 sm:flex">
                <div className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse"></div>
                <span className="text-xs font-bold text-fg-muted">{teacherName}</span>
              </div>
              <IconButton label="ログアウト" onClick={handleLogout} className="rounded-full hover:!bg-rose-50 hover:!text-rose-600"><LogOut size={20} aria-hidden /></IconButton>
            </div>
          </div>
        </header>
      )}
      
      {/* 拡大モード用ヘッダー */}
      {isExpanded && (
        <div className="z-20 flex shrink-0 items-center justify-between bg-slate-900 p-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-white shadow-md">
          <div className="flex items-center gap-3">
             <button type="button" onClick={() => onExpandChange(false)} className="flex min-h-10 items-center gap-2 rounded-btn bg-white/10 px-3 text-white/80 transition-colors hover:bg-white/20" aria-label="戻る"><Minimize2 size={16} aria-hidden /> <span className="hidden text-xs font-bold sm:inline">戻る</span></button>
             <div className="flex rounded-btn border border-slate-700 bg-slate-800 p-0.5">
                 <button type="button" onClick={() => onViewModeChange('day')} className={segmentClass(viewMode === 'day', true)} aria-pressed={viewMode === 'day'}><Layout size={12} aria-hidden /> 1日</button>
                 <button type="button" onClick={() => onViewModeChange('week')} className={segmentClass(viewMode === 'week', true)} aria-pressed={viewMode === 'week'}><LayoutList size={12} aria-hidden /> 週間</button>
             </div>
          </div>
          <div className="flex items-center gap-1 rounded-btn border border-white/10 bg-white/10 p-1">
             <button type="button" onClick={() => handleDateChange(-1)} aria-label="前へ" className="inline-flex h-9 w-9 items-center justify-center rounded-btn text-white/70 transition hover:bg-white/20 hover:text-white"><ChevronLeft size={16} aria-hidden /></button>
             
             <button 
               type="button"
               onClick={() => setIsCalendarModalOpen(true)}
               className="min-h-9 px-2 text-xs font-bold transition-colors hover:text-indigo-300"
             >
               {formatDate(currentDate, { withWeekday: viewMode !== 'week' })}{viewMode === 'week' ? ' ～' : ''}
             </button>

             <button type="button" onClick={() => handleDateChange(1)} aria-label="次へ" className="inline-flex h-9 w-9 items-center justify-center rounded-btn text-white/70 transition hover:bg-white/20 hover:text-white"><ChevronRight size={16} aria-hidden /></button>
          </div>
        </div>
      )}

      <div className={contentClasses}>
        
        {/* ホーム上部: 挨拶と日付操作 */}
        {!isExpanded && (
          <div className="flex justify-end">
            <AppSwitcherLink />
          </div>
        )}
        {!isExpanded && (
          <Card className="flex flex-col items-center justify-between gap-4 lg:flex-row">
            <div className="w-full text-center md:w-auto md:text-left">
               <p className="mb-1 text-xs font-bold text-accent">講師ポータル</p>
               <h2 className="text-xl font-black text-fg">
                 こんにちは、<span className="text-accent">{teacherName}</span>さん
               </h2>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-2">
              <Link href="/teacher/student-preview" className="flex min-h-11 items-center justify-center gap-2 rounded-btn border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 md:col-span-2">
                <Smartphone size={18} aria-hidden /> 生徒画面をテスト
              </Link>
              {visibility.attendance !== false && <Link href="/teacher/attendance" className="flex min-h-11 items-center justify-center gap-2 rounded-btn bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800">
                <Clock size={18} aria-hidden /> 打刻する
              </Link>}
              {visibility.substitutions !== false && <Link href="/teacher/substitutions" className="flex min-h-11 items-center justify-center gap-2 rounded-btn border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100">
                <Megaphone size={18} aria-hidden /> 代行掲示板
              </Link>}
            </div>

            <div className="flex w-full items-center justify-between rounded-card border border-line bg-canvas p-1.5 md:w-auto md:justify-start">
               <IconButton label="前の日へ" onClick={() => handleDateChange(-1)} className="hover:!bg-surface"><ChevronLeft size={20} aria-hidden /></IconButton>
               
               <button 
                 type="button"
                 className="min-w-[140px] rounded-btn px-6 py-1 text-center transition-colors hover:bg-surface"
                 onClick={() => setIsCalendarModalOpen(true)}
               >
                 <span className="mb-0.5 block text-xs font-bold text-fg-muted">表示日</span>
                 <span className="flex items-center justify-center gap-1 text-lg font-bold text-fg">
                   {currentDate} <span className="text-sm font-normal text-fg-muted">({dayOfWeek})</span>
                 </span>
               </button>

               <IconButton label="次の日へ" onClick={() => handleDateChange(1)} className="hover:!bg-surface"><ChevronRight size={20} aria-hidden /></IconButton>
            </div>
          </Card>
        )}
        
        {!isExpanded && showDetailReminder && (
          <WorkDetailReminderCard records={detailReminders.records} error={detailReminders.error} onRetry={detailReminders.reload} className="mb-6" />
        )}
        {!isExpanded && visibility.shifts !== false && <NextClassWidget profile={profile} />}
        {!isExpanded && visibility.news !== false && <NewsWidget role="teacher" />}
        {!isExpanded && visibility.calendar !== false && (
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <CalendarIcon className="text-accent" size={18} aria-hidden />
              <h3 className="text-sm font-bold text-fg">年間予定カレンダー</h3>
            </div>
            <CalendarWidget role="teacher" profile={profile} />
          </Card>
        )}

        {visibility.shifts !== false ? <div className={`space-y-4 ${isExpanded ? 'flex h-full flex-col' : ''}`}>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-3">
              <button 
                type="button"
                onClick={() => setIsCalendarModalOpen(true)}
                className={`group flex items-center gap-2 font-bold text-fg transition-colors hover:text-accent ${isExpanded ? 'hidden' : 'text-lg'}`}
              >
                <div className="rounded-btn bg-accent-soft p-1.5 transition-colors">
                  <CalendarIcon className="text-accent" size={20} aria-hidden />
                </div>
                講師配置
              </button>
              
              <ShiftMonitorButton assignments={allAssignments} currentDate={currentDate} />

              {!isExpanded && (
                <div className="flex rounded-btn bg-slate-200 p-1">
                   <button type="button" onClick={() => onViewModeChange('day')} className={segmentClass(viewMode === 'day')} aria-pressed={viewMode === 'day'}><Layout size={12} aria-hidden /> 1日</button>
                   <button type="button" onClick={() => onViewModeChange('week')} className={segmentClass(viewMode === 'week')} aria-pressed={viewMode === 'week'}><LayoutList size={12} aria-hidden /> 週間</button>
                </div>
              )}
            </div>
            {!isExpanded && <Button variant="secondary" size="sm" onClick={() => onExpandChange(true)} icon={<Maximize2 size={14} aria-hidden />}>拡大</Button>}
          </div>
          <div className={`${isExpanded ? 'custom-scrollbar flex-1 space-y-4 overflow-y-auto pb-32 pr-1' : 'space-y-6'}`}>
            {targetDates.map((date, idx) => {
              // 日付キーはUTC基準で解釈し、端末のタイムゾーンで曜日・日付がずれないようにする
              const d = new Date(`${date}T00:00:00Z`);
              const dayStr = weekdayFromDateKey(date);
              const isToday = date === jstDateKey();
              return (
                <div key={date} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500" style={{animationDelay: `${idx * 30}ms`}}>
                  {(viewMode === 'week' || isExpanded) && (
                    <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-slate-100 py-1 pl-1 shadow-sm">
                      <div className={`text-sm font-bold ${isToday ? 'text-accent' : 'text-fg-muted'}`}>{d.getUTCMonth()+1}/{d.getUTCDate()}</div>
                      <div className={`rounded px-1.5 py-0.5 text-xs font-bold ${isToday ? 'bg-accent text-accent-ink' : 'bg-slate-200 text-fg-muted'}`}>{dayStr}</div>
                      {isToday && <span className="text-xs font-bold text-accent">今日</span>}
                    </div>
                  )}
                  <DailyShiftViewer assignments={allAssignments} currentUserProfile={profile} isExpanded={isExpanded} date={date} />
                </div>
              );
            })}
            {allAssignments.length === 0 && (<div className="rounded-card border border-dashed border-line bg-surface py-10 text-center"><p className="text-sm font-bold text-fg-muted">シフトデータがありません</p></div>)}
          </div>
        </div> : (
          <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm font-bold text-fg-muted">
            講師配置表示は現在OFFです
          </div>
        )}
      </div>

      <FutureClassesModal 
        isOpen={isCalendarModalOpen} 
        onClose={() => setIsCalendarModalOpen(false)} 
        profile={profile} 
      />
    </div>
  );
}
