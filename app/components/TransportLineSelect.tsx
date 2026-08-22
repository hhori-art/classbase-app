'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

type TransportLineSelectProps = {
  transportType?: string;
  value?: string;
  onChange: (value: string) => void;
};

export default function TransportLineSelect({
  transportType,
  value = '',
  onChange,
}: TransportLineSelectProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!transportType) {
        setLines([]);
        return;
      }

      setLoading(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        const params = new URLSearchParams({ transport_type: transportType });
        const res = await fetch(`/api/transport-stations?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.ok !== false) {
          setLines(Array.isArray(data.lines) ? data.lines.filter(Boolean) : []);
        }
      } catch {
        if (!cancelled) setLines([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [transportType]);

  useEffect(() => {
    if (value && lines.length > 0 && !lines.includes(value)) onChange('');
  }, [lines, onChange, value]);

  if (!transportType || lines.length <= 1) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[44px] w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-bold text-gray-700 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
    >
      <option value="">{loading ? '路線確認中' : '路線を選択'}</option>
      {lines.map(line => (
        <option key={line} value={line}>{line}</option>
      ))}
    </select>
  );
}
