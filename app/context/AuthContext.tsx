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
import { doc, getDoc, getDocFromCache, serverTimestamp, updateDoc } from 'firebase/firestore';
import { usePathname } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { passwordChangePathForRole, shouldRedirectToPasswordChange } from '@/lib/first-login-guard';

export interface UserProfile {
  uid: string;
  role: 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin';
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
const FORCE_LOGOUT_KEY = 'classbase_force_logout';
const LOGIN_FLOW_LOCK_KEY = 'classbase_login_flow_lock';
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

const isAttendanceAdminRole = (role: any) => ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(role || '').toLowerCase());

const normalizeRole = (role: any): 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin' => {
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') return 'teacher';
  if (r === 'master') return 'master';
  if (isAttendanceAdminRole(r)) return 'teacher';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  if (r === 'parent' || r === 'guardian') return 'parent';
  return 'student';
};

const targetPathByRole = (role: 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin') => {
  return '/apps';
};

const roleMatchesPath = (role: 'student' | 'teacher' | 'master' | 'admin' | 'parent' | 'attendance_admin', path: string) => {
  if (path.startsWith('/zoom-meeting')) return true;
  if (path === '/apps' || path.startsWith('/apps/')) return true;
  if (role === 'teacher') return path.startsWith('/teacher') || path.startsWith('/eiken/teacher');
  if (role === 'master' || role === 'admin') return path.startsWith('/master') || path.startsWith('/admin');
  if (role === 'parent') return path.startsWith('/parent') || path.startsWith('/eiken/parent');
  return path.startsWith('/student') || path.startsWith('/eiken/student');
};

const isChunkLoadError = (value: unknown) => {
  const message = String(
    value instanceof Error ? value.message : (value as any)?.message || value || ''
  );
  return (
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes("Cannot read properties of undefined (reading 'call')") ||
    message.includes('Cannot read properties of undefined (reading "call")')
  );
};

const AUTH_INIT_TIMEOUT_MS = 12000;
const PROFILE_FETCH_TIMEOUT_MS = 9000;
const PROFILE_CACHE_TTL_MS = 60 * 1000;
const LAST_LOGIN_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
const profileCacheKey = (uid: string) => `classbase_profile_cache:${uid}`;
const lastLoginTouchKey = (uid: string) => `classbase_last_login_touch:${uid}`;

const timeoutAfter = (ms: number, message: string) =>
  new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });

const getBrowserPath = () =>
  typeof window === 'undefined' ? null : window.location.pathname;

const readCachedProfile = (uid: string): UserProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(profileCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.profile || Date.now() - Number(parsed.cachedAt || 0) > PROFILE_CACHE_TTL_MS) return null;
    return parsed.profile as UserProfile;
  } catch {
    return null;
  }
};

const writeCachedProfile = (profile: UserProfile) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(profileCacheKey(profile.uid), JSON.stringify({ profile, cachedAt: Date.now() }));
  } catch {}
};

const clearProfileCache = (uid?: string | null) => {
  if (typeof window === 'undefined' || !uid) return;
  try {
    sessionStorage.removeItem(profileCacheKey(uid));
  } catch {}
};

