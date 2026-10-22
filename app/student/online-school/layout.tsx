'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import { loadAppAvailability } from '@/lib/client-app-availability';
import { ErrorState, Spinner, buttonClass } from '@/app/components/ui';

export default function OnlineSchoolStudentLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadError(false);
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => {
        if (active) setAllowed(data?.apps?.online_school === true);
      })
      // 通信の失敗を「未設定」に見せない。
      .catch(() => { if (active) { setLoadError(true); setAllowed(null); } });
    return () => { active = false; };
  }, [user, reloadKey]);

  if (loadError) {
    return <main className="mx-auto max-w-md px-5 py-10"><ErrorState onRetry={() => setReloadKey(key => key + 1)} /></main>;
  }
  if (allowed === null) {
    return <div className="grid min-h-[70vh] place-items-center"><Spinner size={34} /></div>;
  }
  if (!allowed) {
    return <main className="grid min-h-[70vh] place-items-center px-5"><div className="cb-card max-w-md p-8 text-center"><LockKeyhole className="mx-auto text-fg-muted" size={36} aria-hidden /><h1 className="mt-4 text-xl font-black text-fg">オンライン校は未設定です</h1><p className="mt-2 text-sm leading-6 text-fg-muted">利用するには、管理者によるアカウントへの紐づけが必要です。</p><Link href="/student" className={buttonClass('primary', 'lg', 'mt-6')}>戻る</Link></div></main>;
  }
  return (
    <>
      <div className="mx-auto flex max-w-5xl justify-end px-4 pt-3">
        <AppSwitcherLink />
      </div>
      {children}
    </>
  );
}
