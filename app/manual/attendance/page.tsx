'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { manualGuidesFor } from '../manual-content';

// 勤怠登録の手順は操作マニュアル本体の「勤怠」の章に統合した。旧URLから該当の章へ移動する。
export default function AttendanceManualRedirect() {
  const { profile, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    const guide = profile ? manualGuidesFor(profile).find(item => item.chapters.some(chapter => chapter.id.startsWith('attendance'))) : undefined;
    const chapter = guide?.chapters.find(item => item.id.startsWith('attendance'));
    window.location.replace(guide && chapter ? `/manual#${guide.id}-${chapter.id}` : '/manual');
  }, [loading, profile]);
  return <main className="grid min-h-screen place-items-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-bold text-slate-600"><Loader2 className="animate-spin" />マニュアルを開いています</div></main>;
}
