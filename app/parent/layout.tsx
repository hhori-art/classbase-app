'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, HelpCircle, Home, LogOut, MessageCircle, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout } = useAuth();
  const [visibility, setVisibility] = useState({
    aiMessages: true,
    contact: true,
    notificationSettings: true,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'portal_visibility'));
        if (snap.exists()) setVisibility(prev => ({ ...prev, ...(snap.data().parent || {}) }));
      } catch (e) {
        console.warn('Parent layout visibility read failed:', e);
      }
    };
    load();
  }, []);

  const navItems = [
    { href: '/parent', label: 'ホーム', icon: Home, visible: true },
    { href: '/parent/messages', label: 'AI・連絡', icon: MessageCircle, visible: visibility.aiMessages },
    { href: '/parent/contact', label: '問合せ', icon: HelpCircle, visible: visibility.contact !== false },
    { href: '/parent/settings', label: '通知設定', icon: Bell, visible: visibility.notificationSettings !== false },
  ].filter(item => item.visible);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-gray-800">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/parent" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
              <UserRound size={20} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Parent Console</p>
              <h1 className="text-base font-black text-slate-900">保護者ダッシュボード</h1>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-bold text-slate-500 sm:inline">
              {profile?.parent_name || profile?.name || '保護者'}
            </span>
            <button onClick={handleLogout} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-red-50 hover:text-red-500" title="ログアウト">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-32">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-3 py-2 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.4)] backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl justify-around">
          {navItems.map(item => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-black transition ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                <Icon size={20} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
