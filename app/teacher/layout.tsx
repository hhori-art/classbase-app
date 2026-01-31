'use client';

import TeacherBottomNav from '@/app/components/TeacherBottomNav';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F0F4F8]">
      {/* メインコンテンツ (ボトムナビの高さ分だけ下に余白を確保) */}
      <div className="max-w-5xl mx-auto min-h-screen pb-32 lg:pb-0 relative">
        {children}
      </div>
      
      {/* 常に表示されるボトムナビ */}
      <TeacherBottomNav />
    </div>
  );
}