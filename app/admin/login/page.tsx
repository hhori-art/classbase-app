'use client';

import { useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Lock, Loader2, Wrench, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { loadAuthenticatedProfile } from '@/lib/client-auth-profile';
import { signInWithNetworkRetry } from '@/lib/client-auth-login';

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
        setStatus(`❌ ${LOGIN_CREDENTIAL_ERROR_MESSAGE}`);
      } else if (error.code === 'auth/user-disabled') {
        setStatus('❌ このアカウントは停止中です。管理者に確認してください');
      } else if (error.code === 'auth/network-request-failed') {
        setStatus('❌ 認証サーバーへ接続できませんでした。通信環境を確認して、もう一度お試しください。改善しない場合は、校舎名・端末・発生時刻をお知らせください。');
      } else if (error.message === 'profile-service-unavailable' || error.name === 'AbortError') {
        setStatus('❌ 認証は完了しましたが、ユーザー情報の取得に失敗しました。少し待ってから、もう一度お試しください。');
      } else {
        setStatus(`❌ エラー: ${error.message || '不明なエラーが発生しました'}`);
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-lg border-t-4 border-blue-600">
        <div className="text-center mb-8">
          <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="text-blue-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">管理者ログイン</h1>
          <p className="text-xs text-blue-600 font-bold mt-2 bg-blue-50 py-1 px-2 rounded inline-block">
            <Wrench className="inline w-3 h-3 mr-1"/>
            校舎管理者・マスター管理者
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">メールアドレス または 初期ID</label>
            <input 
              type="text" 
              required
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">パスワード</label>
            <input 
              type="password" 
              required
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {status && (
            <div className="whitespace-pre-line break-words rounded-lg bg-red-100 p-3 text-center text-sm font-bold text-red-700" role="alert">
              {status}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'ログイン'}
          </button>
        </form>

        <div className="mt-6 text-center pt-6 border-t border-gray-100">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1 font-bold">
            <ArrowLeft size={16}/> ログイン画面へ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
