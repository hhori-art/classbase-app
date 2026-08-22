'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Pencil } from 'lucide-react';
import { auth } from '@/lib/firebase';

type StationCandidate = {
  name: string;
  canonical_name: string;
  line?: string;
  station_type?: string;
  source?: string;
};

type TransportStationSearchInputProps = {
  transportType?: string;
  line?: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
};

export default function TransportStationSearchInput({
  transportType,
  line,
  value,
  placeholder,
  onChange,
  onSelect,
}: TransportStationSearchInputProps) {
  const [stations, setStations] = useState<StationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [searchText, setSearchText] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!focused) setSearchText(value);
  }, [focused, value]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!transportType) {
        setStations([]);
        return;
      }

      setLoading(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        const params = new URLSearchParams({
          transport_type: transportType,
          q: searchText,
        });
        if (line) params.set('line', line);
        const res = await fetch(`/api/transport-stations?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.ok !== false) {
          setStations(Array.isArray(data.stations) ? data.stations : []);
        }
      } catch {
        if (!cancelled) setStations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = window.setTimeout(load, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [line, searchText, transportType]);

  const showList = focused && Boolean(transportType) && stations.length > 0;
  const showSelectedButton = Boolean(value) && !focused;

  const commitTextValue = () => {
    const nextValue = searchText.trim();
    if (!nextValue) {
      setSearchText(value);
      return;
    }

    const exact = stations.find(station => station.canonical_name === nextValue || station.name === nextValue);
    const committedValue = exact?.canonical_name || nextValue;
    onChange(committedValue);
    onSelect?.(committedValue);
    setSearchText(committedValue);
  };

  return (
    <div className="relative">
      {showSelectedButton ? (
        <button
          type="button"
          disabled={!transportType}
          className="flex min-h-[68px] w-full min-w-0 items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-left text-slate-900 shadow-sm outline-none hover:border-emerald-200 hover:bg-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
          title={value}
          onClick={() => {
            setFocused(true);
            setSearchText('');
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          <MapPin size={16} className="mt-4 shrink-0 text-emerald-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black leading-none text-emerald-600">選択中</span>
            <span className="mt-1 block whitespace-normal break-words text-base font-black leading-snug text-slate-900">
              {value}
            </span>
          </span>
          <Pencil size={15} className="mt-4 shrink-0 text-emerald-500" />
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              className="min-h-[52px] w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-base font-black text-slate-900 outline-none placeholder:text-sm placeholder:font-bold placeholder:text-slate-400 focus:border-green-400 focus:ring-2 focus:ring-green-100 disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={transportType ? (value ? '別の駅名を入力して変更' : placeholder) : '先に交通機関を選択'}
              value={searchText}
              disabled={!transportType}
              onFocus={() => {
                setFocused(true);
                if (value) setSearchText('');
              }}
              onBlur={() => {
                commitTextValue();
                window.setTimeout(() => setFocused(false), 120);
              }}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {loading ? (
              <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-300" />
            ) : (
              <MapPin size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" />
            )}
          </div>
          {focused && value && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black leading-snug text-emerald-800 ring-1 ring-emerald-100">
              現在: <span className="whitespace-normal break-words text-slate-900">{value}</span>
            </div>
          )}
        </div>
      )}
      {showList && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-96 w-[min(42rem,calc(100vw-2rem))] min-w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <div className="flex items-center justify-between gap-3 px-2 pb-2 text-[11px] font-black text-slate-400">
            <span>候補から選択してください</span>
            <span>{stations.length}件</span>
          </div>
          {stations.slice(0, 80).map(station => (
            <button
              key={`${station.source}-${station.line}-${station.canonical_name}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(station.canonical_name);
                onSelect?.(station.canonical_name);
                setSearchText(station.canonical_name);
                setFocused(false);
              }}
              className="flex w-full flex-col gap-1.5 rounded-xl px-4 py-3 text-left hover:bg-emerald-50"
            >
              <span className="whitespace-normal break-words text-base font-black leading-snug text-slate-900">
                {station.canonical_name}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(station.line || (station.source === 'fare_master' ? '運賃マスタ登録済み' : station.source === 'ekispert' ? '駅すぱあとAPI' : '駅名マスタ'))
                  .split(/[\/／,、]/)
                  .filter(Boolean)
                  .map(label => (
                    <span key={label} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black leading-none text-slate-500">
                      {label}
                    </span>
                  ))}
                {station.station_type && (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black leading-none text-emerald-600">
                    {station.station_type}
                  </span>
                )}
              </div>
            </button>
          ))}
          {stations.length > 80 && (
            <p className="px-3 py-2 text-[11px] font-bold text-slate-400">
              候補が多いため80件まで表示しています。駅名を入力すると絞り込めます。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
