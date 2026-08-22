'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ArrowLeft, ExternalLink, Loader2, MonitorPlay } from 'lucide-react';

declare global {
  interface Window {
    ZoomMtgEmbedded?: {
      createClient: () => {
        init: (options: Record<string, unknown>) => Promise<void>;
        join: (options: Record<string, unknown>) => Promise<void>;
      };
    };
  }
}

const ZOOM_SDK_VERSION = process.env.NEXT_PUBLIC_ZOOM_MEETING_SDK_VERSION || '6.2.0';
const ZOOM_SIGNATURE_TIMEOUT_MS = 8000;
const cleanMeetingId = (value: unknown) => String(value || '').replace(/[\s-]/g, '').trim();

const fetchJsonWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    window.clearTimeout(timer);
  }
};

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === 'true') {
    resolve();
    return;
  }
  if (existing) {
    existing.addEventListener('load', () => resolve(), { once: true });
    existing.addEventListener('error', () => reject(new Error(`script load failed: ${src}`)), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = false;
  script.onload = () => {
    script.dataset.loaded = 'true';
    resolve();
  };
  script.onerror = () => reject(new Error(`script load failed: ${src}`));
  document.head.appendChild(script);
});

async function loadZoomMeetingSdk() {
  const base = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;
  await loadScript(`${base}/lib/vendor/react.min.js`);
  await loadScript(`${base}/lib/vendor/react-dom.min.js`);
  await loadScript(`${base}/lib/vendor/redux.min.js`);
  await loadScript(`${base}/lib/vendor/redux-thunk.min.js`);
  await loadScript(`${base}/lib/vendor/lodash.min.js`);
  await loadScript(`https://source.zoom.us/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
  if (!window.ZoomMtgEmbedded) throw new Error('Zoom Meeting SDKを読み込めませんでした');
  return window.ZoomMtgEmbedded;
}

const waitForAuthUser = () => new Promise<User>((resolve, reject) => {
  if (auth.currentUser) {
    resolve(auth.currentUser);
    return;
  }

  let unsubscribe = () => {};

  const timer = window.setTimeout(() => {
    unsubscribe();
    reject(new Error('ログイン情報を確認できません。もう一度ログインしてから参加してください。'));
  }, 8000);

  unsubscribe = onAuthStateChanged(auth, currentUser => {
    if (!currentUser) return;
    window.clearTimeout(timer);
    unsubscribe();
    resolve(currentUser);
  }, error => {
    window.clearTimeout(timer);
    unsubscribe();
    reject(error);
  });
});

export default function ZoomMeetingPage() {
  const params = useSearchParams();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const joinedRef = useRef(false);
  const [status, setStatus] = useState('Zoom Meeting SDKを準備しています...');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const meetingNumber = cleanMeetingId(params.get('meetingNumber') || params.get('mn'));
  const password = String(params.get('pwd') || '');
  const classId = String(params.get('classId') || '');
  const userName = String(params.get('name') || 'Classbase User');
  const fallbackUrl = useMemo(() => {
    if (!meetingNumber) return 'https://zoom.us/';
    const url = new URL(`https://zoom.us/j/${meetingNumber}`);
    if (password) url.searchParams.set('pwd', password);
    return url.toString();
  }, [meetingNumber, password]);

  useEffect(() => {
    let cancelled = false;

    const join = async () => {
      if (!meetingNumber || !rootRef.current || joinedRef.current) return;
      joinedRef.current = true;
      setJoining(true);
      setError('');
      try {
        setStatus('ログイン情報を確認しています...');
        const user = await waitForAuthUser();
        const token = await user.getIdToken();

        setStatus('Zoom署名を取得しています...');
        const { response: signatureRes, data: signatureData } = await fetchJsonWithTimeout('/api/zoom/meeting-sdk-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ meetingNumber, role: 0 }),
        }, ZOOM_SIGNATURE_TIMEOUT_MS);
        if (!signatureRes.ok || signatureData.ok === false) {
          throw new Error(signatureData.error || 'Zoom署名の取得に失敗しました');
        }

        setStatus('Zoom画面を読み込んでいます...');
        const ZoomMtgEmbedded = await loadZoomMeetingSdk();
        if (cancelled || !rootRef.current) return;

        const client = ZoomMtgEmbedded.createClient();
        await client.init({
          zoomAppRoot: rootRef.current,
          language: 'ja-JP',
          patchJsMedia: true,
          customize: {
            meetingInfo: ['topic', 'host', 'mn', 'pwd'],
            toolbar: { buttons: [] },
          },
        });
        await client.join({
          sdkKey: signatureData.sdkKey,
          signature: signatureData.signature,
          meetingNumber,
          password,
          userName,
        });
        if (cancelled) return;
        setStatus('Zoomに参加中です');

        await fetch('/api/class-participation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            target_date: new Date().toISOString().slice(0, 10),
            class_id: classId || meetingNumber,
            source: 'zoom_meeting_sdk',
          }),
        }).catch(() => {});
      } catch (err: any) {
        console.error(err);
        if (!cancelled) {
          joinedRef.current = false;
          const message = err?.name === 'AbortError'
            ? 'Zoom署名の取得がタイムアウトしました。外部リンクからZoomを開いてください。'
            : err?.message || 'Zoomの埋め込みに失敗しました';
          setError(message);
          setStatus('参加リンクから開いてください');
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    };

    join();
    return () => {
      cancelled = true;
    };
  }, [classId, meetingNumber, password, userName]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <Link href="/student" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white">
          <ArrowLeft size={16} /> 戻る
        </Link>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-black">Zoom授業</p>
          <p className="text-xs font-bold text-white/50">{status}</p>
        </div>
        <a href={fallbackUrl} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-slate-950">
          <ExternalLink size={16} /> 外部
        </a>
      </div>

      {error && (
        <div className="mx-auto mt-4 max-w-3xl rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
          <p>{error}</p>
          <p className="mt-2 text-xs text-amber-100/80">
            Meeting SDKの認証情報が未設定、またはZoom側でMeeting SDK埋め込みが有効になっていない可能性があります。
          </p>
          <a href={fallbackUrl} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950">
            <ExternalLink size={16} /> Zoomを外部で開く
          </a>
        </div>
      )}

      <div className="relative h-[calc(100vh-65px)]">
        {joining && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950">
            <Loader2 className="animate-spin text-sky-300" size={36} />
            <p className="text-sm font-black text-white/70">{status}</p>
          </div>
        )}
        {!meetingNumber ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
            <MonitorPlay size={48} />
            <p className="text-sm font-black">ミーティングIDが見つかりません</p>
          </div>
        ) : (
          <div ref={rootRef} id="meetingSDKElement" className="h-full w-full bg-slate-900" />
        )}
      </div>
    </div>
  );
}
