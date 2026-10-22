'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, Modal, PageHeader, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { db } from '@/lib/firebase';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { CalendarDays, CheckCircle2, Megaphone, Send, Undo2 } from 'lucide-react';
import { formatDate, jstDateKey } from '@/lib/format';

type Post = {
  id: string;
  created_by?: string;
  teacher_id?: string;
  teacher_name?: string;
  requested_by_teacher?: boolean;
  requester_id?: string;
  target_date: string;
  period: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'closed';
  claimed_by?: string;
  claimed_by_name?: string;
  shift_assignment_id?: string;
  created_at?: any;
};

type OwnShift = {
  id: string;
  target_date: string;
  period: string;
  title: string;
  role_type: string;
  unit: string;
  target_place: string;
};

const CLAIM_ERRORS: Record<string, string> = {
  'shift-already-filled': 'この講師配置はすでに埋まっています。',
  'already-claimed-or-closed': 'この代行依頼はすでに締切または返答済みです。',
  'cannot-claim-own-request': '自分が出した代行依頼には返答できません。',
};
const REQUEST_ERRORS: Record<string, string> = {
  forbidden: '自分が担当している授業だけ代行を依頼できます。',
  'shift-in-past': '過ぎた授業の代行は依頼できません。',
  'already-requested': 'この授業の代行依頼はすでに出ています。',
  'reason-required': '理由を入力してください。',
  'reason-too-long': '理由は500文字以内で入力してください。',
};
const STATUS_LABEL: Record<Post['status'], string> = { open: '募集中', claimed: '引受済', closed: '締切' };

