'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';

export default function PasswordResetConfirmPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) return setError('確認用パスワードが一致しません。');
    if (password.length < 10) return setError('パスワードは10文字以上で入力してください。');
    setSaving(true);
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(['invalid-token', 'token-used', 'token-expired'].includes(data.error)
          ? 'このリンクは無効または期限切れです。再度お申し込みください。'
          : 'パスワードを変更できませんでした。');
      }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'パスワードを変更できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        {complete ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
            <h1 className="mt-4 text-xl font-black text-slate-900">変更しました</h1>
            <p className="mt-3 text-sm font-bold text-slate-600">新しいパスワードでログインしてください。</p>
            <Link href="/" className="mt-6 inline-flex rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white">ログインへ</Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600"><KeyRound size={24} /></div>
              <div>
                <h1 className="text-xl font-black text-slate-900">新しいパスワード</h1>
                <p className="mt-1 text-xs font-bold text-slate-500">10文字以上で設定してください</p>
              </div>
            </div>
            <form onSubmit={submit} className="mt-7 space-y-4">
              <input required type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="新しいパスワード" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input required type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="もう一度入力" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</p>}
              <button disabled={saving || !token} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving && <Loader2 size={18} className="animate-spin" />} パスワードを変更する
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