const touchLastLogin = async (uid: string) => {
  if (typeof window === 'undefined' || !uid) return;
  try {
    const key = lastLoginTouchKey(uid);
    const lastTouched = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastTouched < LAST_LOGIN_TOUCH_INTERVAL_MS) return;
    sessionStorage.setItem(key, String(Date.now()));

    await updateDoc(doc(db, 'users', uid), {
      last_login_at: serverTimestamp(),
      last_login: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Last login timestamp update failed:', error);
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [clientPath, setClientPath] = useState<string | null>(null);
  const [authWaitTooLong, setAuthWaitTooLong] = useState(false);

  const redirectingRef = useRef(false);
  const lastPathRef = useRef<string>('');
  const logoutInProgressRef = useRef(false);
  const authSettledRef = useRef(false);

  const clearAuthUiState = () => {
    redirectingRef.current = false;
    setUser(null);
    setProfile(null);
    setConnectionIssue(false);
    setProfileMissing(false);
    setAuthWaitTooLong(false);
    setLoading(false);
  };

  useEffect(() => {
    const syncPath = () => setClientPath(getBrowserPath());
    syncPath();
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const failSafe = window.setTimeout(() => {
      const currentPath = getBrowserPath() || '/';
      if (isLoginLikePath(currentPath)) {
        setLoading(false);
        setConnectionIssue(false);
        setProfileMissing(false);
      }
    }, 2500);
    return () => window.clearTimeout(failSafe);
  }, [loading]);

  useEffect(() => {
    if (!loading) {
      setAuthWaitTooLong(false);
      return;
    }

    const hintTimer = window.setTimeout(() => {
      setAuthWaitTooLong(true);
    }, 7000);

    const releaseTimer = window.setTimeout(() => {
      if (logoutInProgressRef.current) return;

      const currentPath = getBrowserPath() || '/';
      console.warn('Auth loading watchdog released the checking screen.');

      if (isLoginLikePath(currentPath)) {
        setConnectionIssue(false);
        setProfileMissing(false);
        setLoading(false);
        return;
      }

      if (!auth.currentUser) {
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);
        setProfileMissing(false);
        setLoading(false);
        if (!isDeniedPath(currentPath)) window.location.replace('/');
        return;
      }

      setUser(auth.currentUser);
      setProfileMissing(false);
      setConnectionIssue(true);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS + PROFILE_FETCH_TIMEOUT_MS + 3000);

    return () => {
      window.clearTimeout(hintTimer);
      window.clearTimeout(releaseTimer);
    };
  }, [loading]);

  useEffect(() => {
    const reloadOnce = () => {
      const key = 'classbase_chunk_reload_once';
      if (sessionStorage.getItem(key) === 'true') return;
      sessionStorage.setItem(key, 'true');
      window.location.reload();
    };

    const handleError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        event.preventDefault();
        reloadOnce();
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        event.preventDefault();
        reloadOnce();
      }
    };

    const clearReloadFlag = () => sessionStorage.removeItem('classbase_chunk_reload_once');

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('load', clearReloadFlag);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('load', clearReloadFlag);
    };
  }, []);

  const logout = async () => {
    logoutInProgressRef.current = true;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(FORCE_LOGOUT_KEY, 'true');
    }
    clearProfileCache(user?.uid || auth.currentUser?.uid);
    clearAuthUiState();

    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      if (typeof window !== 'undefined' && (window.location.pathname !== '/' || window.location.search)) {
        window.location.replace('/');
      }
    }
  };

  const tryRepairProfile = async (currentUser: User) => {
    const token = await currentUser.getIdToken();
    const res = await fetch('/api/auth/repair-profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'profile-repair-failed');
    return data;
  };

  const finishAuthWithProfile = (
    normalizedProfile: UserProfile,
    currentPath: string,
    options: { cache?: boolean } = {},
  ) => {
    if (options.cache !== false) writeCachedProfile(normalizedProfile);
    setProfile(normalizedProfile);

    if (isDeniedPath(currentPath)) {
      setLoading(false);
      return true;
    }

    if (
      typeof window !== 'undefined' &&
      isLoginLikePath(currentPath) &&
      sessionStorage.getItem(LOGIN_FLOW_LOCK_KEY) === 'true'
    ) {
      setLoading(false);
      return true;
    }

    if (roleMatchesPath(normalizedProfile.role, currentPath)) {
      if (shouldRedirectToPasswordChange(normalizedProfile, currentPath)) {
        const passwordPath = passwordChangePathForRole(normalizedProfile.role);
        if (!redirectingRef.current && currentPath !== passwordPath) {
          redirectingRef.current = true;
          setLoading(false);
          window.location.replace(passwordPath);
          return true;
        }
      }
      setLoading(false);
      return true;
    }

    const target = targetPathByRole(normalizedProfile.role);
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      setLoading(false);
      window.location.replace(target);
      return true;
    }

    setLoading(false);
    return true;
  };

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    const initWatchdog = window.setTimeout(() => {
      if (authSettledRef.current || logoutInProgressRef.current) return;
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
      console.warn(`Auth initialization timed out after ${AUTH_INIT_TIMEOUT_MS}ms`);
      if (!auth.currentUser) {
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);
        setProfileMissing(false);
        setLoading(false);
        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath)) window.location.replace('/');
        return;
      }
      setUser(auth.currentUser);
      setProfile(null);
      setProfileMissing(false);
      setConnectionIssue(true);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      authSettledRef.current = true;
      window.clearTimeout(initWatchdog);
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
      const forceLogout =
        typeof window !== 'undefined' &&
        (sessionStorage.getItem(FORCE_LOGOUT_KEY) === 'true' || window.location.search.includes('logout=true'));

      // パス変化でredirectロック解除
      if (lastPathRef.current && lastPathRef.current !== currentPath) redirectingRef.current = false;
      lastPathRef.current = currentPath;

      // 強制ログアウト
      if (forceLogout) {
        logoutInProgressRef.current = true;
        clearAuthUiState();
        if (typeof window !== 'undefined' && window.location.search.includes('logout=true')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        try {
          await firebaseSignOut(auth);
        } catch (error) {
          console.error('Forced logout error:', error);
        }
        if (!currentUser && typeof window !== 'undefined') {
          sessionStorage.removeItem(FORCE_LOGOUT_KEY);
          logoutInProgressRef.current = false;
        }
        return;
      }

      // 未ログイン
      if (!currentUser) {
        if (typeof window !== 'undefined') sessionStorage.removeItem(FORCE_LOGOUT_KEY);
        logoutInProgressRef.current = false;
        clearProfileCache(user?.uid);
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);
        setProfileMissing(false);
        setLoading(false);

        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath)) {
          window.location.replace('/');
          return;
        }
        return;
      }

      if (logoutInProgressRef.current) {
        setLoading(false);
        return;
      }

      // ログイン済み
      setUser(currentUser);
      setConnectionIssue(false);
      setProfileMissing(false);

      try {
        const cachedProfile = readCachedProfile(currentUser.uid);
        if (cachedProfile) {
          void touchLastLogin(currentUser.uid);
          finishAuthWithProfile(cachedProfile, currentPath, { cache: false });
          return;
        }

        const profileRef = doc(db, 'users', currentUser.uid);
        let snap;
        try {
          snap = await Promise.race([
            getDoc(profileRef),
            timeoutAfter(PROFILE_FETCH_TIMEOUT_MS, 'profile-fetch-timeout'),
          ]);
        } catch (fetchError: any) {
          if (String(fetchError?.message || '') !== 'profile-fetch-timeout') throw fetchError;
          console.warn(`Profile fetch timed out after ${PROFILE_FETCH_TIMEOUT_MS}ms; trying cached profile.`);
          try {
            snap = await getDocFromCache(profileRef);
          } catch {
            throw fetchError;
          }
        }

        if (!snap.exists()) {
          try {
            await tryRepairProfile(currentUser);
            snap = await Promise.race([
              getDoc(profileRef),
              timeoutAfter(PROFILE_FETCH_TIMEOUT_MS, 'profile-fetch-timeout'),
            ]);
          } catch (repairError) {
            console.warn('Profile repair failed:', repairError);
          }
        }

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
        const normalizedProfile = { ...data, uid: currentUser.uid, role };
        void touchLastLogin(currentUser.uid);
        finishAuthWithProfile(normalizedProfile, currentPath);
      } catch (err: any) {
        console.error('Profile fetch error:', err);

        const code = err?.code;
        const msg = String(err?.message || '').toLowerCase();

        if (code === 'unavailable' || msg.includes('offline') || msg.includes('profile-fetch-timeout')) {
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

    return () => {
      window.clearTimeout(initWatchdog);
      unsub();
    };
  }, []);

  const login = async (email: string, pass: string) => {
    if (typeof window !== 'undefined') sessionStorage.removeItem(FORCE_LOGOUT_KEY);
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const renderPath = clientPath || pathname || '';
  const isAuthScreenPath = Boolean(renderPath && isLoginLikePath(renderPath));
  const shouldShowLoading =
    loading && !isAuthScreenPath;

  return (
    <AuthContext.Provider value={{ user, profile, loading, connectionIssue, profileMissing, login, logout }}>
      {shouldShowLoading ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <div className="animate-spin h-10 w-10 border-4 border-indigo-500 rounded-full border-t-transparent"></div>
          <p className="mt-4 text-sm font-bold text-gray-400">アカウントを確認中...</p>
          {authWaitTooLong ? (
            <div className="mt-5 max-w-sm">
              <p className="text-xs leading-6 text-gray-500">
                確認に時間がかかっています。通信またはユーザーデータの取得で止まっている可能性があります。
              </p>
              <button
                onClick={async () => {
                  sessionStorage.setItem(FORCE_LOGOUT_KEY, 'true');
                  try {
                    await firebaseSignOut(auth);
                  } catch (error) {
                    console.error('Sign out from stalled auth screen failed:', error);
                  } finally {
                    window.location.replace('/');
                  }
                }}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                ログイン画面に戻る
              </button>
            </div>
          ) : null}
        </div>
      ) : connectionIssue && !isAuthScreenPath ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <div className="h-12 w-12 rounded-full border-4 border-gray-300 border-t-transparent animate-spin"></div>
          <p className="mt-4 text-sm font-bold text-gray-600">接続が不安定です</p>
          <p className="mt-2 text-xs text-gray-400">数秒待ってリロードしてください。</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800">
            リロード
          </button>
        </div>
      ) : profileMissing && !isAuthScreenPath ? (
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
