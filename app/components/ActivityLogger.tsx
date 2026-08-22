'use client';

import { useEffect } from 'react';
import { auth } from '@/lib/firebase';

type ActivityLoggerProps = {
  uid?: string;
  onRewardApplied?: (updates: Record<string, any>) => void;
};

export default function ActivityLogger({ uid, onRewardApplied }: ActivityLoggerProps) {
  useEffect(() => {
    if (!uid) return;

    const logActivity = async () => {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const lastLogKey = `last_logged_date_${uid}`;
      const sessionSyncKey = `daily_login_synced_${uid}_${today}`;

      // サーバー側で重複付与を防ぐため、画面側はセッション内の確認だけ抑制する
      if (sessionStorage.getItem(sessionSyncKey) === 'true') return;

      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/coin-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'daily_login' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'daily login failed');

        const updates = {
          coins: data.coins,
          total_coins: data.total_coins,
          login_count: data.login_count,
          attendance_count: data.login_count,
          login_streak: data.login_streak,
          earned_badges: data.earned_badges,
          selected_badge: data.selected_badge,
          last_login_bonus_date: today,
        };
        onRewardApplied?.(updates);
        window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', { detail: updates }));

        // 記録済みフラグを保存
        localStorage.setItem(lastLogKey, today);
        sessionStorage.setItem(sessionSyncKey, 'true');

      } catch (error) {
        console.error("Logging error:", error);
      }
    };

    logActivity();
  }, [uid, onRewardApplied]);

  return null; // 画面には表示しない
}
