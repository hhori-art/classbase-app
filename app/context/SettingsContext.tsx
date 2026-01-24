'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type TextSize = 'normal' | 'large';

type SettingsContextType = {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSize>('normal');

  // 初期化: 保存された設定を読み込む
  useEffect(() => {
    const savedSize = localStorage.getItem('app_text_size') as TextSize;
    if (savedSize) {
      setTextSizeState(savedSize);
    }
  }, []);

  // 文字サイズ変更の適用 (HTMLのルートフォントサイズを変更)
  const setTextSize = (size: TextSize) => {
    setTextSizeState(size);
    localStorage.setItem('app_text_size', size);
    
    // アプリ全体の基準サイズを変更 (Tailwindのrem単位がこれに連動して変わります)
    if (size === 'large') {
      document.documentElement.style.fontSize = '115%'; // 15%拡大
    } else {
      document.documentElement.style.fontSize = '100%'; // 標準
    }
  };

  // マウント時にも適用
  useEffect(() => {
    setTextSize(textSize);
  }, [textSize]);

  return (
    <SettingsContext.Provider value={{ textSize, setTextSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}