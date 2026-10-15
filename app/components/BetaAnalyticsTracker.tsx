'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';

type BetaEventType = 'page_view' | 'page_leave' | 'click' | 'error' | 'visibility' | 'performance';

type QueuedBetaEvent = {
  type: BetaEventType;
  path: string;
  session_id: string;
  metadata: Record<string, unknown>;
  feature: unknown;
  duration_ms: unknown;
};

const SESSION_KEY = 'classbase_beta_session_id';
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 25;
const MAX_QUEUED_EVENTS = 100;

const getSessionId = () => {
  if (typeof window === 'undefined') return '';
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(SESSION_KEY, next);
  return next;
};

const textOf = (element: Element | null) => {
  if (!element) return '';
  const explicit = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('data-analytics-label');
  if (explicit) return explicit;
  return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
};

export default function BetaAnalyticsTracker() {
  const pathname = usePathname();
  const { user, profile, loading } = useAuth();
  const startedAtRef = useRef(Date.now());
  const lastClickAtRef = useRef(0);
  const queueRef = useRef<QueuedBetaEvent[]>([]);
  const flushingRef = useRef(false);
  const sessionId = useMemo(getSessionId, []);
  const analyticsLevel = String(process.env.NEXT_PUBLIC_BETA_ANALYTICS_LEVEL || 'summary').toLowerCase();
  const analyticsEnabled = analyticsLevel !== 'off';
  const detailedAnalytics = analyticsLevel === 'detailed';

  const flushEvents = useCallback(async (useKeepalive = false) => {
    if (!user || loading || flushingRef.current || queueRef.current.length === 0) return;
    const events = queueRef.current.splice(0, MAX_BATCH_SIZE);
    flushingRef.current = true;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('missing-token');
      const response = await fetch('/api/beta/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events }),
        keepalive: useKeepalive,
      });
      if (!response.ok) throw new Error(`beta-analytics-${response.status}`);
    } catch {
      queueRef.current = [...events, ...queueRef.current].slice(-MAX_QUEUED_EVENTS);
      // 計測失敗で利用者操作を止めない
    } finally {
      flushingRef.current = false;
    }
  }, [loading, user]);

  const sendEvent = useCallback((type: BetaEventType, payload: Record<string, unknown> = {}, flushNow = false) => {
    if (!analyticsEnabled || !user || loading || !profile) return;
    // 通常運用では画面利用・滞在・エラーだけを記録する。クリック単位の詳細計測は
    // NEXT_PUBLIC_BETA_ANALYTICS_LEVEL=detailed の期間だけ有効にする。
    if (!detailedAnalytics && (type === 'click' || type === 'visibility' || type === 'performance')) return;
    queueRef.current.push({
      type,
      path: pathname || window.location.pathname,
      session_id: sessionId,
      metadata: payload,
      feature: payload.feature || payload.label || payload.href || pathname,
      duration_ms: payload.duration_ms || 0,
    });
    if (queueRef.current.length > MAX_QUEUED_EVENTS) {
      queueRef.current.splice(0, queueRef.current.length - MAX_QUEUED_EVENTS);
    }
    if (flushNow || queueRef.current.length >= MAX_BATCH_SIZE) void flushEvents(flushNow);
  }, [analyticsEnabled, detailedAnalytics, flushEvents, loading, pathname, profile, sessionId, user]);

  useEffect(() => {
    if (!user || loading || !profile) return;
    startedAtRef.current = Date.now();
    sendEvent('page_view', {
      title: document.title,
      role: profile.role,
      grade: profile.grade || '',
      school: profile.school || profile.school_id || '',
      referrer: document.referrer || '',
    });

    const timer = window.setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      sendEvent('performance', {
        load_ms: Math.round(nav.loadEventEnd || nav.duration || 0),
        dom_ms: Math.round(nav.domContentLoadedEventEnd || 0),
      });
    }, 1500);

    return () => {
      window.clearTimeout(timer);
      const duration = Date.now() - startedAtRef.current;
      sendEvent('page_leave', { duration_ms: duration }, true);
    };
  }, [pathname, user, loading, profile, sendEvent]);

  useEffect(() => {
    if (!user || loading || !profile) return;

    const handleClick = (event: MouseEvent) => {
      const now = Date.now();
      if (now - lastClickAtRef.current < 400) return;
      lastClickAtRef.current = now;
      const target = event.target instanceof Element ? event.target.closest('a,button,[role="button"],input,select,textarea') : null;
      if (!target) return;
      const href = target instanceof HTMLAnchorElement ? target.href : '';
      sendEvent('click', {
        label: textOf(target),
        tag: target.tagName.toLowerCase(),
        href,
        feature: target.getAttribute('data-analytics-id') || href || textOf(target),
      });
    };

    const handleError = (event: ErrorEvent) => {
      sendEvent('error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      sendEvent('error', { message: String(event.reason?.message || event.reason || 'unhandledrejection') });
    };

    const handleVisibility = () => {
      sendEvent('visibility', {
        state: document.visibilityState,
        duration_ms: Date.now() - startedAtRef.current,
      });
      if (document.visibilityState === 'hidden') void flushEvents(true);
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, loading, profile, pathname, sendEvent, flushEvents]);

  useEffect(() => {
    if (!analyticsEnabled || !user || loading || !profile) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void flushEvents();
    }, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [analyticsEnabled, flushEvents, loading, profile, user]);

  return null;
}
