'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 職員（管理画面・講師画面）の無操作タイムアウト。生徒・保護者には使わない。
// 複数のタブで操作の時刻を localStorage で共有し、どれかのタブで操作していれば続けて使える。

/** 操作がないままこの時間がたつと自動でログアウトする。 */
export const STAFF_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** ログアウトの何分前に警告を出すか。 */
export const STAFF_IDLE_WARNING_MS = 5 * 60 * 1000;
export const STAFF_LAST_ACTIVITY_KEY = 'classbase_staff_last_activity';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** localStorage への書き込みはこの間隔より細かくしない。 */
const WRITE_THROTTLE_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;
const WARNING_TICK_MS = 1000;

function readSharedActivity() {
  try {
    const value = Number(window.localStorage.getItem(STAFF_LAST_ACTIVITY_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeSharedActivity(at: number) {
  try { window.localStorage.setItem(STAFF_LAST_ACTIVITY_KEY, String(at)); } catch { /* 保存できない環境ではこのタブだけで数える */ }
}

export function useStaffIdleTimeout({ enabled, onTimeout, timeoutMs = STAFF_IDLE_TIMEOUT_MS, warningMs = STAFF_IDLE_WARNING_MS }: {
  enabled: boolean;
  onTimeout: () => void | Promise<void>;
  timeoutMs?: number;
  warningMs?: number;
}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const lastActivityRef = useRef(0);
  const lastWriteRef = useRef(0);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (force || now - lastWriteRef.current >= WRITE_THROTTLE_MS) {
      lastWriteRef.current = now;
      writeSharedActivity(now);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRemainingMs(null);
      return;
    }
    firedRef.current = false;
    // 画面を開いたこと自体を操作とみなす（前回のログインで残った古い時刻で即ログアウトしない）。
    markActive(true);

    let timer: number | undefined;
    const check = () => {
      if (firedRef.current) return;
      const last = Math.max(lastActivityRef.current, readSharedActivity());
      const left = timeoutMs - (Date.now() - last);
      if (left <= 0) {
        firedRef.current = true;
        setRemainingMs(null);
        Promise.resolve(onTimeoutRef.current()).catch(() => undefined);
        return;
      }
      setRemainingMs(left <= warningMs ? left : null);
      window.clearTimeout(timer);
      timer = window.setTimeout(check, left <= warningMs ? WARNING_TICK_MS : Math.min(CHECK_INTERVAL_MS, left - warningMs));
    };

    const onActivity = () => {
      const wasWarning = lastActivityRef.current > 0 && Date.now() - Math.max(lastActivityRef.current, readSharedActivity()) >= timeoutMs - warningMs;
      markActive(wasWarning);
      if (wasWarning) check();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STAFF_LAST_ACTIVITY_KEY) check();
    };
    // スリープ明けなどでタイマーが遅れても、画面に戻った時点で判定する。
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, onActivity, { passive: true, capture: true }));
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    check();

    return () => {
      window.clearTimeout(timer);
      ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, onActivity, { capture: true }));
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, markActive, timeoutMs, warningMs]);

  /** 警告の「続けて使う」。操作したことにして警告を閉じる。 */
  const stayActive = useCallback(() => {
    markActive(true);
    setRemainingMs(null);
  }, [markActive]);

  return { warning: remainingMs !== null, remainingMs, stayActive };
}
