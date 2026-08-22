import Link from 'next/link';
import { ArrowLeft, PanelsTopLeft } from 'lucide-react';

type AppSwitcherLinkProps = {
  className?: string;
  inverse?: boolean;
};

export default function AppSwitcherLink({
  className = '',
  inverse = false,
}: AppSwitcherLinkProps) {
  return (
    <Link
      href="/apps"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-black shadow-sm transition ${
        inverse
          ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
      } ${className}`}
      aria-label="創造学園アプリ一覧へ戻る"
    >
      <ArrowLeft size={17} aria-hidden="true" />
      <PanelsTopLeft size={18} aria-hidden="true" />
      <span>創造学園アプリ一覧へ</span>
    </Link>
  );
}
