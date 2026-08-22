'use client';

import { useRef, useState } from 'react';
import { User as FirebaseUser, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { LogIn, Loader2, User, AlertCircle, Eye, EyeOff, Lock, ArrowRight, GraduationCap } from 'lucide-react';
import Link from 'next/link';

const EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'];
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
  if (['attendance_admin', 'attendance_only', 'attendance_manager'].includes(r)) return 'teacher';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  if (r === 'parent' || r === 'guardian') return 'parent';
  return 'student';
};

const targetPathByRole = (role: string) => {
  return '/apps';
};

const cacheProfileForAuthContext = (uid: string, profile: Record<string, any>) => {
  try {
    sessionStorage.setItem(`classbase_profile_cache:${uid}`, JSON.stringify({ profile, cachedAt: Date.now() }));
  } catch {}
};

const LOGIN_FLOW_LOCK_KEY = 'classbase_login_flow_lock';
const LOGIN_CREDENTIAL_ERROR_MESSAGE =
  'ログインIDまたはパスワードが一致しません。\n案内書面に記載されているID・初期パスワードをもう一度確認してください。\n英数字は半角で入力し、余分なスペースが入っていないかも確認してください。';

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
  const isValidLoginId = (s: string) => /^[0-9A-Za-z_-]+$/.test(s);
  const buildLoginEmails = (id: string) => {
    const idCandidates = Array.from(new Set([id, id.toLowerCase(), id.toUpperCase()]));
    return idCandidates.flatMap(candidate => EMAIL_DOMAINS.map(domain => `${candidate}@${domain}`));
  };

  const firstLoginViaApi = async (lifetimeId: string, pass: string) => {
    const res = await fetch('/api/first-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifetimeId, password: pass }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      // APIが返す理由をそのままユーザー向けに変換
      if (data?.error === 'not-registered') throw new Error('登録データが見つかりません。');
      if (data?.error === 'wrong-initial-password') throw new Error(LOGIN_CREDENTIAL_ERROR_MESSAGE);
      if (data?.error === 'missing-initial-password') throw new Error('初回パスワードが未設定です。管理者に連絡してください。');
      throw new Error('初回登録処理に失敗しました。');
    }

    return data; // { ok:true, uid, email }
  };

  const repairProfileViaApi = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
    const res = await fetch('/api/auth/repair-profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'ユーザー情報の自動修復に失敗しました。');
    return data;
  };

  const redirectLoggedInUser = async (firebaseUser: FirebaseUser) => {
    const userDocRef = doc(db, 'users', firebaseUser.uid);
    let snap = await getDoc(userDocRef);

    if (!snap.exists()) {
      await repairProfileViaApi();
      snap = await getDoc(userDocRef);
    }

    if (!snap.exists()) {
      throw new Error('データベース上にユーザー情報が見つかりません。');
    }

    const role = normalizeRole(snap.data().role);

    if (role === 'admin' || role === 'master') {
      await firebaseSignOut(auth);
      throw new Error('管理者アカウントは、画面下部の「管理者ログイン」からログインしてください。');
    }

    cacheProfileForAuthContext(firebaseUser.uid, { ...snap.data(), uid: firebaseUser.uid, role });
    sessionStorage.removeItem(LOGIN_FLOW_LOCK_KEY);
    window.location.replace(targetPathByRole(role));
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
      setErrorMsg('ログインIDは半角英数字で入力してください');
      setLoading(false);
      return;
    }

    const loginEmails = buildLoginEmails(id);

    try {
      sessionStorage.setItem(LOGIN_FLOW_LOCK_KEY, 'true');
      let loggedInUser: FirebaseUser | null = null;
      // 1) まず通常ログイン
      try {
        let lastSignInError: any = null;
        for (const email of loginEmails) {
          try {
            const credential = await signInWithEmailAndPassword(auth, email, resolvedPassword);
            loggedInUser = credential.user;
            break;
          } catch (candidateError: any) {
            lastSignInError = candidateError;
            if (!['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(candidateError?.code)) {
              throw candidateError;
            }
          }
        }
        if (!loggedInUser) throw lastSignInError;
      } catch (signInError: any) {
        const code = signInError?.code;

        // 初回ユーザー・Auth側だけ古いユーザーは invalid-credential / wrong-password になることがある
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
          // 2) 初回登録APIを試す（ここで initial_password が一致しないなら弾かれる）
          const restored = await firstLoginViaApi(id, resolvedPassword);

          // 3) 作成/復旧できたら改めてログイン
          const credential = await signInWithEmailAndPassword(auth, restored.email || loginEmails[0], resolvedPassword);
          loggedInUser = credential.user;
        } else {
          throw signInError;
        }
      }
      if (loggedInUser) await redirectLoggedInUser(loggedInUser);
    } catch (e: any) {
      console.error('Login Error:', e);

      let message = 'ログイン中にエラーが発生しました。';
      // Firebase Auth側エラー
      if (e?.code === 'auth/invalid-credential' || e?.code === 'auth/user-not-found' || e?.code === 'auth/wrong-password') {
        message = LOGIN_CREDENTIAL_ERROR_MESSAGE;
      } else if (e?.code === 'auth/too-many-requests') {
        message = '試行回数が多すぎます。しばらく待ってください。';
      } else if (e?.code === 'auth/network-request-failed') {
        message = 'ネットワークエラーです。通信環境をご確認ください。';
      } else if (e?.message) {
        // 初回API由来、または権限チェック時の分かりやすいメッセージ
        message = e.message;
      }

      setErrorMsg(message);
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
          <p className="text-xs font-black tracking-[0.2em] text-indigo-600">SOZO GAKUEN</p>
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
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 font-bold text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-800 disabled:opacity-70"
          >
            {loading ? <Loader2 className="animate-spin" /> : (<><LogIn size={20} /> ログイン</>)}
          </button>
          <Link
            href="/password-reset"
            className="flex items-center justify-center text-sm font-bold text-indigo-600 hover:text-indigo-800"
          >
            パスワードを忘れた方
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
