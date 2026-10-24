'use client';

import { useAuth } from '@/app/context/AuthContext';
import { cn } from '@/lib/cn';

// 保護者画面で「どのお子さまを表示するか」を選ぶ共通の切り替え。
// 最後に選んだお子さまを端末に覚えておき（保護者のアカウントごと）、次に開いたときもその子を表示する。

export type ChildOption = { id: string; name?: string; grade?: string };

const storageKey = (uid: string) => `classbase_parent_child:${uid}`;

/** 最後に選んだお子さまの ID（覚えていなければ空文字）。 */
export function readRememberedChild(uid?: string | null) {
  if (!uid || typeof window === 'undefined') return '';
  try { return window.localStorage.getItem(storageKey(uid)) || ''; } catch { return ''; }
}

/** 選んだお子さまを覚える。 */
export function rememberChild(uid: string | null | undefined, childId: string) {
  if (!uid || !childId || typeof window === 'undefined') return;
  try { window.localStorage.setItem(storageKey(uid), childId); } catch { /* 保存できない端末では覚えない */ }
}

/** 表示するお子さまを決める：通知などのリンクで指定された子（?student_id=）→ 今の選択 → 最後に選んだ子 → 一覧の先頭 の順。 */
export function pickChildId(uid: string | null | undefined, ids: string[], current = '') {
  if (!current && typeof window !== 'undefined') {
    const requested = new URLSearchParams(window.location.search).get('student_id') || '';
    if (requested && ids.includes(requested)) {
      rememberChild(uid, requested);
      return requested;
    }
  }
  if (current && ids.includes(current)) return current;
  const remembered = readRememberedChild(uid);
  if (remembered && ids.includes(remembered)) return remembered;
  return ids[0] || '';
}

/**
 * お子さまの切り替えボタン。お子さまが1人なら何も出さない。
 * tone="hero" は紺の見出しの中に置くとき用。
 */
export default function ChildSwitcher({ options, value, onChange, tone = 'surface', label = '表示するお子さま', className }: {
  options: ChildOption[];
  value: string;
  onChange: (childId: string) => void;
  tone?: 'surface' | 'hero';
  label?: string;
  className?: string;
}) {
  const { user } = useAuth();
  if (options.length <= 1) return null;
  const hero = tone === 'hero';
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map(option => {
        const active = option.id === value;
        const name = option.name || 'お子さま';
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              rememberChild(user?.uid, option.id);
              if (!active) onChange(option.id);
            }}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-bold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              hero
                ? active ? 'bg-surface text-accent shadow-sm focus-visible:ring-white' : 'bg-white/10 text-accent-ink/85 ring-1 ring-white/20 hover:bg-white/20 focus-visible:ring-white'
                : active ? 'bg-accent text-accent-ink shadow-sm focus-visible:ring-accent' : 'bg-surface text-fg ring-1 ring-line hover:bg-accent-soft focus-visible:ring-accent',
            )}
          >
            <span className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              hero ? (active ? 'bg-accent text-accent-ink' : 'bg-white/15') : (active ? 'bg-white/20' : 'bg-accent-soft text-accent'),
            )} aria-hidden>
              {name.slice(0, 1)}
            </span>
            <span>{name}{option.grade ? <span className="ml-1 text-xs font-medium opacity-80">{option.grade}</span> : null}</span>
          </button>
        );
      })}
    </div>
  );
}
