'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Flag, MessageSquareWarning, PlayCircle, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import {
  LANGUAGE_CATEGORY_LABELS,
  LANGUAGE_SEVERITY_LABELS,
  lessonTimeLabel,
  type LanguageCategory,
  type LanguageFinding,
  type LanguageSeverity,
} from '@/lib/lesson-language';
import { userErrorMessage } from '@/lib/user-error';
import { downloadCsv } from '@/lib/csv-export';

type Check = {
  id: string;
  target_date: string;
  period: string;
  teacher_name: string;
  grade: string;
  subject: string;
  detail_subject: string;
  unit: string;
  cue_count: number;
  video_offset_seconds: number;
  total: number;
  by_severity: Record<LanguageSeverity, number>;
  findings: LanguageFinding[];
  review_status: 'ok' | 'follow_up' | null;
  review_note: string;
};
type Rule = { id: string; label: string; category: LanguageCategory; severity: LanguageSeverity };

/** 発言の少し前から再生する（前の流れも聞けるように）。 */
const LEAD_IN_SECONDS = 5;

const SEVERITY_ORDER: LanguageSeverity[] = ['high', 'medium', 'low'];
const sortFindings = (findings: LanguageFinding[]) =>
  [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.time - b.time);

const REVIEW_LABELS = { ok: '問題なし', follow_up: '要フォロー' } as const;
const CSV_HEADERS = ['授業日', '時限', '講師', '学年', '教科', '科目', '単元', 'チェックした発言数', '確認', 'メモ', '時刻', '重要度', '種類', '言葉', '話者', '発言', '前の発言', '後の発言'] as const;

/** 見つかった発言を1行ずつ書き出す（見つからなかった授業は発言の欄を空けて1行）。 */
function downloadChecksCsv(checks: Check[]) {
  const rows = checks.flatMap(check => {
    const lesson = [
      check.target_date, check.period, check.teacher_name, check.grade, check.subject, check.detail_subject, check.unit,
      check.cue_count, check.review_status ? REVIEW_LABELS[check.review_status] : '未確認', check.review_note,
    ];
    const findings = [...check.findings].sort((a, b) => a.time - b.time);
    if (findings.length === 0) return [[...lesson, '', '', '', '', '', '', '', '']];
    return findings.map(finding => [
      ...lesson,
      lessonTimeLabel(finding.time), LANGUAGE_SEVERITY_LABELS[finding.severity], LANGUAGE_CATEGORY_LABELS[finding.category],
      finding.label, finding.speaker, finding.text, finding.before, finding.after,
    ]);
  });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).replace(/-/g, '');
  downloadCsv(`授業の発言チェック_${today}.csv`, CSV_HEADERS, rows);
}

const SEVERITY_TONES: Record<LanguageSeverity, string> = {
  high: 'bg-rose-100 text-rose-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-600',
};

/**
 * 授業の発言チェック（マスターだけ）。Zoom の文字起こしから、保護者が聞くと問題になりうる発言・NGワードを見つけて一覧にする。
 * 見つかった発言は前後の発言と時刻を出すので、録画で確かめてから「問題なし／要フォロー」を付ける。
 */
