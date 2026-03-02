'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export interface UserProfile {
  uid: string;
  role: 'student' | 'teacher' | 'master';
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
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // ★追加：Cookie（サーバーの記憶）ごと完全に破壊する強力なログアウト
  const handleForceOut = async () => {
    if (typeof document !== 'undefined') {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    }
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
    window.location.replace('/');
  };

  useEffect(() => {
    // ログイン状態をブラウザに保持させる設定（自動ログイン）
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      
      // 強制ログアウトURL（?logout=true）のキャッチ
      if (typeof window !== 'undefined' && window.location.search.includes('logout=true')) {
        window.history.replaceState(null, '', window.location.pathname);
        await handleForceOut();
        return;
      }

      if (currentUser) {
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const userData = docSnap.data() as UserProfile;
            setUser(currentUser);
            setProfile(userData);
            
            const role = (userData.role || '').toLowerCase();
            const currentPath = window.location.pathname;

            // ★最大の修正ポイント：アプリがどの画面から起動しても、絶対に権限の画面に引き戻す！
            if (role === 'teacher') {
              if (!currentPath.startsWith('/teacher')) {
                window.location.replace('/teacher'); // 先生は絶対に先生画面へ
                return; // 移動させるのでここで処理終了
              }
            } else if (role === 'master' || role === 'admin') {
              if (!currentPath.startsWith('/master') && !currentPath.startsWith('/admin')) {
                window.location.replace('/master'); // マスターは絶対にマスター画面へ
                return;
              }
            } else {
              // 生徒の場合
              if (!currentPath.startsWith('/student')) {
                window.location.replace('/student'); // 生徒は絶対に生徒画面へ
                return;
              }
            }
            
            // 正しい画面にいることが確認できたら、初めて画面を表示させる
            setLoading(false); 

          } else {
            // 初回ログイン等でデータが存在しない場合
            const currentPath = window.location.pathname;
            if (currentPath === '/' || currentPath === '/login' || currentPath.includes('login')) {
              setUser(currentUser);
              setLoading(false); 
            } else {
              console.warn("ユーザーデータが見つかりません。");
              await handleForceOut();
            }
          }
        } catch (error) {
          console.error('Profile fetch error:', error);
          const currentPath = window.location.pathname;
          if (currentPath === '/' || currentPath === '/login' || currentPath.includes('login')) {
            setLoading(false);
          } else {
            await handleForceOut();
          }
        }
      } else {
        // 未ログインの場合
        setUser(null);
        setProfile(null);
        
        const currentPath = window.location.pathname;
        // ログイン画面以外にいようとしたら追い出す
        if (currentPath !== '/' && currentPath !== '/login' && !currentPath.includes('login')) {
          window.location.replace('/'); 
        } else {
          setLoading(false);
        }
      }
    });
    
    return () => unsubscribe();
  }, [router]);

  const login = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const logout = async () => {
    await handleForceOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout }}>
      {loading ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <div className="animate-spin h-10 w-10 border-4 border-indigo-500 rounded-full border-t-transparent"></div>
          <p className="mt-4 text-sm font-bold text-gray-400">アカウントを確認中...</p>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};