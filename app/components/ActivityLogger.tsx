'use client';

import { useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, increment, arrayUnion, serverTimestamp } from 'firebase/firestore';

export default function ActivityLogger({ uid }: { uid?: string }) {
  useEffect(() => {
    if (!uid) return;

    const logActivity = async () => {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const lastLogKey = `last_logged_date_${uid}`;
      const lastLoggedDate = localStorage.getItem(lastLogKey);

      // 今日すでに記録済みならスキップ (F5連打対策)
      if (lastLoggedDate === today) return;

      try {
        // 1. 全体統計 (日別アクティブユーザー集計用)
        const statsRef = doc(db, 'system_stats', `daily_${today}`);
        await setDoc(statsRef, {
          date: today,
          active_uids: arrayUnion(uid),
          total_access: increment(1)
        }, { merge: true });

        // 2. 個人統計 (最終ログイン日時と回数更新)
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
          last_login_at: serverTimestamp(),
          login_count: increment(1),
          last_active_date: today
        });

        // 記録済みフラグを保存
        localStorage.setItem(lastLogKey, today);
        console.log('Activity logged');

      } catch (error) {
        console.error("Logging error:", error);
      }
    };

    logActivity();
  }, [uid]);

  return null; // 画面には表示しない
}