'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  Bell, Home, Calendar, Briefcase, Megaphone, CheckSquare,
  ClipboardList, FileText, Video, MessageCircle, ShoppingBag, 
  Activity, Database, Settings, Menu, LogOut,
  GraduationCap, ListChecks, BookOpen, AlertTriangle, BarChart2, Languages,
  ShieldCheck, Clock, DollarSign, BookOpenCheck
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { db } from '@/lib/firebase';
import {
  adminAppForPath,
  hasAdminAppPermission,
  isMasterOnlyAdminPath,
  isConfigurableAdminRole,
  isSchoolAdminAllowedPath,
  type AdminAppId,
} from '@/lib/admin-app-permissions';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';

// メニュー項目の定義
const MENU_ITEMS = [
  {
    category: 'ホーム',
    items: [
      { key: 'dashboard', title: '管理アプリ選択', icon: Home, href: '/master' },
      { key: 'attendanceApprovalReturn', title: '勤怠承認へ戻る', icon: CheckSquare, href: '/teacher/attendance-approvals' },
      { key: 'scienceSocialHome', title: '理社講座 ダッシュボード', icon: GraduationCap, href: '/master/science-social' },
      { key: 'eiken', title: '英検 Booster管理', icon: Languages, href: '/master/eiken' },
      { key: 'notifications', title: '自分への通知', icon: Bell, href: '/master/notifications' },
      { key: 'manual', title: '操作マニュアル', icon: BookOpen, href: '/manual' },
    ],
  },
  {
    category: 'アカウント・生徒',
    items: [
      { key: 'accountManagement', title: '全体アカウント管理', icon: ShieldCheck, href: '/master/accounts' },
      { key: 'schoolStudents', title: '校舎別 生徒管理', icon: GraduationCap, href: '/master/school-students' },
    ],
  },
  {
    category: '授業・シフト',
    items: [
      { key: 'shifts', title: 'シフト配置・提出確認', icon: Calendar, href: '/master/shifts' },
      { key: 'monthlySchedules', title: '月間予定', icon: Calendar, href: '/master/monthly-schedules' },
      { key: 'substitutions', title: '代行依頼管理', icon: Megaphone, href: '/master/substitutions' },
      { key: 'registrationTasks', title: '登録依頼作成', icon: ClipboardList, href: '/master/registration-tasks' },
      { key: 'courseAllocation', title: '講座割当管理', icon: BookOpen, href: '/master/course-allocation' },
      { key: 'curriculum', title: 'カリキュラム管理', icon: BookOpen, href: '/master/curriculum' },
      { key: 'testPrepCourses', title: '対策講座・単元設定', icon: BookOpenCheck, href: '/master/test-prep-courses' },
      { key: 'reviewPeriods', title: '復習期間・単元設定', icon: Calendar, href: '/master/review-periods' },
    ],
  },
  {
    category: '勤怠・承認',
    items: [
      { key: 'detailApprovals', title: '勤務実績を承認', icon: CheckSquare, href: '/master/attendance-approvals' },
      { key: 'attendance', title: '勤怠一覧・集計', icon: Briefcase, href: '/master/attendance' },
      { key: 'attendancePayroll', title: '給与計算・勤怠出力', icon: DollarSign, href: '/master/attendance/payroll' },
      { key: 'attendanceDiagnostics', title: '勤怠ミス候補', icon: AlertTriangle, href: '/master/attendance/diagnostics' },
      { key: 'dedicatedClaims', title: '専任の各種申請', icon: Clock, href: '/master/attendance/dedicated-claims' },
      { key: 'employeeLessons', title: '専任の授業実績', icon: BookOpen, href: '/master/attendance/employee-lessons' },
      { key: 'attendanceInsights', title: '勤務実態分析', icon: BarChart2, href: '/master/attendance/insights' },
    ],
  },
  {
    category: '学習状況・教材',
    items: [
      { key: 'onlineSchool', title: 'オンライン校 管理', icon: GraduationCap, href: '/master/online-school' },
      { key: 'pf', title: 'PF 学習状況', icon: FileText, href: '/master/pf' },
      { key: 'recordings', title: '授業アーカイブ', icon: Video, href: '/master/recordings' },
      { key: 'slides', title: '授業スライド', icon: BookOpen, href: '/master/slides' },
    ],
  },
  {
    category: '連絡・申請',
    items: [
      { key: 'announcements', title: '生徒・保護者へお知らせ', icon: Megaphone, href: '/master/announcements' },
      { key: 'parentInquiries', title: '保護者との個別連絡', icon: MessageCircle, href: '/master/parent-inquiries' },
      { key: 'requests', title: '生徒・保護者からの申請', icon: CheckSquare, href: '/master/requests' },
      { key: 'community', title: '交流掲示板管理', icon: MessageCircle, href: '/master/community' },
      { key: 'rewards', title: '景品・コイン管理', icon: ShoppingBag, href: '/master/rewards' },
      { key: 'line', title: 'LINE・通知連携', icon: Bell, href: '/master/line' },
    ],
  },
  {
    category: '設定・データ',
    items: [
      { key: 'stats', title: '統計・分析', icon: Activity, href: '/master/stats' },
      { key: 'surveySettings', title: 'アンケート設定', icon: ListChecks, href: '/master/survey-settings' },
      { key: 'imports', title: 'CSV一括登録', icon: Database, href: '/master/imports' },
      { key: 'settings', title: '設定', icon: Settings, href: '/master/settings' },
    ],
  },
];

