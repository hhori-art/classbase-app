'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import StaffIdleTimeout from '@/app/components/StaffIdleTimeout';
import { ChevronDown, ChevronsLeft, ChevronsRight, GraduationCap, LogOut, Menu, Search, UserCog, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { db } from '@/lib/firebase';
import {
  adminAppForPath,
  hasAdminAppPermission,
  isMasterOnlyAdminPath,
  isConfigurableAdminRole,
  isBlockedForSchoolAdmin,
  isGlobalAdminPath,
} from '@/lib/admin-app-permissions';
import { activeAdminHref, visibleAdminMenu, type AdminMenuItem } from '@/app/components/master/admin-menu';
import { useAdminInboxCounts } from '@/app/components/master/useAdminInboxCounts';
import StudentSearchBox from '@/app/components/master/StudentSearchBox';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';
import { useConfirm, useToast } from '@/app/components/ui';

const SIDEBAR_KEY = 'classbase_admin_sidebar_collapsed';
const SECTIONS_KEY = 'classbase_admin_sidebar_sections';

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [liveProfile, setLiveProfile] = useState<Record<string, any> | null>(null);
  const pathname = usePathname();
  const { user, profile, loading, logout } = useAuth();
  const { visibility: adminVisibility } = usePortalVisibility('admin');
  const confirm = useConfirm();
  const toast = useToast();

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
  // 画面ごとに、その画面の管理アプリ（理社講座・勤怠・Booster・オンライン校）の権限で判定する。
  // 校舎管理者の制限（入れる画面の一覧）は理社講座の画面だけにかける。
  const currentPathAllowed = Boolean(
    effectiveProfile &&
    (
      isGlobalAdminPath(pathname) ||
      (isMasterOnlyPath && isMaster) ||
      (isShiftPath && canUseShifts) ||
      (currentAdminApp && hasAdminAppPermission(effectiveProfile.role, effectiveProfile, currentAdminApp))
    )
  ) && !(isSchoolAdmin && isBlockedForSchoolAdmin(pathname));
  // 生徒検索（生徒の総合ページ）は理社講座の権限がある管理者だけ。担当外の生徒はAPIが返さない。
  // 生徒の総合ページは、校舎管理者の画面を広げない方針のため当面マスターだけ（APIは担当校舎の生徒に限る作りのまま）。
  const canSearchStudents = effectiveProfile?.role === 'master';
  const schoolIds = Array.isArray(effectiveProfile?.school_ids) ? effectiveProfile.school_ids.filter(Boolean) : [];
  const roleLabel = isAttendanceAdmin ? '勤怠管理者' : isMaster ? 'マスター管理者' : isDedicatedAttendanceApprover ? '専任・勤怠承認者' : isSchoolAdmin ? '校舎管理者' : '管理者';
  const schoolLabel = isMaster || isAttendanceAdmin ? '' : attendanceSchoolName(schoolIds[0] || effectiveProfile?.school_id || effectiveProfile?.school) || '';

  // メニューはページではなく権限で決める（ページを移っても項目が増減しない）。
  const sections = useMemo(() => visibleAdminMenu(effectiveProfile, adminVisibility as Record<string, boolean | undefined>), [effectiveProfile, adminVisibility]);
  const activeHref = activeAdminHref(sections, pathname);
  const activeSectionId = sections.find(section => section.items.some(item => item.href === activeHref))?.id;
  const activeTitle = sections.flatMap(section => section.items).find(item => item.href === activeHref)?.title || '管理画面';
  const isSectionOpen = (id: string) => id === 'home' || id === activeSectionId || openSections[id] === true || sections.length <= 3;
  // 対応待ちの件数（教室への連絡・申請・安全アラート・勤務実績の承認）。2分ごとと画面を移るたびに取り直す。
  const hasBadgeItems = sections.some(section => section.items.some(item => item.badgeKey));
  const { counts: inboxCounts } = useAdminInboxCounts({ enabled: Boolean(user && effectiveProfile && hasBadgeItems), refreshKey: pathname });
  const badgeCount = (item: AdminMenuItem) => {
    const value = item.badgeKey ? inboxCounts?.[item.badgeKey] : null;
    return typeof value === 'number' && value > 0 ? value : 0;
  };
  const badgeText = (count: number) => count > 99 ? '99+' : String(count);
  const sectionBadgeTotal = (items: AdminMenuItem[]) => items.reduce((sum, item) => sum + badgeCount(item), 0);
  const totalBadge = sections.reduce((sum, section) => sum + sectionBadgeTotal(section.items), 0);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === '1');
      const saved = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) || '{}');
      if (saved && typeof saved === 'object') setOpenSections(saved);
    } catch { /* 保存できない環境では既定の表示 */ }
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const toggleCollapsed = () => setCollapsed(current => {
    const next = !current;
    try { window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* noop */ }
    return next;
  });
  const toggleSection = (id: string) => setOpenSections(current => {
    const next = { ...current, [id]: !isSectionOpen(id) };
    try { window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });

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

  // 権限のない画面は自動で移動させず、理由とホームへのボタンを出す（通知やブックマークから開いたとき）。

  const handleLogout = async () => {
    if (!(await confirm({ title: '管理画面からログアウトしますか？', confirmLabel: 'ログアウト' }))) return;
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('ログアウトできませんでした。もう一度お試しください。');
    }
  };

  if (loading || !effectiveProfile) {
    return <div data-portal="admin" className="min-h-dvh bg-canvas" aria-busy="true" />;
  }
  if (!currentPathAllowed) {
    return (
      <div data-portal="admin" className="grid min-h-dvh place-items-center bg-canvas px-4">
        <div role="alert" className="w-full max-w-md rounded-card border border-line bg-surface p-6 text-center shadow-sm">
          <p className="text-lg font-bold text-fg">この画面を開く権限がありません</p>
          <p className="mt-2 text-sm text-fg-muted">必要な場合は、マスター管理者に「管理者の権限設定」で権限を付けてもらってください。</p>
          <a href="/master" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-btn bg-accent px-5 text-sm font-bold text-white">管理画面のホームへ</a>
        </div>
      </div>
    );
  }

  // compact はデスクトップで折りたたんだ状態（アイコンのみ）。スマホの引き出しでは常に全表示。
  const renderNav = (compact: boolean) => (
    <nav className={`space-y-1 ${compact ? 'px-2' : 'px-3'}`} aria-label="管理メニュー">
      {sections.map((section, index) => {
        const open = compact || isSectionOpen(section.id);
        const SectionIcon = section.icon;
        return (
          <div key={section.id} className={index > 0 ? 'pt-2' : ''}>
            {compact ? (
              index > 0 && <div className="mx-2 mb-2 h-px bg-slate-800" />
            ) : section.id !== 'home' && (
              <button type="button" onClick={() => toggleSection(section.id)} aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-xs font-bold tracking-wider text-slate-400 hover:text-slate-200">
                <SectionIcon size={13} />
                <span className="flex-1 text-left">{section.title}</span>
                {!open && sectionBadgeTotal(section.items) > 0 && (
                  <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`対応待ち ${sectionBadgeTotal(section.items)}件`}>{badgeText(sectionBadgeTotal(section.items))}</span>
                )}
                <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
            )}
            {open && (
              <ul className="mt-0.5 space-y-0.5">
                {section.items.map(item => {
                  const active = item.href === activeHref;
                  const Icon = item.icon;
                  const count = badgeCount(item);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} title={compact ? (count > 0 ? `${item.title}（対応待ち ${count}件）` : item.title) : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex min-h-10 items-center gap-3 rounded-btn py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${compact ? 'justify-center px-0' : 'px-3'} ${active ? 'bg-accent font-bold text-accent-ink shadow-sm' : 'font-medium text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                        <Icon size={18} strokeWidth={active ? 2.5 : 2} className="shrink-0" aria-hidden />
                        {!compact && <span className="min-w-0 flex-1 truncate">{item.title}</span>}
                        {count > 0 && (compact ? (
                          <span className="absolute right-1 top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[11px] font-bold leading-4 text-white" aria-label={`対応待ち ${count}件`}>{badgeText(count)}</span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`対応待ち ${count}件`}>{badgeText(count)}</span>
                        ))}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  const renderAccount = (compact: boolean) => (
    <div className={`border-t border-slate-800 bg-slate-950/40 ${compact ? 'px-2 py-3' : 'p-4'}`}>
      <AppSwitcherLink variant={compact ? 'dark-icon' : 'dark'} className="mb-3" />
      <div className={`flex items-center gap-3 ${compact ? 'flex-col' : ''}`}>
        {/* 名前を押すと自分のアカウント（パスワード変更・LINE連携・ログアウト）。どの管理者でも開ける。 */}
        <Link href="/master/account" title="自分のアカウント" aria-label={compact ? '自分のアカウント' : undefined}
          className={`flex min-w-0 items-center gap-3 rounded-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${compact ? '' : 'flex-1 hover:bg-slate-800/60'}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
            {(user?.displayName || effectiveProfile?.name || '管')[0]}
          </span>
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-white">{user?.displayName || effectiveProfile?.name || '管理者'}</span>
              <span className="block truncate text-xs font-bold text-indigo-300">{[roleLabel, schoolLabel].filter(Boolean).join(' ・ ')}</span>
            </span>
          )}
        </Link>
        {!compact && (
          <Link href="/master/account" title="自分のアカウント" aria-label="自分のアカウント" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-slate-400 hover:bg-slate-800 hover:text-white">
            <UserCog size={16} aria-hidden />
          </Link>
        )}
        <button type="button" onClick={handleLogout} title="ログアウト" aria-label="ログアウト" className="inline-flex h-9 w-9 items-center justify-center rounded-btn text-slate-400 hover:bg-slate-800 hover:text-rose-400">
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </div>
  );

  const brand = (
    <Link href="/master" className="flex min-w-0 items-center gap-3">
      <span className="rounded-input bg-accent p-1.5 text-accent-ink shadow-sm"><GraduationCap size={20} strokeWidth={2.5} /></span>
      <span className="truncate text-base font-bold tracking-tight text-white">創造学園 管理</span>
    </Link>
  );

  return (
    <div data-portal="admin" className="flex h-dvh w-full overflow-hidden bg-canvas font-sans">
      {/* デスクトップ：常に表示するサイドバー（折りたたみ可・状態を保存） */}
      <aside className={`hidden h-full shrink-0 flex-col bg-slate-900 text-slate-300 transition-[width] duration-200 lg:flex ${collapsed ? 'w-[72px]' : 'w-64'}`}>
        <div className={`flex h-16 items-center border-b border-slate-800 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {collapsed ? (
            <Link href="/master" className="rounded-input bg-accent p-1.5 text-accent-ink" aria-label="ホーム"><GraduationCap size={20} strokeWidth={2.5} /></Link>
          ) : brand}
        </div>
        {canSearchStudents && (collapsed ? (
          <Link href="/master/students" title="生徒を検索" aria-label="生徒を検索" className="mx-auto mt-3 inline-flex h-10 w-10 items-center justify-center rounded-btn text-slate-400 hover:bg-slate-800 hover:text-white">
            <Search size={18} aria-hidden />
          </Link>
        ) : (
          <StudentSearchBox tone="dark" className="mx-3 mt-3" />
        ))}
        <div className="flex-1 overflow-y-auto py-3">{renderNav(collapsed)}</div>
        <button type="button" onClick={toggleCollapsed} className="flex h-10 items-center justify-center gap-2 border-t border-slate-800 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label={collapsed ? 'メニューを広げる' : 'メニューを折りたたむ'}>
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} />折りたたむ</>}
        </button>
        {renderAccount(collapsed)}
      </aside>

      {/* スマホ・タブレット：引き出し式メニュー */}
      {drawerOpen && (
        <div className="fixed inset-0 z-overlay lg:hidden" role="dialog" aria-modal="true" aria-label="管理メニュー">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col bg-slate-900 text-slate-300 shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
              {brand}
              <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-btn text-slate-400 hover:bg-slate-800" aria-label="メニューを閉じる"><X size={18} aria-hidden /></button>
            </div>
            {canSearchStudents && <StudentSearchBox tone="dark" className="mx-3 mt-3" onNavigate={() => setDrawerOpen(false)} />}
            <div className="flex-1 overflow-y-auto py-3">{renderNav(false)}</div>
            {renderAccount(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} className="relative inline-flex h-10 w-10 items-center justify-center rounded-btn text-slate-600 hover:bg-slate-100" aria-label={totalBadge > 0 ? `管理メニューを開く（対応待ち ${totalBadge}件）` : '管理メニューを開く'} aria-expanded={drawerOpen}>
            <Menu size={20} aria-hidden />
            {totalBadge > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[11px] font-bold leading-4 text-white" aria-hidden>{badgeText(totalBadge)}</span>}
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{activeTitle}</p>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{roleLabel}</span>
          <AppSwitcherLink variant="icon" />
        </header>
        <main className="relative min-w-0 flex-1 overflow-y-auto scroll-smooth">
          {/* overflow-x-clip は sticky を壊さない（hidden だと各ページの固定見出しが効かない）。 */}
          {/* 右下の「使い方」ボタン（下から約140px）に最後のボタンが隠れないよう、下の余白を160px取る。 */}
          <div className="mx-auto min-h-full max-w-[1600px] overflow-x-clip p-4 pb-40 sm:p-6 sm:pb-40 lg:p-8 lg:pb-40">
            {children}
          </div>
        </main>
        <StaffIdleTimeout />
      </div>
    </div>
  );
}
