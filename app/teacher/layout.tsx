'use client';

import TeacherBottomNav from '@/app/components/TeacherBottomNav';
import { usePathname } from 'next/navigation';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStudentPreview = pathname.startsWith('/teacher/student-preview');

  return (
    <div className="min-h-screen bg-[#F0F4F8]">
      {/* メインコンテンツ (ボトムナビの高さ分だけ下に余白を確保) */}
      <div className={`${isStudentPreview ? '' : 'mx-auto max-w-5xl pb-[calc(7.5rem+env(safe-area-inset-bottom))]'} min-h-screen relative`}>
        {children}
      </div>
      
      {/* 常に表示されるボトムナビ */}
      {!isStudentPreview && <TeacherBottomNav />}
    </div>
  );
}
