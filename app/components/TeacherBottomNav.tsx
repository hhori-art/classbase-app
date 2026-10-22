'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Bell, Home, Briefcase, Settings, MessageCircle, Clock, LogOut, ClipboardCheck, Users, CalendarDays, Menu } from 'lucide-react';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { useAuth } from '@/app/context/AuthContext';
import { useConfirm } from '@/app/components/ui';
import { cn } from '@/lib/cn';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { isDedicatedAttendanceApproverProfile, isDedicatedProfile } from '@/lib/employment-category';

type NavItem = {
  label: string;
  path: string;
  icon: ReactNode;
  visible: boolean;
  onClick?: () => void | Promise<void>;
  /** 長い名前をナビで2行に分けて出すときの各行（例：理社講座／管理）。 */
  labelLines?: [string, string];
};

/** ナビに並べる最大数。これを超えたら設定・ログアウトを「メニュー」にまとめる。 */
const MAX_VISIBLE_ITEMS = 5;
const OVERFLOW_PATHS = ['/teacher/settings', '#logout'];

/** 講師アプリの下部ナビ。高さは 4.5rem + セーフエリア（固定バーはこの上に置く）。 */
export default function TeacherBottomNav() {
  const pathname = usePathname();
  const { visibility } = usePortalVisibility('teacher');
  const { profile, logout } = useAuth();
  const confirm = useConfirm();
  const isAttendanceOnly = !hasScienceSocialProgram(profile);
  const isDedicatedScienceSocial = Boolean(profile && isDedicatedProfile(profile) && !isAttendanceOnly);
  const canApproveAttendance = Boolean(profile && isDedicatedAttendanceApproverProfile(profile));
  // 専任は専任用の勤怠画面へ直接開く（準専任の画面を経由すると一瞬表示されるため）。
  const attendancePath = profile && isDedicatedProfile(profile) ? '/teacher/attendance/dedicated' : '/teacher/attendance';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const handleLogout = async () => {
    setMenuOpen(false);
    if (!(await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' }))) return;
    await logout();
  };

  const attendanceNavItems: NavItem[] = [
    {
      label: '勤怠',
      path: attendancePath,
      icon: <Clock size={22} aria-hidden />,
      visible: true,
    },
    ...(canApproveAttendance ? [{
      label: '承認',
      path: '/teacher/attendance-approvals',
      icon: <ClipboardCheck size={22} aria-hidden />,
      visible: true,
    }] : []),
    ...(canApproveAttendance ? [{
      label: 'シフト',
      path: '/teacher/shift-management',
      icon: <CalendarDays size={22} aria-hidden />,
      visible: true,
    }] : []),
    {
      label: '設定',
      path: '/teacher/settings',
      icon: <Settings size={22} aria-hidden />,
      visible: true,
    },
    {
      label: '通知',
      path: '/teacher/notifications',
      icon: <Bell size={22} aria-hidden />,
      visible: true,
    },
    {
      label: 'ログアウト',
      path: '#logout',
      icon: <LogOut size={22} aria-hidden />,
      visible: true,
      onClick: handleLogout,
    },
  ];
  const dedicatedNavItems: NavItem[] = [
    {
      label: '理社講座管理',
      labelLines: ['理社講座', '管理'],
      path: '/teacher/school-students',
      icon: <Users size={22} aria-hidden />,
      visible: true,
    },
    ...attendanceNavItems.filter(item => item.path !== '#logout'),
    attendanceNavItems.find(item => item.path === '#logout')!,
  ];
  const scienceSocialNavItems: NavItem[] = [
    {
      label: 'ホーム',
      path: '/teacher',
      icon: <Home size={22} aria-hidden />,
      visible: true,
    },
    {
      label: '仕事',
      path: '/teacher/work',
      icon: <Briefcase size={22} aria-hidden />,
      visible: visibility.work !== false,
    },
    {
      label: '掲示板',
      path: '/teacher/community',
      icon: <MessageCircle size={22} aria-hidden />,
      visible: visibility.community !== false,
    },
    {
      label: '通知',
      path: '/teacher/notifications',
      icon: <Bell size={22} aria-hidden />,
      visible: visibility.notifications !== false,
    },
    {
      label: '設定',
      path: '/teacher/settings',
      icon: <Settings size={22} aria-hidden />,
      visible: visibility.settings !== false,
    },
  ];
  const navItems = (isAttendanceOnly
    ? attendanceNavItems
    : isDedicatedScienceSocial ? dedicatedNavItems : scienceSocialNavItems
  ).filter(item => item.visible);

  // 項目が多いとき（承認者など）は、設定とログアウトを「メニュー」にまとめる
  const useOverflow = navItems.length > MAX_VISIBLE_ITEMS;
  const primaryItems = useOverflow ? navItems.filter(item => !OVERFLOW_PATHS.includes(item.path)) : navItems;
  const overflowItems = useOverflow ? navItems.filter(item => OVERFLOW_PATHS.includes(item.path)) : [];

  // パス判定
  const isActive = (path: string) => {
    if (path.startsWith('#')) return false;
    if (path === '/teacher') return pathname === '/teacher';
    // 「/teacher/attendance」と「/teacher/attendance-approvals」を取り違えないよう、区切りまで見る。
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  const overflowActive = overflowItems.some(item => isActive(item.path));

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const itemClass = (active: boolean) => cn(
    'group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-btn px-1 py-1 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    active ? 'text-accent' : 'text-fg-muted hover:text-fg',
  );
  const iconClass = (active: boolean) => cn(
    'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
    active ? 'bg-accent-soft' : 'group-hover:bg-slate-100',
  );

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    const content = (
      <>
        <span className={iconClass(active)}>{item.icon}</span>
        {/* 長い名前は切らずに2行にする（ナビの高さに収まる文字サイズにする）。 */}
        {item.labelLines
          ? <span className="max-w-full text-center text-[11px] font-bold leading-[12px]">{item.labelLines[0]}<br />{item.labelLines[1]}</span>
          : <span className="max-w-full truncate text-xs font-bold">{item.label}</span>}
      </>
    );
    if (item.onClick) {
      const onClick = item.onClick;
      return (
        <button key={item.path} type="button" onClick={() => void onClick()} className={itemClass(false)}>
          {content}
        </button>
      );
    }
    return (
      <Link key={item.path} href={item.path} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
        {content}
      </Link>
    );
  };

  return (
    <nav
      aria-label="講師メニュー"
      className="fixed inset-x-0 bottom-0 z-nav border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgb(15_23_42/0.18)] backdrop-blur-md"
    >
      <div className="mx-auto flex h-[4.5rem] max-w-3xl items-center gap-1 px-2">
        {primaryItems.map(renderItem)}

        {useOverflow && (
          <div ref={menuRef} className="relative flex min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen(open => !open)}
              className={itemClass(overflowActive || menuOpen)}
            >
              <span className={iconClass(overflowActive || menuOpen)}><Menu size={22} aria-hidden /></span>
              <span className="max-w-full truncate text-[11px] font-bold">メニュー</span>
            </button>
            {menuOpen && (
              <div
                id={menuId}
                role="menu"
                className="absolute bottom-full right-0 mb-2 w-48 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-card"
              >
                {overflowItems.map(item => {
                  const active = isActive(item.path);
                  const rowClass = cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-btn px-3 text-sm font-bold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    item.path === '#logout' ? 'text-danger hover:bg-danger-soft' : active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-canvas',
                  );
                  if (item.onClick) {
                    const onClick = item.onClick;
                    return (
                      <button key={item.path} type="button" role="menuitem" onClick={() => void onClick()} className={rowClass}>
                        {item.icon}{item.label}
                      </button>
                    );
                  }
                  return (
                    <Link key={item.path} href={item.path} role="menuitem" aria-current={active ? 'page' : undefined} className={rowClass}>
                      {item.icon}{item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
