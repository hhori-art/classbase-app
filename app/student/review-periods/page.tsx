'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, Save } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, PageHeader, useToast } from '@/app/components/ui';
import { formatDate, formatShortDate } from '@/lib/format';

type Item = { id: string; date: string; weekday: string; subject: string; unit: string; grade: string; time: string; lesson: string; level: string };
type Period = { id: string; name: string; start_date: string; end_date: string; subjects: string[]; items: Item[] };
const MAX_SELECTIONS_PER_PERIOD = 40;

export default function StudentReviewPeriodsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState('');
  const [gradeRequired, setGradeRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 読み込み中・失敗を「受付中の期間なし」と区別して表示する。
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/review-periods', { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'load-failed');
      setPeriods(data.periods || []);
      setSelected(data.selections || {});
      setGradeRequired(Boolean(data.grade_required));
    } catch (error) {
      console.error('復習期間の読み込みに失敗しました', error);
      setLoadError('復習期間を読み込めませんでした。通信状況を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => periods.map(period => ({
    period,
    dates: Object.entries(period.items.reduce((acc, item) => { (acc[item.date] ??= []).push(item); return acc; }, {} as Record<string, Item[]>))
      .sort(([a], [b]) => a.localeCompare(b)),
  })), [periods]);

  const toggle = (periodId: string, itemId: string) => {
    const current = selected[periodId] || [];
    if (!current.includes(itemId) && current.length >= MAX_SELECTIONS_PER_PERIOD) {
      toast.error(`1つの復習期間で選択できるのは${MAX_SELECTIONS_PER_PERIOD}講座までです。`);
      return;
    }
    setSelected(state => {
      const set = new Set(state[periodId] || []);
      if (set.has(itemId)) {
        set.delete(itemId);
      } else if (set.size >= MAX_SELECTIONS_PER_PERIOD) {
        return state;
      } else {
        set.add(itemId);
      }
      return { ...state, [periodId]: [...set] };
    });
  };

  const save = async (periodId: string) => {
    if (!user) return;
    setSaving(periodId);
    try {
      const res = await fetch('/api/review-periods', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_id: periodId, item_ids: selected[periodId] || [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === 'period-ended' ? 'この復習期間は終了したため、変更できません。' : data.error);
      if (Array.isArray(data.item_ids)) setSelected(current => ({ ...current, [periodId]: data.item_ids }));
      toast.success('受講する曜日・単元を保存しました。');
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : '保存できませんでした。もう一度お試しください。');
    } finally {
      setSaving('');
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <PageHeader
        tone="hero"
        eyebrow="理社講座"
        title="復習期間の受講設定"
        description="曜日と復習したい単元を選ぼう。日付ごとに、参加する講座をタップしてください。複数選べます。"
        icon={CalendarDays}
        backHref="/student"
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : gradeRequired ? (
        <div className="rounded-card border border-warning/30 bg-warning-soft p-card text-center">
          <h2 className="font-bold text-warning">学年が登録されていません</h2>
          <p className="mt-2 text-sm text-fg-muted">受講できる単元を表示するため、所属校舎の先生に学年の登録を依頼してください。</p>
        </div>
      ) : grouped.length === 0 && (
        <EmptyState icon={CalendarDays} title="現在、受付中の復習期間はありません。" />
      )}

      {!loading && !loadError && grouped.map(({ period, dates }) => (
        <Card key={period.id} padded={false} className="overflow-hidden">
          <div className="border-b border-line bg-canvas/60 p-card">
            <h2 className="text-xl font-bold text-fg">{period.name}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {formatDate(period.start_date)} 〜 {formatDate(period.end_date)} ・ 選択中 {selected[period.id]?.length || 0}/{MAX_SELECTIONS_PER_PERIOD}講座
            </p>
          </div>
          <div className="space-y-5 p-4 md:p-5">
            {dates.map(([date, items]) => (
              <div key={date}>
                <h3 className="mb-2 flex items-center gap-2 font-bold text-fg">
                  <span className="rounded-btn bg-slate-800 px-3 py-1.5 text-sm text-white">{formatShortDate(date)}（{items[0]?.weekday}）</span>
                  <span className="text-xs font-medium text-fg-muted">{items.length}講座</span>
                </h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {items.map(item => {
                    const active = (selected[period.id] || []).includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(period.id, item.id)}
                        className={`flex items-start gap-3 rounded-card border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? 'border-accent bg-accent-soft shadow-sm' : 'border-line bg-surface hover:border-accent/30'}`}
                      >
                        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${active ? 'bg-accent text-accent-ink' : 'bg-slate-100 text-slate-300'}`}>
                          {active && <Check size={17} aria-hidden />}
                        </span>
                        <span className="min-w-0">
                          <span className={`text-xs font-bold ${item.subject === '理科' ? 'text-emerald-600' : 'text-amber-600'}`}>{item.subject}・{item.grade}</span>
                          <span className="mt-0.5 block font-bold text-fg">{item.unit}</span>
                          <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.lesson || '時間目未設定'}</span>
                            <span className="rounded-full bg-info-soft px-2 py-1 text-info">{item.level || '通常'}</span>
                          </span>
                          {item.time && <span className="mt-1 flex items-center gap-1 text-xs text-fg-muted"><Clock3 size={13} aria-hidden />{item.time}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-line bg-canvas/60 p-4">
            <Button
              size="lg"
              fullWidth
              loading={saving === period.id}
              icon={<Save size={18} aria-hidden />}
              onClick={() => void save(period.id)}
            >
              {saving === period.id ? '保存中…' : 'この内容で保存'}
            </Button>
          </div>
        </Card>
      ))}
    </main>
  );
}
