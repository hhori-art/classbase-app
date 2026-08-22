'use client';

import { useCallback } from 'react';
import { useAuth } from '@/app/context/AuthContext';

export function useEikenApi() {
  const { user } = useAuth();

  return useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    if (!user) throw new Error('ログイン情報を確認できません。');
    const token = await user.getIdToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const messages: Record<string, string> = {
        'eiken-forbidden': '英検対策講座の利用登録が確認できません。',
        'eiken-enrollment-required': 'この講座の受講登録が確認できません。',
        'outside-join-window': 'まだ参加できる時間ではありません。',
        'task-locked': '先に完了する学習があります。',
        'quiz-attempt-limit': 'この確認テストの受験回数に達しています。',
        'writing-already-submitted': 'この答案はすでに添削中、または添削済みです。',
      };
      throw new Error(messages[data.error] || data.error || '処理に失敗しました。');
    }
    return data as T;
  }, [user]);
}

