'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    fetch('/api/auth/recovery-email', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(response => {
        if (!response.ok) throw new Error('verification-failed');
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        {status === 'loading' && <><Loader2 className="mx-auto animate-spin text-indigo-600" size={44} /><h1 className="mt-4 text-xl font-black">確認しています</h1></>}
        {status === 'success' && <><CheckCircle2 className="mx-auto text-emerald-500" size={48} /><h1 className="mt-4 text-xl font-black">メールを登録しました</h1><p className="mt-3 text-sm font-bold text-slate-500">パスワードを忘れたときに、このメールを利用できます。</p></>}
        {status === 'error' && <><XCircle className="mx-auto text-red-500" size={48} /><h1 className="mt-4 text-xl font-black">確認できませんでした</h1><p className="mt-3 text-sm font-bold text-slate-500">リンクが期限切れです。設定画面からもう一度送信してください。</p></>}
        {status !== 'loading' && <Link href="/" className="mt-6 inline-flex rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white">アプリへ戻る</Link>}
      </div>
    </main>
  );
}