export default function LessonLanguagePage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const isMaster = profile?.role === 'master';
  const [tab, setTab] = useState<'checks' | 'rules'>('checks');
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState('');
  const [defaults, setDefaults] = useState<Rule[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set());
  const [custom, setCustom] = useState<Rule[]>([]);
  const [player, setPlayer] = useState<{ check: Check; time: number; token: string } | null>(null);
  const [newWord, setNewWord] = useState<{ label: string; category: LanguageCategory; severity: LanguageSeverity }>({ label: '', category: 'negative', severity: 'medium' });

  const authed = useCallback(async (url: string, init?: RequestInit) => {
    const token = await user!.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  }, [user]);

  const load = useCallback(async () => {
    if (!user || !isMaster) return;
    setLoading(true);
    setError('');
    try {
      const [checkBody, ruleBody] = await Promise.all([authed('/api/admin/lesson-language?days=30'), authed('/api/admin/lesson-language?rules=1')]);
      setChecks(checkBody.checks || []);
      setDefaults(ruleBody.defaults || []);
      setDisabled(new Set(ruleBody.disabled || []));
      setCustom(ruleBody.custom || []);
      const requested = new URLSearchParams(window.location.search).get('shift');
      if (requested) setOpenId(requested);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [authed, isMaster, user]);

  useEffect(() => { if (isMaster) void load(); else setLoading(false); }, [isMaster, load]);

  const visible = useMemo(() => checks.filter(check => !onlyFlagged || check.by_severity.high > 0 || check.by_severity.medium > 0), [checks, onlyFlagged]);
  const totals = useMemo(() => ({
    lessons: checks.length,
    high: checks.reduce((sum, check) => sum + (check.by_severity.high || 0), 0),
    medium: checks.reduce((sum, check) => sum + (check.by_severity.medium || 0), 0),
    pending: checks.filter(check => (check.by_severity.high > 0 || check.by_severity.medium > 0) && !check.review_status).length,
  }), [checks]);

  const review = async (check: Check, status: 'ok' | 'follow_up' | null) => {
    setBusy(`review_${check.id}`);
    try {
      await authed('/api/admin/lesson-language', { method: 'POST', body: JSON.stringify({ action: 'review', shift_id: check.id, status }) });
      setChecks(current => current.map(item => item.id === check.id ? { ...item, review_status: status } : item));
    } catch (reviewError) {
      toast.error(userErrorMessage(reviewError, '保存できませんでした。'));
    } finally { setBusy(''); }
  };

  const recheck = async (check: Check) => {
    setBusy(`recheck_${check.id}`);
    try {
      const result = await authed('/api/admin/lesson-language', { method: 'POST', body: JSON.stringify({ action: 'recheck', shift_id: check.id }) });
      toast.success(`今の言葉の設定で確認し直しました（${result.findings}件）。`);
      await load();
    } catch (recheckError) {
      toast.error(userErrorMessage(recheckError, '確認し直せませんでした。'));
    } finally { setBusy(''); }
  };

  const openPlayer = async (check: Check, time: number) => {
    try {
      setPlayer({ check, time, token: await user!.getIdToken() });
    } catch {
      toast.error('録画を開けませんでした。');
    }
  };

  const saveRules = async () => {
    setBusy('rules');
    try {
      const body = await authed('/api/admin/lesson-language', { method: 'POST', body: JSON.stringify({ action: 'save_rules', disabled: Array.from(disabled), custom }) });
      setCustom(body.custom || []);
      toast.success('言葉の設定を保存しました。これからチェックする授業に使います（済んだ授業は「確認し直す」で反映できます）。');
    } catch (saveError) {
      toast.error(userErrorMessage(saveError, '保存できませんでした。'));
    } finally { setBusy(''); }
  };

  if (!isMaster) {
    return <EmptyState icon={MessageSquareWarning} title="授業の発言チェックは、マスターだけが見られます" />;
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="授業の発言チェック"
        icon={MessageSquareWarning}
        description="Zoomの文字起こしから、保護者が聞くと問題になりうる発言・NGワードを見つけます。録画で前後を確かめてから「問題なし」「要フォロー」を付けてください。"
        actions={<IconButton label="読み込み直す" variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? 'motion-safe:animate-spin' : ''} /></IconButton>}
      />
      <AdminTabs
        value={tab}
        onChange={value => setTab(value as 'checks' | 'rules')}
        tabs={[
          { id: 'checks', label: 'チェック結果', badge: totals.pending || undefined },
          { id: 'rules', label: '言葉の設定' },
        ]}
      />

      {player && <RecordingPlayer {...player} onSeek={time => setPlayer(current => current && { ...current, time })} onClose={() => setPlayer(null)} />}

      {loading ? <ListSkeleton rows={4} /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : tab === 'checks' ? (
        <>
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-bold text-fg">
            <span>直近30日：{totals.lessons}授業</span>
            <span className="text-rose-700">重大 {totals.high}件</span>
            <span className="text-amber-700">要注意 {totals.medium}件</span>
            <span>未確認 {totals.pending}授業</span>
            <label className="ml-auto inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={onlyFlagged} onChange={event => setOnlyFlagged(event.target.checked)} className="h-4 w-4 accent-accent" />重大・要注意がある授業だけ
            </label>
            <Button size="sm" variant="secondary" icon={<Download size={15} aria-hidden />} disabled={visible.length === 0} onClick={() => downloadChecksCsv(visible)}>CSVで保存</Button>
          </Card>
          {visible.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={checks.length ? '確認が必要な発言はありません' : 'まだチェックした授業はありません'} description={checks.length ? undefined : 'Zoomの録画に文字起こしが付くと、自動でチェックします。'} />
          ) : (
            <ul className="space-y-3">
              {visible.map(check => {
                const open = openId === check.id;
                const findings = sortFindings(check.findings);
                return (
                  <li key={check.id}>
                    <Card padded={false} className="overflow-hidden">
                      <button type="button" onClick={() => setOpenId(open ? '' : check.id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-canvas">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-fg">{formatDate(check.target_date)} {[check.grade, check.subject, check.detail_subject].filter(Boolean).join(' ')}{check.unit ? <span className="ml-2 text-xs text-fg-muted">{check.unit}</span> : null}</p>
                          <p className="mt-0.5 text-xs font-bold text-fg-muted">{check.teacher_name || '講師未設定'} ・ 発言 {check.cue_count}件をチェック</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(['high', 'medium', 'low'] as LanguageSeverity[]).filter(severity => check.by_severity[severity] > 0).map(severity => (
                            <span key={severity} className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${SEVERITY_TONES[severity]}`}>{LANGUAGE_SEVERITY_LABELS[severity]} {check.by_severity[severity]}</span>
                          ))}
                          {check.review_status === 'ok' && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">問題なし</span>}
                          {check.review_status === 'follow_up' && <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-bold text-white">要フォロー</span>}
                        </div>
                      </button>
                      {open && (
                        <div className="border-t border-line px-4 py-3">
                          {findings.length === 0 ? <p className="text-sm font-bold text-fg-muted">見つかった発言はありません。</p> : (
                            <ul className="space-y-2">
                              {findings.map((finding, index) => (
                                <li key={`${finding.rule_id}_${finding.time}_${index}`} className="rounded-btn bg-canvas px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                                    <span className="font-mono text-fg">{lessonTimeLabel(finding.time)}</span>
                                    <span className={`rounded-full px-2 py-0.5 ${SEVERITY_TONES[finding.severity]}`}>{LANGUAGE_SEVERITY_LABELS[finding.severity]}</span>
                                    <span className="text-fg-muted">{LANGUAGE_CATEGORY_LABELS[finding.category]}「{finding.label}」</span>
                                    {finding.speaker && <span className="text-fg-muted">話者：{finding.speaker}</span>}
                                    <Button size="sm" variant="ghost" className="ml-auto" icon={<PlayCircle size={15} aria-hidden />} onClick={() => void openPlayer(check, finding.time)}>録画で見る</Button>
                                  </div>
                                  {finding.before && <p className="mt-1 text-xs text-fg-muted">…{finding.before}</p>}
                                  <p className="mt-0.5 text-sm font-bold text-fg">{finding.text}</p>
                                  {finding.after && <p className="mt-0.5 text-xs text-fg-muted">{finding.after}…</p>}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-3 text-xs text-fg-muted">時刻は録画の始まりからの時間です。文字起こしは聞き間違いを含むので、「録画で見る」で発言の少し前から聞いて確かめてください。</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" icon={<CheckCircle2 size={15} aria-hidden />} loading={busy === `review_${check.id}`} onClick={() => void review(check, check.review_status === 'ok' ? null : 'ok')}>{check.review_status === 'ok' ? '「問題なし」を外す' : '問題なし'}</Button>
                            <Button size="sm" variant="secondary" icon={<Flag size={15} aria-hidden />} loading={busy === `review_${check.id}`} onClick={() => void review(check, check.review_status === 'follow_up' ? null : 'follow_up')}>{check.review_status === 'follow_up' ? '「要フォロー」を外す' : '要フォロー'}</Button>
                            <Button size="sm" variant="ghost" icon={<RotateCcw size={15} aria-hidden />} loading={busy === `recheck_${check.id}`} onClick={() => void recheck(check)}>今の設定で確認し直す</Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-bold text-fg">追加の言葉</h2>
            <p className="mt-1 text-xs font-bold text-fg-muted">教室で気になる言い回しを足せます（ひらがな・カタカナの違いは同じものとして探します）。</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-bold text-fg-muted">言葉<input value={newWord.label} onChange={event => setNewWord(value => ({ ...value, label: event.target.value }))} maxLength={40} className="min-h-11 rounded-input border border-line bg-canvas px-3 text-sm font-bold text-fg" placeholder="例：赤点確定" /></label>
              <label className="grid gap-1 text-xs font-bold text-fg-muted">種類<select value={newWord.category} onChange={event => setNewWord(value => ({ ...value, category: event.target.value as LanguageCategory }))} className="min-h-11 rounded-input border border-line bg-canvas px-2 text-sm font-bold">{Object.entries(LANGUAGE_CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              <label className="grid gap-1 text-xs font-bold text-fg-muted">重要度<select value={newWord.severity} onChange={event => setNewWord(value => ({ ...value, severity: event.target.value as LanguageSeverity }))} className="min-h-11 rounded-input border border-line bg-canvas px-2 text-sm font-bold">{(['high', 'medium', 'low'] as LanguageSeverity[]).map(severity => <option key={severity} value={severity}>{LANGUAGE_SEVERITY_LABELS[severity]}</option>)}</select></label>
              <Button variant="secondary" icon={<Plus size={16} aria-hidden />} disabled={newWord.label.trim().length < 2} onClick={() => { setCustom(current => [...current, { id: `w${Date.now().toString(36)}`, ...newWord, label: newWord.label.trim() }]); setNewWord(value => ({ ...value, label: '' })); }}>追加</Button>
            </div>
            {custom.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-btn border border-line">
                {custom.map(rule => (
                  <li key={rule.id} className="flex items-center gap-2 px-3 py-2 text-sm font-bold">
                    <span className="min-w-0 flex-1">{rule.label}</span>
                    <span className="text-xs text-fg-muted">{LANGUAGE_CATEGORY_LABELS[rule.category]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_TONES[rule.severity]}`}>{LANGUAGE_SEVERITY_LABELS[rule.severity]}</span>
                    <IconButton label={`「${rule.label}」を消す`} size="sm" onClick={() => setCustom(current => current.filter(item => item.id !== rule.id))}><Trash2 size={15} /></IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="text-base font-bold text-fg">あらかじめ用意した言葉</h2>
            <p className="mt-1 text-xs font-bold text-fg-muted">誤検知が多い言葉は、チェックを外すと使わなくなります。</p>
            <ul className="mt-3 divide-y divide-line rounded-btn border border-line">
              {defaults.map(rule => (
                <li key={rule.id} className="flex items-center gap-3 px-3 py-2 text-sm font-bold">
                  <input type="checkbox" checked={!disabled.has(rule.id)} onChange={() => setDisabled(current => { const next = new Set(current); if (next.has(rule.id)) next.delete(rule.id); else next.add(rule.id); return next; })} className="h-4 w-4 accent-accent" aria-label={`「${rule.label}」を使う`} />
                  <span className="min-w-0 flex-1">{rule.label}</span>
                  <span className="text-xs text-fg-muted">{LANGUAGE_CATEGORY_LABELS[rule.category]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_TONES[rule.severity]}`}>{LANGUAGE_SEVERITY_LABELS[rule.severity]}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex justify-end"><Button icon={<Save size={16} aria-hidden />} loading={busy === 'rules'} onClick={() => void saveRules()}>言葉の設定を保存</Button></div>
        </div>
      )}
    </div>
  );
}

/** 授業の録画を、見つかった発言の少し前から再生する。右（スマホでは下）の一覧から別の発言へ飛べる。 */
function RecordingPlayer({ check, time, token, onSeek, onClose }: { check: Check; time: number; token: string; onSeek: (time: number) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const positionOf = (seconds: number) => Math.max(0, seconds + (check.video_offset_seconds || 0) - LEAD_IN_SECONDS);
  const src = `/api/zoom/recordings/file?shift_id=${encodeURIComponent(check.id)}&token=${encodeURIComponent(token)}`;

  const seek = (seconds: number) => {
    onSeek(seconds);
    const video = videoRef.current;
    // 読み込み前は loadedmetadata で合わせる。
    if (!video || video.readyState < 1) return;
    video.currentTime = positionOf(seconds);
    void video.play().catch(() => undefined);
  };

  const findings = sortFindings(check.findings).sort((a, b) => a.time - b.time);
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${formatDate(check.target_date)} ${[check.grade, check.subject, check.detail_subject].filter(Boolean).join(' ')}`}
      description={`${check.teacher_name || '講師未設定'} ・ 発言の${LEAD_IN_SECONDS}秒前から再生します`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="overflow-hidden rounded-card bg-slate-950">
          {failed ? (
            <p role="alert" className="flex aspect-video items-center justify-center p-6 text-center text-sm font-bold text-white">録画を再生できませんでした。授業録画の画面で、この授業に録画が付いているか確認してください。</p>
          ) : (
            <video
              ref={videoRef}
              key={src}
              src={src}
              className="aspect-video w-full"
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={event => {
                event.currentTarget.currentTime = positionOf(time);
                void event.currentTarget.play().catch(() => undefined);
              }}
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto lg:max-h-[60vh]" aria-label="見つかった発言">
          {findings.map((finding, index) => {
            const current = finding.time === time;
            return (
              <li key={`${finding.rule_id}_${finding.time}_${index}`}>
                <button
                  type="button"
                  onClick={() => seek(finding.time)}
                  aria-current={current || undefined}
                  className={`w-full rounded-btn border px-3 py-2 text-left ${current ? 'border-accent bg-accent/10' : 'border-line bg-canvas hover:bg-surface'}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                    <span className="font-mono text-fg">{lessonTimeLabel(finding.time)}</span>
                    <span className={`rounded-full px-2 py-0.5 ${SEVERITY_TONES[finding.severity]}`}>{LANGUAGE_SEVERITY_LABELS[finding.severity]}</span>
                    <span className="text-fg-muted">「{finding.label}」</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm font-bold text-fg">{finding.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
