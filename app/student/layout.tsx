'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
// ★追加: BottomNavigation をインポート (パスはプロジェクトに合わせてください)
import BottomNavigation from '@/app/components/BottomNav'; 
import {
  normalizeStudentAppearance,
  StudentAppearance,
  studentAppearanceCssVars,
  studentBackgroundPatternStyle,
  STUDENT_THEMES,
} from '@/lib/student-customization';
import MaintenanceGuard from '@/app/components/common/MaintenanceGuard';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const pathname = usePathname();
  // AIチャットは画面いっぱいの高さで入力欄を下に固定するので、下の余白はボトムナビの分だけにする。
  const fullHeightPage = pathname === '/student/chat';
  const [layoutAppearance, setLayoutAppearance] = useState<StudentAppearance>(() =>
    normalizeStudentAppearance(profile?.settings?.appearance, profile?.owned_cosmetics)
  );
  const appearance = layoutAppearance;
  const theme = STUDENT_THEMES[appearance.theme];

  useEffect(() => {
    setLayoutAppearance(normalizeStudentAppearance(profile?.settings?.appearance, profile?.owned_cosmetics));
  }, [profile?.settings?.appearance, profile?.owned_cosmetics]);

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
    return <div className="min-h-[100dvh] w-full bg-canvas" aria-busy="true" />;
  }

  return (
    // 最下部のコンテンツが、ボトムナビと右下の「使い方」ボタン（下から約140px）に隠れないよう pb-40 を取る。
    // data-portal と CSS 変数で、見た目の設定（テーマ・カード・余白）を生徒画面の全ページに効かせる。
    <div
      data-portal="student"
      className={`min-h-screen w-full ${theme.pageBg} relative ${fullHeightPage ? 'pb-[calc(85px+env(safe-area-inset-bottom))]' : 'pb-40'}`}
      style={{ ...studentAppearanceCssVars(appearance), ...studentBackgroundPatternStyle(appearance.backgroundPattern) } as React.CSSProperties}
    >
      <MaintenanceGuard>
        {children}
      </MaintenanceGuard>
      
      {/* ★追加: ボトムナビゲーションを固定表示 */}
      <div className="fixed bottom-0 left-0 w-full z-40">
        <BottomNavigation />
      </div>
    </div>
  );
}
