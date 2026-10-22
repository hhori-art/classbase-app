'use client';

import { useEffect, useRef, useState } from 'react';
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

/** 通知の一覧で既読にしたときに出すイベント。ベルの未読数をすぐ読み直す。 */
export const NOTIFICATIONS_CHANGED_EVENT = 'classbase:notifications-changed';

export default function NotificationBell({ href, className = '' }: Props) {
  const { user, profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  const [unreadCount, setUnreadCount] = useState(0);
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
        const res = await fetch('/api/notifications?limit=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data.ok) {
          const nextItems: NotificationItem[] = data.notifications || [];
          // サーバーが自分宛ての未読をすべて数えた値を使う（最新20件だけでは数え切れない）。
          const serverCount = Number(data.unread_count);
          const nextUnread = Number.isFinite(serverCount) && serverCount >= 0
            ? serverCount
            : nextItems.filter(item => !item.read).length;
          if (previousUnreadRef.current !== null && nextUnread > previousUnreadRef.current) {
            play('notification');
          }
          previousUnreadRef.current = nextUnread;
          setUnreadCount(nextUnread);
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
    const reloadNow = () => { void load(); };
    const interval = window.setInterval(loadIfVisible, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', loadIfVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reloadNow);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', loadIfVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reloadNow);
    };
  }, [user, play]);

  const label = unreadCount > 0 ? `通知（未読${unreadCount}件）` : '通知';
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn border border-line bg-surface text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <Bell size={18} aria-hidden />
      {unreadCount > 0 && (
        <span aria-hidden className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
