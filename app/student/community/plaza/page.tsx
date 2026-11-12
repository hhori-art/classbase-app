'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { ChevronLeft, CircleHelp, DoorOpen, Eye, Loader2, MapPin, RotateCcw, User, Video } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { BOARD_LIMIT, type ViewMode } from '@/lib/community-plaza';
import { PlazaTopicPanel } from './PlazaTopicPanel';
import type { PlazaBoard, PlazaEngine, StageKey } from './plaza-engine';
import type { Quality } from './plaza-world';

/**
 * 交流広場：交流掲示板の承認済みの投稿が看板として並ぶ3Dの広場を、一人称視点で歩いて見て回る。
 * - スマホは横向きで遊ぶ。Android は全画面にして横向きに固定し、できない端末（iPhone の Safari など）は
 *   縦持ちのとき画面ごと90度回して横向きに見せる。
 * - 視点は三人称（自分のアバターを後ろから見る）が標準。一人称に切り替えられる（端末に保存）。
 * - 広場の「校舎・教室」の門から教室へ入れる。教室では後ろの掲示板に新しい投稿が貼ってある。
 * - 画質は「きれい（影あり）」と「軽い」を選べる（端末に保存）。
 * - ほかの生徒の姿・位置は出さない（個人の動きを記録しない。1対1のやりとりもない）。
 */

const SENSITIVITY_KEY = 'classbase_plaza_sensitivity';
const VIEW_MODE_KEY = 'classbase_plaza_view';
const QUALITY_KEY = 'classbase_plaza_quality';
const STAGE_LABELS: Record<StageKey, string> = { plaza: '交流広場', classroom: '教室' };
/** アバターの服の色。生徒ごとに決まった色にする（毎回同じ）。 */
const AVATAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const avatarColorFor = (uid: string) => AVATAR_COLORS[Array.from(uid).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];

function readQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch { /* 保存できない端末 */ }
  // メモリの少ない端末は、はじめから軽い画質にする。
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory && memory <= 3 ? 'low' : 'high';
}

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'first' ? 'first' : 'third';
  } catch {
    return 'third';
  }
}

const toBoard = (topic: any): PlazaBoard => ({
  id: topic.id,
  title: String(topic.title || ''),
  type: topic.type === 'vote' ? 'vote' : 'thread',
  creatorName: String(topic.creator_name || ''),
  likes: Number(topic.likes || 0),
  featured: Boolean(topic.reward_given),
});

function readSensitivity() {
  try {
    const value = Number(localStorage.getItem(SENSITIVITY_KEY));
    return value >= 0.3 && value <= 3 ? value : 1;
  } catch {
    return 1;
  }
}

