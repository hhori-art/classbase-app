'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/app/components/ui';
import { adminMenuEntryForPath } from '@/app/components/master/admin-menu';
import { cn } from '@/lib/cn';

/**
 * 管理画面の各ページ共通の見出し（共通の PageHeader tone="plain" を使う）。
 * 左のメニューがあるので「管理トップへ戻る」ボタンは置かない。
 * 親ページがある下層ページだけ backHref で小さく戻り先を出す（例：勤怠一覧 → 給与計算）。
 *
 * 見出し・分類名・アイコンは、渡さなければ左メニュー（ADMIN_MENU）の項目から決まる。
 * メニューと同じ名前にそろえるため、メニューにあるページでは title を渡さない。
 */
export default function AdminPageHeader({
  icon,
  kicker,
  title,
  description,
  actions,
  backHref,
  className,
}: {
  icon?: LucideIcon;
  /** 見出しの上の小さな分類名。省略するとメニューの分野名（例：「勤怠」）。 */
  kicker?: string;
  /** 省略するとメニューの項目名。 */
  title?: string;
  description?: ReactNode;
  /** 右側に置くボタンなど。 */
  actions?: ReactNode;
  backHref?: string;
  /** 互換のため残す。文言はガイドラインに合わせて常に「戻る」。 */
  backLabel?: string;
  className?: string;
}) {
  const pathname = usePathname() || '';
  const { item, section } = adminMenuEntryForPath(pathname);
  const eyebrow = section && section.id !== 'home' ? section.title : kicker;
  // 講師アプリ（専任）から開いた管理画面は、左メニューの項目がないので見出しを固定する。
  const fallbackTitle = pathname.startsWith('/teacher/school-students') ? '理社講座管理' : '管理画面';
  return (
    <PageHeader
      tone="plain"
      className={cn('mb-6', className)}
      eyebrow={eyebrow}
      title={title || item?.title || fallbackTitle}
      icon={icon || item?.icon}
      description={description}
      actions={actions}
      backHref={backHref}
      backLabel="戻る"
    />
  );
}
