'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, CalendarX, CheckCircle, Clock, Eye, MessageCircle, RefreshCw, Search, Smartphone, Sparkles, Users,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import {
  Button, ButtonLink, Card, EmptyState, ErrorState, ListSkeleton, Modal, PageHeader, StatusPill, useConfirm, useToast,
  type StatusTone,
} from '@/app/components/ui';
import { formatDateTime, formatShortDate } from '@/lib/format';
import type { AttentionBand, AttentionCategory, AttentionSignal } from '@/lib/student-attention';

type Week = { start: string; current: boolean; expected: boolean; attended: boolean };
type Handled = { key: string; label: string; status: 'contacted' | 'watch'; note: string; actor_name: string; at: string | null };
type Item = {
  id: string;
  student_name: string;
  grade: string;
  classroom: string;
  band: AttentionBand | null;
  score: number;
  signals: AttentionSignal[];
  handled: Handled[];
  weeks: Week[];
  last_login: string | null;
  last_action: { status: string; note: string; actor_name: string; at: string | null } | null;
  ai: { risk: number; reason: string; action: string } | null;
};
type Onboarding = { id: string; student_name: string; grade: string; classroom: string; status: 'never' | 'inactive'; last_login: string | null };

const BANDS: Record<AttentionBand, { label: string; tone: StatusTone; hint: string }> = {
  urgent: { label: '今すぐ', tone: 'danger', hint: '質問への返信、または理由が重なっている生徒' },
  this_week: { label: '今週中に', tone: 'warning', hint: '次の授業までに声をかけたい生徒' },
  watch: { label: '気にかける', tone: 'info', hint: '小さな変化。授業のときにひと声' },
};

const CATEGORIES: Array<{ key: AttentionCategory | 'all'; label: string; icon: typeof Users }> = [
  { key: 'all', label: 'すべて', icon: Users },
  { key: 'contact', label: '質問・連絡', icon: MessageCircle },
  { key: 'attendance', label: '出席', icon: CalendarX },
  { key: 'homework', label: '宿題', icon: BookOpen },
  { key: 'learning', label: '学習', icon: Sparkles },
  { key: 'app', label: 'アプリ', icon: Smartphone },
];
const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map(item => [item.key, item.icon])) as Record<AttentionCategory, typeof Users>;

const STATUS_LABEL: Record<string, string> = { contacted: '声かけ済み', watch: '様子を見る' };

function WeekStrip({ weeks }: { weeks: Week[] }) {
  return (
    <div className="flex items-center gap-1" aria-label="直近8週の授業参加">
      {weeks.map(week => {
        const state = week.attended ? 'attended' : week.current ? 'current' : week.expected ? 'missed' : 'none';
        const cls = {
          attended: 'bg-emerald-500',
          missed: 'bg-rose-400',
          current: 'border-2 border-dashed border-slate-300 bg-surface',
          none: 'bg-slate-200',
        }[state];
        const label = { attended: '参加', missed: '不参加', current: '今週', none: '授業なし' }[state];
        return <span key={week.start} title={`${formatShortDate(week.start)}の週：${label}`} className={`h-3 w-5 rounded-full ${cls}`} />;
      })}
    </div>
  );
}

