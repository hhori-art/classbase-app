'use client';

import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Bell, BookOpenText, CalendarDays, CalendarX2, FileText, GraduationCap, Home, ListChecks, LogOut, Megaphone, Menu, MessageCircle, MessagesSquare, Settings, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import NotificationBell from '@/app/components/NotificationBell';
import { IconButton } from '@/app/components/ui';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';

type NavItem = { href: string; label: string; icon: typeof Home; visible: boolean };

const ABSENCE_HREF = '/parent#absence';
/** スマホ下部のタブに出す順の優先度（見えるものから4つ）。残りは「メニュー」に入る。 */
const PRIMARY_PRIORITY = ['/parent', ABSENCE_HREF, '/parent/pf', '/parent/contact', '/parent/news'];
const PRIMARY_COUNT = 4;

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout } = useAuth();
  const { visibility } = usePortalVisibility('parent');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState('');

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // usePathname には「#absence」が含まれないので、欠席連絡のタブを光らせるために hash を別に持つ。
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [pathname]);

  const learningVisible = Boolean(visibility.attendance || visibility.recordings || visibility.homework);
  const navItems: NavItem[] = ([
    { href: '/parent', label: TERMS.home, icon: Home, visible: true },
    { href: '/parent/pf', label: '学習状況', icon: BarChart3, visible: learningVisible },
    { href: '/parent/report', label: '月のレポート', icon: FileText, visible: learningVisible },
    { href: '/parent/timetable', label: '時間割', icon: CalendarDays, visible: true },
    { href: '/parent/courses', label: '受講講座', icon: ListChecks, visible: visibility.courseRegistration !== false },
    { href: '/parent/news', label: TERMS.news, icon: Megaphone, visible: Boolean(visibility.announcements) },
    { href: ABSENCE_HREF, label: TERMS.absenceContact, icon: CalendarX2, visible: visibility.absence !== false },
    { href: '/parent/contact', label: TERMS.parentContact, icon: MessagesSquare, visible: visibility.contact !== false },
    { href: '/parent/messages', label: 'AI学習履歴', icon: MessageCircle, visible: Boolean(visibility.aiMessages) },
    { href: '/parent/notifications', label: TERMS.notification, icon: Bell, visible: visibility.notifications !== false },
    { href: '/parent/settings', label: '設定', icon: Settings, visible: visibility.settings !== false && visibility.notificationSettings !== false },
  ] as NavItem[]).filter(item => item.visible);
  const primaryHrefs = new Set(PRIMARY_PRIORITY.filter(href => navItems.some(item => item.href === href)).slice(0, PRIMARY_COUNT));
  const primaryItems = navItems.filter(item => primaryHrefs.has(item.href));
  const menuItems = navItems.filter(item => !primaryHrefs.has(item.href));

  const isActive = (href: string) => {
    if (href === ABSENCE_HREF) return pathname === '/parent' && hash === '#absence';
    if (href === '/parent') return pathname === '/parent' && hash !== '#absence';
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const menuActive = menuItems.some(item => isActive(item.href));
  const guardianName = String(profile?.parent_name || profile?.name || '').trim();
  const onNavigate = (href: string) => setHash(href === ABSENCE_HREF ? '#absence' : '');

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <div data-portal="parent" className="min-h-screen bg-canvas font-sans text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/parent" onClick={() => onNavigate('/parent')} className="flex min-h-11 shrink-0 items-center gap-3 rounded-btn">
            <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent text-accent-ink shadow-sm">
              <GraduationCap size={22} aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-xs font-bold text-fg-muted">保護者</span>
              <span className="block text-base font-bold text-fg">創造学園アプリ</span>
            </span>
          </Link>

          <nav className="hidden min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto [scrollbar-width:none] xl:justify-center lg:flex [&::-webkit-scrollbar]:hidden" aria-label="保護者メニュー">
            {navItems.filter(item => item.href !== '/parent/notifications').map(item => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onNavigate(item.href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    // 項目が多いので、ラベルは折り返さない（入りきらないときはメニューごと横に動かせる）。
                    'flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-btn px-2.5 text-sm font-bold transition-colors',
                    active ? 'bg-accent text-accent-ink' : 'text-fg-muted hover:bg-accent-soft hover:text-accent',
                  )}
                >
                  <Icon size={16} aria-hidden />{item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            {guardianName && <span className="hidden text-sm font-medium text-fg-muted sm:inline">{guardianName} 様</span>}
            {visibility.notifications !== false && <NotificationBell href="/parent/notifications" />}
            <AppSwitcherLink variant="icon" />
            <IconButton label="ログアウト" variant="secondary" onClick={handleLogout} className="hover:bg-danger-soft hover:text-danger">
              <LogOut size={18} aria-hidden />
            </IconButton>
          </div>
        </div>
      </header>

      {/* 右下の「使い方」ボタン（下から約140px）に最後のボタンが隠れないよう、下の余白を160px取る。 */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-40">{children}</main>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div
            id="parent-more-menu"
            role="dialog"
            aria-label="その他のメニュー"
            className="absolute inset-x-3 bottom-[calc(88px+env(safe-area-inset-bottom))] rounded-hero bg-surface p-3 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <p className="text-sm font-bold text-fg-muted">その他のメニュー</p>
              <IconButton label="閉じる" size="sm" onClick={() => setMenuOpen(false)}><X size={18} aria-hidden /></IconButton>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {menuItems.map(item => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => { onNavigate(item.href); setMenuOpen(false); }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-12 items-center gap-3 rounded-btn px-4 py-3 text-sm font-bold',
                      active ? 'bg-accent text-accent-ink' : 'bg-canvas text-fg hover:bg-accent-soft',
                    )}
                  >
                    <Icon size={18} aria-hidden className={active ? undefined : 'text-accent'} />{item.label}
                  </Link>
                );
              })}
              <Link href="/manual" className="flex min-h-12 items-center gap-3 rounded-btn bg-canvas px-4 py-3 text-sm font-bold text-fg hover:bg-accent-soft">
                <BookOpenText size={18} aria-hidden className="text-accent" />操作マニュアル
              </Link>
              <AppSwitcherLink variant="menu" />
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 rounded-t-card border-t border-line bg-surface/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 shadow-[0_-10px_30px_-18px_rgba(15,23,42,0.45)] backdrop-blur-md lg:hidden" aria-label="保護者メニュー">
        <div className="mx-auto flex max-w-lg justify-around">
          {primaryItems.map(item => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onNavigate(item.href)}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1"
              >
                <span className={cn('flex h-8 w-12 items-center justify-center rounded-btn transition-colors', active ? 'bg-accent text-accent-ink' : 'text-fg-muted')}>
                  <Icon size={20} aria-hidden />
                </span>
                <span className={cn('max-w-full truncate text-[11px] font-bold', active ? 'text-accent' : 'text-fg-muted')}>{item.label}</span>
              </Link>
            );
          })}
          {menuItems.length > 0 && (
            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-expanded={menuOpen}
              aria-controls="parent-more-menu"
              className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1"
            >
              <span className={cn('flex h-8 w-12 items-center justify-center rounded-btn transition-colors', menuOpen || menuActive ? 'bg-accent text-accent-ink' : 'text-fg-muted')}>
                <Menu size={20} aria-hidden />
              </span>
              <span className={cn('text-[11px] font-bold', menuOpen || menuActive ? 'text-accent' : 'text-fg-muted')}>メニュー</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