export default function CommunityPlazaPage() {
  const { user } = useAuth();
  const uid = user?.uid || '';
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PlazaEngine | null>(null);
  const boardsRef = useRef<PlazaBoard[]>([]);

  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [facing, setFacing] = useState(-1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('third');
  const [quality, setQuality] = useState<Quality | null>(null);
  const [stage, setStage] = useState<StageKey>('plaza');
  const [portalLabel, setPortalLabel] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [reportedKeys, setReportedKeys] = useState<Set<string>>(() => new Set());

  const visibleTopics = useMemo(() => topics.slice(0, BOARD_LIMIT), [topics]);
  const openTopic = openId ? visibleTopics.find(topic => topic.id === openId) || null : null;
  const paused = showIntro || Boolean(openTopic);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const q = query(collection(db, 'community_topics'), where('is_approved', '==', true), orderBy('created_at', 'desc'), limit(BOARD_LIMIT));
      const snap = await getDocs(q);
      setTopics(snap.docs.map(item => ({ id: item.id, ...item.data() })));
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void fetchTopics(); }, [fetchTopics]);

  // 縦持ちのスマホは、画面ごと90度回して横向きに見せる。
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => {
      setCoarse(media.matches);
      setRotated(media.matches && window.innerHeight > window.innerWidth);
    };
    update();
    setSensitivity(readSensitivity());
    setViewMode(readViewMode());
    setQuality(readQuality());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // 3D の広場（three.js はこのページを開いたときだけ読み込む）。
  useEffect(() => {
    let disposed = false;
    let engine: PlazaEngine | null = null;
    if (!uid || !quality) return;
    setEngineReady(false);
    boardsRef.current = [];
    (async () => {
      try {
        const { createPlazaEngine } = await import('./plaza-engine');
        if (disposed || !stageRef.current) return;
        engine = createPlazaEngine(stageRef.current, {
          onFacingChange: setFacing,
          onInteract: index => {
            const board = boardsRef.current[index];
            if (board) setOpenId(board.id);
          },
          onPointerLockChange: setLocked,
          onViewModeChange: setViewMode,
          onPortalChange: setPortalLabel,
          onTransition: setTransitioning,
          onStageChange: setStage,
          viewMode: readViewMode(),
          avatarColor: avatarColorFor(uid),
          quality,
        });
        setStage('plaza');
        setPortalLabel(null);
        engineRef.current = engine;
        setEngineReady(true);
      } catch (error) {
        console.error('[plaza] 3D の準備に失敗しました', error);
        setEngineError(true);
      }
    })();
    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [uid, quality]);
  useEffect(() => {
    if (!quality) return;
    try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* 保存できなくても動く */ }
  }, [quality]);

  // 看板の中身。並びが同じなら、変わった看板だけ描き直す。
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = visibleTopics.map(toBoard);
    const previous = boardsRef.current;
    const sameOrder = previous.length === next.length && previous.every((board, index) => board.id === next[index].id);
    if (sameOrder) {
      next.forEach((board, index) => {
        if (JSON.stringify(board) !== JSON.stringify(previous[index])) engine.updateBoard(index, board);
      });
    } else {
      engine.setBoards(next);
    }
    boardsRef.current = next;
  }, [visibleTopics, engineReady]);

  useEffect(() => { engineRef.current?.setRotated(rotated); }, [rotated, engineReady]);
  useEffect(() => {
    engineRef.current?.setViewMode(viewMode);
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch { /* 保存できなくても動く */ }
  }, [viewMode, engineReady]);
  useEffect(() => { engineRef.current?.setPaused(paused); }, [paused, engineReady]);
  useEffect(() => {
    engineRef.current?.setSensitivity(sensitivity);
    try { localStorage.setItem(SENSITIVITY_KEY, String(sensitivity)); } catch { /* 保存できなくても動く */ }
  }, [sensitivity, engineReady]);

  // 出るときは全画面と向きの固定を戻す。
  useEffect(() => () => {
    try { (screen.orientation as any)?.unlock?.(); } catch { /* 対応していない端末 */ }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const enter = async () => {
    setShowIntro(false);
    if (!coarse) return;
    // Android（Chrome など）は全画面にすると横向きに固定できる。できない端末は回して見せる。
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await (screen.orientation as any)?.lock?.('landscape');
    } catch { /* iPhone の Safari などは非対応 */ }
  };

  const postAction = useCallback(async (payload: Record<string, unknown>) => {
    if (!user) throw new Error('not-signed-in');
    const res = await fetch('/api/student/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'community-action-failed');
    return data;
  }, [user]);

  const closePanel = useCallback(() => setOpenId(null), []);
  const facingBoard = facing >= 0 ? boardsRef.current[facing] : null;

  const stageStyle: React.CSSProperties = rotated
    ? { position: 'fixed', top: 0, left: 0, width: '100dvh', height: '100dvw', transform: 'rotate(90deg) translateY(-100%)', transformOrigin: 'top left' }
    : { position: 'fixed', inset: 0 };

  return (
    <div style={stageStyle} className="z-[100] overflow-hidden bg-sky-100 text-fg select-none" data-plaza-rotated={rotated ? 'true' : 'false'}>
      <div ref={stageRef} className="absolute inset-0" />

      {/* 上のボタン */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link href="/student/community" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface/90 px-3 text-sm font-bold text-fg shadow-card backdrop-blur">
            <ChevronLeft size={18} aria-hidden /> 掲示板へ
          </Link>
          <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-900/55 px-3 text-xs font-bold text-white" aria-live="polite">
            <MapPin size={14} aria-hidden /> {STAGE_LABELS[stage]}
          </span>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode(mode => (mode === 'third' ? 'first' : 'third'))}
            aria-label={viewMode === 'third' ? '一人称視点に切り替える' : '三人称視点に切り替える'}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface/90 px-3 text-sm font-bold text-fg shadow-card backdrop-blur"
          >
            {viewMode === 'third' ? <User size={18} aria-hidden /> : <Video size={18} aria-hidden />}
            {viewMode === 'third' ? '三人称' : '一人称'}
            {!coarse && <span className="rounded bg-canvas px-1 text-xs text-fg-muted">V</span>}
          </button>
          <button type="button" onClick={() => engineRef.current?.resetPosition()} aria-label={stage === 'plaza' ? '噴水の前にもどる' : '教室の入口にもどる'} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface/90 text-fg shadow-card backdrop-blur">
            <RotateCcw size={18} aria-hidden />
          </button>
          <button type="button" onClick={() => setShowIntro(true)} aria-label="操作のしかた" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface/90 text-fg shadow-card backdrop-blur">
            <CircleHelp size={18} aria-hidden />
          </button>
        </div>
      </div>

      {/* 照準 */}
      {!paused && !coarse && viewMode === 'first' && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_rgba(15,23,42,0.5)]" aria-hidden />
      )}

      {/* 状態・ヒント */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {!paused && portalLabel && (
          <button
            type="button"
            onClick={() => engineRef.current?.enterPortal()}
            className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-bold text-white shadow-card"
          >
            <DoorOpen size={18} aria-hidden />
            {portalLabel}
            {!coarse && <span className="shrink-0 rounded bg-white/25 px-1.5 text-xs">E</span>}
          </button>
        )}
        {!paused && facingBoard && !portalLabel && (
          <button
            type="button"
            onClick={() => setOpenId(facingBoard.id)}
            className="pointer-events-auto flex min-h-12 max-w-[min(90%,28rem)] items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-accent-ink shadow-card"
          >
            <Eye size={18} aria-hidden />
            <span className="truncate">{facingBoard.title}</span>
            <span className="shrink-0 rounded bg-white/25 px-1.5 text-xs">{coarse ? '見る' : 'E で見る'}</span>
          </button>
        )}
        {!paused && !coarse && !locked && !facingBoard && !portalLabel && (
          <p className="rounded-full bg-slate-900/60 px-4 py-2 text-xs font-bold text-white">画面をクリックすると、マウスで見回せます（Esc で解除）</p>
        )}
        {!loading && !loadError && visibleTopics.length === 0 && !paused && (
          <p className="rounded-full bg-slate-900/60 px-4 py-2 text-xs font-bold text-white">まだ看板（投稿）がありません。掲示板から投稿してみよう！</p>
        )}
      </div>

      {/* ステージを移るときの暗転 */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 z-20 bg-slate-950 transition-opacity duration-300 ${transitioning ? 'opacity-100' : 'opacity-0'}`} />

      {/* 入口の説明 */}
      {showIntro && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-900/55 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="plaza-intro-title" className="my-auto w-full max-w-2xl rounded-card bg-surface p-5 shadow-2xl">
            <h1 id="plaza-intro-title" className="text-lg font-bold text-fg">交流広場</h1>
            <p className="mt-1 text-sm text-fg-muted">交流掲示板の投稿が、看板になって並んでいます。自分のアバターで歩いて近づき、看板を開くと、いいね・投票・コメントができます。「校舎・教室」の門からは教室に入れます（後ろの掲示板にも投稿がはってあります）。</p>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-btn bg-canvas p-3">
                <h2 className="mb-1 font-bold text-fg">スマホ・タブレット</h2>
                <ul className="list-disc space-y-0.5 pl-5 text-fg-muted">
                  <li>横向きで遊びます</li>
                  <li>画面の左側を押したまま動かす：歩く（大きく倒すと走る）</li>
                  <li>画面の右側をなぞる：見回す</li>
                  <li>看板の前で「見る」を押す：投稿を開く</li>
                  <li>門・扉の前のボタン：教室と広場を行き来する</li>
                  <li>右上の「三人称／一人称」：視点を切り替える</li>
                </ul>
              </div>
              <div className="rounded-btn bg-canvas p-3">
                <h2 className="mb-1 font-bold text-fg">パソコン</h2>
                <ul className="list-disc space-y-0.5 pl-5 text-fg-muted">
                  <li>画面をクリック → マウスで見回す（Esc で解除）</li>
                  <li>W A S D・矢印キー：歩く（Shift で走る）</li>
                  <li>看板の前で E：投稿を開く／門・扉の前で E：通る</li>
                  <li>V：視点を切り替える（三人称／一人称）</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-bold text-fg">
              視点
              <div className="flex rounded-btn bg-canvas p-1" role="group" aria-label="視点">
                {([['third', '三人称（アバターを後ろから）'], ['first', '一人称（自分の目から）']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)} className={`min-h-9 rounded-btn px-3 text-xs font-bold ${viewMode === mode ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold text-fg">
              画質
              <div className="flex rounded-btn bg-canvas p-1" role="group" aria-label="画質">
                {([['high', 'きれい（影あり）'], ['low', '軽い（古い端末向け）']] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={quality === value} onClick={() => setQuality(value)} className={`min-h-9 rounded-btn px-3 text-xs font-bold ${quality === value ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold text-fg">
              見回す速さ
              <input type="range" min={0.3} max={3} step={0.1} value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} className="min-w-40 flex-1 accent-accent" aria-valuetext={`${sensitivity.toFixed(1)}倍`} />
              <span className="w-12 text-right text-fg-muted">{sensitivity.toFixed(1)}倍</span>
            </label>

            <ul className="mt-4 space-y-1 rounded-btn border border-line p-3 text-xs text-fg-muted">
              <li>・歩きながら使わないでね。周りに気をつけて、すわって遊ぼう。</li>
              <li>・目がつかれたり、気分が悪くなったりしたら、すぐにやめて休もう。</li>
              <li>・看板になるのは、先生が確認した投稿だけです。ほかの生徒の姿や、いる場所は表示されません。</li>
              <li>・いやな投稿を見つけたら、看板を開いて「通報」で先生に知らせてね。</li>
            </ul>

            {engineError ? (
              <p className="mt-4 rounded-btn bg-danger-soft p-3 text-sm font-bold text-danger">この端末では3Dの広場を表示できませんでした。掲示板からご利用ください。</p>
            ) : loadError ? (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-btn bg-danger-soft p-3 text-sm font-bold text-danger">
                投稿を読み込めませんでした。
                <button type="button" onClick={() => void fetchTopics()} className="min-h-11 rounded-btn bg-surface px-4 text-fg">もう一度</button>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Link href="/student/community" className="inline-flex min-h-11 items-center rounded-btn px-4 text-sm font-bold text-fg-muted hover:bg-canvas">掲示板にもどる</Link>
              <button
                type="button"
                onClick={() => void enter()}
                disabled={!engineReady || engineError || loading}
                className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-accent px-6 text-sm font-bold text-accent-ink disabled:opacity-50"
              >
                {(loading || (!engineReady && !engineError)) && <Loader2 size={16} className="animate-spin" aria-hidden />}
                広場に入る
              </button>
            </div>
          </section>
        </div>
      )}

      {openTopic && uid && (
        <PlazaTopicPanel
          topic={openTopic}
          uid={uid}
          reportedKeys={reportedKeys}
          onReported={key => setReportedKeys(prev => new Set(prev).add(key))}
          onClose={closePanel}
          onTopicChange={next => setTopics(prev => prev.map(item => (item.id === next.id ? next : item)))}
          postAction={postAction}
        />
      )}
    </div>
  );
}
