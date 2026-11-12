'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Home, Users, Settings } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import { useUnreadNotificationCount } from '@/app/components/student/useUnreadNotificationCount';

export default function BottomNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { visibility } = usePortalVisibility('student');
  const unreadCount = useUnreadNotificationCount(visibility.notifications !== false);

  // 生徒の下部メニュー。選択中の項目は差し色（生徒のテーマ設定）で示す。
  const navItems = [
    {
      label: 'ホーム',
      path: '/student',
      icon: Home,
      visible: true,
    },
    {
      label: '掲示板',
      path: '/student/community',
      icon: Users,
      // 全体設定でオフでも、マスターが個別に許可した生徒（テスト用アカウントなど）には出す。
      visible: isStudentFeatureEnabled(visibility, profile, 'community'),
    },
    {
      label: '通知',
      path: '/student/notifications',
      icon: Bell,
      visible: visibility.notifications !== false,
    },
    {
      label: '設定',
      path: '/student/settings',
      icon: Settings,
      visible: visibility.settings !== false,
    },
  ].filter(item => item.visible);

  const isActive = (path: string) => {
    if (path === '/student') return pathname === '/student';
    return pathname.startsWith(path);
  };

  return (
    <nav
      aria-label="生徒メニュー"
      className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around gap-1 rounded-t-card border-t border-line bg-surface/90 px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)] backdrop-blur-md"
    >
      {navItems.map((item) => {
        const active = isActive(item.path);
        const Icon = item.icon;
        const badge = item.path === '/student/notifications' && unreadCount > 0 ? unreadCount : 0;

        return (
          <Link
            key={item.path}
            href={item.path}
            aria-current={active ? 'page' : undefined}
            aria-label={badge ? `${item.label}（未読${badge}件）` : undefined}
            className="group flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-btn px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span
              className={`relative flex h-10 w-12 items-center justify-center rounded-btn transition-colors duration-200 ${
                active ? 'bg-accent-soft text-accent' : 'text-fg-muted group-hover:bg-canvas'
              }`}
            >
              <Icon size={24} strokeWidth={active ? 2.5 : 2} aria-hidden />
              {badge > 0 && (
                <span aria-hidden className="absolute right-0.5 top-0 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface bg-danger px-1 text-[11px] font-bold leading-none text-white">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <span className={`whitespace-nowrap text-xs font-bold ${active ? 'text-accent' : 'text-fg-muted'}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
