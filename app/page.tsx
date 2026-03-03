'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { LogIn, Loader2, User, AlertCircle, Eye, EyeOff, Lock, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const firstLoginViaApi = async (lifetimeId: string, email: string, pass: string) => {
    const res = await fetch('/api/first-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifetimeId, email, password: pass }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      if (data?.error === 'not-registered') throw new Error('登録データが見つかりません。');
      if (data?.error === 'wrong-initial-password') throw new Error('パスワードが間違っています。');
      throw new Error('初回登録処理に失敗しました。');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const input = loginInput.trim();
    if (!input) {
      setErrorMsg('IDを入力してください');
      setLoading(false);
      return;
    }

    const isId = !input.includes('@');
    const lifetimeId = input;
    const email = isId ? `${input}@sozogakuen.co.jp` : input;

    try {
      try {
        await signInWithEmailAndPassword(auth, email, password);
        setLoading(false);
        return;
      } catch (signInError: any) {
        const code = signInError?.code;
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          await firstLoginViaApi(lifetimeId, email, password);
          await signInWithEmailAndPassword(auth, email, password);
          setLoading(false);
          return;
        }
        throw signInError;
      }
    } catch (e: any) {
      console.error('Login Error:', e);

      let message = 'ログイン中にエラーが発生しました。';
      if (e?.code === 'auth/wrong-password') message = 'パスワードが間違っています。';
      else if (e?.code === 'auth/too-many-requests') message = '試行回数が多すぎます。しばらく待ってください。';
      else if (e?.code === 'auth/invalid-email') message = 'メールアドレス（ID）の形式が正しくありません。';
      else if (e?.code === 'auth/user-disabled') message = 'このアカウントは無効化されています。';
      else if (e?.code === 'auth/network-request-failed') message = 'ネットワークエラーです。';
      else if (e?.message === '登録データが見つかりません。') message = '指定されたIDは登録されていません。';
      else if (e?.message === 'パスワードが間違っています。') message = '初回パスワードが間違っています。';

      setErrorMsg(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-blue-50 px-4 font-sans text-slate-600">
      <div className="bg-white/80 backdrop-blur-sm w-full max-w-md p-8 md:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50">
        <div className="text-center mb-10">
          <div className="relative w-24 h-24 mx-auto mb-6 shadow-xl rounded-2xl overflow-hidden transform -rotate-3 bg-white p-2 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="理社講座ロゴ" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">理社講座 ログイン</h1>
          <p className="text-slate-500 text-sm mt-2 font-medium">学ぶ、つながる、未来を創る</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">ID (生涯番号)</label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={20} />
              <input
                type="text"
                required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-mono text-lg text-slate-700"
                placeholder="12345678"
                value={loginInput}
                onChange={e => setLoginInput(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">パスワード</label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all text-lg text-slate-700"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 text-sm p-4 rounded-2xl font-bold border border-red-100 flex items-start gap-3">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div className="whitespace-pre-wrap leading-relaxed">{errorMsg}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="animate-spin" /> : (<><LogIn size={20} /> ログイン</>)}
          </button>
        </form>

        <div className="mt-10 text-center border-t border-slate-100 pt-6">
          <Link href="/admin/login" className="group inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors px-4 py-2 rounded-full hover:bg-indigo-50">
            <User size={14} className="group-hover:scale-110 transition-transform" />
            管理者ログイン (Master)
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}