'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type NotificationItem = {
  id: string;
  title?: string;
  message?: string;
  kind?: string;
  read?: boolean;
  created_at?: any;
};

function dateLabel(value: any) {
  if (!value) return '';
  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : value._seconds
      ? new Date(value._seconds * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function NotificationsClient({ backHref }: { backHref: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch('/api/notifications?limit=80', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) setItems(data.notifications || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    setItems(prev => prev.map(current => current.id === item.id ? { ...current, read: true } : current));
    try {
      if (!user) return;
      const token = await user.getIdToken();
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, read: true }),
      });
    } catch {
      setItems(prev => prev.map(current => current.id === item.id ? { ...current, read: false } : current));
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 pb-32 font-sans text-slate-800">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3">
          <Link href={backHref} className="rounded-full bg-white p-3 text-slate-500 shadow-sm hover:bg-slate-50">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-indigo-400">Notifications</p>
            <h1 className="text-2xl font-black text-slate-900">通知</h1>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-400" size={32} /></div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
            <Bell className="mx-auto mb-3 text-slate-300" size={34} />
            <p className="text-sm font-bold text-slate-400">通知はまだありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <button key={item.id} onClick={() => markRead(item)} className={`w-full rounded-3xl border p-4 text-left shadow-sm transition ${item.read ? 'border-slate-100 bg-white' : 'border-indigo-100 bg-indigo-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${item.read ? 'bg-slate-100 text-slate-500' : 'bg-indigo-600 text-white'}`}>
                        {item.read ? '既読' : '未読'}
                      </span>
                      {item.kind && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">{item.kind}</span>}
                      <span className="text-xs font-bold text-slate-400">{dateLabel(item.created_at)}</span>
                    </div>
                    <h2 className="text-base font-black text-slate-900">{item.title || '通知'}</h2>
                    {item.message && <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">{item.message}</p>}
                  </div>
                  {!item.read && <CheckCircle2 className="shrink-0 text-indigo-500" size={20} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
