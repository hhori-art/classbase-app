'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { sortRows, type SortDirection, type SortValue } from '@/lib/table-sort';

export type TableSortState<K extends string> = { key: K; direction: SortDirection } | null;

/**
 * 読み込み済みの行を画面内で並べ替える。見出しを押すたびに 昇順 → 降順 → 元の順 と切り替わる。
 * accessors には列ごとに「並べ替えに使う値」を返す関数を渡す。
 */
export function useTableSort<T, K extends string>(rows: readonly T[], accessors: Record<K, (row: T) => SortValue>, initial: TableSortState<K> = null) {
  const [sort, setSort] = useState<TableSortState<K>>(initial);
  const toggle = useCallback((key: K) => {
    setSort(current => current?.key !== key ? { key, direction: 'asc' } : current.direction === 'asc' ? { key, direction: 'desc' } : null);
  }, []);
  // accessors は毎回作り直されることが多いので、並べ替えの状態とデータが変わったときだけ計算する。
  const accessor = sort ? accessors[sort.key] : null;
  const sorted = useMemo(
    () => sort && accessor ? sortRows(rows, accessor, sort.direction) : [...rows],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort],
  );
  const headerProps = (key: K) => ({ sortKey: key, sort, onSort: toggle });
  return { sorted, sort, setSort, toggle, headerProps };
}

/** 並べ替えできる表の見出し。ボタンなので Tab・Enter・Space で操作でき、aria-sort で読み上げにも伝わる。 */
export function SortableHeader<K extends string>({ sortKey, sort, onSort, children, className, align = 'left' }: {
  sortKey: K;
  sort: TableSortState<K>;
  onSort: (key: K) => void;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sort?.key === sortKey;
  const direction = active ? sort?.direction : undefined;
  const Icon = direction === 'asc' ? ChevronUp : direction === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'} className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex min-h-9 items-center gap-1 rounded-input font-bold transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          active && 'text-slate-700',
          align === 'right' && 'flex-row-reverse',
          align === 'center' && 'justify-center',
        )}
      >
        {children}
        <Icon size={14} aria-hidden className={active ? 'text-accent' : 'text-slate-300'} />
        <span className="sr-only">{direction === 'asc' ? '（昇順に並べ替え中）' : direction === 'desc' ? '（降順に並べ替え中）' : '（押すと並べ替え）'}</span>
      </button>
    </th>
  );
}