export default function TeacherSubstitutionsPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [ownShifts, setOwnShifts] = useState<OwnShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'mine' | 'all'>('open');
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({ shiftId: '', reason: '' });
  const [requesting, setRequesting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const authHeaders = async () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user!.getIdToken()}`,
  });

  const loadPosts = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const today = jstDateKey();
      const [snap, shiftRes] = await Promise.all([
        getDocs(query(
          collection(db, 'teacher_substitution_posts'),
          where('target_date', '>=', today),
          orderBy('target_date', 'asc'),
          limit(120)
        )),
        authHeaders().then(headers => fetch('/api/teacher/substitutions', { headers })),
      ]);
      const shiftData = await shiftRes.json().catch(() => ({}));
      if (!shiftRes.ok || shiftData.ok === false) throw new Error(shiftData.error || 'own-shifts-failed');
      setOwnShifts(Array.isArray(shiftData.shifts) ? shiftData.shifts : []);
      setPosts(snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Post))
        .filter(post => String(post.target_date || '') >= today)
      );
    } catch (e) {
      console.error(e);
      setPosts([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // シフト希望画面の「代行を依頼する」から来たときは、その授業を選んだ状態で開く。
  useEffect(() => {
    if (loading || loadError) return;
    const shiftId = new URLSearchParams(window.location.search).get('shift');
    if (!shiftId || !ownShifts.some(shift => shift.id === shiftId)) return;
    setRequestForm({ shiftId, reason: '' });
    setRequestOpen(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, [loading, loadError, ownShifts]);

  const ownShiftIds = useMemo(() => new Set(ownShifts.map(shift => shift.id)), [ownShifts]);
  const activeShiftIds = useMemo(() => new Set(posts
    .filter(post => post.status === 'open' || post.status === 'claimed')
    .map(post => post.shift_assignment_id)
    .filter(Boolean) as string[]), [posts]);
  const requestableShifts = useMemo(() => ownShifts.filter(shift => !activeShiftIds.has(shift.id)), [ownShifts, activeShiftIds]);

  const isMine = (post: Post) => Boolean(user) && (
    post.requester_id === user?.uid ||
    post.created_by === user?.uid ||
    post.claimed_by === user?.uid ||
    (post.shift_assignment_id ? ownShiftIds.has(post.shift_assignment_id) : false)
  );

  const visiblePosts = useMemo(() => posts.filter(post => {
    if (filter === 'open') return post.status === 'open';
    if (filter === 'mine') return isMine(post);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [posts, filter, user?.uid, ownShiftIds]);

  const openRequest = () => {
    setRequestForm({ shiftId: requestableShifts[0]?.id || '', reason: '' });
    setRequestOpen(true);
  };

  const submitRequest = async () => {
    if (!user) return;
    if (!requestForm.shiftId) return toast.error('代行してほしい授業を選んでください。');
    if (!requestForm.reason.trim()) return toast.error('理由を入力してください。');
    setRequesting(true);
    try {
      const res = await fetch('/api/teacher/substitutions', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'request', shift_assignment_id: requestForm.shiftId, reason: requestForm.reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(REQUEST_ERRORS[data.error] || data.error || '代行を依頼できませんでした。');
        return;
      }
      toast.success('代行を依頼しました。管理者にも通知しました。');
      setRequestOpen(false);
      setFilter('mine');
      await loadPosts();
    } catch (e) {
      console.error(e);
      toast.error('代行を依頼できませんでした。');
    } finally {
      setRequesting(false);
    }
  };

  const cancelRequest = async (post: Post) => {
    if (!user) return;
    const ok = await confirm({
      title: 'この代行依頼を取り下げますか？',
      message: `${formatDate(post.target_date)} ${post.period}「${post.title}」`,
      confirmLabel: '取り下げる',
      tone: 'danger',
    });
    if (!ok) return;
    setCancellingId(post.id);
    try {
      const res = await fetch('/api/teacher/substitutions', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'cancel', post_id: post.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(CLAIM_ERRORS[data.error] || data.error || '取り下げられませんでした。');
      } else {
        toast.success('代行依頼を取り下げました。');
      }
      await loadPosts();
    } catch (e) {
      console.error(e);
      toast.error('取り下げられませんでした。');
    } finally {
      setCancellingId(null);
    }
  };

  const claimPost = async (post: Post) => {
    if (!user) return;
    const ok = await confirm({
      title: 'この代行に対応可能として返答しますか？',
      message: `${formatDate(post.target_date)} ${post.period}「${post.title}」`,
      confirmLabel: '代行できます',
    });
    if (!ok) return;
    setClaimingId(post.id);
    try {
      const res = await fetch('/api/teacher/substitutions', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ post_id: post.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(CLAIM_ERRORS[data.error] || data.error || '返答に失敗しました。');
        await loadPosts();
        return;
      }
      toast.success('代行できると返答しました。');
      await loadPosts();
    } catch (e) {
      console.error(e);
      toast.error('返答に失敗しました。');
    } finally {
      setClaimingId(null);
    }
  };

  const selectedShift = ownShifts.find(shift => shift.id === requestForm.shiftId);

  return (
    <div className="px-4 py-5 pb-28 sm:px-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          tone="plain"
          title="代行依頼掲示板"
          backHref="/teacher/work"
          actions={(
            <Button icon={<Megaphone size={17} />} onClick={openRequest} disabled={loading || loadError}>
              代行を依頼する
            </Button>
          )}
        />

        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-btn bg-accent-soft p-3 text-accent"><Megaphone size={22} aria-hidden /></div>
            <div>
              <h2 className="text-sm font-bold text-fg">代行の依頼と返答</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed text-fg-muted">
                今日以降の代行依頼を表示します。対応できる募集があれば「代行できます」を押してください。
                自分の授業に出られなくなったときは「代行を依頼する」から授業を選んで依頼できます（管理者にも通知されます）。
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-sm font-bold text-fg">募集一覧</h2>
            <div className="grid grid-cols-3 gap-2 rounded-btn bg-slate-100 p-1 text-xs font-bold">
              {[
                ['open', '募集中'],
                ['mine', '自分関連'],
                ['all', 'すべて'],
              ].map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key as typeof filter)} aria-pressed={filter === key} className={`min-h-9 rounded-input px-3 py-2 ${filter === key ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>{label}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <ListSkeleton />
          ) : loadError ? (
            <ErrorState onRetry={() => void loadPosts()} />
          ) : visiblePosts.length === 0 ? (
            <EmptyState
              title="表示できる募集はありません"
              description={filter === 'mine' ? '自分が出した依頼・返答した依頼・自分の授業の依頼がここに出ます。' : undefined}
            />
          ) : (
            <div className="space-y-3">
              {visiblePosts.map(post => {
                const ownRequest = post.requester_id === user?.uid;
                const ownShift = post.shift_assignment_id ? ownShiftIds.has(post.shift_assignment_id) : false;
                return (
                  <div key={post.id} className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-slate-600"><CalendarDays size={12} className="mr-1 inline" aria-hidden />{formatDate(post.target_date)} {post.period}</span>
                          <StatusPill tone={post.status === 'open' ? 'danger' : post.status === 'claimed' ? 'success' : 'neutral'}>
                            {STATUS_LABEL[post.status] || post.status}
                          </StatusPill>
                          {ownRequest && <StatusPill tone="accent">自分の依頼</StatusPill>}
                          {!ownRequest && ownShift && <StatusPill tone="info">自分の授業</StatusPill>}
                          {post.claimed_by === user?.uid && <StatusPill tone="success">自分が返答</StatusPill>}
                        </div>
                        <h3 className="text-base font-bold text-fg">{post.title}</h3>
                        <p className="mt-1 text-xs font-bold text-fg-muted">依頼元: {post.teacher_name || '管理者'}{post.claimed_by_name ? ` / 返答: ${post.claimed_by_name}` : ''}</p>
                        {post.shift_assignment_id && <p className="mt-1 text-xs font-bold text-accent">授業予定と連携しています。返答すると担当情報に反映されます。</p>}
                        {post.detail && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{post.detail}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {post.status === 'open' && ownRequest && (
                          <Button variant="secondary" icon={<Undo2 size={16} />} loading={cancellingId === post.id} disabled={cancellingId !== null} onClick={() => void cancelRequest(post)}>取り下げる</Button>
                        )}
                        {post.status === 'open' && !ownRequest && (
                          <Button icon={<CheckCircle2 size={16} />} loading={claimingId === post.id} disabled={claimingId !== null} onClick={() => void claimPost(post)}>代行できます</Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={requestOpen}
        onClose={() => { if (!requesting) setRequestOpen(false); }}
        title="代行を依頼する"
        description="自分が担当している今日以降の授業から選んでください。依頼すると掲示板に載り、管理者にも通知されます。"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRequestOpen(false)} disabled={requesting}>キャンセル</Button>
            <Button onClick={() => void submitRequest()} loading={requesting} disabled={!requestForm.shiftId || !requestForm.reason.trim()} icon={<Send size={16} />}>依頼する</Button>
          </>
        )}
      >
        {requestableShifts.length === 0 ? (
          <EmptyState
            title="依頼できる授業がありません"
            description={ownShifts.length ? '担当している授業は、すでに代行依頼が出ています。' : '今日以降に担当として配置されている授業がありません。'}
          />
        ) : (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-xs font-bold text-fg-muted">代行してほしい授業</legend>
              <div className="custom-scrollbar max-h-72 space-y-2 overflow-y-auto pr-1">
                {requestableShifts.map(shift => {
                  const checked = requestForm.shiftId === shift.id;
                  return (
                    <label key={shift.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-input border p-3 text-sm ${checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-slate-50'}`}>
                      <input
                        type="radio"
                        name="substitution-shift"
                        className="mt-1"
                        checked={checked}
                        onChange={() => setRequestForm(prev => ({ ...prev, shiftId: shift.id }))}
                      />
                      <span className="min-w-0">
                        <span className="block font-bold text-fg">{formatDate(shift.target_date)} {shift.period}</span>
                        <span className="block text-xs text-fg-muted">{[shift.title, shift.unit, shift.target_place].filter(Boolean).join(' / ')}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-fg-muted">理由・引き継ぎ事項</span>
              <textarea
                value={requestForm.reason}
                onChange={event => setRequestForm(prev => ({ ...prev, reason: event.target.value }))}
                maxLength={500}
                rows={4}
                placeholder="例: 大学の試験と重なったため。教材は共有フォルダにあります。"
                className="w-full rounded-input border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <span className="mt-1 block text-right text-xs text-fg-muted">{requestForm.reason.length}/500</span>
            </label>
            {selectedShift && (
              <p className="rounded-input bg-slate-50 p-3 text-xs text-fg-muted">
                代行が決まるまでは、この授業の担当はあなたのままです。返答があると担当が代行の講師に切り替わり、通知でお知らせします。
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
