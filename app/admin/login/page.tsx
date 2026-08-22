'use client';

import { useState } from 'react';
import { User as FirebaseUser, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Lock, Loader2, Wrench, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

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

const repairProfile = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
  const res = await fetch('/api/auth/repair-profile', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'profile repair failed');
  return data;
};

const loadAdminProfile = async (firebaseUser: FirebaseUser) => {
  let snap = await getDoc(doc(db, 'users', firebaseUser.uid));
  if (!snap.exists()) {
    await repairProfile();
    snap = await getDoc(doc(db, 'users', firebaseUser.uid));
  }
  if (!snap.exists()) throw new Error('管理者プロフィールが見つかりません。');

  const data = snap.data();
  const role = String(data.role || '').toLowerCase();
  if (role !== 'master' && !ADMIN_ROLE_ALIASES.includes(role)) {
    throw new Error('このアカウントは管理者権限ではありません。');
  }
  const normalizedRole = role === 'master' ? 'master' : 'admin';
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
    setStatus('🚀 1/3: 認証を開始します...');

    try {
      // 1. Firebase Auth認証
      const loginCandidates = buildLoginCandidates(email);
      let userCredential;
      let lastAuthError: any = null;

      for (const candidate of loginCandidates) {
        try {
          userCredential = await signInWithEmailAndPassword(auth, candidate, password);
          break;
        } catch (authError: any) {
          lastAuthError = authError;
          if (!['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(authError?.code)) {
            throw authError;
          }
        }
      }

      if (!userCredential) {
        setStatus('⚠️ Auth未登録またはメール形式違いの可能性があります。管理者データを確認中...');
        const restored = await adminFirstLogin(email, password);
        userCredential = await signInWithEmailAndPassword(auth, restored.email, password);
      }
      setStatus('✅ 2/3: 認証成功。権限を確認中...');
      const role = await loadAdminProfile(userCredential.user);
      setStatus('✅ 3/3: 権限確認OK。画面を移動します...');
      window.location.replace('/master');

    } catch (error: any) {
      console.error('Login Error:', error);
      
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        setStatus(`❌ ${LOGIN_CREDENTIAL_ERROR_MESSAGE}`);
      } else if (error.code === 'auth/user-disabled') {
        setStatus('❌ このアカウントは停止中です。管理者に確認してください');
      } else if (error.code === 'auth/network-request-failed') {
        setStatus('❌ 通信に失敗しました。通信環境を確認して、もう一度お試しください。');
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

          <div className={`p-3 rounded-lg text-sm font-bold text-center break-words ${
            status.includes('❌') ? 'bg-red-100 text-red-700' :
            status.includes('✨') || status.includes('3/3') ? 'bg-green-100 text-green-700' :
            status.includes('🚀') || status.includes('⚠️') || status.includes('2/3') ? 'bg-yellow-50 text-yellow-700' :
            'bg-gray-50 text-gray-500'
          }`}>
            {status || '管理者情報を入力してください'}
          </div>

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
