'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, BookOpenCheck, ChartNoAxesCombined, History, Home, Languages } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

export default function EikenLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile } = useAuth();
  const role = String(profile?.role || '');
  const home = role === 'parent' ? '/eiken/parent' : role === 'teacher' ? '/eiken/teacher' : '/eiken/student';
  const studentNav = [
    { href: '/eiken/student', label: 'ホーム', icon: Home },
    { href: '/eiken/student#today', label: '今日の学習', icon: BookOpenCheck },
    { href: '/eiken/student#growth', label: '成長', icon: ChartNoAxesCombined },
    { href: '/eiken/student#history', label: '履歴', icon: History },
    { href: '/eiken/student#news', label: 'お知らせ', icon: Bell },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-emerald-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href={home} className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Languages size={22} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black text-emerald-700">英検対策講座</p>
              <h1 className="truncate text-base font-black">Booster</h1>
            </div>
          </Link>
          <Link
            href="/apps"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
            <span>創造学園アプリ一覧へ</span>
          </Link>
        </div>
      </header>

      {role === 'student' && (
        <nav className="sticky top-[65px] z-20 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl overflow-x-auto px-2">
            {studentNav.map(item => {
              const Icon = item.icon;
              const active = pathname === item.href.split('#')[0] && item.href === '/eiken/student';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-w-24 flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold ${
                    active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon size={16} />
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
