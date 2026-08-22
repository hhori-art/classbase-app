'use client';

type GmMakeupButtonProps = {
  href: string;
  periodStart: string;
  periodEnd: string;
  now?: Date;
  label?: string;
};

export default function GmMakeupButton({
  href,
  periodStart,
  periodEnd,
  now = new Date(),
  label = 'GM振替 入室',
}: GmMakeupButtonProps) {
  const start = new Date(`${periodStart}T00:00:00+09:00`);
  const end = new Date(`${periodEnd}T23:59:59+09:00`);
  const enabled = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && now >= start && now <= end;

  if (!enabled) return null;

  return (
    <a href={href} className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-indigo-700">
      {label}
    </a>
  );
}

