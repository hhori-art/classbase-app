'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, BookOpenText, BriefcaseBusiness, GraduationCap, Languages, LogOut, Sparkles, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { scienceSocialPathForProfile } from '@/lib/auth-navigation';
import { isDedicatedProfile } from '@/lib/employment-category';
import { loadAppAvailability } from '@/lib/client-app-availability';
import { ErrorState, Skeleton } from '@/app/components/ui';
import { formatDate } from '@/lib/format';

type AppId = 'science_social' | 'eiken' | 'attendance' | 'online_school';
type AppAvailability = Record<AppId, boolean>;
type Audience = 'student' | 'parent' | 'teacher' | 'admin';

const roleHome = (role: string, app: AppId, profile?: Record<string, unknown> | null) => {
  if (app === 'online_school') return role === 'admin' || role === 'master' ? '/master/online-school' : '/student/online-school';
  if (app === 'attendance') {
    if (role === 'admin' || role === 'master' || role === 'attendance_admin') return '/master/attendance';
    return profile && isDedicatedProfile(profile) ? '/teacher/attendance/dedicated' : '/teacher/attendance';
  }
  if (app === 'eiken') {
    if (role === 'student') return '/eiken/student';
    if (role === 'parent' || role === 'guardian') return '/eiken/parent';
    if (role === 'teacher') return '/eiken/teacher';
    return '/master/eiken';
  }
  return scienceSocialPathForProfile({ ...(profile || {}), role });
};

const audienceOf = (role: string): Audience => {
  if (role === 'student') return 'student';
  if (role === 'parent' || role === 'guardian') return 'parent';
  if (role === 'teacher') return 'teacher';
  return 'admin';
};

// 権限ごとの呼び方・案内。色は data-portal（権限ごとの差し色）に従う。
const AUDIENCE_THEME: Record<Audience, { label: string; lead: string; honorific: string }> = {
  student: { label: '生徒', lead: '今日はどのアプリで学習しますか？', honorific: 'さん' },
  parent: { label: '保護者', lead: 'お子さまの学習状況や連絡は、各アプリから確認できます。', honorific: '様' },
  teacher: { label: '講師', lead: '担当している講座と勤怠のアプリを選んでください。', honorific: '先生' },
  admin: { label: '管理者', lead: '管理するアプリを選んでください。権限のある機能だけが表示されます。', honorific: 'さん' },
};

type AppCard = { name: string; icon: LucideIcon; accent: string; iconBg: string; features: Record<Audience, string[]> };

const APPS: Record<AppId, AppCard> = {
  science_social: {
    name: 'オンライン理社講座', icon: BookOpen, accent: 'hover:border-indigo-300', iconBg: 'bg-indigo-600',
    features: {
      student: ['授業に参加', '宿題（Monoxer）', '授業録画', 'テスト期間'],
      parent: ['出欠・欠席連絡', '学習の様子', 'お知らせ・面談'],
      teacher: ['授業・講師配置', '生徒の様子', '勤怠'],
      admin: ['講座・録画', 'アカウント', '勤怠・お知らせ'],
    },
  },
  online_school: {
    name: 'オンライン校', icon: Sparkles, accent: 'hover:border-violet-300', iconBg: 'bg-violet-600',
    features: {
      student: ['算数・数学', '国語', '1回10分のレベル別学習'],
      parent: ['算数・数学と国語の学習'],
      teacher: ['算数・数学と国語の学習'],
      admin: ['算数・数学と国語の学習'],
    },
  },
  eiken: {
    name: '英検対策講座 Booster', icon: Languages, accent: 'hover:border-emerald-300', iconBg: 'bg-emerald-600',
    features: {
      student: ['今日の学習', 'LIVE授業', '確認テスト', 'AI添削'],
      parent: ['学習状況', '確認テストの結果'],
      teacher: ['LIVE授業', '添削・フォロー'],
      admin: ['受講生と学習状況', '教材・テスト'],
    },
  },
  attendance: {
    name: '創造学園 勤怠', icon: BriefcaseBusiness, accent: 'hover:border-amber-300', iconBg: 'bg-amber-500',
    features: {
      student: ['出退勤'], parent: ['出退勤'],
      teacher: ['出退勤', '勤務詳細', '交通費'],
      admin: ['勤務実績の承認', '集計・給与計算'],
    },
  },
};

