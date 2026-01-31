'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
// ★追加: BottomNavigation をインポート (パスはプロジェクトに合わせてください)
import BottomNavigation from '@/app/components/BottomNav'; 

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (!user || !profile || profile.role !== 'student') return;

    const updateOnlineStatus = async () => {
      try {
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
  }, [user, profile, pathname]);

  return (
    // pb-24 を追加して、最下部のコンテンツがボトムナビに被らないようにする
    <div className="min-h-screen w-full bg-gray-50 relative pb-24">
      {children}
      
      {/* ★追加: ボトムナビゲーションを固定表示 */}
      <div className="fixed bottom-0 left-0 w-full z-50">
        <BottomNavigation />
      </div>
    </div>
  );
}