'use client';

import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

// この端末への通知（Web Push）。Service Worker はオンにした時だけ登録し、
// 通常のページ表示では登録しない（Next.js の画面配信と干渉させない）。

const SW_URL = '/push-sw.js';
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export type WebPushStatus =
  | 'checking'
  | 'not-configured' // 公開鍵が未設定
  | 'unsupported' // この端末・ブラウザでは使えない
  | 'ios-needs-install' // iPhone/iPad でホーム画面に追加していない
  | 'denied' // 通知がブロックされている
  | 'off'
  | 'on';

function isIos() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function pushSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function base64UrlToUint8Array(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function findPushRegistration() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const script = registration?.active?.scriptURL || registration?.waiting?.scriptURL || registration?.installing?.scriptURL || '';
  return registration && script.endsWith(SW_URL) ? registration : null;
}

async function callApi(method: 'POST' | 'DELETE', body: unknown) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/push/subscriptions', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`push-subscription-${res.status}`);
}

export function useWebPush() {
  const [status, setStatus] = useState<WebPushStatus>('checking');
  const [busy, setBusy] = useState(false);

  const baseStatus = useCallback((): WebPushStatus | null => {
    if (!VAPID_PUBLIC_KEY) return 'not-configured';
    if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
    if (isIos() && !isStandalone()) return 'ios-needs-install';
    if (Notification.permission === 'denied') return 'denied';
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fixed = baseStatus();
      if (fixed) { if (!cancelled) setStatus(fixed); return; }
      try {
        const registration = await findPushRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (cancelled) return;
        if (subscription && Notification.permission === 'granted') {
          setStatus('on');
          // 同じ端末で別の人がログインした場合に備え、登録先を今の利用者にそろえる。
          callApi('POST', { subscription: subscription.toJSON() }).catch(() => undefined);
        } else {
          setStatus('off');
        }
      } catch {
        if (!cancelled) setStatus('off');
      }
    })();
    return () => { cancelled = true; };
  }, [baseStatus]);

  const enable = useCallback(async () => {
    const fixed = baseStatus();
    if (fixed) { setStatus(fixed); return { ok: false as const, status: fixed }; }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        const next = permission === 'denied' ? 'denied' : 'off';
        setStatus(next);
        return { ok: false as const, status: next };
      }
      await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        try {
          subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        } catch (error) {
          // 以前の鍵で登録されていた場合は作り直す。
          const old = await registration.pushManager.getSubscription();
          if (!old) throw error;
          await old.unsubscribe();
          subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        }
      }
      await callApi('POST', { subscription: subscription.toJSON() });
      setStatus('on');
      return { ok: true as const, status: 'on' as const };
    } catch {
      setStatus('off');
      return { ok: false as const, status: 'off' as const };
    } finally {
      setBusy(false);
    }
  }, [baseStatus]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await findPushRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await callApi('DELETE', { endpoint: subscription.endpoint }).catch(() => undefined);
        await subscription.unsubscribe().catch(() => false);
      }
      await registration?.unregister().catch(() => false);
      setStatus('off');
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, enable, disable };
}

/**
 * ログアウト前の後片付け：この端末の通知の登録を解除し、サーバー側の登録も消す。
 * ログアウトを止めないよう、失敗しても投げず、最大 timeoutMs で打ち切る。
 */
export async function cleanupThisDevicePushOnLogout(timeoutMs = 3000): Promise<void> {
  if (!pushSupported()) return;
  const work = (async () => {
    const registration = await findPushRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    // サーバー側の削除にはログイン中のトークンが要るので、サインアウトより前に呼ぶ。
    await callApi('DELETE', { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  })().catch(() => undefined);
  await Promise.race([work, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
}
