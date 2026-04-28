'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, CalendarX } from 'lucide-react';
import ZoomButton from './ZoomButton';

type Props = {
  profile: any;
  period: 1 | 2;
  startTime: string;
  endTime: string;
};

type ClassButtonData = {
  id: string;
  url: string;
  subject: string;
  unit?: string;
  source?: string;
};

export default function SmartClassButton({ profile, period, startTime, endTime }: Props) {
  const [classDataList, setClassDataList] = useState<ClassButtonData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassUrls = async () => {
      setLoading(true);

      if (!profile) {
        setLoading(false);
        return;
      }

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setClassDataList([]);
          return;
        }
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const token = await currentUser.getIdToken();
        const res = await fetch(`/api/student/today-classes?date=${todayStr}&period=${period}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'class fetch failed');
        setClassDataList(Array.isArray(data.classes) ? data.classes : []);

      } catch (error: any) {
        console.error("SmartClassButton Error:", error);
        setClassDataList([]);
      } finally {
        setLoading(false);
      }
    };

    fetchClassUrls();
  }, [profile, period]);

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="animate-spin inline text-indigo-300"/></div>;
  }

  // 表示するものがない場合
  if (classDataList.length === 0) {
    return (
      <div className="w-full flex flex-col gap-2">
        <div className="bg-white/50 border-2 border-dashed border-gray-300 rounded-3xl p-6 flex flex-col items-center justify-center text-gray-400 gap-2">
          <CalendarX size={32} className="opacity-50" />
          <div className="text-sm font-bold text-center">{period}限目の授業はありません</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
      {classDataList.map((classData) => (
        <ZoomButton
          key={classData.id}
          url={classData.url}
          label={`${period}限: ${classData.subject}`}
          subLabel={classData.source === 'transfer' ? `振替登録済み${classData.unit ? ` | ${classData.unit}` : ''}` : `受講登録済み${classData.unit ? ` | ${classData.unit}` : ''}`}
          color={period === 1 ? 'blue' : 'purple'}
          startTime={startTime}
          endTime={endTime}
          classId={classData.id}
          // ★重要: ここでプロフィールを渡すことで、ZoomButton側で名前を指定できます
          userProfile={profile}
        />
      ))}
    </div>
  );
}
