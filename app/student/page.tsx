'use client';

import { useAuth } from '@/app/context/AuthContext';
import { Loader2, LogOut, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// ★Gamificationロジックを含むコンポーネントを読み込み
import StudentDashboard from '@/app/components/StudentDashboard';

export default function StudentPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [manualLoading, setManualLoading] = useState(true);
  const [fetchedProfile, setFetchedProfile] = useState<any>(null);

  // 救済用：強制ログアウト
  const handleForceLogout = async () => {
    if(!confirm('ログアウトしてログイン画面に戻りますか？')) return;
    await signOut(auth);
    window.location.href = '/';
  };

  useEffect(() => {
    // ユーザーがいない場合はトップへ
    if (!authLoading && !user) {
      if (typeof window !== 'undefined') window.location.href = '/';
      return;
    }

    const checkRoleAndRedirect = async () => {
      if (!user) return;
      
      try {
        let currentProfile: any = profile;
        
        // ContextにProfileがない場合、手動取得を試みる
        if (!currentProfile) {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
            currentProfile = { 
              ...userSnap.data(), 
              uid: user.uid 
            };
            setFetchedProfile(currentProfile);
          }
        }

        // ロール判定とリダイレクト
        if (currentProfile) {
          if (currentProfile.role === 'teacher') {
            setIsRedirecting(true);
            window.location.href = '/teacher';
            return;
          }
          if (currentProfile.role === 'master') {
            setIsRedirecting(true);
            window.location.href = '/master';
            return;
          }
        }
        
        // 生徒として表示許可
        setManualLoading(false);

      } catch (e) {
        console.error('Role Check Error:', e);
        setManualLoading(false);
      }
    };

    if (!authLoading) {
      checkRoleAndRedirect();
    }
  }, [user, authLoading, profile]);

  // --- 表示分岐 ---

  if (authLoading || manualLoading || isRedirecting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-6">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
          <p className="text-gray-500 font-bold">
            {isRedirecting ? '先生用ページへ移動しています...' : 'データを読み込んでいます...'}
          </p>
        </div>
        <div className="mt-8 p-4 bg-white rounded-xl shadow-sm border border-gray-200 text-center max-w-xs">
          <p className="text-xs text-gray-400 mb-3">画面が切り替わらない場合</p>
          <button onClick={handleForceLogout} className="text-gray-600 font-bold text-xs underline hover:text-red-500">
             強制ログアウト
          </button>
        </div>
      </div>
    );
  }

  const displayProfile = profile || fetchedProfile;
  if (!displayProfile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <AlertTriangle className="text-red-500 mb-4" size={48} />
        <h2 className="text-xl font-bold text-gray-800 mb-2">ユーザーデータが見つかりません</h2>
        <button onClick={handleForceLogout} className="bg-red-500 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-red-600">
          戻る
        </button>
      </div>
    );
  }

  // ★ここでダッシュボードコンポーネントを呼び出し
  return <StudentDashboard initialProfile={displayProfile} />;
}