'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Download, PlayCircle, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { CartesianGrid, ComposedChart, Bar, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';
import { downloadCsv } from '@/lib/csv-export';
import {
  clockLabel,
  type LessonAnalysisRules, type LessonEvaluation, type LessonEvent, type RubricCriterion, type SeriesRow,
} from '@/lib/lesson-analysis';

type Metrics = {
  teacher_talk_ratio: number | null;
  wpm: number | null;
  questions: number;
  median_wait_seconds: number | null;
  student_turns: number;
  longest_monologue: { start: number; end: number; seconds: number } | null;
  silence_count: number;
  // 2026-11-11 にアンケートに合わせて足した項目（それより前に作った振り返りにはない）
  work_seconds?: number;
  work_prompts?: number;
  checkins?: number;
  tips?: number;
  interactions?: number;
};
type Camera = { students: number; rate: number | null; off_students: number } | null;
type ListItem = {
  id: string;
  target_date: string;
  period: string;
  teacher_id: string;
  teacher_name: string;
  grade: string;
  subject: string;
  detail_subject: string;
  unit: string;
  status: 'done' | 'skipped' | 'failed';
  reason: string;
  duration_sec?: number;
  levels?: Record<string, number | null>;
  overall_score?: number | null;
  metrics?: Metrics;
  camera?: Camera;
  evaluation?: { summary?: string };
};
type Analysis = ListItem & {
  video_offset_seconds: number;
  teacher_detection: 'registered_name' | 'most_talk' | 'no_speaker';
  speaker_count: number;
  series: SeriesRow[];
  events: LessonEvent[];
  evaluation: LessonEvaluation;
};
type Settings = { rules: LessonAnalysisRules; rubric: RubricCriterion[]; disabled_teacher_ids: string[]; can_edit: boolean };
type Tab = 'lessons' | 'settings';

const DAY_OPTIONS = [7, 30, 90] as const;
const REASONS: Record<string, string> = {
  'no-transcript': '文字起こしがありません',
  'teacher-disabled': 'この先生は振り返りをオフにしています',
};
const lessonLabel = (item: ListItem) => [item.grade, item.subject, item.detail_subject].filter(Boolean).join(' ') || '授業';
const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);
const LEVEL_TONES: Record<number, string> = {
  4: 'bg-emerald-100 text-emerald-800',
  3: 'bg-sky-100 text-sky-800',
  2: 'bg-amber-100 text-amber-800',
  1: 'bg-rose-100 text-rose-800',
};

const scoreTone = (score: number) => (score >= 75 ? 'text-emerald-700' : score >= 50 ? 'text-sky-700' : score >= 25 ? 'text-amber-700' : 'text-rose-700');

/** 総合点（判定できた観点のレベルの平均を0〜100にならしたもの）。 */
function OverallScore({ score, large = false }: { score: number | null | undefined; large?: boolean }) {
  if (score === null || score === undefined) return <span className="text-xs font-bold text-fg-muted">総合点なし</span>;
  return (
    <span className={`inline-flex items-baseline gap-0.5 font-bold ${scoreTone(score)}`} aria-label={`総合点 ${score}点`}>
      {!large && <span className="mr-1 text-xs text-fg-muted">総合</span>}
      <span className={large ? 'text-4xl' : 'text-xl'}>{score}</span>
      <span className="text-xs">点</span>
    </span>
  );
}

const CRITERIA = ['導入', '発問', '生徒の参加', '説明の分かりやすさ', '時間配分', '考える・書く時間'] as const;
const CSV_HEADERS = [
  '授業日', '時限', '先生', '学年', '教科', '科目', '単元', '状態', '総合点', ...CRITERIA.map(name => `${name}（レベル）`),
  '授業の長さ(分)', '先生の話(%)', '話す速さ(字/分)', '問いかけ(回)', '待ち時間の中央値(秒)', '生徒の発言(回)', '続けて話した最長(分)', '沈黙(回)',
  '考える・書く時間(分)', '書けたかの確かめ(回)', '覚え方・ポイント(回)', '当てる・チャットの声かけ(回)',
  'カメラON率(%)', 'カメラの記録の人数', 'ほぼオフの生徒(人)', '要約', '作れなかった理由',
] as const;