export default function AppsHomePage() {
  const { user, profile, logout } = useAuth();
  const [apps, setApps] = useState<AppAvailability | null>(null);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setError('');
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => { if (active && data.apps) setApps(data.apps as AppAvailability); })
      .catch(fetchError => { if (active) setError(fetchError instanceof Error ? fetchError.message : 'アプリ情報の取得に失敗しました。'); });
    return () => { active = false; };
  }, [user, reload]);

  const role = String(profile?.role || '');
  const audience = audienceOf(role);
  const theme = AUDIENCE_THEME[audience];
  const name = String(profile?.student_name || profile?.parent_name || profile?.teacher_name || profile?.name || '').trim();

  const appIds = useMemo<AppId[]>(() => {
    if (!apps || !profile) return [];
    // 理社講座を使える講師は、講師画面の中から勤怠を開くので、勤怠カードは勤怠だけの人に出す。
    // 管理者は勤怠も独立した管理アプリなので、権限があれば常にカードを出す。
    return (['science_social', 'online_school', 'eiken', 'attendance'] as AppId[]).filter(id => (
      id === 'attendance' ? apps.attendance && (audience === 'admin' || !apps.science_social) : apps[id]
    ));
  }, [apps, profile, audience]);

  useEffect(() => {
    if (!apps || !profile || appIds.length !== 1 || redirecting) return;
    setRedirecting(true);
    window.location.replace(roleHome(role, appIds[0], profile));
  }, [appIds, apps, profile, redirecting, role]);

  const today = formatDate(new Date());
  const hour = Number(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }).format(new Date()).replace(/\D/g, ''));
  const greeting = hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';
  const waiting = !apps || !profile || redirecting || appIds.length === 1;

  return (
    <main data-portal={audience} className="min-h-screen bg-canvas pb-16 text-fg">
      <div className="bg-accent pb-24 pt-8 text-accent-ink">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-white/15"><GraduationCap size={20} aria-hidden /></span>
              <p className="text-sm font-bold text-accent-ink/85">創造学園</p>
              {profile && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{theme.label}</span>}
            </div>
            <p className="mt-5 text-sm font-medium text-accent-ink/75">{today}</p>
            <h1 className="mt-1 text-2xl font-black leading-snug sm:text-3xl">
              {greeting}{name ? <>、<span className="whitespace-nowrap">{name} {theme.honorific}</span></> : ''}
            </h1>
            <p className="mt-2 text-sm text-accent-ink/80">{theme.lead}</p>
          </div>
          <button type="button" onClick={() => logout()} title="ログアウト" aria-label="ログアウト"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-white/15 text-accent-ink hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <LogOut size={19} aria-hidden />
          </button>
        </div>
      </div>

      <section aria-labelledby="app-heading" className="mx-auto -mt-16 max-w-5xl px-4 sm:px-6">
        <h2 id="app-heading" className="sr-only">利用するアプリを選択</h2>

        {error && <ErrorState title="アプリ情報を読み込めませんでした" message={error} onRetry={() => setReload(value => value + 1)} />}

        {waiting && !error && (
          <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="読み込み中">
            <Skeleton className="h-48 w-full rounded-card" />
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        )}

        {!waiting && appIds.length === 0 && (
          <div className="cb-card p-8 text-center">
            <p className="font-bold">現在利用できるアプリはありません。</p>
            <p className="mt-2 text-sm text-fg-muted">受講登録または担当設定をご確認ください。</p>
          </div>
        )}

        {!waiting && appIds.length > 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            {appIds.map(id => {
              const app = APPS[id];
              const Icon = app.icon;
              return (
                <Link key={id} href={roleHome(role, id, profile)}
                  className={`cb-card group flex flex-col p-6 transition motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${app.accent}`}>
                  <div className="flex items-center gap-4">
                    <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-btn text-white shadow-md ${app.iconBg}`}><Icon size={28} aria-hidden /></span>
                    <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug">{app.name}</h3>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {app.features[audience].map(feature => (
                      <span key={feature} className="rounded-input bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{feature}</span>
                    ))}
                  </div>
                  <span className="mt-5 flex items-center justify-end gap-1 text-sm font-bold text-fg-muted transition-colors group-hover:text-fg">
                    開く<ArrowRight size={16} aria-hidden className="transition-transform motion-safe:group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {!waiting && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-fg-muted">
            <Link href="/manual" className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 shadow-sm hover:text-fg"><BookOpenText size={15} aria-hidden />操作マニュアル</Link>
            <span>アプリは各画面の「アプリ切替」からいつでも切り替えられます。</span>
          </div>
        )}
      </section>
    </main>
  );
}
