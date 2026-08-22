'use client';

import type React from 'react';
import Link from 'next/link';
import { Wrench, ShieldAlert } from 'lucide-react';
import { useMaintenanceStatus } from '@/app/hooks/useMaintenanceStatus';

type MaintenanceGuardProps = {
  children: React.ReactNode;
};

export default function MaintenanceGuard({ children }: MaintenanceGuardProps) {
  const status = useMaintenanceStatus();

  return (
    <>
      {children}
      {status.is_maintenance && (
        <div className="fixed inset-0 z-[10000] flex min-h-[100dvh] items-center justify-center bg-slate-950/95 px-5 text-white backdrop-blur-md">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/10 p-7 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20">
              <Wrench size={30} strokeWidth={2.5} />
            </div>
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-amber-200">
              <ShieldAlert size={13} /> Maintenance
            </p>
            <h1 className="text-2xl font-black tracking-tight">メンテナンス中です</h1>
            <p className="mt-4 text-sm font-bold leading-7 text-slate-200">
              {status.message}
            </p>
            <Link
              href={status.link_url}
              className="mt-7 inline-flex w-full items-center justify-center rounded-2xl bg-white px-5 py-4 text-sm font-black text-slate-900 shadow-lg transition hover:bg-amber-50"
            >
              {status.link_label}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