/** 一覧に出ている授業を、1授業1行で書き出す。 */
function downloadAnalysesCsv(items: ListItem[]) {
  const value = (number: number | null | undefined) => (number === null || number === undefined ? '' : number);
  const rows = items.map(item => {
    const metrics = item.metrics;
    return [
      item.target_date, item.period, item.teacher_name, item.grade, item.subject, item.detail_subject, item.unit,
      item.status === 'done' ? '完了' : item.status === 'failed' ? '失敗' : '対象外',
      value(item.overall_score),
      ...CRITERIA.map(name => value(item.levels?.[name])),
      item.duration_sec ? Math.round(item.duration_sec / 60) : '',
      metrics?.teacher_talk_ratio === null || metrics?.teacher_talk_ratio === undefined ? '' : Math.round(metrics.teacher_talk_ratio * 100),
      value(metrics?.wpm), value(metrics?.questions), value(metrics?.median_wait_seconds), value(metrics?.student_turns),
      metrics?.longest_monologue ? (metrics.longest_monologue.seconds / 60).toFixed(1) : '',
      value(metrics?.silence_count),
      metrics?.work_seconds === undefined ? '' : (metrics.work_seconds / 60).toFixed(1),
      value(metrics?.checkins), value(metrics?.tips), value(metrics?.interactions),
      value(item.camera?.rate), value(item.camera?.students), value(item.camera?.off_students),
      item.evaluation?.summary || '',
      item.status === 'done' ? '' : REASONS[item.reason] || item.reason,
    ];
  });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).replace(/-/g, '');
  downloadCsv(`授業の振り返り_${today}.csv`, CSV_HEADERS, rows);
}

function LevelBadge({ level }: { level: number | null | undefined }) {
  if (level === null || level === undefined) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">判定なし</span>;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LEVEL_TONES[level] || LEVEL_TONES[1]}`}>レベル{level}</span>;
}

/**
 * 授業の振り返り（理社講座の管理者）。Zoom の文字起こしと、生徒のカメラON率から、決まりで作った振り返りを見る。
 * AI は使っていない。先生の授業改善を支えるためのもので、評価の材料にはしない。
 */
