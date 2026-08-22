'use client';

type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  _seconds?: number;
};

export function lastLoginToDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'object') {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const seconds = timestamp.seconds ?? timestamp._seconds;
    if (typeof seconds === 'number') {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  if (typeof value === 'number') {
    const date = new Date(value > 100000000000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatLastLogin(value: unknown) {
  const date = lastLoginToDate(value);
  if (!date) return { label: '未ログイン', detail: '', tone: 'empty' as const };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfLoginDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((startOfToday - startOfLoginDay) / 86400000);
  const time = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  const detail = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (diffDays === 0) return { label: `今日 ${time}`, detail, tone: 'fresh' as const };
  if (diffDays === 1) return { label: `昨日 ${time}`, detail, tone: 'recent' as const };
  if (diffDays <= 7) return { label: `${diffDays}日前`, detail, tone: 'recent' as const };

  return {
    label: new Intl.DateTimeFormat('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
    detail,
    tone: 'old' as const,
  };
}

export default function LastLoginCell({ value }: { value: unknown }) {
  const formatted = formatLastLogin(value);
  const className =
    formatted.tone === 'fresh'
      ? 'bg-emerald-50 text-emerald-700'
      : formatted.tone === 'recent'
        ? 'bg-blue-50 text-blue-700'
        : formatted.tone === 'old'
          ? 'bg-slate-100 text-slate-600'
          : 'bg-slate-50 text-slate-400';

  return (
    <div className="min-w-[128px]">
      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black ${className}`}>
        {formatted.label}
      </span>
      {formatted.detail ? (
        <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">{formatted.detail}</p>
      ) : null}
    </div>
  );
}
