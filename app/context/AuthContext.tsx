'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  User,
  signOut as firebaseSignOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { doc, getDocFromCache, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { usePathname } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { passwordChangePathForRole, shouldRedirectToPasswordChange } from '@/lib/first-login-guard';
import { AuthRole, isPublicAuthPath, isRoleScopedPath, profileMatchesPath, targetPathForProfile } from '@/lib/auth-navigation';
import { loadAuthenticatedProfile } from '@/lib/client-auth-profile';
import { signInWithNetworkRetry } from '@/lib/client-auth-login';
import { clearCourseRegistrationOptionsCache } from '@/lib/client-course-options';

export interface UserProfile {
  uid: string;
  role: AuthRole;
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
const isPublicPath = isPublicAuthPath;
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
  if (isAttendanceAdminRole(r)) return 'attendance_admin';
  if (ADMIN_ROLE_ALIASES.includes(r)) return 'admin';
  if (r === 'parent' || r === 'guardian') return 'parent';
  return 'student';
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
const PRIVATE_PROFILE_FIELDS = new Set([
  'initial_password', 'raw_password', 'parent_initial_password',
  'password', 'password_hash', 'temporary_password',
  'line_user_id', 'lineUserId', 'reset_token', 'verification_token',
]);
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

const safeLiveProfile = (uid: string, data: Record<string, any>): UserProfile => Object.fromEntries(
  Object.entries({ ...data, uid, role: normalizeRole(data.role) })
    .filter(([key]) => !PRIVATE_PROFILE_FIELDS.has(key)),
) as UserProfile;

const courseRegistrationSignature = (profile: Record<string, any>) => JSON.stringify({
  grade: profile.grade || '',
  active: profile.active_course_registration_id || '',
  ids: Array.isArray(profile.selected_course_ids) ? profile.selected_course_ids : [],
  keys: Array.isArray(profile.selected_course_keys) ? profile.selected_course_keys : [],
  year: profile.course_registration_year || '',
  term: profile.course_registration_term || '',
  updated: profile.course_registration_updated_at || '',
  testPrepActive: profile.active_test_prep_course_registration_id || '',
  testPrepIds: Array.isArray(profile.selected_test_prep_course_ids) ? profile.selected_test_prep_course_ids : [],
  testPrepKeys: Array.isArray(profile.selected_test_prep_course_keys) ? profile.selected_test_prep_course_keys : [],
  testPrepUpdated: profile.test_prep_course_registration_updated_at || '',
});

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
  const authTransitionRef = useRef(0);
  const lastAuthenticatedUidRef = useRef<string | null>(null);
  const courseRegistrationSignatureRef = useRef('');

  const clearAuthUiState = (keepLoading = false) => {
    redirectingRef.current = false;
    setUser(null);
    setProfile(null);
    setConnectionIssue(false);
    setProfileMissing(false);
    setAuthWaitTooLong(false);
    setLoading(keepLoading);
  };

  useEffect(() => {
    const syncPath = () => setClientPath(getBrowserPath());
    syncPath();
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const updates = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!updates || typeof updates !== 'object') return;

      // A course registration is written by a server route, so Firebase Auth
      // does not emit another auth-state event. Keep the provider and its
      // session cache in sync before the registration screen navigates home.
      setProfile(current => {
        if (!current) return current;
        const cleanedUpdates = Object.fromEntries(
          Object.entries(updates).filter(([, value]) => value !== undefined),
        );
        const nextProfile = { ...current, ...cleanedUpdates };
        writeCachedProfile(nextProfile);
        return nextProfile;
      });
      clearCourseRegistrationOptionsCache();
    };

    window.addEventListener('classbase:user-profile-updated', handleProfileUpdated);
    return () => window.removeEventListener('classbase:user-profile-updated', handleProfileUpdated);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const failSafe = window.setTimeout(() => {
      const currentPath = getBrowserPath() || '/';
      if (authSettledRef.current && !auth.currentUser && (isLoginLikePath(currentPath) || isPublicPath(currentPath))) {
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

      if (isLoginLikePath(currentPath) || isPublicPath(currentPath)) {
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
    authTransitionRef.current += 1;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(FORCE_LOGOUT_KEY, 'true');
    }
    clearProfileCache(user?.uid || auth.currentUser?.uid);
    clearAuthUiState(true);

    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      if (typeof window !== 'undefined') {
        if (window.location.pathname !== '/' || window.location.search) {
          window.location.replace('/');
        } else {
          sessionStorage.removeItem(FORCE_LOGOUT_KEY);
          logoutInProgressRef.current = false;
          setLoading(false);
        }
      }
    }
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

    // 公開マニュアルは、未ログイン・ログイン済みのどちらでも表示する。
    if (isPublicPath(currentPath)) {
      setLoading(false);
      return true;
    }

    if (
      typeof window !== 'undefined' &&
      isLoginLikePath(currentPath) &&
      sessionStorage.getItem(LOGIN_FLOW_LOCK_KEY) === 'true'
    ) {
      return true;
    }

    if (profileMatchesPath(normalizedProfile, currentPath)) {
      if (shouldRedirectToPasswordChange(normalizedProfile, currentPath)) {
        const passwordPath = passwordChangePathForRole(normalizedProfile.role);
        if (!redirectingRef.current && currentPath !== passwordPath) {
          redirectingRef.current = true;
          window.location.replace(passwordPath);
          return true;
        }
      }
      setLoading(false);
      return true;
    }

    const target = targetPathForProfile(normalizedProfile);
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.replace(target);
      return true;
    }
    return true;
  };

  // 管理者が別端末から生徒の講座登録を変更しても、再ログインを待たずに
  // AuthContextと講座画面のキャッシュを更新する。生徒画面ごとの重複購読は行わない。
  useEffect(() => {
    if (!user?.uid || profile?.uid !== user.uid) return;
    const uid = user.uid;
    return onSnapshot(doc(db, 'users', uid), snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const status = String(data.account_status || data.status || '').toLowerCase();
      if (['suspended', 'withdrawn', 'archived'].includes(status)) {
        clearProfileCache(uid);
        clearCourseRegistrationOptionsCache();
        void firebaseSignOut(auth).finally(() => window.location.replace('/?reason=account-inactive'));
        return;
      }
      const nextProfile = safeLiveProfile(uid, data);
      const nextCourseRegistrationSignature = courseRegistrationSignature(nextProfile);
      if (courseRegistrationSignatureRef.current !== nextCourseRegistrationSignature) {
        courseRegistrationSignatureRef.current = nextCourseRegistrationSignature;
        clearCourseRegistrationOptionsCache();
      }
      writeCachedProfile(nextProfile);
      setProfile(current => current?.uid === uid ? nextProfile : current);
    }, error => console.warn('Authenticated profile live update failed:', error));
  }, [profile?.uid, user?.uid]);

  // モバイルOSがバックグラウンド中にFirestore購読を停止した場合の保険。
  // アプリに戻った時だけサーバーの最新登録と照合し、定期ポーリングは行わない。
  useEffect(() => {
    if (!user?.uid || profile?.uid !== user.uid) return;
    let disposed = false;
    let lastRefreshAt = 0;
    const refreshCourseRegistration = async () => {
      if (disposed || document.visibilityState !== 'visible' || Date.now() - lastRefreshAt < 15_000) return;
      lastRefreshAt = Date.now();
      try {
        const remote = safeLiveProfile(user.uid, await loadAuthenticatedProfile(user, PROFILE_FETCH_TIMEOUT_MS));
        const nextSignature = courseRegistrationSignature(remote);
        if (nextSignature === courseRegistrationSignatureRef.current || disposed) return;
        courseRegistrationSignatureRef.current = nextSignature;
        clearCourseRegistrationOptionsCache();
        writeCachedProfile(remote);
        setProfile(current => current?.uid === user.uid ? remote : current);
      } catch (error) {
        console.warn('Course registration focus refresh failed:', error);
      }
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') void refreshCourseRegistration(); };
    window.addEventListener('focus', refreshCourseRegistration);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshCourseRegistration);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [profile?.uid, user]);

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
        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath) && !isPublicPath(currentPath)) window.location.replace('/');
        return;
      }
      setUser(auth.currentUser);
      setProfile(null);
      setProfileMissing(false);
      setConnectionIssue(true);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      const authTransition = ++authTransitionRef.current;
      const isCurrentTransition = () =>
        authTransitionRef.current === authTransition &&
        (currentUser ? auth.currentUser?.uid === currentUser.uid : !auth.currentUser);

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
        clearAuthUiState(true);
        if (typeof window !== 'undefined' && window.location.search.includes('logout=true')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        try {
          await firebaseSignOut(auth);
        } catch (error) {
          console.error('Forced logout error:', error);
        }
        if (typeof window !== 'undefined' && isCurrentTransition()) {
          if (currentPath !== '/' || window.location.search) {
            window.location.replace('/');
          } else {
            sessionStorage.removeItem(FORCE_LOGOUT_KEY);
            logoutInProgressRef.current = false;
            setLoading(false);
          }
        }
        return;
      }

      // 未ログイン
      if (!currentUser) {
        if (typeof window !== 'undefined') sessionStorage.removeItem(FORCE_LOGOUT_KEY);
        logoutInProgressRef.current = false;
        clearProfileCache(lastAuthenticatedUidRef.current);
        lastAuthenticatedUidRef.current = null;
        setUser(null);
        setProfile(null);
        setConnectionIssue(false);
        setProfileMissing(false);
        if (!isLoginLikePath(currentPath) && !isDeniedPath(currentPath) && !isPublicPath(currentPath)) {
          setLoading(true);
          window.location.replace('/');
          return;
        }
        setLoading(false);
        return;
      }

      if (logoutInProgressRef.current) {
        setLoading(false);
        return;
      }

      // ログイン済み
      lastAuthenticatedUidRef.current = currentUser.uid;
      setLoading(true);
      setUser(currentUser);
      setProfile(null);
      setConnectionIssue(false);
      setProfileMissing(false);

      try {
        // ログイン入り口では、管理者が変更した専任区分・理社講座の
        // 紐付けを即座に反映するため、短時間のセッションキャッシュも使わない。
        const cachedProfile = isLoginLikePath(currentPath) ? null : readCachedProfile(currentUser.uid);
        if (cachedProfile) {
          if (!isCurrentTransition()) return;
          void touchLastLogin(currentUser.uid);
          finishAuthWithProfile(cachedProfile, currentPath, { cache: false });
          return;
        }

        const profileRef = doc(db, 'users', currentUser.uid);
        let profileData: Record<string, any> | null = null;
        try {
          profileData = await Promise.race([
            loadAuthenticatedProfile(currentUser, PROFILE_FETCH_TIMEOUT_MS),
            timeoutAfter(PROFILE_FETCH_TIMEOUT_MS + 500, 'profile-fetch-timeout'),
          ]);
        } catch (fetchError: any) {
          // 無効化・失効したアカウントは古いキャッシュで入れないよう、ここで打ち切る。
          if (
            fetchError?.status === 401 ||
            ['account-inactive', 'auth/user-disabled', 'auth/user-token-expired', 'auth/id-token-revoked', 'auth/id-token-expired']
              .includes(String(fetchError?.code || '')) ||
            String(fetchError?.code || '').includes('reauth')
          ) throw fetchError;
          console.warn('Server profile fetch failed; trying Firestore browser cache.', fetchError);
          try {
            const cachedSnapshot = await getDocFromCache(profileRef);
            if (cachedSnapshot.exists()) profileData = cachedSnapshot.data();
          } catch {
            throw fetchError;
          }
        }

        if (!isCurrentTransition()) return;

        if (!profileData) {
          // ★ここが「止まる」原因になりやすい：必ずloadingを解除し、表示する
          setProfile(null);
          setProfileMissing(true);
          setLoading(false);

          // login画面ならそのまま（管理者が再登録などできる）
          if (isLoginLikePath(currentPath) || isDeniedPath(currentPath) || isPublicPath(currentPath)) return;

          // 保護画面にいるなら、いったんトップへ戻す（無限ループ防止）
          window.location.replace('/?profile_missing=true');
          return;
        }

        const data = profileData as UserProfile;
        const role = normalizeRole(data.role);
        const normalizedProfile = { ...data, uid: currentUser.uid, role };
        void touchLastLogin(currentUser.uid);
        finishAuthWithProfile(normalizedProfile, currentPath);
      } catch (err: any) {
        if (!isCurrentTransition()) return;
        console.error('Profile fetch error:', err);

        const code = err?.code;
        const msg = String(err?.message || '').toLowerCase();

        const accountInactive = code === 'account-inactive';
        if (
          err?.status === 401 || accountInactive ||
          ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-token-expired', 'auth/user-disabled', 'reauth-required'].includes(String(code || '')) ||
          msg.includes('token has been revoked') || msg.includes('session-expired') || msg.includes('再度ログイン')
        ) {
          logoutInProgressRef.current = true;
          clearProfileCache(currentUser.uid);
          clearAuthUiState(true);
          try {
            await firebaseSignOut(auth);
          } catch (signOutError) {
            console.error('Expired session cleanup failed:', signOutError);
          } finally {
            window.location.replace(accountInactive ? '/?reason=account-inactive' : '/?reason=session-expired');
          }
          return;
        }

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
    await signInWithNetworkRetry(auth, email, pass);
  };

  const renderPath = pathname || clientPath || '';
  const isAuthScreenPath = Boolean(renderPath && isLoginLikePath(renderPath));
  const isPublicScreenPath = Boolean(renderPath && isPublicPath(renderPath));
  const hasIdentityMismatch = Boolean(user && profile && profile.uid !== user.uid);
  const hasRolePathMismatch = Boolean(
    profile &&
    renderPath &&
    isRoleScopedPath(renderPath) &&
    !isLoginLikePath(renderPath) &&
    !isDeniedPath(renderPath) &&
    !profileMatchesPath(profile, renderPath)
  );
  // Login screens own their submit state. Keep them mounted while Firebase restores
  // the session so users do not see a separate account-check screen between pages.
  const shouldShowLoading = !isAuthScreenPath && !isPublicScreenPath && (loading || hasIdentityMismatch || hasRolePathMismatch);

  useEffect(() => {
    if (loading || !user || !profile || !renderPath || !hasRolePathMismatch) return;
    redirectingRef.current = true;
    setLoading(true);
    window.location.replace(targetPathForProfile(profile));
  }, [hasRolePathMismatch, loading, profile, renderPath, user]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, connectionIssue, profileMissing, login, logout }}>
      {shouldShowLoading ? (
        <div className="min-h-[100dvh] bg-gray-50" aria-busy="true" aria-label="">
          {authWaitTooLong ? (
            <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
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
      ) : connectionIssue && !isAuthScreenPath && !isPublicScreenPath ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
          <div className="h-12 w-12 rounded-full border-4 border-gray-300 border-t-transparent animate-spin"></div>
          <p className="mt-4 text-sm font-bold text-gray-600">接続が不安定です</p>
          <p className="mt-2 text-xs text-gray-400">数秒待ってリロードしてください。</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800">
            リロード
          </button>
        </div>
      ) : profileMissing && !isAuthScreenPath && !isPublicScreenPath ? (
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
