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
  name?: string;
  email?: string;
  student_name?: string;
  lifetime_id?: string;
  grade?: string;
  classroom?: string;
  phone_number?: string;
  initial_password?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  connectionIssue: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  connectionIssue: false,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// login画面として許容するパス
const isLoginLikePath = (path: string) => {
  if (!path) return false;
  return path === '/' || path === '/login' || path.includes('login') || path.startsWith('/admin/login');
};

// ★ 追加：アクセス拒否ページは「例外」＝ roleで引き戻さない
const isDeniedPath = (path: string) => {
  if (!path) return false;
  return path === '/403' || path.startsWith('/403');
};

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
  if (!path) return false;
  if (role === 'teacher') return path.startsWith('/teacher');
  if (role === 'master' || role === 'admin') return path.startsWith('/master') || path.startsWith('/admin');
  return path.startsWith('/student');
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionIssue, setConnectionIssue] = useState(false);

  // 多重リダイレクト防止
  const redirectingRef = useRef(false);
  const lastPathRef = useRef<string>('');

  const forceOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch {}
    setUser(null);
    setProfile(null);
    setConnectionIssue(false);
    window.location.replace('/');
  };

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';

      // ★ 追加：パスが変わったら「遷移中ロック」を解除（復帰しやすくする）
      if (currentPath && lastPathRef.current && currentPath !== lastPathRef.current) {
        redirectingRef.current = false;
      }
      lastPathRef.current = currentPath;

      // logout=true 強制ログアウト
      if (typeof window !== 'undefined' && window.location.search.includes('logout=true')) {
        window.history.replaceState(null, '', window.location.pathname);
        await forceOut();
        return;
      }

      // 未ログイン
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);

        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath)) {
          window.location.replace('/');
          return;
        }
        setLoading(false);
        return;
      }

      // ログイン済み
      setUser(currentUser);

      // profile取得
      try {
        setConnectionIssue(false);

        const snap = await getDoc(doc(db, 'users', currentUser.uid));

        if (!snap.exists()) {
          // profileが無い：login系 or 403ならそのまま、保護領域なら追い出す
          if (isLoginLikePath(currentPath) || isDeniedPath(currentPath)) {
            setProfile(null);
            setLoading(false);
            return;
          }
          await forceOut();
          return;
        }

        const data = snap.data() as UserProfile;
        const role = normalizeRole(data.role);
        const mergedProfile: UserProfile = { ...data, uid: currentUser.uid, role };

        setProfile(mergedProfile);

        // ★最重要：403にいるなら role で引き戻さない（/master↔/403 ループ防止）
        if (isDeniedPath(currentPath)) {
          setLoading(false);
          return;
        }

        // すでに権限に合う画面なら何もしない
        if (roleMatchesPath(role, currentPath)) {
          setLoading(false);
          return;
        }

        // 正しい画面へ送る（login系等から）
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
        const msg = String(err?.message || '');

        // Firestore一時不調：追い出さず表示
        if (code === 'unavailable' || msg.toLowerCase().includes('offline')) {
          setConnectionIssue(true);
          setLoading(false);
          return;
        }

        // 403にいる場合は追い出さない（アクセス制限ページとして固定）
        if (isDeniedPath(currentPath)) {
          setLoading(false);
          return;
        }

        // その他の致命的エラー：login系ならそのまま、それ以外はログアウト
        if (isLoginLikePath(currentPath)) {
          setLoading(false);
          return;
        }

        await forceOut();
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const logout = async () => {
    await forceOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, connectionIssue, login, logout }}>
      {loading ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <div className="animate-spin h-10 w-10 border-4 border-indigo-500 rounded-full border-t-transparent"></div>
          <p className="mt-4 text-sm font-bold text-gray-400">アカウントを確認中...</p>
        </div>
      ) : connectionIssue ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <div className="h-12 w-12 rounded-full border-4 border-gray-300 border-t-transparent animate-spin"></div>
          <p className="mt-4 text-sm font-bold text-gray-600">接続が不安定です</p>
          <p className="mt-2 text-xs text-gray-400">
            Firestore に接続できませんでした。数秒待ってリロードしてください。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
          >
            リロード
          </button>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};