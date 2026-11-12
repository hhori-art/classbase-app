'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, KeyRound, Loader2, TimerOff } from 'lucide-react';
import { userErrorMessage } from '@/lib/user-error';
import { BASIC_PASSWORD_MIN_LENGTH, passwordPolicyError } from '@/lib/password-policy';
import { PASSWORD_RESET_TTL_LABEL } from '@/lib/password-reset-rules';
import { PASSWORD_SUPPORT_HOURS, PASSWORD_SUPPORT_PHONE, selfServicePasswordResetEnabled } from '@/lib/password-reset-availability';

// リンクが使えないときの理由。どの場合も、新しいリンクの受け取り方を案内する。
const LINK_ERRORS: Record<string, string> = {
  'token-expired': `このリンクは有効期限（${PASSWORD_RESET_TTL_LABEL}）が切れています。`,
  'token-used': 'このリンクはすでに使われています。リンクは1回だけ使えます。',
  'token-revoked': '新しいリンクが発行されたため、このリンクは使えません。いちばん新しいリンクを使ってください。',
  'invalid-token': 'このリンクは使えません。',
};

export default function PasswordResetConfirmPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') || '';
    setToken(value);
    if (!value) setLinkError(LINK_ERRORS['invalid-token']);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) return setError('確認用パスワードが一致しません。');
    // 再設定は生徒・保護者・講師だけ（管理者は使えない）なので、8文字以上のきまりで先に確かめる。IDとの近さはサーバーで確かめる。
    const policyError = passwordPolicyError(password, 'student');
    if (policyError) return setError(policyError);
    setSaving(true);
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const code = String(data.code || data.error || '');
        if (LINK_ERRORS[code]) return setLinkError(LINK_ERRORS[code]);
        throw new Error(code === 'password-policy' && data.message ? data.message : 'パスワードを変更できませんでした。');
      }
      setComplete(true);
    } catch (cause) {
      setError(userErrorMessage(cause, 'パスワードを変更できませんでした。'));
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
            <Link href="/" className="mt-6 inline-flex rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white">ログインへ</Link>
          </div>
        ) : linkError ? (
          <div className="text-center">
            <TimerOff className="mx-auto text-amber-500" size={48} aria-hidden />
            <h1 className="mt-4 text-xl font-black text-slate-900">このリンクは使えません</h1>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-700">{linkError}</p>
            {selfServicePasswordResetEnabled() ? (
              <>
                <p className="mt-2 text-xs font-medium leading-6 text-slate-500">もう一度申し込むと、新しいリンクが届きます（有効期限{PASSWORD_RESET_TTL_LABEL}）。</p>
                <Link href="/password-reset" className="mt-5 inline-flex rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700">もう一度申し込む</Link>
              </>
            ) : (
              <p className="mt-2 text-xs font-medium leading-6 text-slate-500">新しいリンクが必要なときは、サポートセンター（{PASSWORD_SUPPORT_PHONE}、{PASSWORD_SUPPORT_HOURS}）へお電話ください。</p>
            )}
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-left text-xs font-medium leading-6 text-slate-600">
              校舎・サポートセンターから受け取ったリンクのときは、校舎またはサポートセンターに新しいリンクの発行を依頼してください。
            </p>
            <Link href="/" className="mt-4 inline-flex text-sm font-bold text-slate-500 underline">ログインへ戻る</Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600"><KeyRound size={24} /></div>
              <div>
                <h1 className="text-xl font-black text-slate-900">新しいパスワード</h1>
                <p className="mt-1 text-xs font-bold text-slate-500">{BASIC_PASSWORD_MIN_LENGTH}文字以上で設定してください（このリンクは1回だけ使えます）</p>
              </div>
            </div>
            <form onSubmit={submit} className="mt-7 space-y-4">
              <input required type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="新しいパスワード" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input required type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="もう一度入力" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</p>}
              <button disabled={saving || !token} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving && <Loader2 size={18} className="animate-spin" />} パスワードを変更する
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