export default function LessonAnalysisPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('lessons');
  const [days, setDays] = useState<number>(30);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teacher, setTeacher] = useState('');
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState('');

  const authed = useCallback(async (url: string, init?: RequestInit) => {
    const token = await user!.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const body = await authed(`/api/admin/lesson-analysis?days=${days}`);
      setItems(body.items || []);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [authed, days, user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('shift');
    if (requested) setOpenId(requested);
  }, []);

  const teachers = useMemo(() => Array.from(new Map(items.map(item => [item.teacher_id || item.teacher_name, item.teacher_name || '講師未設定'])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'ja')), [items]);
  // オン・オフは講師のIDで決めるので、IDがある先生だけ
  const teacherIds = useMemo(() => Array.from(new Map(items.filter(item => item.teacher_id).map(item => [item.teacher_id, item.teacher_name || '講師未設定'])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'ja')), [items]);
  const visible = useMemo(() => items.filter(item => !teacher || (item.teacher_id || item.teacher_name) === teacher), [items, teacher]);
  const failed = items.filter(item => item.status === 'failed').length;
  const averageScore = useMemo(() => {
    const scores = visible.map(item => item.overall_score).filter((value): value is number => typeof value === 'number');
    return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
  }, [visible]);

  const rerunFailed = async () => {
    setBusy('failed');
    try {
      const body = await authed('/api/admin/lesson-analysis', { method: 'POST', body: JSON.stringify({ action: 'rerun_failed' }) });
      toast.success(`${body.rerun}件を作り直しました（できたのは${body.done}件）。`);
      await load();
    } catch (rerunError) {
      toast.error(userErrorMessage(rerunError, '作り直せませんでした。'));
    } finally { setBusy(''); }
  };

  if (openId) {
    return <Report id={openId} authed={authed} onBack={() => { setOpenId(''); void load(); }} />;
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="授業の振り返り"
        icon={ClipboardCheck}
        description="Zoomの文字起こしと生徒のカメラON率から、授業ごとの振り返りを毎晩作ります（AIは使わず、決まりで判定します）。先生の授業改善のためのもので、評価の材料にはしません。"
        actions={<IconButton label="読み込み直す" variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? 'motion-safe:animate-spin' : ''} /></IconButton>}
      />
      <AdminTabs value={tab} onChange={value => setTab(value as Tab)} tabs={[{ id: 'lessons', label: '授業の一覧', badge: failed || undefined }, { id: 'settings', label: '観点と決まり' }]} />

      {tab === 'settings' ? <SettingsPanel authed={authed} teachers={teacherIds} /> : loading ? <ListSkeleton rows={5} /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <>
          <Card className="flex flex-wrap items-center gap-3 text-sm font-bold text-fg">
            <span className="inline-flex items-center gap-1">
              {DAY_OPTIONS.map(option => (
                <button key={option} type="button" aria-pressed={days === option} onClick={() => setDays(option)}
                  className={`min-h-9 rounded-full border px-3 text-xs font-bold ${days === option ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-muted'}`}>
                  直近{option}日
                </button>
              ))}
            </span>
            <label className="inline-flex items-center gap-2 text-xs">
              先生
              <select value={teacher} onChange={event => setTeacher(event.target.value)} className="min-h-9 rounded-input border border-line bg-surface px-2 text-sm">
                <option value="">すべて</option>
                {teachers.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
            </label>
            <span className="text-fg-muted">{visible.length}授業</span>
            {averageScore !== null && <span className="text-fg-muted">総合点の平均 <span className={scoreTone(averageScore)}>{averageScore}点</span></span>}
            <Button size="sm" variant="secondary" className="ml-auto" icon={<Download size={15} aria-hidden />} disabled={visible.length === 0} onClick={() => downloadAnalysesCsv(visible)}>CSVで保存</Button>
            {failed > 0 && <Button size="sm" variant="secondary" icon={<RotateCcw size={15} aria-hidden />} loading={busy === 'failed'} onClick={() => void rerunFailed()}>作れなかった{failed}件を作り直す</Button>}
          </Card>
          {visible.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="まだ振り返りはありません" description="Zoomの録画に文字起こしが付いた授業から、毎晩23時20分ごろに作ります。" />
          ) : (
            <ul className="space-y-2">
              {visible.map(item => (
                <li key={item.id}>
                  <Card padded={false} className="overflow-hidden">
                    <button type="button" onClick={() => setOpenId(item.id)} disabled={item.status !== 'done'} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-canvas disabled:cursor-default disabled:hover:bg-transparent">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-fg">{formatDate(item.target_date)}{item.period ? ` ${item.period}限` : ''} {lessonLabel(item)}{item.unit ? <span className="ml-2 text-xs text-fg-muted">{item.unit}</span> : null}</p>
                        <p className="mt-0.5 text-xs font-bold text-fg-muted">
                          {item.teacher_name || '講師未設定'}
                          {item.status === 'done' && item.metrics ? ` ・ 先生の話 ${percent(item.metrics.teacher_talk_ratio)} ・ 問いかけ ${item.metrics.questions}回` : ''}
                          {item.status === 'done' && item.camera ? ` ・ カメラON ${item.camera.rate ?? '—'}%` : ''}
                        </p>
                      </div>
                      {item.status === 'done' && <OverallScore score={item.overall_score} />}
                      {item.status === 'done' ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(item.levels || {}).map(([criterion, level]) => (
                            <span key={criterion} className="inline-flex items-center gap-1 text-xs font-bold text-fg-muted">{criterion}<LevelBadge level={level} /></span>
                          ))}
                        </div>
                      ) : (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${item.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                          {item.status === 'failed' ? `作れませんでした（${item.reason || '理由不明'}）` : REASONS[item.reason] || '対象外'}
                        </span>
                      )}
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Report({ id, authed, onBack }: { id: string; authed: (url: string, init?: RequestInit) => Promise<any>; onBack: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [player, setPlayer] = useState<{ time: number; token: string } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const body = await authed(`/api/admin/lesson-analysis?id=${encodeURIComponent(id)}`);
      setAnalysis(body.analysis);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '読み込めませんでした。'));
    }
  }, [authed, id]);
  useEffect(() => { void load(); }, [load]);

  const play = async (time: number) => {
    try {
      setPlayer({ time, token: await user!.getIdToken() });
    } catch {
      toast.error('録画を開けませんでした。');
    }
  };
  const rerun = async () => {
    setBusy(true);
    try {
      await authed('/api/admin/lesson-analysis', { method: 'POST', body: JSON.stringify({ action: 'rerun', shift_id: id }) });
      await load();
      toast.success('今の決まりで作り直しました。');
    } catch (rerunError) {
      toast.error(userErrorMessage(rerunError, '作り直せませんでした。'));
    } finally { setBusy(false); }
  };

  const TimeButton = ({ seconds, label }: { seconds: number; label?: string }) => (
    <button type="button" onClick={() => void play(seconds)} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-xs font-bold text-accent hover:bg-accent/20">
      <PlayCircle size={13} aria-hidden />{label || clockLabel(seconds)}
    </button>
  );

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!analysis) return <ListSkeleton rows={5} />;
  const evaluation = analysis.evaluation;
  const metrics = analysis.metrics;
  const questionTimes = (analysis.events || []).filter(event => event.type === 'question').map(event => event.t_sec);
  const chartData = (analysis.series || []).map(row => ({
    t: row.t_sec,
    teacher: Math.round(row.teacher_talk_ratio * 100),
    student: row.student_turns,
    wpm: row.wpm,
  }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} aria-hidden />} onClick={onBack}>一覧へ</Button>
        <Button size="sm" variant="secondary" className="ml-auto" icon={<PlayCircle size={15} aria-hidden />} onClick={() => void play(0)}>録画を見る</Button>
        <Button size="sm" variant="secondary" icon={<RotateCcw size={15} aria-hidden />} loading={busy} onClick={() => void rerun()}>今の決まりで作り直す</Button>
      </div>
      <AdminPageHeader
        title={`${formatDate(analysis.target_date)}${analysis.period ? ` ${analysis.period}限` : ''} ${lessonLabel(analysis)}`}
        icon={ClipboardCheck}
        description={`${analysis.teacher_name || '講師未設定'}${analysis.unit ? ` ・ ${analysis.unit}` : ''} ・ ${Math.round((analysis.duration_sec || 0) / 60)}分`}
      />

      {/* 上段：総合点・要約・良かった点・改善のヒント */}
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <div className="shrink-0 text-center">
            <p className="text-xs font-bold text-fg-muted">総合点</p>
            <OverallScore score={analysis.overall_score} large />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-relaxed text-fg">{evaluation.summary}</p>
            <p className="mt-1 text-xs text-fg-muted">総合点は、レベルを付けられた観点の平均を、レベル1＝0点・レベル4＝100点にならしたものです（判定なしの観点は入れません）。</p>
          </div>
        </div>
        {analysis.teacher_detection === 'most_talk' && (
          <p className="mt-2 text-xs font-bold text-fg-muted">Zoomの表示名が先生の名前と一致しなかったため、いちばん長く話した人を先生としています{analysis.speaker_count <= 1 ? '（文字起こしの話者は1人だけでした）' : ''}。</p>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section>
            <h2 className="text-sm font-bold text-emerald-700">良かった点</h2>
            <ul className="mt-2 space-y-2">
              {evaluation.strengths.length === 0 ? <li className="text-sm text-fg-muted">—</li> : evaluation.strengths.map((item, index) => (
                <li key={index} className="flex flex-wrap items-start gap-2 text-sm text-fg"><TimeButton seconds={item.t_sec} /><span className="min-w-0 flex-1">{item.text}</span></li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-sm font-bold text-amber-700">改善のヒント</h2>
            <ul className="mt-2 space-y-2">
              {evaluation.improvements.length === 0 ? <li className="text-sm text-fg-muted">—</li> : evaluation.improvements.map((item, index) => (
                <li key={index} className="flex flex-wrap items-start gap-2 text-sm text-fg">
                  <TimeButton seconds={item.t_sec} />
                  <span className="min-w-0 flex-1">{item.text}<span className="mt-0.5 block text-xs text-fg-muted">{item.suggestion}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Card>

      {/* 中段：時系列 */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-bold text-fg-muted">
          <span>先生の話 {percent(metrics?.teacher_talk_ratio)}</span>
          <span>話す速さ {metrics?.wpm ?? '—'}字/分</span>
          <span>問いかけ {metrics?.questions ?? 0}回（待ち時間の中央値 {metrics?.median_wait_seconds ?? '—'}秒）</span>
          <span>続けて話した最長 {metrics?.longest_monologue ? `${(metrics.longest_monologue.seconds / 60).toFixed(1)}分` : '—'}</span>
          <span>沈黙 {metrics?.silence_count ?? 0}回</span>
          {metrics?.work_seconds !== undefined && <span>考える・書く時間 {(metrics.work_seconds / 60).toFixed(1)}分（確かめ {metrics.checkins ?? 0}回）</span>}
          {metrics?.tips !== undefined && <span>覚え方・ポイント {metrics.tips}回</span>}
          {metrics?.interactions !== undefined && <span>当てる・チャット {metrics.interactions}回</span>}
          <span>カメラON {analysis.camera ? `${analysis.camera.rate ?? '—'}%（${analysis.camera.students}人）` : '記録なし'}</span>
        </div>
        <div className="mt-3 h-64" role="img" aria-label="10秒ごとの先生の話している割合と話す速さ。縦線は問いかけ。">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => clockLabel(Number(value)).slice(0, 5)} fontSize={11} />
              <YAxis yAxisId="ratio" domain={[0, 100]} fontSize={11} unit="%" />
              <YAxis yAxisId="wpm" orientation="right" fontSize={11} hide />
              <Tooltip labelFormatter={value => clockLabel(Number(value))} />
              {questionTimes.map(time => <ReferenceLine key={time} yAxisId="ratio" x={time} stroke="#f59e0b" strokeOpacity={0.5} />)}
              <Bar yAxisId="ratio" name="先生の話（%）" dataKey="teacher" fill="#c7d2fe" isAnimationActive={false} />
              <Line yAxisId="wpm" name="話す速さ（字/分）" dataKey="wpm" stroke="#0284c7" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
              {chartData.some(row => row.student > 0) && <Bar yAxisId="ratio" name="生徒の発言（回）" dataKey="student" fill="#10b981" isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-fg-muted">薄い紫の棒は10秒ごとの先生の話している割合、青い線は話す速さ、オレンジの縦線は問いかけです。</p>
        {evaluation.notable_moments.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {evaluation.notable_moments.map((moment, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 text-sm text-fg"><TimeButton seconds={moment.t_sec} />{moment.description}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* 下段：観点ごと */}
      <div className="grid gap-3 md:grid-cols-2">
        {evaluation.scores.map(score => (
          <Card key={score.criterion}>
            <div className="flex items-center gap-2"><h2 className="font-bold text-fg">{score.criterion}</h2><LevelBadge level={score.level} /></div>
            <p className="mt-2 text-sm text-fg">{score.comment}</p>
            {score.evidence.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {score.evidence.map((item, index) => (
                  <li key={index} className="flex flex-wrap items-start gap-2 text-xs text-fg-muted"><TimeButton seconds={item.t_sec} /><span className="min-w-0 flex-1">「{item.quote}」</span></li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {player && <Player shiftId={analysis.id} offset={analysis.video_offset_seconds || 0} time={player.time} token={player.token} title={lessonLabel(analysis)} onClose={() => setPlayer(null)} />}
    </div>
  );
}

/** 録画をその時刻から再生する（発言の5秒前から）。 */
function Player({ shiftId, offset, time, token, title, onClose }: { shiftId: string; offset: number; time: number; token: string; title: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const position = Math.max(0, time + offset - (time ? 5 : 0));
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) {
      video.currentTime = position;
      void video.play().catch(() => undefined);
    }
  }, [position]);
  return (
    <Modal open onClose={onClose} size="xl" title={title} description={time ? `${clockLabel(time)}の5秒前から再生します` : undefined}>
      <div className="overflow-hidden rounded-card bg-slate-950">
        {failed ? (
          <p role="alert" className="flex aspect-video items-center justify-center p-6 text-center text-sm font-bold text-white">録画を再生できませんでした。授業録画の画面で、この授業に録画が付いているか確認してください。</p>
        ) : (
          <video
            ref={videoRef}
            src={`/api/zoom/recordings/file?shift_id=${encodeURIComponent(shiftId)}&token=${encodeURIComponent(token)}`}
            className="aspect-video w-full"
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={event => {
              event.currentTarget.currentTime = position;
              void event.currentTarget.play().catch(() => undefined);
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </Modal>
  );
}

const lines = (value: string[]) => value.join('\n');
const fromLines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);

function SettingsPanel({ authed, teachers }: { authed: (url: string, init?: RequestInit) => Promise<any>; teachers: [string, string][] }) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authed('/api/admin/lesson-analysis?settings=1')
      .then(body => setSettings({ rules: body.rules, rubric: body.rubric, disabled_teacher_ids: body.disabled_teacher_ids || [], can_edit: body.can_edit === true }))
      .catch(loadError => setError(userErrorMessage(loadError, '読み込めませんでした。')));
  }, [authed]);

  if (error) return <ErrorState message={error} />;
  if (!settings) return <ListSkeleton rows={3} />;
  const editable = settings.can_edit;
  const setRules = (patch: Partial<LessonAnalysisRules>) => setSettings(current => current && { ...current, rules: { ...current.rules, ...patch } });
  const save = async () => {
    setSaving(true);
    try {
      const body = await authed('/api/admin/lesson-analysis', { method: 'POST', body: JSON.stringify({ action: 'save_settings', rules: settings.rules, rubric: settings.rubric, disabled_teacher_ids: settings.disabled_teacher_ids }) });
      setSettings(current => current && { ...current, rules: body.rules, rubric: body.rubric, disabled_teacher_ids: body.disabled_teacher_ids });
      toast.success('保存しました。今夜から使います（作った振り返りは「今の決まりで作り直す」で反映できます）。');
    } catch (saveError) {
      toast.error(userErrorMessage(saveError, '保存できませんでした。'));
    } finally { setSaving(false); }
  };
  const number = (key: 'wait_ok_seconds' | 'long_monologue_seconds' | 'silence_seconds' | 'wpm_min' | 'wpm_max' | 'intro_good_seconds' | 'work_window_seconds', label: string, unit: string) => (
    <label className="grid gap-1 text-xs font-bold text-fg-muted">
      {label}
      <span className="flex items-center gap-2">
        <input type="number" inputMode="numeric" value={settings.rules[key]} disabled={!editable} onChange={event => setRules({ [key]: Number(event.target.value) } as Partial<LessonAnalysisRules>)}
          className="min-h-11 w-24 rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg disabled:bg-canvas" />
        <span className="text-sm">{unit}</span>
      </span>
    </label>
  );
  const words = (key: 'question_patterns' | 'intro_patterns' | 'summary_patterns' | 'work_patterns' | 'checkin_patterns' | 'tip_patterns' | 'interaction_patterns', label: string) => (
    <label className="grid gap-1 text-xs font-bold text-fg-muted">
      {label}（1行に1つ）
      <textarea rows={6} value={lines(settings.rules[key])} disabled={!editable} onChange={event => setRules({ [key]: fromLines(event.target.value) } as Partial<LessonAnalysisRules>)}
        className="rounded-input border border-line bg-surface px-3 py-2 font-mono text-xs text-fg disabled:bg-canvas" />
    </label>
  );
  return (
    <div className="space-y-4">
      {!editable && <p className="text-sm font-bold text-fg-muted">設定を変えられるのはマスターだけです。</p>}
      <Card>
        <h2 className="font-bold text-fg">観点</h2>
        <p className="mt-1 text-xs text-fg-muted">観点は決まりで判定するため、名前は固定です。説明と、使う・使わないを変えられます。</p>
        <ul className="mt-3 space-y-2">
          {settings.rubric.map((item, index) => (
            <li key={item.criterion} className="flex flex-wrap items-center gap-3">
              <label className="inline-flex w-44 items-center gap-2 text-sm font-bold text-fg">
                <input type="checkbox" checked={item.enabled} disabled={!editable} className="h-4 w-4 accent-accent"
                  onChange={event => setSettings(current => current && { ...current, rubric: current.rubric.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry) })} />
                {item.criterion}
              </label>
              <input value={item.description} disabled={!editable} aria-label={`${item.criterion}の説明`}
                onChange={event => setSettings(current => current && { ...current, rubric: current.rubric.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry) })}
                className="min-h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-sm disabled:bg-canvas" />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-bold text-fg">目安の値</h2>
        <div className="mt-3 flex flex-wrap gap-4">
          {number('wait_ok_seconds', '問いかけのあと待てた', '秒以上')}
          {number('long_monologue_seconds', '長い説明', '秒以上')}
          {number('silence_seconds', '沈黙', '秒以上')}
          {number('wpm_min', '話す速さ（下限）', '字/分')}
          {number('wpm_max', '話す速さ（上限）', '字/分')}
          {number('intro_good_seconds', 'ねらいを示す', '秒以内')}
          {number('work_window_seconds', '促してから考える・書く時間を見る', '秒')}
        </div>
      </Card>
      <Card>
        <h2 className="font-bold text-fg">言葉の決まり</h2>
        <p className="mt-1 text-xs text-fg-muted">正規表現も使えます（例：「[？?]」は疑問符）。読めない行は保存のときに外します。既定の言葉は、生徒アンケート（約6.4万件）の自由記述に合わせてあります。</p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {words('question_patterns', '問いかけとみなす言い方')}
          {words('intro_patterns', 'ねらいを示す言い方')}
          {words('summary_patterns', 'まとめに入る言い方')}
          {words('work_patterns', '問題を解く・書くよう促す言い方')}
          {words('checkin_patterns', '書けたか・時間が要るかの確かめ')}
          {words('tip_patterns', '覚え方・大事なポイントの言い方')}
          {words('interaction_patterns', '当てる・チャットなど参加を促す言い方')}
        </div>
      </Card>
      <Card>
        <h2 className="font-bold text-fg">先生ごとのオン・オフ</h2>
        <p className="mt-1 text-xs text-fg-muted">オフにした先生の授業は、振り返りを作りません。一覧に出ている先生だけが並びます。</p>
        {teachers.length === 0 ? <p className="mt-2 text-sm text-fg-muted">まだ授業がありません。</p> : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.map(([key, name]) => {
              const off = settings.disabled_teacher_ids.includes(key);
              return (
                <li key={key}>
                  <label className="flex items-center gap-2 text-sm font-bold text-fg">
                    <input type="checkbox" checked={!off} disabled={!editable} className="h-4 w-4 accent-accent"
                      onChange={event => setSettings(current => current && {
                        ...current,
                        disabled_teacher_ids: event.target.checked ? current.disabled_teacher_ids.filter(item => item !== key) : [...current.disabled_teacher_ids, key],
                      })} />
                    {name}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editable && <Button icon={<Save size={16} aria-hidden />} loading={saving} onClick={() => void save()}>保存する</Button>}
    </div>
  );
}
