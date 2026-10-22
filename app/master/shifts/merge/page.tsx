'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, GitMerge, Link2Off, RefreshCw, Video } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDate, jstDateKey } from '@/lib/format';
import { hasAdminAppPermission } from '@/lib/admin-app-permissions';

type MergeShift = {
  id: string;
  period: number;
  grade: string;
  subject: string;
  detail_subject: string;
  unit: string;
  teacher_name: string;
  school: string;
  meeting_id: string;
  merge_host_shift_id: string | null;
  merge_host_label: string | null;
  merge_audiences: Array<{ shift_id: string }>;
};

const shiftDay = (date: string, days: number) => jstDateKey(new Date(new Date(`${date}T12:00:00+09:00`).getTime() + days * 86_400_000));
const classLabel = (shift: MergeShift) => [shift.grade, shift.subject, shift.detail_subject].filter(Boolean).join(' ');

/**
 * 授業の合併：同じ日・同じ時限に全く同じ内容を行う授業を、1人の講師の授業（合併先）の Zoom に集約する。
 * 合併すると、合併した授業の生徒の参加ボタンは合併先の Zoom に入り、ボタンも1つにまとまる。
 */
export default function ShiftMergePage() {
  const { user, profile } = useAuth();
  // 合併を変更できるのは、マスターと理社講座の管理者だけ（サーバーでも確認する）。
  const canEdit = Boolean(profile && hasAdminAppPermission(profile.role, profile, 'science_social'));
  const toast = useToast();
  const confirm = useConfirm();
  const [date, setDate] = useState(() => jstDateKey());
  const [shifts, setShifts] = useState<MergeShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [hostByPeriod, setHostByPeriod] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/shift-merges?date=${date}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(response.status === 403 ? '授業の合併は、マスターと理社講座の管理者だけが使えます。' : body.error || '授業を読み込めませんでした。');
      setShifts(body.shifts || []);
      setHostByPeriod({});
      setSelected(new Set());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '授業を読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, [date, user]);

  useEffect(() => { if (canEdit) void load(); else setLoading(false); }, [canEdit, load]);

  const byPeriod = useMemo(() => {
    const groups = new Map<number, MergeShift[]>();
    shifts.forEach(shift => groups.set(shift.period, [...(groups.get(shift.period) || []), shift]));
    return Array.from(groups.entries()).sort(([a], [b]) => (a || 9) - (b || 9));
  }, [shifts]);

  const post = async (payload: Record<string, unknown>) => {
    const token = await user!.getIdToken();
    const response = await fetch('/api/admin/shift-merges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(response.status === 403 ? '授業の合併を変更できるのは、マスターと理社講座の管理者だけです。' : body.error || '処理できませんでした。');
    return body;
  };

  const merge = async (period: number) => {
    const hostId = hostByPeriod[period];
    const members = shifts.filter(shift => shift.period === period && selected.has(shift.id) && shift.id !== hostId);
    const host = shifts.find(shift => shift.id === hostId);
    if (!host) return toast.error('合併先（授業を行う講師の授業）を選んでください。');
    if (!members.length) return toast.error('合併する授業にチェックを付けてください。');
    if (!(await confirm({
      title: `${members.length}件の授業を「${classLabel(host)}（${host.teacher_name || '講師未定'}）」に合併しますか？`,
      message: (
        <div className="space-y-2">
          <p>合併した授業の生徒の参加ボタンは、合併先の Zoom（ID {host.meeting_id}）に入ります。同じ時間のボタンは1つにまとまります。</p>
          <ul className="list-disc pl-5">{members.map(member => <li key={member.id}>{classLabel(member)}（{member.teacher_name || '講師未定'}）</li>)}</ul>
          <p>合併した授業の講師は、ホスト開始ではなく合併先に参加者として入ります。合併先の録画は、合併した授業の生徒も見られます。</p>
        </div>
      ),
      confirmLabel: '合併する',
    }))) return;
    setBusy(`merge_${period}`);
    try {
      await post({ action: 'merge', host_shift_id: hostId, shift_ids: members.map(member => member.id) });
      toast.success(`${members.length}件の授業を合併しました。`);
      await load();
    } catch (mergeError) {
      toast.error(mergeError instanceof Error ? mergeError.message : '合併できませんでした。');
    } finally { setBusy(''); }
  };

  const unmerge = async (shift: MergeShift) => {
    if (!(await confirm({ title: `「${classLabel(shift)}」の合併を解除しますか？`, message: 'この授業の生徒の参加ボタンは、もとの講師の Zoom に戻ります。', confirmLabel: '解除する', tone: 'danger' }))) return;
    setBusy(`unmerge_${shift.id}`);
    try {
      await post({ action: 'unmerge', shift_id: shift.id });
      toast.success('合併を解除しました。');
      await load();
    } catch (unmergeError) {
      toast.error(unmergeError instanceof Error ? unmergeError.message : '解除できませんでした。');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="授業の合併"
        icon={GitMerge}
        backHref="/master/shifts"
        description="同じ日・同じ時限に全く同じ内容を行う授業を、1人の講師の授業（合併先）の Zoom にまとめます。生徒の参加ボタンも1つになります。"
        actions={<IconButton label="読み込み直す" variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? 'motion-safe:animate-spin' : ''} /></IconButton>}
      />

      <Card className="flex flex-wrap items-center gap-2">
        <IconButton label="前の日" variant="secondary" onClick={() => setDate(current => shiftDay(current, -1))}><ChevronLeft size={18} /></IconButton>
        <input type="date" value={date} onChange={event => event.target.value && setDate(event.target.value)} aria-label="授業日" className="min-h-11 rounded-input border border-line bg-canvas px-3 text-sm font-bold" />
        <IconButton label="次の日" variant="secondary" onClick={() => setDate(current => shiftDay(current, 1))}><ChevronRight size={18} /></IconButton>
        {date !== jstDateKey() && <Button size="sm" variant="secondary" onClick={() => setDate(jstDateKey())}>今日</Button>}
        <p className="text-sm font-bold text-fg-muted">{formatDate(date)}の授業</p>
      </Card>

      {!canEdit ? <EmptyState icon={GitMerge} title="授業の合併は、マスターと理社講座の管理者だけが使えます" /> : loading ? <ListSkeleton rows={4} /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : byPeriod.length === 0 ? (
        <EmptyState icon={Video} title="この日の授業（講師配置）はありません" />
      ) : byPeriod.map(([period, list]) => {
        const hostId = hostByPeriod[period] || '';
        const memberCount = list.filter(shift => selected.has(shift.id) && shift.id !== hostId).length;
        return (
          <Card key={period} padded={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-4 py-3">
              <h2 className="text-base font-bold text-fg">{period ? `${period}限` : '時限不明'}<span className="ml-2 text-xs text-fg-muted">{list.length}件</span></h2>
              {period > 0 && (
                <Button size="sm" icon={<GitMerge size={15} aria-hidden />} disabled={!hostId || memberCount === 0} loading={busy === `merge_${period}`} onClick={() => void merge(period)}>
                  {memberCount > 0 ? `${memberCount}件を合併する` : '合併する'}
                </Button>
              )}
            </div>
            <p className="border-b border-line px-4 py-2 text-xs font-bold text-fg-muted">授業を行う講師の授業を「合併先」に選び、まとめる授業にチェックを付けて「合併する」を押します。</p>
            <ul className="divide-y divide-line">
              {list.map(shift => {
                const isHost = shift.merge_audiences.length > 0;
                const merged = Boolean(shift.merge_host_shift_id);
                return (
                  <li key={shift.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    {period > 0 && !merged && (
                      <div className="flex shrink-0 items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-fg-muted">
                          <input type="radio" name={`host_${period}`} checked={hostId === shift.id} onChange={() => setHostByPeriod(current => ({ ...current, [period]: shift.id }))} disabled={!shift.meeting_id} className="h-4 w-4 accent-accent" />合併先
                        </label>
                        {!isHost && (
                          <label className="inline-flex items-center gap-1.5 text-xs font-bold text-fg-muted">
                            <input type="checkbox" checked={selected.has(shift.id) && hostId !== shift.id} disabled={hostId === shift.id} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(shift.id)) next.delete(shift.id); else next.add(shift.id); return next; })} className="h-4 w-4 accent-accent" />まとめる
                          </label>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-fg">{classLabel(shift) || '授業名未設定'}{shift.unit ? <span className="ml-2 text-xs font-bold text-fg-muted">{shift.unit}</span> : null}</p>
                      <p className="mt-0.5 text-xs font-bold text-fg-muted">{shift.teacher_name || '講師未定'}{shift.school ? ` ・ ${shift.school}` : ''} ・ {shift.meeting_id ? `Zoom ${shift.meeting_id}` : 'Zoom未設定'}</p>
                      {isHost && <p className="mt-1 text-xs font-bold text-indigo-700">合併先：ほか{shift.merge_audiences.length}件の授業の生徒もこの Zoom に入ります</p>}
                      {merged && <p className="mt-1 text-xs font-bold text-indigo-700">合併済み：{shift.merge_host_label || '合併先の授業'}の Zoom に集約</p>}
                    </div>
                    {merged && (
                      <Button size="sm" variant="secondary" icon={<Link2Off size={15} aria-hidden />} loading={busy === `unmerge_${shift.id}`} onClick={() => void unmerge(shift)}>解除</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
