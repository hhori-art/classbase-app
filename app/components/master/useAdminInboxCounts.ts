'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { auth } from '@/lib/firebase';

/** /api/admin/inbox-counts の件数。null は「数えられなかった」。キーがない分野は表示しない。 */
export type AdminInboxCounts = Partial<Record<
  'parentInquiries' | 'requests' | 'safetyAlerts' | 'detailApprovals' | 'recordings' | 'substitutions' | 'rewards' | 'passwordRecovery',
  number | null
>>;

type State = { counts: AdminInboxCounts | null; error: string; loading: boolean };

// サイドバーとホームで1回の取得を共有する。
let state: State = { counts: null, error: '', loading: false };
let inFlight: Promise<void> | null = null;
let lastFetchedAt = 0;
const listeners = new Set<() => void>();
const emit = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const MIN_INTERVAL_MS = 15_000;

async function fetchCounts(force = false) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastFetchedAt < MIN_INTERVAL_MS) return;
  inFlight = (async () => {
    emit({ loading: true });
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch('/api/admin/inbox-counts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '件数を取得できませんでした。');
      lastFetchedAt = Date.now();
      emit({ counts: body.counts || {}, error: '' });
    } catch (error) {
      emit({ error: error instanceof Error ? error.message : '件数を取得できませんでした。' });
    } finally {
      emit({ loading: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 対応待ちの件数。refreshKey（画面のパスなど）が変わったときと、intervalMs ごとに取り直す。
 * 同じ画面のサイドバーとホームでは取得を共有し、15秒以内の再取得はしない。
 */
export function useAdminInboxCounts({ enabled = true, refreshKey, intervalMs = 300_000 }: { enabled?: boolean; refreshKey?: string; intervalMs?: number } = {}) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);

  useEffect(() => {
    if (!enabled) return;
    void fetchCounts();
  }, [enabled, refreshKey]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchCounts(true);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  const reload = useCallback(() => fetchCounts(true), []);

  return { ...snapshot, reload };
}
