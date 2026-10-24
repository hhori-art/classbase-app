'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Coins, Minus, Plus, Search, UserRound } from 'lucide-react';
import { Button, EmptyState, ErrorState, ListSkeleton, Skeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { BADGE_RARITY_LABELS, BADGE_RARITY_STYLES, MANUAL_BADGES } from '@/lib/gamification';
import { adminApi, inputClass, labelClass, newOperationId } from './api';
import { userErrorMessage } from '@/lib/user-error';

type Student = { id: string; name: string; grade: string; school: string; login_id: string; coins: number; total_coins: number; badge_count: number; inactive: boolean; shop_override: boolean };
type HistoryItem = { id: string; amount: number; reason: string; source: string; created_at: string | null };

const REASON_PRESETS = ['授業での積極的な発言', 'テストの頑張り', 'イベント参加', '修正（誤付与の取り消し）'];

export default function StudentPointsPanel({ isMaster = false }: { isMaster?: boolean }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Student | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [earnedBadges, setEarnedBadges] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [sign, setSign] = useState<1 | -1>(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailError, setDetailError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await adminApi<{ students: Student[] }>('/api/admin/points');
      setStudents(data.students || []);
    } catch (error) {
      console.error(error);
      setLoadError(userErrorMessage(error, '生徒を取得できませんでした'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStudents(); }, [loadStudents]);

  const openStudent = async (student: Student) => {
    setSelected(student);
    setDetailError('');
    setDetailLoading(true);
    try {
      const data = await adminApi<{ history: HistoryItem[]; earned_badges: string[] }>(`/api/admin/points?user_id=${encodeURIComponent(student.id)}`);
      setHistory(data.history || []);
      setEarnedBadges(data.earned_badges || []);
    } catch (error) {
      console.error(error);
      setDetailError(error instanceof Error ? error.message : '履歴を取得できませんでした');
    } finally {
      setDetailLoading(false);
    }
  };

  const visible = useMemo(() => {
    const text = keyword.trim();
    return students.filter(student => !text || `${student.name} ${student.login_id} ${student.grade} ${attendanceSchoolName(student.school) || student.school}`.includes(text)).slice(0, 200);
  }, [students, keyword]);

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const value = Number(amount) * sign;
    if (!Number.isInteger(value) || value === 0) return toast.error('コイン数を整数で入力してください');
    if (!reason.trim()) return toast.error('理由を入力してください（生徒の履歴に表示されます）');
    if (!(await confirm({
      title: `${selected.name} さんのコインを ${value > 0 ? '+' : ''}${value} しますか？`,
      message: `理由：${reason.trim()}`,
      confirmLabel: value > 0 ? '追加する' : '減らす',
      tone: value > 0 ? 'default' : 'danger',
    }))) return;
    setBusy(true);
    try {
      const data = await adminApi<{ coins: number }>('/api/admin/points', {
        body: { action: 'adjust', user_id: selected.id, amount: value, reason: reason.trim(), adjustment_id: newOperationId() },
      });
      const updated = { ...selected, coins: data.coins, total_coins: selected.total_coins + Math.max(0, value) };
      setSelected(updated);
      setStudents(prev => prev.map(student => student.id === updated.id ? updated : student));
      setAmount('');
      setReason('');
      toast.success(`コインを${value > 0 ? '追加' : '減らし'}ました（現在 ${data.coins.toLocaleString()} コイン）`);
      await openStudent(updated);
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '更新できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const toggleShopOverride = async () => {
    if (!selected) return;
    const enabled = !selected.shop_override;
    if (!(await confirm(enabled
      ? { title: `${selected.name} さんにだけ景品交換・ガチャを表示しますか？`, message: '全体設定がオフでも表示されます。', confirmLabel: '表示する' }
      : { title: `${selected.name} さんの個別表示をやめますか？`, confirmLabel: 'やめる' }))) return;
    setBusy(true);
    try {
      await adminApi('/api/admin/points', { body: { action: 'set_shop_override', user_id: selected.id, enabled } });
      const updated = { ...selected, shop_override: enabled };
      setSelected(updated);
      setStudents(prev => prev.map(student => student.id === updated.id ? updated : student));
      toast.success(enabled ? '景品交換・ガチャを個別に表示しました（生徒は再ログイン後に反映）' : '個別表示をやめました');
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '更新できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const toggleBadge = async (badgeId: string) => {
    if (!selected) return;
    const granting = !earnedBadges.includes(badgeId);
    setBusy(true);
    try {
      await adminApi('/api/admin/points', { body: { action: granting ? 'grant_badge' : 'revoke_badge', user_id: selected.id, badge_id: badgeId } });
      setEarnedBadges(prev => granting ? [...prev, badgeId] : prev.filter(id => id !== badgeId));
      toast.success(granting ? 'バッジを授与しました' : 'バッジを取り消しました');
    } catch (error) {
      console.error(error);
      toast.error(userErrorMessage(error, '更新できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <section className="rounded-card border border-line bg-surface p-4 shadow-card lg:col-span-5">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} aria-hidden />
          <input className={`${inputClass} pl-9`} aria-label="生徒を検索" placeholder="名前・ログインID・学年・校舎で検索" value={keyword} onChange={e => setKeyword(e.target.value)} />
        </div>
        {loading ? <ListSkeleton rows={5} /> : loadError ? <ErrorState message={loadError} onRetry={() => void loadStudents()} /> : (
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {visible.map(student => (
              <button key={student.id} onClick={() => void openStudent(student)} aria-pressed={selected?.id === student.id} className={`flex min-h-11 w-full items-center gap-3 rounded-btn px-3 py-2 text-left ${selected?.id === student.id ? 'bg-accent-soft ring-2 ring-accent/40' : 'hover:bg-slate-50'}`}>
                <UserRound size={18} className="shrink-0 text-slate-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{student.name}{student.inactive && <span className="ml-1 text-xs text-slate-400">（停止中）</span>}{student.shop_override && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">景品表示</span>}</p>
                  <p className="truncate text-xs font-medium text-slate-400">{attendanceSchoolName(student.school) || student.school || '校舎未設定'} {student.grade}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-bold text-amber-600"><Coins size={13} aria-hidden />{student.coins.toLocaleString()}</span>
              </button>
            ))}
            {visible.length === 0 && <EmptyState title="該当する生徒がいません" description={keyword ? '検索の言葉を変えてみてください。' : undefined} />}
            {students.length > visible.length && !keyword && <p className="pt-2 text-center text-xs font-medium text-slate-400">先頭200名を表示しています。検索で絞り込んでください。</p>}
          </div>
        )}
      </section>

      <section className="space-y-4 lg:col-span-7">
        {!selected ? (
          <EmptyState icon={UserRound} title="左の一覧から生徒を選んでください" description="コインの増減・特別バッジ・コイン履歴を確認できます。" />
        ) : (
          <>
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-400">{attendanceSchoolName(selected.school) || selected.school} {selected.grade}</p>
                  <h2 className="text-xl font-bold text-slate-800">{selected.name}</h2>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-400">所持 / 累計</p>
                  <p className="text-lg font-bold text-amber-600">{selected.coins.toLocaleString()} <span className="text-xs text-slate-400">/ {selected.total_coins.toLocaleString()}</span></p>
                </div>
              </div>
              <form onSubmit={adjust} className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <div className="flex overflow-hidden rounded-input border border-line">
                    <button type="button" aria-pressed={sign === 1} onClick={() => setSign(1)} className={`flex min-h-10 items-center gap-1 px-3 text-xs font-bold ${sign === 1 ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}><Plus size={14} aria-hidden />増やす</button>
                    <button type="button" aria-pressed={sign === -1} onClick={() => setSign(-1)} className={`flex min-h-10 items-center gap-1 px-3 text-xs font-bold ${sign === -1 ? 'bg-rose-500 text-white' : 'text-slate-500'}`}><Minus size={14} aria-hidden />減らす</button>
                  </div>
                  <input type="number" min={1} max={10000} className={inputClass} aria-label="コイン数" placeholder="コイン数" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <label className="block"><span className={labelClass}>理由（生徒のコイン履歴に表示されます）</span><input className={inputClass} value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
                <div className="flex flex-wrap gap-1">
                  {REASON_PRESETS.map(preset => <button type="button" key={preset} onClick={() => setReason(preset)} className="min-h-8 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-200">{preset}</button>)}
                </div>
                <Button type="submit" fullWidth loading={busy} icon={<Coins size={16} aria-hidden />}>コインを反映する</Button>
              </form>
              {isMaster && (
                <label className="mt-4 flex items-center justify-between gap-3 rounded-btn bg-amber-50 p-3 text-xs font-bold text-amber-900">
                  <span>この生徒にだけ景品交換・ガチャを表示する<br /><span className="text-xs font-medium text-amber-700">全体設定（設定 → 景品交換）がオフでも表示されます。テスト用アカウント向け。</span></span>
                  <input type="checkbox" checked={selected.shop_override} disabled={busy} onChange={() => void toggleShopOverride()} className="h-5 w-5" />
                </label>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-800"><Award size={18} className="text-accent" aria-hidden />講師からの特別バッジ</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MANUAL_BADGES.map(badge => {
                  const earned = earnedBadges.includes(badge.id);
                  return (
                    <button key={badge.id} disabled={busy || detailLoading} onClick={() => void toggleBadge(badge.id)}
                      aria-pressed={earned} className={`rounded-btn border-2 p-3 text-left disabled:opacity-50 ${earned ? BADGE_RARITY_STYLES[badge.rarity] : 'border-dashed border-slate-200 bg-white opacity-70'}`}>
                      <div className="text-2xl">{badge.icon}</div>
                      <p className="text-xs font-bold text-slate-800">{badge.name}</p>
                      <p className="text-xs font-medium text-slate-400">{BADGE_RARITY_LABELS[badge.rarity]}・{earned ? 'タップで取り消し' : 'タップで授与'}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="mb-3 font-bold text-slate-800">最近のコイン履歴</h3>
              {detailLoading ? <div className="space-y-2" role="status" aria-label="読み込み中"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : detailError ? <ErrorState message={detailError} onRetry={() => void openStudent(selected)} /> : history.length === 0 ? <EmptyState icon={Coins} title="コイン履歴はまだありません" /> : (
                <ul className="divide-y divide-slate-50 text-sm">
                  {history.map(item => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0"><p className="truncate font-bold text-slate-700">{item.reason}</p><p className="text-xs font-medium text-slate-400">{(item.created_at && formatDateTime(item.created_at, { withYear: true })) || '-'}</p></div>
                      <span className={`shrink-0 font-bold ${item.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.amount >= 0 ? '+' : ''}{item.amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
