'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Coins, Loader2, Minus, Plus, Search, UserRound } from 'lucide-react';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { BADGE_RARITY_LABELS, BADGE_RARITY_STYLES, MANUAL_BADGES } from '@/lib/gamification';
import { adminApi, inputClass, labelClass, newOperationId } from './api';

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
  const [message, setMessage] = useState('');

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi<{ students: Student[] }>('/api/admin/points');
      setStudents(data.students || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生徒を取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStudents(); }, [loadStudents]);

  const openStudent = async (student: Student) => {
    setSelected(student);
    setMessage('');
    setDetailLoading(true);
    try {
      const data = await adminApi<{ history: HistoryItem[]; earned_badges: string[] }>(`/api/admin/points?user_id=${encodeURIComponent(student.id)}`);
      setHistory(data.history || []);
      setEarnedBadges(data.earned_badges || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '履歴を取得できませんでした');
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
    if (!Number.isInteger(value) || value === 0) return setMessage('コイン数を整数で入力してください');
    if (!reason.trim()) return setMessage('理由を入力してください（生徒の履歴に表示されます）');
    if (!confirm(`${selected.name} さんのコインを ${value > 0 ? '+' : ''}${value} します。よろしいですか？`)) return;
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
      setMessage(`コインを${value > 0 ? '追加' : '減らし'}ました（現在 ${data.coins.toLocaleString()} コイン）`);
      await openStudent(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const toggleShopOverride = async () => {
    if (!selected) return;
    const enabled = !selected.shop_override;
    if (!confirm(enabled ? `${selected.name} さんにだけ景品交換・ガチャを表示しますか？（全体設定がオフでも表示されます）` : `${selected.name} さんの個別表示をやめますか？`)) return;
    setBusy(true);
    try {
      await adminApi('/api/admin/points', { body: { action: 'set_shop_override', user_id: selected.id, enabled } });
      const updated = { ...selected, shop_override: enabled };
      setSelected(updated);
      setStudents(prev => prev.map(student => student.id === updated.id ? updated : student));
      setMessage(enabled ? '景品交換・ガチャを個別に表示しました（生徒は再ログイン後に反映）' : '個別表示をやめました');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新できませんでした');
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
      setMessage(granting ? 'バッジを授与しました' : 'バッジを取り消しました');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <section className="rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm lg:col-span-5">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={15} />
          <input className={`${inputClass} pl-9`} placeholder="名前・ログインID・学年・校舎で検索" value={keyword} onChange={e => setKeyword(e.target.value)} />
        </div>
        {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-amber-500" /></div> : (
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {visible.map(student => (
              <button key={student.id} onClick={() => void openStudent(student)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${selected?.id === student.id ? 'bg-amber-50 ring-2 ring-amber-300' : 'hover:bg-slate-50'}`}>
                <UserRound size={18} className="shrink-0 text-slate-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{student.name}{student.inactive && <span className="ml-1 text-[10px] text-slate-400">（停止中）</span>}{student.shop_override && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700">景品表示</span>}</p>
                  <p className="truncate text-[11px] font-bold text-slate-400">{attendanceSchoolName(student.school) || student.school || '校舎未設定'} {student.grade}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-black text-amber-600"><Coins size={13} />{student.coins.toLocaleString()}</span>
              </button>
            ))}
            {visible.length === 0 && <p className="py-8 text-center text-sm font-bold text-slate-300">該当する生徒がいません</p>}
            {students.length > visible.length && !keyword && <p className="pt-2 text-center text-[11px] font-bold text-slate-400">先頭200名を表示しています。検索で絞り込んでください。</p>}
          </div>
        )}
      </section>

      <section className="space-y-4 lg:col-span-7">
        {!selected ? (
          <div className="rounded-[28px] border-4 border-dashed border-slate-100 bg-white py-20 text-center font-bold text-slate-300">左の一覧から生徒を選んでください</div>
        ) : (
          <>
            <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-400">{attendanceSchoolName(selected.school) || selected.school} {selected.grade}</p>
                  <h2 className="text-xl font-black text-slate-800">{selected.name}</h2>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold text-slate-400">所持 / 累計</p>
                  <p className="text-lg font-black text-amber-600">{selected.coins.toLocaleString()} <span className="text-xs text-slate-400">/ {selected.total_coins.toLocaleString()}</span></p>
                </div>
              </div>
              <form onSubmit={adjust} className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <div className="flex overflow-hidden rounded-xl border-2 border-slate-100">
                    <button type="button" onClick={() => setSign(1)} className={`flex items-center gap-1 px-3 text-xs font-black ${sign === 1 ? 'bg-emerald-500 text-white' : 'text-slate-400'}`}><Plus size={14} />増やす</button>
                    <button type="button" onClick={() => setSign(-1)} className={`flex items-center gap-1 px-3 text-xs font-black ${sign === -1 ? 'bg-rose-500 text-white' : 'text-slate-400'}`}><Minus size={14} />減らす</button>
                  </div>
                  <input type="number" min={1} max={10000} className={inputClass} placeholder="コイン数" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <label className="block"><span className={labelClass}>理由（生徒のコイン履歴に表示されます）</span><input className={inputClass} value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
                <div className="flex flex-wrap gap-1">
                  {REASON_PRESETS.map(preset => <button type="button" key={preset} onClick={() => setReason(preset)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-200">{preset}</button>)}
                </div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={16} /> : <Coins size={16} />}コインを反映する</button>
              </form>
              {isMaster && (
                <label className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-900">
                  <span>この生徒にだけ景品交換・ガチャを表示する<br /><span className="text-[11px] text-amber-700">全体設定（設定 → 景品交換）がオフでも表示されます。テスト用アカウント向け。</span></span>
                  <input type="checkbox" checked={selected.shop_override} disabled={busy} onChange={() => void toggleShopOverride()} className="h-5 w-5" />
                </label>
              )}
              {message && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">{message}</p>}
            </div>

            <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 font-black text-slate-800"><Award size={18} className="text-violet-500" />先生からの特別バッジ</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MANUAL_BADGES.map(badge => {
                  const earned = earnedBadges.includes(badge.id);
                  return (
                    <button key={badge.id} disabled={busy || detailLoading} onClick={() => void toggleBadge(badge.id)}
                      className={`rounded-2xl border-2 p-3 text-left disabled:opacity-50 ${earned ? BADGE_RARITY_STYLES[badge.rarity] : 'border-dashed border-slate-200 bg-white opacity-70'}`}>
                      <div className="text-2xl">{badge.icon}</div>
                      <p className="text-xs font-black text-slate-800">{badge.name}</p>
                      <p className="text-[10px] font-bold text-slate-400">{BADGE_RARITY_LABELS[badge.rarity]}・{earned ? 'タップで取り消し' : 'タップで授与'}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-3 font-black text-slate-800">最近のコイン履歴</h3>
              {detailLoading ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-amber-500" /></div> : history.length === 0 ? <p className="text-sm font-bold text-slate-300">履歴がありません</p> : (
                <ul className="divide-y divide-slate-50 text-sm">
                  {history.map(item => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0"><p className="truncate font-bold text-slate-700">{item.reason}</p><p className="text-[11px] font-bold text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleString('ja-JP') : '-'}</p></div>
                      <span className={`shrink-0 font-black ${item.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.amount >= 0 ? '+' : ''}{item.amount.toLocaleString()}</span>
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
