'use client';

import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, BookOpenCheck, ChartNoAxesCombined, History, Home, Languages } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ButtonLink } from '@/app/components/ui';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';
import { loadAppAvailability } from '@/lib/client-app-availability';

export default function EikenLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const role = String(profile?.role || '');
  const isParent = role === 'parent' || role === 'guardian';
  // 保護者ホーム（理社講座）は、理社のお子さまが紐づいている保護者だけに出す。Boosterだけの保護者には出さない。
  const [hasScienceSocial, setHasScienceSocial] = useState(false);
  useEffect(() => {
    if (!user || !isParent) { setHasScienceSocial(false); return; }
    let active = true;
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => { if (active) setHasScienceSocial(data?.apps?.science_social === true); })
      .catch(() => { if (active) setHasScienceSocial(false); });
    return () => { active = false; };
  }, [user, isParent]);
  const home = isParent ? '/eiken/parent' : role === 'teacher' ? '/eiken/teacher' : '/eiken/student';
  const studentNav = [
    { href: '/eiken/student', label: TERMS.home, icon: Home },
    { href: '/eiken/student#today', label: '今日の学習', icon: BookOpenCheck },
    { href: '/eiken/student#growth', label: '成長', icon: ChartNoAxesCombined },
    { href: '/eiken/student#history', label: '履歴', icon: History },
    { href: '/eiken/student#news', label: TERMS.news, icon: Bell },
  ];

  return (
    <div data-portal="eiken" className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href={home} className="flex min-h-11 min-w-0 items-center gap-3 rounded-btn">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent text-accent-ink">
              <Languages size={22} aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs font-bold text-accent">英検対策講座</span>
              <span className="block truncate text-base font-bold">Booster</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {/* 理社講座も使う保護者は、保護者ホームへすぐ戻れるようにする */}
            {isParent && hasScienceSocial && <ButtonLink href="/parent" variant="secondary" size="sm" icon={<Home size={15} aria-hidden />} className="min-h-11">保護者ホーム</ButtonLink>}
            <AppSwitcherLink />
          </div>
        </div>
      </header>

      {role === 'student' && (
        <nav className="sticky top-[65px] z-20 border-b border-line bg-surface" aria-label="Booster メニュー">
          <div className="mx-auto flex max-w-4xl overflow-x-auto px-2">
            {studentNav.map(item => {
              const Icon = item.icon;
              const active = pathname === item.href.split('#')[0] && item.href === '/eiken/student';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-12 min-w-24 flex-1 items-center justify-center gap-1.5 border-b-2 px-3 text-sm font-bold',
                    active ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon size={16} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {children}
    </div>
  );
}
