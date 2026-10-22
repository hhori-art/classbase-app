'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/app/components/NotificationBell';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * 自分宛ての未読通知の数（NotificationBell と同じ /api/notifications の unread_count）。
 * 5分ごと（画面が表示中のときだけ）と、通知一覧で既読にしたときに読み直す。
 */
export function useUnreadNotificationCount(enabled = true) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const inFlightRef = useRef(false);
  const lastLoadedAtRef = useRef(0);

  useEffect(() => {
    if (!user || !enabled) return;
    let cancelled = false;
    const load = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/notifications?limit=1', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data.ok) return;
        const serverCount = Number(data.unread_count);
        const items: { read?: boolean }[] = Array.isArray(data.notifications) ? data.notifications : [];
        setCount(Number.isFinite(serverCount) && serverCount >= 0 ? serverCount : items.filter(item => !item.read).length);
        lastLoadedAtRef.current = Date.now();
      } catch (error) {
        // 未読数が取れなくても下部メニューは使えるので、印を出さないだけにする。
        console.warn('unread notification count failed:', error);
      } finally {
        inFlightRef.current = false;
      }
    };
    void load();
    const loadIfVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadedAtRef.current >= REFRESH_MS) void load();
    };
    const reloadNow = () => { void load(); };
    const interval = window.setInterval(loadIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', loadIfVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reloadNow);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', loadIfVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reloadNow);
    };
  }, [user, enabled]);

  return enabled ? count : 0;
}
