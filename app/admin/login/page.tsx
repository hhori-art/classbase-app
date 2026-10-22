'use client';

import { useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Lock, Wrench, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { loadAuthenticatedProfile } from '@/lib/client-auth-profile';
import { signInWithNetworkRetry } from '@/lib/client-auth-login';
import { Button } from '@/app/components/ui';

const normalizeLoginInput = (value: string) =>
  value.trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const LOGIN_CREDENTIAL_ERROR_MESSAGE =
  'ログインIDまたはパスワードが一致しません。\n案内書面に記載されているID・初期パスワードをもう一度確認してください。\n英数字は半角で入力し、余分なスペースが入っていないかも確認してください。';

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
const ATTENDANCE_ADMIN_ROLE_ALIASES = ['attendance_admin', 'attendance_only', 'attendance_manager'];

const buildLoginCandidates = (value: string) => {
  const normalized = normalizeLoginInput(value);
  if (!normalized) return [];

  const candidates: string[] = [];
  if (normalized.includes('@')) {
    candidates.push(normalized);
    const [localPart] = normalized.split('@');
    if (localPart) {
      candidates.push(`${localPart}@classbase.local`);
      candidates.push(`${localPart}@sozogakuen.co.jp`);
    }
  } else {
    candidates.push(`${normalized}@classbase.local`);
    candidates.push(`${normalized}@sozogakuen.co.jp`);
  }

  return Array.from(new Set(candidates));
};

const adminFirstLogin = async (login: string, pass: string) => {
  const res = await fetch('/api/admin/first-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: pass }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    if (data.error === 'not-registered') throw new Error('管理者登録データが見つかりません。');
    if (data.error === 'not-admin') throw new Error('このアカウントは管理者権限ではありません。');
    if (data.error === 'wrong-password') throw new Error(LOGIN_CREDENTIAL_ERROR_MESSAGE);
    throw new Error(data.error || '管理者Auth復旧に失敗しました。');
  }
  return data as { ok: true; email: string };
};

const cacheProfileForAuthContext = (uid: string, profile: Record<string, any>) => {
  try {
    sessionStorage.setItem(`classbase_profile_cache:${uid}`, JSON.stringify({ profile, cachedAt: Date.now() }));
  } catch {}
};

const loadAdminProfile = async (firebaseUser: FirebaseUser) => {
  const data = await loadAuthenticatedProfile(firebaseUser);
  const role = String(data.role || '').toLowerCase();
  if (role !== 'master' && !ADMIN_ROLE_ALIASES.includes(role) && !ATTENDANCE_ADMIN_ROLE_ALIASES.includes(role)) {
    throw new Error('このアカウントは管理者権限ではありません。');
  }
  const normalizedRole = role === 'master' ? 'master' : ATTENDANCE_ADMIN_ROLE_ALIASES.includes(role) ? 'attendance_admin' : 'admin';
  cacheProfileForAuthContext(firebaseUser.uid, { ...data, uid: firebaseUser.uid, role: normalizedRole });
  return normalizedRole;
};

export default function AutoFixLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('');

    try {
      // 1. Firebase Auth認証
      const loginCandidates = buildLoginCandidates(email);
      let userCredential;
      let lastAuthError: any = null;

      for (const candidate of loginCandidates) {
        try {
          userCredential = await signInWithNetworkRetry(auth, candidate, password);
          break;
        } catch (authError: any) {
          lastAuthError = authError;
          if (!['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(authError?.code)) {
            throw authError;
          }
        }
      }

      if (!userCredential) {
        const restored = await adminFirstLogin(email, password);
        userCredential = await signInWithNetworkRetry(auth, restored.email, password);
      }
      const normalizedRole = await loadAdminProfile(userCredential.user);
      window.location.replace(normalizedRole === 'attendance_admin' ? '/master/attendance' : '/master');

    } catch (error: any) {
      console.error('Login Error:', error);
      
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        setStatus(`${LOGIN_CREDENTIAL_ERROR_MESSAGE}`);
      } else if (error.code === 'auth/user-disabled') {
        setStatus('このアカウントは停止中です。管理者に確認してください');
      } else if (error.code === 'auth/network-request-failed') {
        setStatus('認証サーバーへ接続できませんでした。通信環境を確認して、もう一度お試しください。改善しない場合は、校舎名・端末・発生時刻をお知らせください。');
      } else if (error.message === 'profile-service-unavailable' || error.name === 'AbortError') {
        setStatus('認証は完了しましたが、ユーザー情報の取得に失敗しました。少し待ってから、もう一度お試しください。');
      } else {
        setStatus(`エラー: ${error.message || '不明なエラーが発生しました'}`);
      }
      setLoading(false);
    }
  };

  return (
    <div data-portal="admin" className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-card border-t-4 border-accent bg-white p-8 shadow-lg">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
            <Lock className="text-accent" size={32} aria-hidden />
          </div>
          <h1 className="text-2xl font-black text-slate-800">管理者ログイン</h1>
          <p className="mt-2 inline-block rounded-btn bg-accent-soft px-2 py-1 text-xs font-bold text-accent">
            <Wrench className="mr-1 inline h-3 w-3" aria-hidden />
            校舎管理者・マスター管理者
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="admin-login-id" className="mb-2 block text-sm font-bold text-slate-700">メールアドレス または 初期ID</label>
            <input 
              id="admin-login-id"
              type="text" 
              required
              autoComplete="username"
              className="min-h-11 w-full rounded-input border border-line px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="admin-login-password" className="mb-2 block text-sm font-bold text-slate-700">パスワード</label>
            <input 
              id="admin-login-password"
              type="password" 
              required
              autoComplete="current-password"
              className="min-h-11 w-full rounded-input border border-line px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {status && (
            <div className="whitespace-pre-line break-words rounded-btn border border-rose-200 bg-rose-50 p-3 text-center text-sm font-bold text-rose-700" role="alert">
              {status}
            </div>
          )}

          <Button type="submit" size="lg" fullWidth loading={loading}>
            ログイン
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-6 text-center">
          <Link href="/" className="flex items-center justify-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
            <ArrowLeft size={16} aria-hidden /> ログイン画面へ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
