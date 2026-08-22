'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
// ★追加: BottomNavigation をインポート (パスはプロジェクトに合わせてください)
import BottomNavigation from '@/app/components/BottomNav'; 
import {
  normalizeStudentAppearance,
  StudentAppearance,
  studentBackgroundPatternStyle,
  STUDENT_THEMES,
} from '@/lib/student-customization';
import MaintenanceGuard from '@/app/components/common/MaintenanceGuard';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [layoutAppearance, setLayoutAppearance] = useState<StudentAppearance>(() =>
    normalizeStudentAppearance(profile?.settings?.appearance)
  );
  const appearance = layoutAppearance;
  const theme = STUDENT_THEMES[appearance.theme];

  useEffect(() => {
    setLayoutAppearance(normalizeStudentAppearance(profile?.settings?.appearance));
  }, [profile?.settings?.appearance]);

  useEffect(() => {
    if (!user || !profile || profile.role !== 'student') return;

    const updateOnlineStatus = async () => {
      try {
        const key = `classbase_last_login_touch:${user.uid}`;
        const lastTouched = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - lastTouched < 4 * 60 * 1000) return;
        sessionStorage.setItem(key, String(Date.now()));

        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          last_login: serverTimestamp(),
        });
      } catch (e) {
        console.error("Status update failed", e);
      }
    };

    updateOnlineStatus();
    const intervalId = setInterval(updateOnlineStatus, 5 * 60 * 1000);
    const handleFocus = () => updateOnlineStatus();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.uid, profile?.role]);

  if (loading || !user || !profile || profile.role !== 'student') {
    return (
      <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-slate-50 px-6 text-center">
        <Loader2 className="animate-spin text-indigo-600" size={36} />
        <p className="mt-4 text-sm font-black text-slate-500">ホーム画面を準備しています</p>
      </div>
    );
  }

  return (
    // pb-24 を追加して、最下部のコンテンツがボトムナビに被らないようにする
    <div
      className={`min-h-screen w-full ${theme.pageBg} relative pb-24`}
      style={studentBackgroundPatternStyle(appearance.backgroundPattern)}
    >
      <MaintenanceGuard>
        {children}
      </MaintenanceGuard>
      
      {/* ★追加: ボトムナビゲーションを固定表示 */}
      <div className="fixed bottom-0 left-0 w-full z-50">
        <BottomNavigation />
      </div>
    </div>
  );
}
