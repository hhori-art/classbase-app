'use client';

import { useRef, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { LogIn, Loader2, User, AlertCircle, Eye, EyeOff, Lock, ArrowRight, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { targetPathForProfile } from '@/lib/auth-navigation';
import { loadAuthenticatedProfile } from '@/lib/client-auth-profile';
import { LoginError, loginWithServer, retryAfterLabel } from '@/lib/client-auth-login';

const ADMIN_ROLE_ALIASES = [
  'admin',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
];

const normalizeRole = (role: any): 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin' => {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'master') return 'master';
  if (['attendance_admin', 'attendance_only', 'attendance_manager'].includes(r)) return 'attendance_admin';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  if (r === 'parent' || r === 'guardian') return 'parent';
  return 'student';
};

const cacheProfileForAuthContext = (uid: string, profile: Record<string, any>) => {
  try {
    sessionStorage.setItem(`classbase_profile_cache:${uid}`, JSON.stringify({ profile, cachedAt: Date.now() }));
  } catch {}
};

const LOGIN_FLOW_LOCK_KEY = 'classbase_login_flow_lock';
const LOGIN_CREDENTIAL_ERROR_MESSAGE =
  'ログインIDまたはパスワードが一致しません。\n案内書面に記載されているID・初期パスワードをもう一度確認してください。\n英数字は半角で入力し、余分なスペースが入っていないかも確認してください。';

function loginErrorMessage(error: any) {
  const code = error instanceof LoginError ? error.code : String(error?.code || '');
  if (code === 'wrong-password' || code === 'not-registered' || code === 'auth/invalid-credential') return LOGIN_CREDENTIAL_ERROR_MESSAGE;
  if (code === 'too-many-attempts') {
    return `ログインに続けて失敗したため、しばらくログインできません。${retryAfterLabel(error?.retryAfterSeconds)}ほど待ってから、もう一度お試しください。\n急ぐときは、校舎またはサポート窓口（078-321-4123）でロックを解いてもらえます。`;
  }
  if (code === 'account-inactive' || code === 'auth/user-disabled') return 'このアカウントは停止中です。校舎または管理者へお問い合わせください。';
  if (code === 'id-invalid-format') return 'ログインIDは半角英数字（またはメールアドレス）で入力してください';
  if (code === 'auth/network-request-failed') return '認証サーバーへ接続できませんでした。通信環境を確認して、もう一度ログインしてください。改善しない場合は、校舎名・端末・発生時刻を管理者へお知らせください。';
  if (error?.message === 'profile-service-unavailable' || error?.name === 'AbortError') return '認証は完了しましたが、ユーザー情報の取得に失敗しました。少し待ってからもう一度ログインしてください。';
  return 'ログインの処理に失敗しました。少し待ってからもう一度お試しください。改善しない場合は、ログインIDと発生時刻を管理者へお知らせください。';
}

export default function LoginPage() {
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const loginInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const normalizeLoginId = (value: string) =>
    String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .trim();
  // 職員番号・生徒番号（半角英数字）か、メールアドレスで登録した職員のメールアドレス。
  const isEmailLogin = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const isValidLoginId = (s: string) => /^[0-9A-Za-z_-]+$/.test(s) || isEmailLogin(s);

  const redirectLoggedInUser = async (firebaseUser: FirebaseUser) => {
    const profile = await loadAuthenticatedProfile(firebaseUser);
    const role = normalizeRole(profile.role);
    const normalizedProfile = { ...profile, uid: firebaseUser.uid, role };

    cacheProfileForAuthContext(firebaseUser.uid, normalizedProfile);
    sessionStorage.removeItem(LOGIN_FLOW_LOCK_KEY);
    window.location.replace(targetPathForProfile(normalizedProfile));
  };

  const runLogin = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');

    const id = normalizeLoginId(loginInput || loginInputRef.current?.value || '');
    const resolvedPassword = password || passwordInputRef.current?.value || '';

    if (!id) {
      setErrorMsg('ログインIDを入力してください');
      setLoading(false);
      return;
    }
    if (!isValidLoginId(id)) {
      setErrorMsg('ログインIDは半角英数字（またはメールアドレス）で入力してください');
      setLoading(false);
      return;
    }

    try {
      sessionStorage.setItem(LOGIN_FLOW_LOCK_KEY, 'true');
      // パスワードはサーバーで確かめる（初回ログインもここで行う）。失敗が続くとロックされる。
      const { user: loggedInUser } = await loginWithServer(id, resolvedPassword);
      await redirectLoggedInUser(loggedInUser);
    } catch (e: any) {
      console.error('Login Error:', e?.code || e?.message);
      setErrorMsg(loginErrorMessage(e));
      setLoading(false);
      sessionStorage.removeItem(LOGIN_FLOW_LOCK_KEY);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await runLogin();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-blue-50 px-4 font-sans text-slate-600">
      <div className="w-full max-w-md rounded-3xl border border-white/50 bg-white/80 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-sm md:p-10">
        <div className="text-center mb-10">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-100">
            <GraduationCap size={50} strokeWidth={2.4} aria-hidden="true" />
          </div>
          <p className="text-xs font-bold tracking-[0.2em] text-indigo-600">SOZO GAKUEN</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-800">創造学園アプリ</h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
              ログインID
            </label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={20} />
              <input
                ref={loginInputRef}
                type="text"
                inputMode="text"
                pattern="[0-9A-Za-z_-]*"
                required
                className="w-full rounded-2xl border-2 border-transparent bg-slate-50 py-3.5 pl-12 pr-4 font-mono text-lg text-slate-700 outline-none transition-all focus:border-indigo-100 focus:bg-white focus:ring-4 focus:ring-indigo-50/50"
                placeholder="13040463 / 13040463P"
                value={loginInput}
                onChange={e => setLoginInput(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
              パスワード
            </label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={20} />
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                required
                className="w-full rounded-2xl border-2 border-transparent bg-slate-50 py-3.5 pl-12 pr-12 text-lg text-slate-700 outline-none transition-all focus:border-indigo-100 focus:bg-white focus:ring-4 focus:ring-indigo-50/50"
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
            onClick={(e) => {
              e.preventDefault();
              runLogin();
            }}
            disabled={loading}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 font-bold text-accent-ink shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : (<><LogIn size={20} /> ログイン</>)}
          </button>
          <Link
            href="/password-reset"
            className="flex items-center justify-center text-sm font-bold text-accent hover:text-accent-hover"
          >
            パスワードを忘れた方
          </Link>
          <Link href="/manual" className="flex items-center justify-center text-sm font-bold text-slate-500 hover:text-indigo-700">
            共通ログインマニュアル
          </Link>
        </form>

        <div className="mt-10 text-center border-t border-slate-100 pt-6">
          <Link href="/admin/login" className="group inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors px-4 py-2 rounded-full hover:bg-indigo-50">
            <User size={14} className="group-hover:scale-110 transition-transform" />
            管理者ログイン
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}
