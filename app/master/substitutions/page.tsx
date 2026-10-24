'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { reportAuditLog } from '@/app/components/master/audit-log-client';
import { CalendarDays, CheckCircle2, ClipboardList, Megaphone, RefreshCw, Send, UserPlus, XCircle } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, EmptyState, ErrorState, ListSkeleton, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { jstDateKey } from '@/lib/date-key';
import { userErrorMessage } from '@/lib/user-error';

type Post = {
  id: string;
  teacher_name?: string;
  target_date: string;
  period: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'closed';
  claimed_by?: string;
  claimed_by_name?: string;
  shift_assignment_id?: string;
  requested_by_teacher?: boolean;
};

type EmptyShift = {
  id: string;
  target_date?: string;
  note?: string;
  role_type?: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  unit?: string;
  target_place?: string;
  teacher_name?: string;
  user_id?: string;
};

const REOPEN_ERRORS: Record<string, string> = {
  forbidden: 'この代行依頼を再募集する権限がありません。',
  'already-open': 'この代行依頼はすでに募集中です。',
  'post-not-found': 'この代行依頼は見つかりませんでした。',
};

const todayString = () => jstDateKey();
const dayLabel = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return '';
  return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
};
const substituteMarkers = ['⇒', '→', '代講', '代行', '未定', '調整', '募集'];
const needsSubstitute = (shift: EmptyShift) => {
  const name = String(shift.teacher_name || '').trim();
  if (!name) return true;
  return substituteMarkers.some(marker => name.includes(marker));
};
const postKeyPart = (value: unknown) => String(value || '').trim().replace(/[^\p{Letter}\p{Number}]+/gu, '_').slice(0, 60) || 'none';
const candidatePostId = (shift: EmptyShift, period: string, title: string) => [
  'shift',
  postKeyPart(shift.target_date),
  postKeyPart(period),
  postKeyPart(shift.target_grade),
  postKeyPart(shift.target_subject),
  postKeyPart(shift.target_detail_subject),
  postKeyPart(shift.unit),
  postKeyPart(shift.target_place),
  postKeyPart(title),
].join('__').slice(0, 900);

