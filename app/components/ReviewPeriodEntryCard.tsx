'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadActiveReviewPeriods, type ReviewPeriodSummary } from '@/lib/client-review-periods';
import { formatShortDate } from '@/lib/format';
import { StatusPill } from '@/app/components/ui';

/**
 * 復習期間（理社講座）の受講設定への入口。
 * 生徒の学年で受付中（開始日 ≦ 今日（日本時間）≦ 終了日）の復習期間があるときだけ表示する。
 */
export default function ReviewPeriodEntryCard({ disabled = false, className = '' }: { disabled?: boolean; className?: string }) {
  const { user, profile } = useAuth();
  const [periods, setPeriods] = useState<ReviewPeriodSummary[]>([]);

  useEffect(() => {
    // 先生のプレビューや生徒以外では読み込まない（生徒向けの結果しか返らないため）。
    if (disabled || !user || profile?.role !== 'student') {
      setPeriods([]);
      return;
    }
    let active = true;
    loadActiveReviewPeriods(user.uid, () => user.getIdToken())
      .then(list => { if (active) setPeriods(list); })
      .catch(() => { if (active) setPeriods([]); });
    return () => { active = false; };
  }, [disabled, profile?.role, user]);

  if (periods.length === 0) return null;
  const first = periods[0];
  const extra = periods.length - 1;

  return (
    <Link href="/student/review-periods" className={`group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}>
      <div className="cb-card p-card transition-transform active:scale-[0.99]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-accent text-accent-ink shadow-sm"><CalendarDays size={26} aria-hidden /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-fg">復習期間の受講設定</h2>
                <StatusPill tone="accent">受付中</StatusPill>
              </div>
              <p className="mt-1 truncate text-xs font-medium text-fg-muted">
                {first.name || '復習期間'}（{formatShortDate(first.start_date)}〜{formatShortDate(first.end_date)}）{extra > 0 ? ` ほか${extra}件` : ''}
              </p>
            </div>
          </div>
          <ChevronRight size={24} aria-hidden className="shrink-0 text-accent transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  );
}
