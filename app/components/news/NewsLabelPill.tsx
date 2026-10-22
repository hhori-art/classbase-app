import { AlertTriangle, Info, PartyPopper, Tag } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/app/components/ui';
import { TERMS } from '@/lib/glossary';

const LABELS: Record<string, { text: string; tone: StatusTone; icon: typeof Tag }> = {
  important: { text: '重要', tone: 'warning', icon: Tag },
  event: { text: 'イベント', tone: 'accent', icon: PartyPopper },
  alert: { text: '緊急', tone: 'danger', icon: AlertTriangle },
  info: { text: TERMS.news, tone: 'info', icon: Info },
};

/** お知らせの種類のラベル（ラベルなしは「お知らせ」）。 */
export function NewsLabelPill({ label }: { label?: string }) {
  const item = LABELS[String(label || 'info')] || LABELS.info;
  const Icon = item.icon;
  return <StatusPill tone={item.tone} icon={<Icon size={12} aria-hidden />}>{item.text}</StatusPill>;
}