const itemApp = (key: string): AdminAppId | 'global' => {
  if (['dashboard', 'attendanceApprovalReturn', 'accountManagement', 'notifications', 'manual'].includes(key)) return 'global';
  if (key === 'eiken') return 'eiken';
  if (['detailApprovals', 'attendance', 'attendancePayroll', 'dedicatedClaims', 'employeeLessons', 'attendanceDiagnostics', 'attendanceInsights'].includes(key)) return 'attendance';
  return 'science_social';
};

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentHash, setCurrentHash] = useState('');
  const [liveProfile, setLiveProfile] = useState<Record<string, any> | null>(null);
  const pathname = usePathname();
  const { user, profile, loading, logout } = useAuth();
  const { visibility: adminVisibility } = usePortalVisibility('admin');

  const effectiveProfile = useMemo(() => liveProfile && profile
    ? { ...profile, ...liveProfile, role: profile.role }
    : profile, [liveProfile, profile]);
  const isMaster = effectiveProfile?.role === 'master';
  const isSchoolAdmin = isConfigurableAdminRole(effectiveProfile?.role) && !isMaster;
  const isAttendanceAdmin = effectiveProfile?.role === 'attendance_admin';
  const isDedicatedAttendanceApprover = Boolean(effectiveProfile && isDedicatedAttendanceApproverProfile(effectiveProfile));
  const isMasterOnlyPath = isMasterOnlyAdminPath(pathname);
  const currentAdminApp = adminAppForPath(pathname);
  const isShiftPath = pathname === '/master/shifts' || pathname.startsWith('/master/shifts/');
  const canUseShifts = Boolean(effectiveProfile && (
    hasAdminAppPermission(effectiveProfile.role, effectiveProfile, 'science_social') ||
    isDedicatedAttendanceApprover
  ));
  const currentPathAllowed = Boolean(
    effectiveProfile &&
    (
      pathname === '/master' ||
      (isSchoolAdmin && isSchoolAdminAllowedPath(pathname)) ||
      (isMasterOnlyPath && isMaster) ||
      (isShiftPath && canUseShifts) ||
      (currentAdminApp && hasAdminAppPermission(effectiveProfile.role, effectiveProfile, currentAdminApp))
    )
  ) && (!isSchoolAdmin || isSchoolAdminAllowedPath(pathname));
  const schoolIds = Array.isArray(effectiveProfile?.school_ids) ? effectiveProfile.school_ids.filter(Boolean) : [];
  const currentSchoolLabel = isAttendanceAdmin ? '勤怠アプリ' : isMaster ? 'マスター管理者' : isDedicatedAttendanceApprover ? '専任・勤怠承認者' : attendanceSchoolName(schoolIds[0] || effectiveProfile?.school_id || effectiveProfile?.school) || '校舎未設定';
  const visibleMenuItems = MENU_ITEMS.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (isSchoolAdmin) return ['scienceSocialHome', 'schoolStudents', 'shifts', 'monthlySchedules', 'manual'].includes(item.key);
      const app = itemApp(item.key);
      if (isMasterOnlyAdminPath(item.href) && !isMaster) return false;
      if (item.key === 'attendanceApprovalReturn') return isDedicatedAttendanceApprover;
      if (item.key === 'shifts') {
        if (!canUseShifts) return false;
        return currentAdminApp === 'science_social' || currentAdminApp === 'attendance';
      }
      if (app === 'global') return currentAdminApp === null || ['dashboard', 'notifications', 'manual', 'attendanceApprovalReturn'].includes(item.key);
      if (currentAdminApp !== app) return false;
      if (!effectiveProfile || !hasAdminAppPermission(effectiveProfile.role, effectiveProfile, app)) return false;
      return isMaster || adminVisibility[item.key] !== false;
    }),
  })).filter(section => section.items.length > 0);
  const activeMenuHref = [...visibleMenuItems.flatMap(section => section.items)]
    .filter(item => {
      const [itemPathWithQuery, itemHash = ''] = item.href.split('#');
      const itemPath = itemPathWithQuery.split('?')[0];
      if (itemHash) return pathname === itemPath && currentHash === `#${itemHash}`;
      return pathname === itemPath || (itemPath !== '/master' && pathname.startsWith(`${itemPath}/`));
    })
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  useEffect(() => {
    const desktopViewport = window.matchMedia('(min-width: 1024px)');
    const syncSidebarForViewport = (matches: boolean) => setIsSidebarOpen(matches);

    syncSidebarForViewport(desktopViewport.matches);
    const handleViewportChange = (event: MediaQueryListEvent) => syncSidebarForViewport(event.matches);
    desktopViewport.addEventListener('change', handleViewportChange);
    return () => desktopViewport.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    if (!user) {
      setLiveProfile(null);
      return;
    }
    return onSnapshot(doc(db, 'users', user.uid), snapshot => {
      if (snapshot.exists()) setLiveProfile(snapshot.data());
    }, error => {
      console.warn('Admin permission listener failed:', error);
    });
  }, [user]);

  useEffect(() => {
    if (loading || !effectiveProfile || currentPathAllowed) return;
    window.location.replace('/master');
  }, [currentPathAllowed, effectiveProfile, loading]);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash || '');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [pathname]);

  // ログアウト処理
  const handleLogout = async () => {
    if (confirm('管理画面からログアウトしますか？')) {
      try {
        await logout();
      } catch (error) {
        console.error('Logout error:', error);
        alert('ログアウトに失敗しました。');
      }
    }
  };

  if (loading || !effectiveProfile || !currentPathAllowed) {
    return <div className="min-h-dvh bg-[#F0F3FF]" aria-busy="true" />;
  }

  return (
    <div className="flex h-dvh w-full bg-[#F0F3FF] font-sans overflow-hidden">
      
      {/* サイドバー */}
      <aside 
        className={`bg-slate-900 text-slate-300 flex-shrink-0 transition-all duration-300 ease-in-out flex flex-col z-50 h-full
          ${isSidebarOpen ? 'w-64' : 'w-16 sm:w-20'}
        `}
      >
        {/* ロゴエリア */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm">
          {isSidebarOpen ? (
            <Link href="/master" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-indigo-900/50">
                <GraduationCap size={20} strokeWidth={2.5} />
              </div>
              <span className="text-lg font-black text-white tracking-tight">創造学園 管理</span>
            </Link>
          ) : (
            <Link href="/master" className="mx-auto bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-indigo-900/50 hover:bg-indigo-500 transition-colors">
              <GraduationCap size={20} strokeWidth={2.5} />
            </Link>
          )}
          
          {/* 開閉ボタン */}
          {isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(false)}
              aria-label="管理メニューを閉じる"
              aria-expanded={isSidebarOpen}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Menu size={18} />
            </button>
          )}
        </div>

        {/* 閉じた状態での開くボタン */}
        {!isSidebarOpen && (
          <button type="button" aria-label="管理メニューを開く" aria-expanded={isSidebarOpen} className="h-10 w-full flex items-center justify-center border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors" onClick={() => setIsSidebarOpen(true)}>
             <Menu size={16} className="text-slate-500"/>
          </button>
        )}

        {/* メニューリスト */}
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          <nav className="space-y-6 px-3">
            {visibleMenuItems.map((section, idx) => (
              <div key={idx}>
                {isSidebarOpen && (
                  <h3 className="px-3 text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 animate-in fade-in duration-500">
                    {section.category}
                  </h3>
                )}
                {!isSidebarOpen && idx > 0 && <div className="h-px bg-slate-800 my-2 mx-2"></div>}

                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = item.href === activeMenuHref;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link 
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative
                            ${isActive 
                              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50 font-bold' 
                              : 'hover:bg-slate-800 hover:text-white text-slate-400 font-medium'
                            }
                            ${!isSidebarOpen ? 'justify-center' : ''}
                          `}
                          title={!isSidebarOpen ? item.title : ''}
                        >
                          <span className={`transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                          </span>
                          {isSidebarOpen && (
                            <span className="text-sm truncate">{item.title}</span>
                          )}
                          {isActive && isSidebarOpen && (
                            <div className="absolute right-2 w-1.5 h-1.5 bg-white rounded-full opacity-50"></div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ユーザー情報・ログアウト */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/30">
          <div className={`flex items-center gap-3 ${!isSidebarOpen ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0 shadow-lg border-2 border-slate-800">
              {user?.displayName?.[0] || 'M'}
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 flex-1 animate-in fade-in duration-300">
                <p className="text-sm font-bold text-white truncate">{user?.displayName || '管理者'}</p>
                <p className="mt-0.5 truncate text-[10px] font-black text-indigo-300">{currentSchoolLabel}</p>
                <button 
                  onClick={handleLogout}
                  className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors mt-0.5 font-medium group w-full text-left"
                >
                  <LogOut size={12} className="group-hover:-translate-x-0.5 transition-transform" /> ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* メインコンテンツエリア */}
      <main className="flex-1 overflow-y-auto relative scroll-smooth h-full">
        {/* ★修正箇所: コンテンツラッパーにパディングを追加
          p-8 (32px) 〜 md:p-12 (48px) の余白を設定し、コンテンツを右下に配置します。
        */}
        <div className="min-h-full p-4 sm:p-6 md:p-10 max-w-[1600px] mx-auto overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
