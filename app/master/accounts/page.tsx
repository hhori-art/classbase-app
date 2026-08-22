'use client';

import Link from 'next/link';
import {
  ArrowRight,
  FileKey,
  Headphones,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';

const ACCOUNT_ACTIONS = [
  {
    title: 'パスワード再設定受付',
    description: 'メールを利用できない方の本人確認と、一度だけ使える再設定リンクの発行を行います。',
    href: '/master/accounts/recovery',
    icon: Headphones,
    style: 'border-amber-200 bg-amber-50 text-amber-950',
    iconStyle: 'bg-amber-600',
  },
  {
    title: 'アカウント作成・停止',
    description: '生徒、保護者、講師、管理者、勤怠アプリ利用者のアカウントを作成・更新します。',
    href: '/master/accounts/sso',
    icon: UserCog,
    style: 'border-sky-200 bg-sky-50 text-sky-950',
    iconStyle: 'bg-sky-600',
  },
  {
    title: 'ID書面・印刷',
    description: 'ログインIDと初期パスワードを確認し、利用開始案内を印刷します。',
    href: '/master/users',
    icon: FileKey,
    style: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    iconStyle: 'bg-emerald-600',
  },
  {
    title: '管理権限設定',
    description: '管理者ごとに理社講座、Booster、勤怠の利用権限を設定します。',
    href: '/master/access-control',
    icon: KeyRound,
    style: 'border-violet-200 bg-violet-50 text-violet-950',
    iconStyle: 'bg-violet-600',
  },
  {
    title: 'アカウント・データ削除',
    description: '不要なアカウントや関連データを確認して削除します。',
    href: '/master/delete',
    icon: Trash2,
    style: 'border-rose-200 bg-rose-50 text-rose-950',
    iconStyle: 'bg-rose-600',
  },
] as const;

export default function AccountManagementHome() {
  return (
    <div className="mx-auto max-w-6xl py-4 sm:py-8">
      <header className="mb-8 border-b border-slate-200 pb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-500">
          <ShieldCheck size={18} />
          マスター管理者専用
        </div>
        <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">全体アカウント管理</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
          創造学園アプリ全体で使用するアカウントと管理権限を管理します。講座固有の生徒情報や受講講座は、それぞれの講座管理画面で操作します。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {ACCOUNT_ACTIONS.map(action => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`group flex min-h-48 flex-col justify-between rounded-lg border p-5 transition hover:-translate-y-0.5 hover:shadow-lg ${action.style}`}
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-white ${action.iconStyle}`}>
                  <Icon size={24} />
                </div>
                <ArrowRight className="transition group-hover:translate-x-1" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-black">{action.title}</h2>
                <p className="mt-2 text-sm font-medium leading-6 opacity-70">{action.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
