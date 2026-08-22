'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Languages,
  LockKeyhole,
  PanelsTopLeft,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import {
  normalizeAdminAppPermissions,
  type AdminAppId,
} from '@/lib/admin-app-permissions';

const APPS: Array<{
  id: AdminAppId;
  title: string;
  description: string;
  href: string;
  icon: typeof BookOpen;
  style: string;
  iconStyle: string;
}> = [
  {
    id: 'science_social',
    title: '理社講座 管理',
    description: '生徒、講座、講師配置、録画、お知らせなどを管理します。',
    href: '/master/science-social',
    icon: BookOpen,
    style: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    iconStyle: 'bg-indigo-600',
  },
  {
    id: 'eiken',
    title: 'Booster 管理',
    description: '英検講座、課題、LIVE授業、学習状況を管理します。',
    href: '/master/eiken',
    icon: Languages,
    style: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    iconStyle: 'bg-emerald-600',
  },
  {
    id: 'attendance',
    title: '勤怠 管理',
    description: '勤務記録、打刻修正、交通費、勤怠出力を管理します。',
    href: '/master/attendance',
    icon: BriefcaseBusiness,
    style: 'border-amber-200 bg-amber-50 text-amber-950',
    iconStyle: 'bg-amber-600',
  },
];

export default function AdminAppHome() {
  const { profile } = useAuth();
  const permissions = normalizeAdminAppPermissions(profile?.role, profile || {});
  const availableApps = APPS.filter(app => permissions[app.id]);
  const isMaster = profile?.role === 'master';

  return (
    <div className="mx-auto max-w-6xl py-4 sm:py-8">
      <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-500">
            <PanelsTopLeft size={18} />
            創造学園 管理
          </div>
          <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">管理するアプリを選択</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            このアカウントに許可された管理画面だけが表示されています。
          </p>
        </div>
        {isMaster && (
          <div className="flex">
            <Link
              href="/master/accounts"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-black text-white hover:bg-slate-800"
            >
              <ShieldCheck size={18} />
              全体アカウント管理
            </Link>
          </div>
        )}
      </header>

      {availableApps.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
          <LockKeyhole className="mx-auto mb-3" size={28} />
          <p className="font-black">利用できる管理画面が設定されていません。</p>
          <p className="mt-2 text-sm">マスター管理者へ権限設定をご依頼ください。</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {availableApps.map(app => {
            const Icon = app.icon;
            return (
              <Link
                key={app.id}
                href={app.href}
                className={`group flex min-h-56 flex-col justify-between rounded-lg border p-6 transition hover:-translate-y-0.5 hover:shadow-lg ${app.style}`}
              >
                <div className="flex items-start justify-between">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-lg text-white ${app.iconStyle}`}>
                    <Icon size={28} />
                  </div>
                  <ArrowRight className="transition group-hover:translate-x-1" size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-black">{app.title}</h2>
                  <p className="mt-2 text-sm font-medium leading-6 opacity-70">{app.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