export default function MasterSubstitutionsPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'open' | 'claimed' | 'all'>('open');
  const [emptyShifts, setEmptyShifts] = useState<EmptyShift[]>([]);
  const [form, setForm] = useState({
    target_date: todayString(),
    period: '1限',
    title: '',
    detail: '',
  });

  const adminName = profile?.name || profile?.student_name || user?.displayName || '管理者';

  const periodFromShift = (shift: EmptyShift) => {
    const raw = `${shift.note || ''} ${shift.target_detail_subject || ''}`.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return '1限';
    if (raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return '2限';
    return shift.note || 'その他';
  };

  const shiftTitle = (shift: EmptyShift) => {
    const subject = [shift.target_grade, shift.target_subject, shift.target_detail_subject].filter(Boolean).join(' ');
    return subject || shift.note || '講師未定の授業';
  };

  const loadData = async () => {
    setLoading(true);
    setCandidateLoading(true);
    setLoadError(false);
    try {
      const today = todayString();
      const [snap, shiftSnap] = await Promise.all([
        getDocs(query(collection(db, 'teacher_substitution_posts'), orderBy('created_at', 'desc'), limit(120))),
        getDocs(query(collection(db, 'shift_assignments'), where('target_date', '>=', today), orderBy('target_date', 'asc'), limit(500))).catch(() => ({ docs: [] as any[] })),
      ]);
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
      const existingShiftIds = new Set(snap.docs.map(d => String((d.data() as any).shift_assignment_id || '')).filter(Boolean));
      const existingPostIds = new Set(snap.docs.map(d => d.id));
      setEmptyShifts(shiftSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as EmptyShift))
        .filter((shift: EmptyShift) => needsSubstitute(shift))
        .filter((shift: EmptyShift) => shift.role_type !== 'sub')
        .filter((shift: EmptyShift) => !existingShiftIds.has(shift.id))
        .filter((shift: EmptyShift) => !existingPostIds.has(candidatePostId(shift, periodFromShift(shift), shiftTitle(shift))))
        .slice(0, 30)
      );
    } catch (e) {
      console.error(e);
      setPosts([]);
      setEmptyShifts([]);
      setLoadError(true);
    } finally {
      setLoading(false);
      setCandidateLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const visiblePosts = useMemo(() => posts.filter(post => {
    if (filter === 'open') return post.status === 'open';
    if (filter === 'claimed') return post.status === 'claimed';
    return true;
  }), [posts, filter]);

  const createPost = async (candidate?: EmptyShift) => {
    if (!user) return;
    const targetDate = candidate?.target_date || form.target_date;
    const period = candidate ? periodFromShift(candidate) : form.period;
    const title = candidate ? shiftTitle(candidate) : form.title.trim();
    const detail = candidate
      ? [
        candidate.unit ? `単元: ${candidate.unit}` : '',
        candidate.target_place ? `場所: ${candidate.target_place}` : '',
        candidate.teacher_name ? `現在の講師欄: ${candidate.teacher_name}` : '',
        candidate.note ? `備考: ${candidate.note}` : '',
      ].filter(Boolean).join('\n')
      : form.detail.trim();
    if (!targetDate || !title) return toast.error('日付と件名を入力してください。');
    setSaving(true);
    try {
      const payload = {
        created_by: user.uid,
        teacher_name: adminName,
        target_date: targetDate,
        period,
        title,
        detail,
        shift_assignment_id: candidate?.id || null,
        shift_summary: candidate ? {
          target_grade: candidate.target_grade || '',
          target_subject: candidate.target_subject || '',
          target_detail_subject: candidate.target_detail_subject || '',
          unit: candidate.unit || '',
          target_place: candidate.target_place || '',
        } : null,
        status: 'open',
        updated_at: serverTimestamp(),
      };

      if (candidate) {
        const postRef = doc(db, 'teacher_substitution_posts', candidatePostId(candidate, period, title));
        const existing = await getDoc(postRef);
        if (existing.exists()) {
          const existingData = existing.data() as Post;
          if (existingData.status === 'open' || existingData.status === 'claimed') {
            toast.info('この講師配置の代行依頼はすでに作成済みです。');
            return;
          }
        }
        await setDoc(postRef, {
          ...payload,
          shift_assignment_id: candidate.id,
          created_at: existing.exists() ? existing.data().created_at || serverTimestamp() : serverTimestamp(),
        }, { merge: true });
      } else {
        await addDoc(collection(db, 'teacher_substitution_posts'), {
          ...payload,
          created_at: serverTimestamp(),
        });
      }
      setForm({ target_date: todayString(), period: '1限', title: '', detail: '' });
      toast.success('代行依頼を作成しました。');
      await loadData();
    } catch (e: any) {
      toast.error(`代行依頼を作成できませんでした。${userErrorMessage(e, '')}`);
    } finally {
      setSaving(false);
    }
  };

  const closePost = async (post: Post) => {
    if (!(await confirm({
      title: `「${post.title}」の代行依頼を締め切りますか？`,
      message: `${formatDate(post.target_date)} ${post.period}`,
      confirmLabel: '締め切る',
      tone: 'danger',
    }))) return;
    try {
      await updateDoc(doc(db, 'teacher_substitution_posts', post.id), {
        status: 'closed',
        updated_at: serverTimestamp(),
      });
      void reportAuditLog({
        action: 'substitution_close',
        target_type: 'teacher_substitution_post',
        target_id: post.id,
        target_label: post.title,
        details: { target_date: post.target_date, period: post.period, previous_status: post.status },
      });
      toast.success('代行依頼を締め切りました。');
    } catch (e) {
      console.error(e);
      toast.error('代行依頼を締め切れませんでした。もう一度お試しください。');
      return;
    }
    await loadData();
  };

  const reopenPost = async (post: Post) => {
    if (!user) return;
    const handsBack = post.requested_by_teacher && post.claimed_by_name;
    if (!(await confirm({
      title: `「${post.title}」の代行依頼を再募集しますか？`,
      message: post.claimed_by_name
        ? `「${post.claimed_by_name}」さんの返答は取り消されます。${handsBack ? '講師配置の担当は、依頼した講師に戻ります。' : ''}`
        : undefined,
      confirmLabel: '再募集する',
    }))) return;
    try {
      // 担当の戻し・通知・操作ログはサーバーでまとめて行う。
      const res = await fetch('/api/admin/substitutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action: 'reopen', post_id: post.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(REOPEN_ERRORS[data.error] || '再募集できませんでした。もう一度お試しください。');
        return;
      }
      toast.success(data.restored ? '代行依頼を再募集しました。担当は依頼した講師に戻りました。' : '代行依頼を再募集しました。');
    } catch (e) {
      console.error(e);
      toast.error('再募集できませんでした。もう一度お試しください。');
      return;
    }
    await loadData();
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        description="代行依頼の締切・再募集は管理者のみ行えます。講師も自分の担当授業について代行を依頼できます。"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={loadData} loading={loading}>再読み込み</Button>}
      />

      {loadError && <ErrorState title="代行依頼を読み込めませんでした" onRetry={loadData} />}

      <section className="rounded-card border border-line bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Megaphone className="text-accent" size={20} aria-hidden />
          <h2 className="text-sm font-bold text-slate-800">代行依頼を作成</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-[160px_120px_1fr]">
          <label>
            <span className="mb-1 block text-xs font-bold text-slate-500">日付</span>
            <input type="date" value={form.target_date} onChange={e => setForm(prev => ({ ...prev, target_date: e.target.value }))} className="w-full rounded-input border border-line px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-bold text-slate-500">時限</span>
            <select value={form.period} onChange={e => setForm(prev => ({ ...prev, period: e.target.value }))} className="w-full rounded-input border border-line px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20">
              <option>1限</option>
              <option>2限</option>
              <option>全日</option>
              <option>その他</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-bold text-slate-500">件名</span>
            <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="例: 中2理科 1限の代行をお願いします" className="w-full rounded-input border border-line px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
          </label>
        </div>
        <textarea value={form.detail} onChange={e => setForm(prev => ({ ...prev, detail: e.target.value }))} placeholder="詳細、引き継ぎ事項、集合場所、連絡方法など" className="mt-3 min-h-24 w-full resize-none rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
        <Button size="lg" fullWidth className="mt-3" onClick={() => createPost()} loading={saving} icon={<Send size={18} aria-hidden />}>
          代行依頼を作成
        </Button>
      </section>

      <section className="rounded-card border border-line bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="text-accent" size={20} aria-hidden />
          <h2 className="text-sm font-bold text-slate-800">講師未定の講師配置から作成</h2>
        </div>
        {candidateLoading ? (
          <ListSkeleton rows={2} />
        ) : loadError ? (
          <ErrorState onRetry={loadData} />
        ) : emptyShifts.length === 0 ? (
          <EmptyState icon={UserPlus} title="講師名が空欄の講師配置はありません" description="今日以降の講師配置で講師が未定のものがあると、ここから代行依頼を作れます。" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {emptyShifts.map(shift => (
              <div key={shift.id} className="rounded-btn border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">{shift.target_date ? formatDate(shift.target_date, { withWeekday: false }) : ''}（{dayLabel(shift.target_date || '')}） {periodFromShift(shift)}</span>
                  <StatusPill tone="warning">{shift.teacher_name ? '代講表示あり' : '講師未定'}</StatusPill>
                </div>
                <h3 className="text-sm font-bold text-slate-900">{shiftTitle(shift)}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{[shift.unit, shift.target_place, shift.note].filter(Boolean).join(' / ') || '詳細未設定'}</p>
                <Button variant="secondary" fullWidth className="mt-3" onClick={() => createPost(shift)} disabled={saving}>
                  この配置から代行依頼を作成
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-sm font-bold text-slate-800">依頼一覧</h2>
          <AdminTabs
            size="sm"
            ariaLabel="依頼の絞り込み"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'open', label: '募集中' },
              { id: 'claimed', label: '返答あり' },
              { id: 'all', label: 'すべて' },
            ]}
          />
        </div>

        {loading ? (
          <ListSkeleton rows={3} />
        ) : loadError ? (
          <ErrorState onRetry={loadData} />
        ) : visiblePosts.length === 0 ? (
          <EmptyState icon={ClipboardList} title="表示できる依頼はありません" description={filter === 'all' ? '代行依頼を作成すると、ここに一覧で出ます。' : '「すべて」に切り替えると、ほかの状態の依頼も確認できます。'} />
        ) : (
          <div className="space-y-3">
            {visiblePosts.map(post => (
              <div key={post.id} className="rounded-card border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600"><CalendarDays size={12} className="mr-1 inline" aria-hidden />{formatDate(post.target_date, { withWeekday: false })}（{dayLabel(post.target_date)}） {post.period}</span>
                      <StatusPill tone={post.status === 'open' ? 'accent' : post.status === 'claimed' ? 'success' : 'neutral'}>
                        {post.status === 'open' ? '募集中' : post.status === 'claimed' ? '返答あり' : '締切'}
                      </StatusPill>
                      {post.requested_by_teacher && <StatusPill tone="info">講師からの依頼</StatusPill>}
                    </div>
                    <h3 className="text-base font-bold text-slate-900">{post.title}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">作成: {post.teacher_name || '管理者'}{post.claimed_by_name ? ` / 代行可能: ${post.claimed_by_name}` : ''}</p>
                    {post.shift_assignment_id && <p className="mt-1 text-xs font-bold text-accent">講師配置連携済み</p>}
                    {post.detail && <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">{post.detail}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {post.status !== 'closed' && (
                      <Button variant="secondary" size="sm" onClick={() => closePost(post)} icon={<XCircle size={16} aria-hidden />}>締め切る</Button>
                    )}
                    {post.status !== 'open' && (
                      <Button variant="secondary" size="sm" onClick={() => reopenPost(post)} icon={<CheckCircle2 size={16} aria-hidden />}>再募集</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
