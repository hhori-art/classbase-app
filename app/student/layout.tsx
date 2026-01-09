import BottomNav from '@/app/components/BottomNav';
import React from 'react';

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen pb-[100px] relative">
      {/* 各ページの中身 */}
      {children}
      
      {/* 下部メニューバー */}
      <BottomNav />
    </section>
  );
}