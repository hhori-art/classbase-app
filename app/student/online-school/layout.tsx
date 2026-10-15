'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadAppAvailability } from '@/lib/client-app-availability';

export default function OnlineSchoolStudentLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => {
        if (active) setAllowed(data?.apps?.online_school === true);
      })
      .catch(() => active && setAllowed(false));
    return () => { active = false; };
  }, [user]);

  if (allowed === null) {
    return <div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-indigo-600" size={34}/></div>;
  }
  if (!allowed) {
    return <main className="grid min-h-[70vh] place-items-center px-5"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm"><LockKeyhole className="mx-auto text-slate-400" size={36}/><h1 className="mt-4 text-xl font-black text-slate-900">オンライン校は未設定です</h1><p className="mt-2 text-sm font-bold leading-6 text-slate-500">利用するには、管理者によるアカウントへの紐づけが必要です。</p><Link href="/apps" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-900 px-6 font-black text-white">アプリ選択へ戻る</Link></div></main>;
  }
  return children;
}
