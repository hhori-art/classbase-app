'use client';

import Link from 'next/link';
import { ArrowRight, LockKeyhole, PanelsTopLeft } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { visibleAdminMenu, type AdminMenuSection } from '@/app/components/master/admin-menu';
import TodayTasks from '@/app/components/master/TodayTasks';

const TONES: Record<AdminMenuSection['tone'], { card: string; icon: string }> = {
  indigo: { card: 'border-indigo-100', icon: 'bg-indigo-600' },
  sky: { card: 'border-sky-100', icon: 'bg-sky-600' },
  emerald: { card: 'border-emerald-100', icon: 'bg-emerald-600' },
  amber: { card: 'border-amber-100', icon: 'bg-amber-500' },
  violet: { card: 'border-violet-100', icon: 'bg-violet-600' },
  rose: { card: 'border-rose-100', icon: 'bg-rose-600' },
  slate: { card: 'border-slate-200', icon: 'bg-slate-800' },
};

/** 管理画面のホーム。この権限で使える機能を分野ごとに並べる（サイドバーと同じ定義）。 */
export default function AdminHome() {
  const { profile } = useAuth();
  const { visibility } = usePortalVisibility('admin');
  const sections = visibleAdminMenu(profile, visibility as Record<string, boolean | undefined>)
    .map(section => section.id === 'home'
      ? { ...section, title: '共通', items: section.items.filter(item => item.key !== 'dashboard') }
      : section)
    .filter(section => section.items.length > 0);
  const name = String(profile?.name || profile?.teacher_name || '').trim();

  return (
    <div>
      <AdminPageHeader
        icon={PanelsTopLeft}
        kicker="創造学園 管理"
        title={name ? `${name} さんの管理メニュー` : '管理メニュー'}
        description="このアカウントの権限で使える機能だけを表示しています。左のメニューからも同じ画面を開けます。"
      />

      {sections.length > 0 && <TodayTasks isMaster={profile?.role === 'master'} />}

      {sections.length === 0 ? (
        <div className="rounded-card border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
          <LockKeyhole className="mx-auto mb-3" size={28} aria-hidden />
          <p className="font-bold">利用できる管理画面が設定されていません。</p>
          <p className="mt-2 text-sm">マスター管理者へ権限設定をご依頼ください。</p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {sections.map(section => {
            const tone = TONES[section.tone];
            const SectionIcon = section.icon;
            return (
              <section key={section.id} className={`rounded-card border bg-surface p-5 shadow-card ${tone.card}`}>
                <div className="mb-3 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-btn text-white ${tone.icon}`}><SectionIcon size={20} aria-hidden /></div>
                  <h2 className="text-base font-bold text-slate-900">{section.title}</h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <Link key={item.href} href={item.href} className="group flex min-h-14 items-center gap-3 rounded-btn border border-line bg-slate-50/60 px-3.5 py-3 transition hover:border-accent/30 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <Icon size={18} className="shrink-0 text-slate-500 group-hover:text-accent" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-slate-800">{item.title}</span>
                          <span className="block truncate text-xs font-medium text-slate-500">{item.description}</span>
                        </span>
                        <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
