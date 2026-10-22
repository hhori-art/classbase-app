'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadAppAvailability } from '@/lib/client-app-availability';
import { cn } from '@/lib/cn';

type AppSwitcherLinkProps = {
  className?: string;
  /**
   * 見た目は4種類（色は差し色トークンに従う）。
   * - pill：白い小さなボタン（既定）
   * - inverse：差し色・暗い背景の上に置くボタン（dark は inverse と同じ、dark-icon はそのアイコンだけ版）
   * - menu：メニュー内の1行
   * - icon：アイコンだけのボタン
   */
  variant?: 'pill' | 'inverse' | 'menu' | 'icon' | 'dark' | 'dark-icon';
  /** 互換用：inverse と同じ */
  inverse?: boolean;
};

const LABEL = 'アプリを切り替える';

/** 使えるアプリが2つ以上あるときだけ、アプリ選択画面（/apps）への入口を出す。 */
export function useHasMultipleApps() {
  const { user } = useAuth();
  const [multiple, setMultiple] = useState(false);
  useEffect(() => {
    if (!user) return;
    let active = true;
    loadAppAvailability(user.uid, () => user.getIdToken())
      .then(data => {
        const apps = (data.apps || {}) as Record<string, boolean>;
        // 理社講座を使える講師は、勤怠を理社の画面から開くため1つと数える（アプリ選択画面と同じ考え方）。
        // 管理者は勤怠も独立した管理アプリとして数える。
        const isAdminAccount = ['admin', 'master', 'attendance_admin'].includes(String(data.role || ''));
        const count = ['science_social', 'online_school', 'eiken'].filter(key => apps[key]).length
          + (apps.attendance && (isAdminAccount || !apps.science_social) ? 1 : 0);
        if (active) setMultiple(count > 1);
      })
      .catch(() => { if (active) setMultiple(false); });
    return () => { active = false; };
  }, [user]);
  return multiple;
}

export default function AppSwitcherLink({ className = '', variant, inverse = false }: AppSwitcherLinkProps) {
  const visible = useHasMultipleApps();
  if (!visible) return null;
  const requested = variant || (inverse ? 'inverse' : 'pill');
  const style = requested === 'dark' ? 'inverse' : requested;
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  if (style === 'menu') {
    return (
      <Link href="/apps" className={cn('flex min-h-12 items-center gap-3 rounded-btn bg-canvas px-4 py-3 text-sm font-bold text-fg hover:bg-accent-soft', focus, className)}>
        <LayoutGrid size={18} className="text-accent" aria-hidden />
        <span className="flex-1">{LABEL}</span>
        <ChevronRight size={16} className="text-fg-muted" aria-hidden />
      </Link>
    );
  }
  if (style === 'icon' || style === 'dark-icon') {
    return (
      <Link href="/apps" title={LABEL} aria-label={LABEL}
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn transition-colors', focus,
          style === 'dark-icon' ? 'bg-white/10 text-white hover:bg-white/20' : 'border border-line bg-surface text-fg-muted hover:bg-accent-soft hover:text-accent',
          className,
        )}>
        <LayoutGrid size={18} aria-hidden />
      </Link>
    );
  }
  return (
    <Link
      href="/apps"
      aria-label={LABEL}
      className={cn(
        'min-h-11 items-center gap-1.5 rounded-btn px-3.5 text-sm font-bold transition-colors', focus,
        requested === 'dark' ? 'flex w-full justify-start' : 'inline-flex justify-center',
        style === 'inverse'
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'border border-line bg-surface text-fg shadow-sm hover:bg-accent-soft hover:text-accent',
        className,
      )}
    >
      <LayoutGrid size={16} aria-hidden />
      <span className={requested === 'dark' ? 'flex-1 text-left' : undefined}>{requested === 'dark' ? LABEL : 'アプリ切替'}</span>
    </Link>
  );
}
