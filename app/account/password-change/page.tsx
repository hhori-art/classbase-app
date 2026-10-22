'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { auth } from '@/lib/firebase';
import { targetPathForProfile } from '@/lib/auth-navigation';
import { minPasswordLength } from '@/lib/password-policy';

export default function RequiredPasswordChangePage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const minLength = minPasswordLength(profile?.role);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !profile) return setMessage('ログイン情報を確認できません。画面を再読み込みしてください。');
    if (password.length < minLength) return setMessage(`パスワードは${minLength}文字以上で入力してください。`);
    if (password !== confirmation) return setMessage('確認用パスワードが一致しません。');
    setSaving(true);
    setMessage('');
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || 'password-change-failed');
      if (!user.email) throw new Error('missing-auth-email');
      sessionStorage.removeItem(`classbase_profile_cache:${user.uid}`);
      const credential = await signInWithEmailAndPassword(auth, user.email, password);
      await credential.user.getIdToken(true);
      window.location.replace(targetPathForProfile({ ...profile, isFirstLogin: false }));
    } catch (error) {
      console.error('Required password change failed:', error);
      setMessage('パスワードを変更できませんでした。通信環境を確認して、もう一度お試しください。');
      setSaving(false);
    }
  };

  if (authLoading || !user || !profile) return <main className="min-h-dvh bg-slate-50" aria-busy="true" />;

  return <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-100 text-indigo-700"><LockKeyhole size={28} /></div>
      <h1 className="mt-5 text-center text-2xl font-black text-slate-950">新しいパスワードを設定</h1>
      <p className="mt-2 text-center text-sm font-bold leading-6 text-slate-500">初回ログインを完了するため、{minLength}文字以上のパスワードへ変更してください。</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block"><span className="mb-2 block text-xs font-bold text-slate-700">新しいパスワード</span><div className="relative"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className="min-h-12 w-full rounded-xl border border-slate-200 px-4 pr-12 font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400" aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <label className="block"><span className="mb-2 block text-xs font-bold text-slate-700">確認用パスワード</span><input type={showPassword ? 'text' : 'password'} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" className="min-h-12 w-full rounded-xl border border-slate-200 px-4 font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
        {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{message}</p>}
        <button disabled={saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? <Loader2 className="animate-spin" size={18} /> : <LockKeyhole size={18} />}パスワードを変更して開始</button>
      </form>
    </section>
  </main>;
}
