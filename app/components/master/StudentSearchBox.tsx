'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/cn';

export type StudentSearchResult = {
  id: string;
  name: string;
  kana: string;
  grade: string;
  school_name: string;
  lifetime_id: string;
  inactive: boolean;
};

export const studentOverviewHref = (id: string) => `/master/students/${encodeURIComponent(id)}`;

/**
 * 生徒検索（名前・ふりがな・ログインID／生涯番号）。選ぶと生徒の総合ページを開く。
 * tone="dark" はサイドバー用、"light" はページ内用。
 */
export default function StudentSearchBox({ tone = 'light', autoFocus = false, onNavigate, className }: {
  tone?: 'dark' | 'light';
  autoFocus?: boolean;
  /** 生徒を選んだあと（スマホのメニューを閉じるなど）。 */
  onNavigate?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('missing-token');
        const res = await fetch(`/api/admin/students/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || 'search-failed');
        if (cancelled) return;
        setResults(Array.isArray(body.students) ? body.students : []);
        setActive(0);
        setState('done');
      } catch {
        if (!cancelled) { setResults([]); setState('error'); }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (student: StudentSearchResult) => {
    setOpen(false);
    setQuery('');
    onNavigate?.();
    router.push(studentOverviewHref(student.id));
  };

  const dark = tone === 'dark';
  const showList = open && query.trim().length > 0;

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <label className="sr-only" htmlFor={`${listId}-input`}>生徒を検索</label>
      <div className={cn(
        'flex min-h-10 items-center gap-2 rounded-input border px-3',
        dark ? 'border-slate-700 bg-slate-800/70 text-slate-200 focus-within:border-indigo-400' : 'border-line bg-surface text-fg focus-within:border-accent',
      )}>
        {state === 'loading'
          ? <Loader2 size={15} className="shrink-0 animate-spin opacity-70" aria-hidden />
          : <Search size={15} className="shrink-0 opacity-70" aria-hidden />}
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          autoComplete="off"
          value={query}
          placeholder="生徒を検索（名前・ID）"
          onChange={event => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, results.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && results[active]) { event.preventDefault(); go(results[active]); }
            if (event.key === 'Escape') setOpen(false);
          }}
          className={cn('min-w-0 flex-1 bg-transparent py-2 text-sm outline-none', dark ? 'placeholder:text-slate-500' : 'placeholder:text-fg-muted')}
        />
      </div>
      {showList && (
        <div id={`${listId}-list`} role="listbox" aria-label="生徒の検索結果"
          className="absolute inset-x-0 top-full z-overlay mt-1 max-h-80 overflow-y-auto rounded-btn border border-line bg-surface py-1 text-fg shadow-card">
          {state === 'error' ? (
            <p className="px-3 py-3 text-sm font-bold text-danger" role="alert">検索できませんでした。もう一度お試しください。</p>
          ) : state === 'loading' && results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-muted">検索中…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-muted">見つかりませんでした</p>
          ) : results.map((student, index) => (
            <button key={student.id} type="button" role="option" aria-selected={index === active}
              onMouseEnter={() => setActive(index)} onClick={() => go(student)}
              className={cn('flex min-h-11 w-full flex-col items-start px-3 py-2 text-left', index === active ? 'bg-accent-soft' : 'hover:bg-canvas')}>
              <span className="flex w-full items-center gap-2">
                <span className="truncate text-sm font-bold">{student.name}</span>
                {student.inactive && <span className="shrink-0 rounded-full bg-slate-100 px-2 text-[11px] font-bold text-slate-500">停止中</span>}
              </span>
              <span className="truncate text-xs text-fg-muted">
                {[student.school_name, student.grade, student.lifetime_id && `ID ${student.lifetime_id}`].filter(Boolean).join(' ・ ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
