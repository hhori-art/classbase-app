import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NUMERIC_NAME_NOTICE, isNumberOnlyName } from '@/lib/no-personal-info-schools';

/** 名前が生徒番号で表示されているときに、その理由（セキュリティ上の理由）を添える。名前が番号でなければ何も出さない。 */
export default function NumericNameNotice({ name, tone = 'plain', className }: { name: unknown; tone?: 'plain' | 'hero'; className?: string }) {
  if (!isNumberOnlyName(name)) return null;
  return (
    <p className={cn(
      'flex items-start gap-1.5 text-xs font-bold leading-relaxed',
      tone === 'hero' ? 'text-current opacity-90' : 'text-fg-muted',
      className,
    )}>
      <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
      {NUMERIC_NAME_NOTICE}
    </p>
  );
}
