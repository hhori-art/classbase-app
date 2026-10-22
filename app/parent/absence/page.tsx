'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/app/components/ui';

/** 欠席・遅刻の連絡は、ホームの通塾カレンダーから行う（授業が終わった日は選べない）。 */
export default function ParentAbsencePage() {
  const router = useRouter();
  useEffect(() => { router.replace('/parent#absence'); }, [router]);
  return <div className="flex min-h-[50vh] items-center justify-center"><Spinner size={28} /></div>;
}
