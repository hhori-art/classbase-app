'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  User,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export interface UserProfile {
  uid: string;
  role: 'student' | 'teacher' | 'master' | 'admin';
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  connectionIssue: boolean;
  profileMissing: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  connectionIssue: false,
  profileMissing: false,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const isLoginLikePath = (path: string) =>
  path === '/' || path === '/login' || path.includes('login') || path.startsWith('/admin/login');

const isDeniedPath = (path: string) => path === '/403' || path.startsWith('/403');

const normalizeRole = (role: any): 'student' | 'teacher' | 'master' | 'admin' => {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'master') return 'master';
  if (r === 'admin') return 'admin';
  return 'student';
};

const targetPathByRole = (role: 'student' | 'teacher' | 'master' | 'admin') => {
  if (role === 'teacher') return '/teacher';
  if (role === 'master' || role === 'admin') return '/master';
  return '/student';
};

const roleMatchesPath = (role: 'student' | 'teacher' | 'master' | 'admin', path: string) => {
  if (role === 'teacher') return path.startsWith('/teacher');
  if (role === 'master' || role === 'admin') return path.startsWith('/master') || path.startsWith('/admin');
  return path.startsWith('/student');
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);

  const redirectingRef = useRef(false);
  const lastPathRef = useRef<string>('');

  const logout = async () => {
    try {
      await firebaseSignOut(auth);
    } catch {}
    setUser(null);
    setProfile(null);
    setConnectionIssue(false);
    setProfileMissing(false);
    window.location.replace('/');
  };

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';

      // パス変化でredirectロック解除
      if (lastPathRef.current && lastPathRef.current !== currentPath) redirectingRef.current = false;
      lastPathRef.current = currentPath;

      // 強制ログアウト
      if (typeof window !== 'undefined' && window.location.search.includes('logout=true')) {
        window.history.replaceState(null, '', window.location.pathname);
        await logout();
        return;
      }

      // 未ログイン
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);
        setProfileMissing(false);

        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath)) {
          window.location.replace('/');
          return;
        }
        setLoading(false);
        return;
      }

      // ログイン済み
      setUser(currentUser);
      setConnectionIssue(false);
      setProfileMissing(false);

      try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));

        if (!snap.exists()) {
          // ★ここが「止まる」原因になりやすい：必ずloadingを解除し、表示する
          setProfile(null);
          setProfileMissing(true);
          setLoading(false);

          // login画面ならそのまま（管理者が再登録などできる）
          if (isLoginLikePath(currentPath) || isDeniedPath(currentPath)) return;

          // 保護画面にいるなら、いったんトップへ戻す（無限ループ防止）
          window.location.replace('/?profile_missing=true');
          return;
        }

        const data = snap.data() as UserProfile;
        const role = normalizeRole(data.role);
        setProfile({ ...data, uid: currentUser.uid, role });

        // ★403中は引き戻さない（ループ防止）
        if (isDeniedPath(currentPath)) {
          setLoading(false);
          return;
        }

        // 正しい画面なら表示
        if (roleMatchesPath(role, currentPath)) {
          setLoading(false);
          return;
        }

        // 適切な画面へ誘導
        const target = targetPathByRole(role);
        if (!redirectingRef.current) {
          redirectingRef.current = true;
          window.location.replace(target);
          return;
        }

        setLoading(false);
      } catch (err: any) {
        console.error('Profile fetch error:', err);

        const code = err?.code;
        const msg = String(err?.message || '').toLowerCase();

        if (code === 'unavailable' || msg.includes('offline')) {
          setConnectionIssue(true);
          setLoading(false);
          return;
        }

        // それ以外の例外：表示を出して止める（追い出しループ回避）
        setProfile(null);
        setProfileMissing(true);
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const login = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, connectionIssue, profileMissing, login, logout }}>
      {loading ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <div className="animate-spin h-10 w-10 border-4 border-indigo-500 rounded-full border-t-transparent"></div>
          <p className="mt-4 text-sm font-bold text-gray-400">アカウントを確認中...</p>
        </div>
      ) : connectionIssue ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <div className="h-12 w-12 rounded-full border-4 border-gray-300 border-t-transparent animate-spin"></div>
          <p className="mt-4 text-sm font-bold text-gray-600">接続が不安定です</p>
          <p className="mt-2 text-xs text-gray-400">数秒待ってリロードしてください。</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800">
            リロード
          </button>
        </div>
      ) : profileMissing ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <p className="text-sm font-bold text-gray-700">ユーザーデータが見つかりません</p>
          <p className="mt-2 text-xs text-gray-500">初回登録が未完了、または users/{`{uid}`} が存在しません。</p>
          <div className="mt-6 flex gap-3">
            <button onClick={() => window.location.replace('/?logout=true')} className="px-4 py-2 rounded-lg text-xs font-bold bg-gray-200 hover:bg-gray-300">
              ログアウト
            </button>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800">
              リロード
            </button>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};