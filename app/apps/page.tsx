'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, BriefcaseBusiness, ChevronRight, GraduationCap, Languages, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type AppAvailability = {
  science_social: boolean;
  eiken: boolean;
  attendance: boolean;
};

const roleHome = (role: string, app: 'science_social' | 'eiken' | 'attendance') => {
  if (app === 'attendance') {
    return role === 'admin' || role === 'master' ? '/master/attendance' : '/teacher/attendance';
  }
  if (app === 'eiken') {
    if (role === 'student') return '/eiken/student';
    if (role === 'parent' || role === 'guardian') return '/eiken/parent';
    if (role === 'teacher') return '/eiken/teacher';
    return '/master/eiken';
  }
  if (role === 'student') return '/student';
  if (role === 'parent' || role === 'guardian') return '/parent';
  if (role === 'teacher') return '/teacher';
  return '/master/science-social';
};

export default function AppsHomePage() {
  const { user, profile, logout } = useAuth();
  const [apps, setApps] = useState<AppAvailability | null>(null);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken()
      .then(token => fetch('/api/apps', { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || '利用可能なアプリを確認できませんでした。');
        if (active) setApps(data.apps);
      })
      .catch(fetchError => {
        if (active) setError(fetchError instanceof Error ? fetchError.message : 'アプリ情報の取得に失敗しました。');
      });
    return () => {
      active = false;
    };
  }, [user]);

  const appCards = useMemo(() => {
    if (!apps || !profile) return [];
    return [
      {
        id: 'science_social' as const,
        visible: apps.science_social,
        name: 'オンライン理社講座',
        description: '授業参加、宿題、録画、講座設定',
        icon: BookOpen,
        color: 'border-indigo-200 bg-indigo-50 text-indigo-700',
        iconColor: 'bg-indigo-600',
      },
      {
        id: 'eiken' as const,
        visible: apps.eiken,
        name: '英検対策講座 Booster',
        description: '今日の学習、LIVE授業、確認テスト、AI添削',
        icon: Languages,
        color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        iconColor: 'bg-emerald-600',
      },
      {
        id: 'attendance' as const,
        visible: apps.attendance,
        name: '創造学園勤怠アプリ',
        description: '出退勤、勤務詳細、交通費',
        icon: BriefcaseBusiness,
        color: 'border-amber-200 bg-amber-50 text-amber-900',
        iconColor: 'bg-amber-600',
      },
    ].filter(item => item.visible);
  }, [apps, profile]);

  useEffect(() => {
    if (!apps || !profile || appCards.length !== 1 || redirecting) return;
    const onlyApp = appCards[0];
    setRedirecting(true);
    window.location.replace(roleHome(String(profile.role || ''), onlyApp.id));
  }, [appCards, apps, profile, redirecting]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <GraduationCap size={27} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-500">SOZO GAKUEN</p>
              <h1 className="truncate text-xl font-black sm:text-2xl">創造学園アプリ</h1>
              <p className="mt-1 text-sm text-slate-500">
                {profile?.student_name || profile?.parent_name || profile?.teacher_name || profile?.name || '利用者'}さん
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
            aria-label="ログアウト"
            title="ログアウト"
          >
            <LogOut size={19} />
          </button>
        </header>

        <section aria-labelledby="app-heading">
          <div className="mb-5">
            <h2 id="app-heading" className="text-lg font-black">利用するアプリを選択</h2>
            <p className="mt-1 text-sm text-slate-500">利用できる講座と機能だけが表示されています。</p>
          </div>

          {(!apps || !profile || redirecting || (apps && appCards.length === 1)) && !error && (
            <div className="flex min-h-48 items-center justify-center text-slate-500">
              <Loader2 className="mr-2 animate-spin" size={20} />
              {apps && appCards.length === 1 ? 'アプリを開いています' : '利用できるアプリを確認しています'}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          {apps && profile && appCards.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
              <p className="font-bold">現在利用できるアプリはありません。</p>
              <p className="mt-2 text-sm text-slate-500">受講登録または担当設定をご確認ください。</p>
            </div>
          )}

          <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${redirecting || appCards.length === 1 ? 'hidden' : ''}`}>
            {appCards.map(item => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={roleHome(String(profile?.role || ''), item.id)}
                  className={`group flex min-h-44 flex-col justify-between rounded-lg border p-5 transition hover:-translate-y-0.5 hover:shadow-md ${item.color}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-white ${item.iconColor}`}>
                      <Icon size={25} />
                    </div>
                    <ChevronRight className="transition group-hover:translate-x-1" size={21} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black">{item.name}</h3>
                    <p className="mt-1 text-sm leading-6 opacity-75">{item.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
