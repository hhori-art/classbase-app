'use client';

import { useEffect, useRef } from 'react';

// リロードまでの待機時間 (ミリ秒)
// 例: 60分 = 60 * 60 * 1000
const TIMEOUT_MS = 60 * 60 * 1000; 

export default function AutoRefresh() {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // リロード実行関数
    const performReload = () => {
      if (typeof window !== 'undefined') {
        console.log('一定時間操作がなかったため再読み込みします');
        window.location.reload();
      }
    };

    // タイマーをリセットする関数
    const resetTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(performReload, TIMEOUT_MS);
    };

    // 監視するイベント (マウス操作、キー入力、タッチ、スクロール)
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    
    // イベントリスナー登録
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    // 初回タイマースタート
    resetTimer();

    // クリーンアップ (コンポーネントアンマウント時)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, []);

  return null; // 画面には何も表示しません
}