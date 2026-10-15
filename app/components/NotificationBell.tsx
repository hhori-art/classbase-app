'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useSound } from '@/lib/sound';

type Props = {
  href: string;
  className?: string;
};

type NotificationItem = {
  id: string;
  read?: boolean;
};

export default function NotificationBell({ href, className = '' }: Props) {
  const { user, profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const previousUnreadRef = useRef<number | null>(null);
  const requestInFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      if (requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      try {
        const token = await user.getIdToken();
        if (!token) return;
        const res = await fetch('/api/notifications?limit=20', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data.ok) {
          const nextItems = data.notifications || [];
          const unreadCount = nextItems.filter((item: NotificationItem) => !item.read).length;
          if (previousUnreadRef.current !== null && unreadCount > previousUnreadRef.current) {
            play('notification');
          }
          previousUnreadRef.current = unreadCount;
          setItems(nextItems);
          lastLoadedAtRef.current = Date.now();
        }
      } catch (e) {
        console.warn('Notification load failed:', e);
      } finally {
        requestInFlightRef.current = false;
      }
    };
    void load();
    const loadIfVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadedAtRef.current >= 5 * 60 * 1000) void load();
    };
    const interval = window.setInterval(loadIfVisible, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', loadIfVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', loadIfVisible);
    };
  }, [user, play]);

  const unreadCount = useMemo(() => items.filter(item => !item.read).length, [items]);

  return (
    <Link href={href} className={`relative rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 ${className}`} title="通知">
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