export default function AttentionListPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [transition, setTransition] = useState(false);
  const [onboarding, setOnboarding] = useState<Onboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [view, setView] = useState<'open' | 'handled' | 'onboarding'>('open');
  const [category, setCategory] = useState<AttentionCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<{ item: Item; status: 'contacted' | 'watch' } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/teacher/attention', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'attention-load-failed');
      setItems(data.items || []);
      setStudentCount(Number(data.student_count || 0));
      setTransition(Boolean(data.transition));
      setOnboarding(data.onboarding || []);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const openItems = useMemo(() => items.filter(item => item.band), [items]);
  const handledItems = useMemo(() => items.filter(item => item.handled.length), [items]);
  const counts = useMemo(() => ({
    urgent: openItems.filter(item => item.band === 'urgent').length,
    this_week: openItems.filter(item => item.band === 'this_week').length,
    watch: openItems.filter(item => item.band === 'watch').length,
  }), [openItems]);

  const visible = useMemo(() => {
    const q = search.trim();
    return (view === 'open' ? openItems : handledItems).filter(item => {
      if (q && !`${item.student_name} ${item.grade} ${item.classroom}`.includes(q)) return false;
      if (view === 'open' && category !== 'all' && !item.signals.some(signal => signal.category === category)) return false;
      return true;
    });
  }, [category, handledItems, openItems, search, view]);

  const startAction = (item: Item, status: 'contacted' | 'watch') => {
    setTarget({ item, status });
    setSelectedKeys(item.signals.filter(signal => signal.resolvable).map(signal => signal.key));
    setNote('');
  };

  const saveAction = async () => {
    if (!target || !user || !selectedKeys.length) return;
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/attention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({
          student_id: target.item.id,
          status: target.status,
          note,
          signals: target.item.signals.filter(signal => selectedKeys.includes(signal.key)).map(signal => ({ key: signal.key, fingerprint: signal.fingerprint })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'attention-save-failed');
      toast.success(`${target.item.student_name}さんを「${STATUS_LABEL[target.status]}」にしました。`);
      setTarget(null);
      await load();
    } catch (error) {
      console.error(error);
      toast.error('記録できませんでした。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  const runAiAnalysis = async () => {
    if (!(await confirm({
      title: 'AIの退塾予測を更新しますか？',
      message: '数分かかることがあります。AIの予測は参考として小さく加点するだけで、並び順はおもに出席・宿題・学習の記録で決まります。',
      confirmLabel: '更新する',
    }))) return;
    setAnalyzing(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('not-authenticated');
      const res = await fetch('/api/teacher/analyze-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batchSize: 50 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { toast.error('更新の回数が上限に達しました。しばらくしてからお試しください。'); return; }
      if (!res.ok) throw new Error(data.error || 'analyze-failed');
      toast.success(`AI予測を更新しました（${data.processed}人）。`);
      await load();
    } catch (error) {
      console.error(error);
      toast.error('AI予測を更新できませんでした。');
    } finally {
      setAnalyzing(false);
    }
  };

  const tabClass = (active: boolean) =>
    `min-h-9 rounded-input px-4 py-2 text-xs font-bold transition-colors ${active ? 'bg-surface text-fg shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          tone="plain"
          title="声かけリスト"
          icon={AlertTriangle}
          description="出席・宿題・学習・連絡の記録から、声をかける順に並べています。"
          backHref="/teacher/work"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void load()} icon={<RefreshCw size={16} aria-hidden />}>読み込み直す</Button>
              <Button variant="ghost" onClick={runAiAnalysis} loading={analyzing} icon={<Sparkles size={16} aria-hidden />}>AI予測を更新</Button>
            </div>
          )}
        />

        {!loading && !loadError && transition && (
          <div className="rounded-card border border-sky-200 bg-info-soft px-4 py-3 text-sm leading-relaxed text-fg">
            <p className="font-bold text-info">移行期間の判定です</p>
            <p className="mt-1 text-xs text-fg-muted">
              旧システムと併用中のため、ログインや授業参加の記録が少なくても、それだけでは声かけの理由にしていません。
              出席は、アプリで3週以上参加している生徒だけを、控えめな点数で見ています。アプリをまだ使っていない生徒は「アプリ未利用」タブにまとめています。
            </p>
          </div>
        )}

        {!loading && !loadError && (
          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(BANDS) as AttentionBand[]).map(band => (
              <Card key={band} className="!p-4">
                <StatusPill tone={BANDS[band].tone}>{BANDS[band].label}</StatusPill>
                <p className="mt-2 text-3xl font-black text-fg">{counts[band]}<span className="ml-1 text-sm font-bold text-fg-muted">人</span></p>
                <p className="mt-1 hidden text-xs text-fg-muted sm:block">{BANDS[band].hint}</p>
              </Card>
            ))}
          </div>
        )}

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-btn bg-slate-100 p-1" role="group" aria-label="表示">
              <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')} className={tabClass(view === 'open')}>声をかける（{openItems.length}）</button>
              <button type="button" aria-pressed={view === 'handled'} onClick={() => setView('handled')} className={tabClass(view === 'handled')}>対応の記録（{handledItems.length}）</button>
              {transition && <button type="button" aria-pressed={view === 'onboarding'} onClick={() => setView('onboarding')} className={tabClass(view === 'onboarding')}>アプリ未利用（{onboarding.length}）</button>}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} aria-hidden />
              <input
                type="text"
                placeholder="名前・学年で探す"
                aria-label="名前・学年で探す"
                className="min-h-11 w-52 rounded-input border border-line bg-surface py-2 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-accent/30"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
          </div>
          {view === 'open' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="理由で絞り込む">
              {CATEGORIES.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors ${category === key ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-muted hover:border-accent/40'}`}
                >
                  <Icon size={13} aria-hidden />{label}
                </button>
              ))}
            </div>
          )}
        </Card>

        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState onRetry={() => void load()} />
        ) : view === 'onboarding' ? (
          <Card>
            <p className="text-xs leading-relaxed text-fg-muted">移行を進めるための一覧です。声かけの優先順位には入れていません。ID書面が届いているか、ログインできているかの確認にお使いください。</p>
            {onboarding.filter(item => !search.trim() || `${item.student_name} ${item.grade} ${item.classroom}`.includes(search.trim())).length === 0 ? (
              <p className="mt-4 text-sm font-bold text-fg">該当する生徒はいません。</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {onboarding.filter(item => !search.trim() || `${item.student_name} ${item.grade} ${item.classroom}`.includes(search.trim())).map(item => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <StatusPill tone={item.status === 'never' ? 'warning' : 'neutral'}>{item.status === 'never' ? '未ログイン' : '14日以上なし'}</StatusPill>
                    <span className="font-bold text-fg">{item.student_name}</span>
                    <span className="text-xs text-fg-muted">{[item.grade, item.classroom].filter(Boolean).join('・')}</span>
                    {item.last_login && <span className="ml-auto text-xs text-fg-muted">最終 {formatDateTime(item.last_login)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title={view === 'open' ? '今、声をかける必要がある生徒はいません' : '対応の記録はまだありません'}
            description={view === 'open' ? `担当の${studentCount}人を確認しました。` : '「声かけ済み」「様子を見る」にした生徒がここに出ます。'}
          />
        ) : (
          <ol className="grid gap-4">
            {visible.map((item, index) => (
              <li key={item.id}>
                <Card className={view === 'open' && item.band === 'urgent' ? 'border-rose-200' : ''}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {view === 'open' && <span className="text-sm font-black text-fg-muted">{index + 1}</span>}
                        {view === 'open' && item.band && <StatusPill tone={BANDS[item.band].tone}>{BANDS[item.band].label}</StatusPill>}
                        <h2 className="text-lg font-bold text-fg">{item.student_name}</h2>
                        {item.grade && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{item.grade}</span>}
                        {item.classroom && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{item.classroom}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                        <span className="inline-flex items-center gap-2">直近8週の参加 <WeekStrip weeks={item.weeks} /></span>
                        <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />最終ログイン {item.last_login ? formatDateTime(item.last_login) : 'なし'}</span>
                      </div>
                    </div>
                    {view === 'open' && <span className="text-xs font-bold text-fg-muted">優先度 {item.score}</span>}
                  </div>

                  {view === 'open' && (
                    <ul className="mt-4 space-y-2">
                      {item.signals.map(signal => {
                        const Icon = CATEGORY_ICON[signal.category] || AlertTriangle;
                        const ai = signal.key === 'ai_churn';
                        return (
                          <li key={signal.key} className={`flex gap-3 rounded-btn border px-3 py-2 ${ai ? 'border-violet-100 bg-violet-50/60' : 'border-line bg-canvas'}`}>
                            <Icon size={16} className={`mt-0.5 shrink-0 ${ai ? 'text-violet-600' : 'text-danger'}`} aria-hidden />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-fg">{signal.label}</p>
                              <p className="text-xs leading-relaxed text-fg-muted">{signal.detail}</p>
                              {ai && item.ai?.reason && <p className="mt-1 text-xs leading-relaxed text-violet-700">{item.ai.reason}{item.ai.action ? ` → ${item.ai.action}` : ''}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {item.handled.length > 0 && (
                    <div className={`mt-3 space-y-1 rounded-btn px-3 py-2 text-xs ${view === 'handled' ? 'bg-canvas' : 'bg-success-soft/50'}`}>
                      {item.handled.map(entry => (
                        <p key={entry.key} className="text-fg-muted">
                          <StatusPill tone={entry.status === 'contacted' ? 'success' : 'info'} className="mr-2">{STATUS_LABEL[entry.status]}</StatusPill>
                          <span className="font-bold text-fg">{entry.label}</span>
                          {entry.actor_name && `・${entry.actor_name}`}{entry.at && `（${formatDateTime(entry.at)}）`}
                          {entry.note && <span className="block pl-1 pt-0.5">{entry.note}</span>}
                        </p>
                      ))}
                      {view === 'open' && <p className="text-fg-muted">上の理由とは別に、対応済みの理由があります。根拠が変わると、もう一度ここに出ます。</p>}
                    </div>
                  )}

                  {view === 'open' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.signals.some(signal => signal.key === 'question_waiting') && (
                        <ButtonLink href={`/teacher/chat?student=${encodeURIComponent(item.id)}`} size="sm" icon={<MessageCircle size={14} aria-hidden />}>返信する</ButtonLink>
                      )}
                      {item.signals.some(signal => signal.resolvable) && (
                        <>
                          <Button size="sm" variant={item.signals.some(signal => signal.key === 'question_waiting') ? 'secondary' : 'primary'} onClick={() => startAction(item, 'contacted')} icon={<CheckCircle size={14} aria-hidden />}>声かけ済みにする</Button>
                          <Button size="sm" variant="secondary" onClick={() => startAction(item, 'watch')} icon={<Eye size={14} aria-hidden />}>様子を見る</Button>
                        </>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}

        <p className="text-xs leading-relaxed text-fg-muted">
          {transition && '移行期間中は、続けて不参加 20〜40、ログインは数えません。'}
          並び順は、理由ごとの点数の合計です（質問への未返信 40、続けて不参加 35〜60、参加が減った 20、宿題・Monoxer 15〜25、小テスト 15、ログインなし 15〜25、単元のつまずき 10、AI予測は参考で 10）。
          出席は、授業ボタンで参加したことがある生徒だけを見ています（教室で受けている生徒は、アプリに参加の記録が残らないため）。授業があった週は、同じ学年のだれかが参加した週で判断しています。対応済みにした理由は、根拠が変わるまで（たとえば次の週も不参加だったとき）表示しません。
        </p>
      </div>

      <Modal
        open={Boolean(target)}
        onClose={() => !saving && setTarget(null)}
        title={target ? `${target.item.student_name}さんを「${STATUS_LABEL[target.status]}」にする` : ''}
        description="選んだ理由は、根拠が変わるまで一覧に出なくなります。"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={saving}>やめる</Button>
            <Button onClick={() => void saveAction()} loading={saving} disabled={!selectedKeys.length}>記録する</Button>
          </>
        )}
      >
        {target && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-bold text-fg-muted">対象の理由</legend>
              {target.item.signals.filter(signal => signal.resolvable).map(signal => (
                <label key={signal.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-btn border border-line px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-accent"
                    checked={selectedKeys.includes(signal.key)}
                    onChange={event => setSelectedKeys(prev => event.target.checked ? [...prev, signal.key] : prev.filter(key => key !== signal.key))}
                  />
                  <span className="font-bold text-fg">{signal.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className="text-xs font-bold text-fg-muted">メモ（任意）</span>
              <textarea
                value={note}
                onChange={event => setNote(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder={target.status === 'contacted' ? '例：授業後に声をかけた。部活で忙しく、来週から参加するとのこと。' : '例：テスト期間のため。来週の様子を見る。'}
                className="mt-1 w-full rounded-input border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
