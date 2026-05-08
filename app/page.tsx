'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, User, AlertCircle, Eye, EyeOff, Lock, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const EMAIL_DOMAIN = 'sozogakuen.co.jp';
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

const normalizeRole = (role: any) => {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'parent' || r === 'guardian') return 'parent';
  if (r === 'master') return 'master';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  return 'student';
};

const targetPathByRole = (role: string) => {
  if (role === 'teacher') return '/teacher';
  if (role === 'parent') return '/parent';
  if (role === 'master' || role === 'admin') return '/master';
  return '/student';
};

export default function LoginPage() {
  const router = useRouter();
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isNumericId = (s: string) => /^[0-9]+$/.test(s);

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
      if (data?.error === 'wrong-initial-password') throw new Error('IDまたはパスワードが間違っています。');
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const id = loginInput.trim();

    if (!id) {
      setErrorMsg('生涯番号（数字）を入力してください');
      setLoading(false);
      return;
    }
    if (!isNumericId(id)) {
      setErrorMsg('生涯番号は数字のみで入力してください');
      setLoading(false);
      return;
    }

    const email = `${id}@${EMAIL_DOMAIN}`;

    try {
      let loggedInUser;

      // 1) まず通常ログイン
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        loggedInUser = userCredential.user;
      } catch (signInError: any) {
        const code = signInError?.code;

        // ★重要：初回ユーザーは user-not-found ではなく invalid-credential が返ることがある
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          // 2) 初回登録APIを試す（ここで initial_password が一致しないなら弾かれる）
          await firstLoginViaApi(id, password);

          // 3) 作成/復旧できたら改めてログイン
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          loggedInUser = userCredential.user;
        } else {
          throw signInError;
        }
      }

      // 4) ログイン成功後、Firestoreからroleを取得してリダイレクト
      if (loggedInUser) {
        // ※ Firestoreに 'users' コレクションがあり、ドキュメントIDがuidであることを想定
        const userDocRef = doc(db, 'users', loggedInUser.uid);
        let userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          await repairProfileViaApi();
          userDocSnap = await getDoc(userDocRef);
        }

        if (userDocSnap.exists()) {
          const role = normalizeRole(userDocSnap.data().role);
          const target = targetPathByRole(role);
          router.replace(target);
          setTimeout(() => { window.location.href = target; }, 800);
        } else {
          throw new Error('データベース上にユーザー情報が見つかりません。');
        }
      }

    } catch (e: any) {
      console.error('Login Error:', e);

      let message = 'ログイン中にエラーが発生しました。';
      // Firebase Auth側エラー
      if (e?.code === 'auth/invalid-credential' || e?.code === 'auth/wrong-password') {
        message = 'IDまたはパスワードが間違っています。';
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
          <p className="text-slate-500 text-sm mt-2 font-medium">生涯番号（数字）でログイン</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
              生涯番号（数字のみ）
            </label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={20} />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-mono text-lg text-slate-700"
                placeholder="13040463"
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
            管理者ログイン
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}
