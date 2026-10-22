'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import {
  AlertCircle, Archive, Atom, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Globe, History, Landmark, Leaf, Loader2,
  MonitorPlay, Mountain, PlayCircle, ScrollText, Search, Sparkles, Video, X,
} from 'lucide-react';
import { PageHeader, Button, IconButton, Modal, ListSkeleton, EmptyState, ErrorState, Spinner, StatusPill } from '@/app/components/ui';
import { formatDate, jstDateKey, weekdayFromDateKey } from '@/lib/format';
import { RECORDING_HEARTBEAT_SECONDS } from '@/lib/recording-watch';
import {
  getCurrentSchoolYear,
  getRecordingYearScope,
  normalizeRecordingType,
  normalizeSchoolYear,
  recordingTypeLabel,
  type RecordingType,
  type RecordingYearScope,
} from '@/lib/recordings';

type RecordingItem = {
  id: string;
  target_date: string;
  grade: string;
  subject: string;
  title: string;
  video_url: string;
  original_shift_id?: string;
  zoom_recording_file_id?: string;
  target_recording_file_id?: string;
  unit: string;
  detail_subject: string;
  trim_start_seconds?: number;
  trim_end_seconds?: number | null;
  recording_type: RecordingType;
  recording_type_label: string;
  school_year: number;
  year_scope: RecordingYearScope;
  searchText: string;
  zoom_share: boolean;
  /** 自分の視聴記録。completed＝最後まで見た、partial＝途中まで。 */
  watch_status: 'completed' | 'partial' | null;
};

type PlaybackOption = {
  key: string;
  label: string;
  playback_url: string;
};

export default function StudentRecordingsPage() {
  const { user } = useAuth();
  
  // データ管理
  const [allRecordings, setAllRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [activeRecording, setActiveRecording] = useState<RecordingItem | null>(null);
  const [watchStartedAt, setWatchStartedAt] = useState<number | null>(null);
  const [videoToken, setVideoToken] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [videoRetry, setVideoRetry] = useState(0);
  // Zoom共有の録画はモーダルを開かずに新しいタブで開くため、失敗はモーダルの外のお知らせで出す。
  const [openError, setOpenError] = useState('');
  // 一覧の読み込み失敗を「録画なし」と区別する。
  const [listError, setListError] = useState('');
  const [listReloadKey, setListReloadKey] = useState(0);
  const [recordingSessionId, setRecordingSessionId] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackChoices, setPlaybackChoices] = useState<{ recording: RecordingItem; options: PlaybackOption[] } | null>(null);
  
  // UI状態：今年度と過去の録画をはっきり分けて表示する。
  const [scope, setScope] = useState<RecordingYearScope>('current');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | RecordingType>('all');
  const [pastYearFilter, setPastYearFilter] = useState<'all' | number>('all');
  // 今年度：実施月・カレンダーの日付で絞り込む。
  const [monthFilter, setMonthFilter] = useState<'all' | string>('all');
  const [dayFilter, setDayFilter] = useState('');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const currentSchoolYear = getCurrentSchoolYear();

  // データ取得
  useEffect(() => {
    const fetchRecordings = async () => {
      if (!user) return;
      setLoading(true);
      setListError('');

      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/student/recordings', { headers: { Authorization: `Bearer ${token}` } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || '録画一覧を取得できません');
        const data: RecordingItem[] = (Array.isArray(result.recordings) ? result.recordings : []).map((d: any) => {
          const targetDate = d.target_date || '2024-01-01';
          const schoolYear = normalizeSchoolYear(targetDate, d.school_year);
          const recordingType = normalizeRecordingType(d.recording_type || d.recording_type_label);
          const typeLabel = recordingTypeLabel(recordingType);
          return { 
            id: d.id,
            target_date: targetDate,
            grade: d.grade || 'その他',
            subject: d.subject || '全科目',
            title: d.title || 'タイトルなし',
            video_url: '',
            original_shift_id: d.original_shift_id || '',
            zoom_recording_file_id: d.zoom_recording_file_id || d.target_recording_file_id || '',
            target_recording_file_id: d.target_recording_file_id || d.zoom_recording_file_id || '',
            unit: d.unit || '',
            detail_subject: d.detail_subject || '',
            trim_start_seconds: Number(d.trim_start_seconds || 0),
            trim_end_seconds: d.trim_end_seconds ? Number(d.trim_end_seconds) : null,
            recording_type: recordingType,
            recording_type_label: typeLabel,
            school_year: schoolYear,
            year_scope: getRecordingYearScope(schoolYear),
            watch_status: d.watch_status === 'completed' || d.watch_status === 'partial' ? d.watch_status : null,
            zoom_share: d.zoom_share === true,
            searchText: `${d.title} ${d.subject} ${d.grade} ${d.target_date} ${d.unit || ''} ${d.detail_subject || ''} ${typeLabel} ${schoolYear}年度`.toLowerCase()
          };
        });

        setAllRecordings(data);
        // 今年度の録画がまだない場合は、過去の録画を最初に表示する。
        if (data.length > 0 && !data.some(rec => rec.year_scope === 'current')) setScope('past');

      } catch (error) {
        console.error("録画取得エラー:", error);
        setListError('録画一覧を読み込めませんでした。通信状況を確認して、もう一度お試しください。');
      } finally {
        setLoading(false);
      }
    };
    fetchRecordings();
  }, [user, listReloadKey]);

  const SCIENCE_UNITS = [
    { label: '物理', icon: <Atom size={15}/> },
    { label: '化学', icon: <FlaskConical size={15}/> },
    { label: '生物', icon: <Leaf size={15}/> },
    { label: '地学', icon: <Mountain size={15}/> },
  ];
  const SOCIAL_UNITS = [
    { label: '地理', icon: <Globe size={15}/> },
    { label: '歴史', icon: <ScrollText size={15}/> },
    { label: '公民', icon: <Landmark size={15}/> },
  ];

  const currentCount = allRecordings.filter(rec => rec.year_scope === 'current').length;
  const pastCount = allRecordings.filter(rec => rec.year_scope === 'past').length;
  const pastYears = useMemo(() => Array.from(new Set(allRecordings.filter(rec => rec.year_scope === 'past').map(rec => rec.school_year))).sort((a, b) => b - a), [allRecordings]);
  const unitOptions = subjectFilter === '社会' ? SOCIAL_UNITS : subjectFilter === '理科' ? SCIENCE_UNITS : [...SCIENCE_UNITS, ...SOCIAL_UNITS];

  // 月・日付以外の条件で絞った録画（カレンダーの印と月ごとの本数に使う）。
  const filteredWithoutDate = useMemo(() => {
    const lowerQ = searchQuery.trim().toLowerCase();
    return allRecordings.filter(rec => {
      if (rec.year_scope !== scope) return false;
      if (scope === 'past' && pastYearFilter !== 'all' && rec.school_year !== pastYearFilter) return false;
      if (typeFilter !== 'all' && rec.recording_type !== typeFilter) return false;
      if (gradeFilter !== 'all' && rec.grade !== gradeFilter) return false;
      if (subjectFilter !== 'all' && rec.subject !== subjectFilter) return false;
      if (unitFilter !== 'all' && !`${rec.title} ${rec.unit} ${rec.detail_subject}`.includes(unitFilter)) return false;
      return !lowerQ || rec.searchText.includes(lowerQ);
    });
  }, [allRecordings, scope, pastYearFilter, typeFilter, gradeFilter, subjectFilter, unitFilter, searchQuery]);

  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    filteredWithoutDate.forEach(rec => {
      const key = rec.target_date.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(key)) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [filteredWithoutDate]);
  // 今年度の月（4月〜翌3月）。録画のある月だけ選べる。
  const schoolMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const month = ((index + 3) % 12) + 1;
    const year = month >= 4 ? currentSchoolYear : currentSchoolYear + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  }), [currentSchoolYear]);
  // 年度の切り替え前に始まった授業（3月など）も選べるようにする。
  // まだ来ていない月は出さない。
  const monthOptions = useMemo(() => {
    const thisMonth = jstDateKey().slice(0, 7);
    return Array.from(new Set([...Array.from(monthCounts.keys()), ...schoolMonths.filter(key => key <= thisMonth)])).sort();
  }, [monthCounts, schoolMonths]);
  const latestMonth = useMemo(() => Array.from(monthCounts.keys()).sort().at(-1) || '', [monthCounts]);
  const shownCalendarMonth = calendarMonth || (monthFilter !== 'all' ? monthFilter : latestMonth);

  const displayVideos = useMemo(() => filteredWithoutDate.filter(rec => {
    if (scope !== 'current') return true;
    if (dayFilter) return rec.target_date === dayFilter;
    if (monthFilter !== 'all') return rec.target_date.startsWith(monthFilter);
    return true;
  }), [filteredWithoutDate, scope, dayFilter, monthFilter]);

  const selectMonth = (value: 'all' | string) => {
    setMonthFilter(value);
    setDayFilter('');
    setCalendarMonth(value === 'all' ? '' : value);
  };
  const selectDay = (date: string) => {
    if (dayFilter === date) { setDayFilter(''); return; }
    setDayFilter(date);
    setMonthFilter(date.slice(0, 7));
    setCalendarMonth(date.slice(0, 7));
  };

  // 今年度は月ごと、過去は年度ごとにまとめる。
  const groups = useMemo(() => {
    const map = new Map<string, RecordingItem[]>();
    displayVideos.forEach(rec => {
      const key = scope === 'current' ? rec.target_date.slice(0, 7) : String(rec.school_year);
      map.set(key, [...(map.get(key) || []), rec]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [displayVideos, scope]);
  const groupLabel = (key: string) => {
    if (scope === 'past') return `${key}年度の録画`;
    const [y, m] = key.split('-');
    return `${Number(m)}月の授業${Number(y) !== new Date().getFullYear() ? `（${y}年）` : ''}`;
  };
  const isPast = scope === 'past';

  const postRecordingView = async (recordingId: string, eventType: 'start' | 'progress' | 'complete', watchedSeconds: number, sessionId = '', video?: HTMLVideoElement | null) => {
    if (!user) return;
    const token = await user.getIdToken();
    const response = await fetch('/api/recording-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recording_id: recordingId,
        event_type: eventType,
        watched_seconds: watchedSeconds,
        session_id: sessionId,
        position_seconds: video && Number.isFinite(video.currentTime) ? video.currentTime : null,
        duration_seconds: video && Number.isFinite(video.duration) ? video.duration : null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '視聴記録の保存に失敗しました');
    return data;
  };

  const createZoomPlaybackOptions = async (recordingId: string) => {
    if (!user) throw new Error('ログイン情報を確認できません。');
    const token = await user.getIdToken();
    const response = await fetch('/api/zoom/recordings/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recording_id: recordingId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.playback_url) throw new Error(data.error || '録画を開けませんでした。');
    const options = Array.isArray(data.playback_options) ? data.playback_options.filter((option: any) => (
      option && typeof option.playback_url === 'string' && typeof option.label === 'string'
    )) : [];
    return options.length > 0 ? options : [{ key: 'default', label: '録画を開く', playback_url: String(data.playback_url) }];
  };

  const openZoomRecording = async (rec: RecordingItem, playbackWindow: Window | null) => {
    try {
      const options = await createZoomPlaybackOptions(rec.id);
      if (options.length > 1) {
        if (playbackWindow) playbackWindow.close();
        setPlaybackChoices({ recording: rec, options });
        return false;
      }
      if (playbackWindow) playbackWindow.location.href = options[0].playback_url;
      return true;
    } catch (error) {
      if (playbackWindow) playbackWindow.close();
      setOpenError(error instanceof Error ? error.message : '録画を開けませんでした。');
      return false;
    }
  };

  const handleWatchVideo = async (e: React.MouseEvent, rec: RecordingItem) => {
    e.preventDefault(); 
    if (processingId) return;
    const zoomSharePlayback = rec.zoom_share;
    if (zoomSharePlayback) {
      setOpenError('');
      const playbackWindow = window.open('', '_blank');
      if (playbackWindow) playbackWindow.opener = null;
      setProcessingId(rec.id);
      try {
        const opened = playbackWindow ? await openZoomRecording(rec, playbackWindow) : false;
        if (opened) await postRecordingView(rec.id, 'start', 0);
      } catch (err) {
        console.warn('recording start log failed:', err);
      } finally {
        window.setTimeout(() => setProcessingId(null), 1000);
      }
      if (!playbackWindow) {
        setActiveRecording(rec);
        setVideoLoading(false);
        setVideoError('ブラウザで新しいタブがブロックされました。下のボタンから録画を開いてください。');
      }
      return;
    }
    const token = user ? await user.getIdToken() : '';
    setVideoLoading(true);
    setVideoError('');
    setVideoRetry(0);
    setVideoToken(token);
    setActiveRecording(rec);
    setWatchStartedAt(Date.now());
    setProcessingId(rec.id);
    try {
      const view = await postRecordingView(rec.id, 'start', 0, '', videoRef.current);
      setRecordingSessionId(String(view?.session_id || ''));
    } catch (err) { console.error(err); } 
    finally { setTimeout(() => setProcessingId(null), 1000); }
  };

  const closeRecordingModal = async () => {
    if (!activeRecording) return;
    const watchedSeconds = watchStartedAt ? Math.max(1, Math.round((Date.now() - watchStartedAt) / 1000)) : 0;
    // 閉じるときは最後の合図を送って、この視聴を終える（コインの判定はサーバーが再生時間で行う）。
    const eventType = 'complete';
    const recordingId = activeRecording.id;
    setActiveRecording(null);
    setWatchStartedAt(null);
    setVideoToken('');
    setVideoLoading(false);
    setVideoError('');
    setVideoRetry(0);
    setRecordingSessionId('');
    try {
      const result = await postRecordingView(recordingId, eventType, watchedSeconds, recordingSessionId, videoRef.current);
      // 一覧の「視聴済み／途中まで」をその場で更新する（次に開いたときはサーバーの記録を表示）。
      const nextStatus: RecordingItem['watch_status'] = result?.rewarded || result?.already_rewarded ? 'completed' : watchedSeconds >= RECORDING_HEARTBEAT_SECONDS ? 'partial' : null;
      if (nextStatus) {
        setAllRecordings(prev => prev.map(item => item.id === recordingId && item.watch_status !== 'completed' ? { ...item, watch_status: nextStatus } : item));
      }
    } catch (err) {
      console.warn('recording progress log failed:', err);
    }
  };

  // 再生中（一時停止・タブ非表示でない）の間だけ、約30秒ごとに視聴中の合図を送る。
  const sendHeartbeat = async () => {
    if (!activeRecording || !recordingSessionId) return;
    try {
      await postRecordingView(activeRecording.id, 'progress', 0, recordingSessionId, videoRef.current);
    } catch (err) {
      console.warn('recording heartbeat failed:', err);
    }
  };
  useEffect(() => {
    if (!activeRecording || activeRecording.zoom_share || !recordingSessionId) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || document.visibilityState !== 'visible') return;
      void sendHeartbeat();
    }, RECORDING_HEARTBEAT_SECONDS * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecording, recordingSessionId]);

  const activeRecordingSrc = activeRecording
    ? (activeRecording.zoom_share
      ? ''
      : `/api/zoom/recordings/file?recording_id=${encodeURIComponent(activeRecording.id)}&token=${encodeURIComponent(videoToken)}&retry=${videoRetry}`)
    : '';
  const activeRecordingUsesZoomPlayer = Boolean(activeRecording?.zoom_share);

  useEffect(() => {
    if (!activeRecording || !videoLoading) return;
    const timeout = window.setTimeout(() => {
      setVideoLoading(false);
      setVideoError('録画の読み込みに時間がかかっています。再読み込みをお試しください。');
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [activeRecording, activeRecordingSrc, videoLoading]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <ListSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      {openError && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[230] flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="flex w-full max-w-md items-start gap-3 rounded-card border border-danger/25 bg-surface px-4 py-3 shadow-card">
            <AlertCircle size={20} className="mt-2.5 shrink-0 text-danger" aria-hidden />
            <p className="flex-1 py-2 text-sm font-bold text-fg">{openError}</p>
            <IconButton label="お知らせを閉じる" size="sm" onClick={() => setOpenError('')}><X size={16} aria-hidden /></IconButton>
          </div>
        </div>
      )}
      <Modal
        open={Boolean(playbackChoices)}
        onClose={() => setPlaybackChoices(null)}
        title="視聴する録画を選択"
        description={playbackChoices ? <>複数の録画があります。<br />{playbackChoices.recording.title}</> : undefined}
        size="sm"
      >
        {playbackChoices && (
          <div className="space-y-2">
            {playbackChoices.options.map((option, index) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  const target = window.open('', '_blank');
                  if (!target) {
                    setOpenError('ブラウザで新しいタブがブロックされました。ポップアップを許可して、もう一度お試しください。');
                    return;
                  }
                  target.opener = null;
                  target.location.href = option.playback_url;
                  void postRecordingView(playbackChoices.recording.id, 'start', 0).catch(error => console.warn('recording start log failed:', error));
                  setPlaybackChoices(null);
                }}
                className="flex min-h-14 w-full items-center justify-between rounded-btn border border-line bg-slate-50 px-4 py-3 text-left transition hover:border-accent/30 hover:bg-accent-soft"
              >
                <span><span className="block text-sm font-bold text-fg">録画 {index + 1}</span><span className="mt-1 block text-xs text-fg-muted">{option.label}</span></span>
                <PlayCircle className="text-accent" size={24} aria-hidden />
              </button>
            ))}
          </div>
        )}
      </Modal>
      {activeRecording && (
        <div className="fixed inset-0 z-[200] bg-slate-950/80 p-3 sm:p-6">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-card bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-line p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-fg">{activeRecording.title}</p>
                <p className="text-xs text-fg-muted">
                  {activeRecording.zoom_share
                    ? 'Zoomで開く録画は視聴時間を記録できないため、コインの対象外です'
                    // 残り時間を見せると「そこまでしか見ない」ので、基準や残りは表示しない。
                    : '視聴の記録中です。最後まで見て学習しましょう'}
                </p>
              </div>
              <Button variant="secondary" onClick={closeRecordingModal} icon={<X size={16} aria-hidden />}>閉じる</Button>
            </div>
            <div className="relative min-h-0 flex-1 bg-slate-900">
              {activeRecordingUsesZoomPlayer ? (
                <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-center text-white">
                  <div>
                    <PlayCircle className="mx-auto text-white/70" size={44} aria-hidden />
                    <p className="mt-4 text-sm font-bold">Zoom公式プレイヤーで再生します</p>
                    <button
                      type="button"
                      onClick={() => {
                        const playbackWindow = window.open('', '_blank');
                        if (playbackWindow) playbackWindow.opener = null;
                        void openZoomRecording(activeRecording, playbackWindow);
                      }}
                      className="mt-4 inline-flex min-h-11 items-center rounded-btn bg-white px-5 text-sm font-bold text-slate-900 hover:bg-slate-100"
                    >
                      録画を開く
                    </button>
                  </div>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  src={activeRecordingSrc}
                  title={activeRecording.title}
                  className="h-full w-full bg-slate-900"
                  controls
                  autoPlay
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  playsInline
                  preload="metadata"
                  onContextMenu={(event) => event.preventDefault()}
                  onLoadStart={() => { setVideoLoading(true); setVideoError(''); }}
                  onCanPlay={() => setVideoLoading(false)}
                  onPlaying={() => setVideoLoading(false)}
                  // 再生を始めた・止めた時点でも合図を送り、サーバー側の区切りをそろえる。
                  onPlay={() => { void sendHeartbeat(); }}
                  onPause={() => { void sendHeartbeat(); }}
                  onError={() => {
                    setVideoLoading(false);
                    setVideoError('録画を読み込めませんでした。少し待ってからもう一度お試しください。');
                  }}
                  onLoadedMetadata={(event) => {
                    const start = activeRecording.trim_start_seconds || 0;
                    if (start > 0) event.currentTarget.currentTime = start;
                  }}
                  onTimeUpdate={(event) => {
                    const end = activeRecording.trim_end_seconds;
                    if (end && event.currentTarget.currentTime >= end) {
                      event.currentTarget.pause();
                    }
                  }}
                />
              )}
              {videoLoading && !videoError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/70 text-white">
                  <div className="text-center">
                    <Loader2 className="mx-auto animate-spin" size={32} aria-hidden />
                    <p className="mt-3 text-xs font-bold">録画を準備しています</p>
                  </div>
                </div>
              )}
              {videoError && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950 p-6 text-center text-sm font-bold text-white">
                  <div>
                    <p>{videoError}</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {activeRecordingUsesZoomPlayer && (
                        <button type="button" onClick={() => {
                          const playbackWindow = window.open('', '_blank');
                          if (playbackWindow) playbackWindow.opener = null;
                          void openZoomRecording(activeRecording, playbackWindow);
                        }} className="inline-flex min-h-11 items-center rounded-btn bg-white px-4 text-sm font-bold text-slate-900">
                          Zoomで録画を開く
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (activeRecordingUsesZoomPlayer) {
                            void closeRecordingModal();
                            return;
                          }
                          setVideoError('');
                          setVideoLoading(true);
                          setVideoRetry(value => value + 1);
                        }}
                        className="inline-flex min-h-11 items-center rounded-btn bg-white px-4 text-sm font-bold text-slate-900"
                      >
                        {activeRecordingUsesZoomPlayer ? '閉じる' : '再読み込み'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700">
              ダウンロードはできません。再生速度などの操作は動画プレイヤーのメニューから利用できます。
            </p>
          </div>
        </div>
      )}

      <PageHeader
        tone="hero"
        title="授業の録画"
        description="見たい録画の年度を選んでね。視聴の記録は自動で残ります"
        icon={Video}
        backHref="/student"
      />

      {/* 今年度 / 過去 を大きなカードで切り替える */}
      <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label="録画の年度">
        <button type="button" role="tab" aria-selected={!isPast} onClick={() => { setScope('current'); setPastYearFilter('all'); }}
          className={`relative overflow-hidden rounded-card p-5 text-left transition-all ${!isPast ? 'bg-accent text-accent-ink shadow-card ring-4 ring-accent/20' : 'cb-card text-fg hover:ring-2 hover:ring-accent/30'}`}>
          <div className="flex items-center justify-between">
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${!isPast ? 'bg-white/20' : 'bg-accent-soft text-accent'}`}><Sparkles size={14} aria-hidden />今年度の授業</span>
            <span className="text-3xl font-black">{currentCount}<span className="ml-1 text-sm font-bold">本</span></span>
          </div>
          <p className="mt-3 text-2xl font-black">{currentSchoolYear}年度</p>
          <p className={`mt-1 text-xs font-medium ${!isPast ? 'text-accent-ink/85' : 'text-fg-muted'}`}>いま受けている授業の録画。休んだ日や復習に</p>
        </button>
        <button type="button" role="tab" aria-selected={isPast} onClick={() => { setScope('past'); setMonthFilter('all'); setDayFilter(''); }} disabled={pastCount === 0}
          className={`relative overflow-hidden rounded-card p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${isPast ? 'bg-slate-800 text-white shadow-card ring-4 ring-slate-200' : 'cb-card text-fg hover:ring-2 hover:ring-slate-300'}`}>
          <div className="flex items-center justify-between">
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${isPast ? 'bg-white/15' : 'bg-slate-100 text-slate-600'}`}><History size={14} aria-hidden />過去の録画</span>
            <span className="text-3xl font-black">{pastCount}<span className="ml-1 text-sm font-bold">本</span></span>
          </div>
          <p className="mt-3 text-2xl font-black">{pastYears.length > 0 ? `${pastYears[pastYears.length - 1]}〜${pastYears[0]}年度` : `${currentSchoolYear - 1}年度以前`}</p>
          <p className={`mt-1 text-xs font-medium ${isPast ? 'text-white/75' : 'text-fg-muted'}`}>去年までの授業の録画。予習や総復習に</p>
        </button>
      </div>

      {isPast && (
        <div className="flex items-start gap-3 rounded-card border-2 border-slate-300 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
          <Archive size={20} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />
          <p>ここは<span className="font-bold text-slate-900">過去の年度の録画</span>です。今年度の授業とは、内容や進み方、テスト範囲が違うことがあります。</p>
        </div>
      )}

      {/* 絞り込み */}
      <div className="cb-card p-card space-y-3">
        <div className={`flex items-center gap-2 rounded-input border border-line bg-slate-50 px-3 transition-all focus-within:bg-surface ${isPast ? 'focus-within:border-slate-400' : 'focus-within:border-accent'}`}>
          <Search size={18} className="text-fg-muted" aria-hidden />
          <input type="text" aria-label="キーワードで探す" placeholder="キーワードで探す（例：電流、鎌倉幕府）" className="h-12 flex-1 bg-transparent font-medium text-fg outline-none" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery && <IconButton label="検索をクリア" size="sm" onClick={() => setSearchQuery('')}><X size={16} aria-hidden /></IconButton>}
        </div>
        {isPast && pastYears.length > 1 && (
          <FilterRow label="年度">
            <Chip active={pastYearFilter === 'all'} onClick={() => setPastYearFilter('all')} dark>すべての年度</Chip>
            {pastYears.map(yearValue => <Chip key={yearValue} active={pastYearFilter === yearValue} onClick={() => setPastYearFilter(yearValue)} dark>{yearValue}年度</Chip>)}
          </FilterRow>
        )}
        {!isPast && (
          <>
            <FilterRow label="実施月">
              <Chip active={monthFilter === 'all' && !dayFilter} onClick={() => selectMonth('all')}>すべての月</Chip>
              {monthOptions.map(key => {
                const count = monthCounts.get(key) || 0;
                return (
                  <button key={key} type="button" disabled={count === 0} onClick={() => selectMonth(key)} aria-pressed={monthFilter === key}
                    className={`min-h-9 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-35 ${monthFilter === key ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-fg-muted hover:border-slate-300'}`}>
                    {Number(key.slice(5))}月{count > 0 && <span className={`ml-1 ${monthFilter === key ? 'text-accent-ink/80' : 'text-slate-400'}`}>{count}</span>}
                  </button>
                );
              })}
            </FilterRow>
            {shownCalendarMonth && (
              <RecordingCalendar
                month={shownCalendarMonth}
                records={filteredWithoutDate}
                selectedDay={dayFilter}
                canPrev={monthOptions.some(key => key < shownCalendarMonth)}
                canNext={monthOptions.some(key => key > shownCalendarMonth)}
                onMove={offset => {
                  const [y, m] = shownCalendarMonth.split('-').map(Number);
                  const date = new Date(y, m - 1 + offset, 1);
                  setCalendarMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
                }}
                onSelectDay={selectDay}
              />
            )}
            {dayFilter && (
              <div className="flex items-center gap-2 rounded-btn bg-accent-soft px-3 py-2 text-xs font-bold text-accent">
                <CalendarDays size={15} aria-hidden />{formatDate(dayFilter, { withWeekday: false })}の録画を表示中
                <button type="button" onClick={() => setDayFilter('')} className="ml-auto min-h-9 rounded-full bg-surface px-3 text-xs font-bold text-accent hover:bg-white">日付の選択を解除</button>
              </div>
            )}
          </>
        )}
        <FilterRow label="学年">
          {['all', '中1', '中2', '中3'].map(g => <Chip key={g} active={gradeFilter === g} onClick={() => setGradeFilter(g)} dark={isPast}>{g === 'all' ? 'すべて' : g}</Chip>)}
        </FilterRow>
        <FilterRow label="科目">
          {['all', '理科', '社会'].map(value => <Chip key={value} active={subjectFilter === value} onClick={() => { setSubjectFilter(value); setUnitFilter('all'); }} dark={isPast}>{value === 'all' ? 'すべて' : value}</Chip>)}
          <span className="mx-1 h-5 w-px bg-line" />
          {unitOptions.map(unit => <Chip key={unit.label} active={unitFilter === unit.label} onClick={() => setUnitFilter(unitFilter === unit.label ? 'all' : unit.label)} dark={isPast}><span className="flex items-center gap-1">{unit.icon}{unit.label}</span></Chip>)}
        </FilterRow>
        <FilterRow label="種類">
          {([['all', 'すべて'], ['regular', '通常授業'], ['test_prep', 'テスト対策'], ['group_meeting', 'グループミーティング']] as const).map(([key, label]) => <Chip key={key} active={typeFilter === key} onClick={() => setTypeFilter(key)} dark={isPast}>{label}</Chip>)}
        </FilterRow>
      </div>

      {listError ? (
        <ErrorState title="録画を読み込めませんでした" message={listError} onRetry={() => setListReloadKey(key => key + 1)} />
      ) : displayVideos.length === 0 ? (
        <EmptyState
          icon={MonitorPlay}
          title={`${isPast ? '過去の録画' : '今年度の録画'}は見つかりませんでした`}
          description="絞り込みを「すべて」にすると見つかるかもしれません"
        />
      ) : (
        <div className="space-y-8">
          {groups.map(([key, items]) => (
            <section key={key}>
              <div className="mb-3 flex items-center gap-3 px-1">
                <h2 className={`flex items-center gap-2 text-lg font-bold ${isPast ? 'text-slate-700' : 'text-fg'}`}>
                  {isPast ? <History size={20} className="text-slate-500" aria-hidden /> : <CalendarDays size={20} className="text-accent" aria-hidden />}
                  {groupLabel(key)}
                </h2>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-bold text-white">{items.length}本</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map(rec => <RecordingCard key={rec.id} rec={rec} past={isPast} busy={processingId === rec.id} onWatch={(event) => handleWatchVideo(event, rec)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function RecordingCalendar({ month, records, selectedDay, canPrev, canNext, onMove, onSelectDay }: {
  month: string;
  records: RecordingItem[];
  selectedDay: string;
  canPrev: boolean;
  canNext: boolean;
  onMove: (offset: number) => void;
  onSelectDay: (date: string) => void;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const counts = new Map<string, number>();
  records.forEach(rec => { if (rec.target_date.startsWith(month)) counts.set(rec.target_date, (counts.get(rec.target_date) || 0) + 1); });
  const todayKey = jstDateKey();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  ];
  return (
    <div className="rounded-btn border border-accent/20 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <IconButton label="前の月" size="sm" onClick={() => onMove(-1)} disabled={!canPrev}><ChevronLeft size={18} aria-hidden /></IconButton>
        <p className="text-sm font-bold text-fg">{year}年 <span className="text-accent">{monthNumber}月</span> の授業</p>
        <IconButton label="次の月" size="sm" onClick={() => onMove(1)} disabled={!canNext}><ChevronRight size={18} aria-hidden /></IconButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((label, index) => (
          <span key={label} className={`py-1 text-xs font-bold ${index === 0 ? 'text-rose-400' : index === 6 ? 'text-sky-500' : 'text-fg-muted'}`}>{label}</span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;
          const count = counts.get(date) || 0;
          const selected = selectedDay === date;
          return (
            <button key={date} type="button" disabled={count === 0} onClick={() => onSelectDay(date)}
              aria-label={`${Number(date.slice(8))}日 録画${count}本`}
              aria-pressed={selected}
              className={`flex aspect-square flex-col items-center justify-center rounded-input text-xs font-bold transition-all sm:aspect-auto sm:h-11 ${
                selected ? 'bg-accent text-accent-ink shadow-sm'
                  : count > 0 ? 'bg-surface text-fg ring-1 ring-accent/20 hover:ring-accent/50'
                    : 'text-slate-300'
              } ${date === todayKey && !selected ? 'ring-2 ring-accent' : ''}`}>
              {Number(date.slice(8))}
              {count > 0 && <span className={`mt-0.5 text-[11px] leading-none ${selected ? 'text-accent-ink/85' : 'text-accent'}`}>{count}本</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-bold text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children, dark }: { active: boolean; onClick: () => void; children: React.ReactNode; dark?: boolean }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-9 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-all ${active ? (dark ? 'border-slate-800 bg-slate-800 text-white' : 'border-accent bg-accent text-accent-ink') : 'border-line bg-surface text-fg-muted hover:border-slate-300'}`}>
      {children}
    </button>
  );
}

function RecordingCard({ rec, past, busy, onWatch }: { rec: RecordingItem; past: boolean; busy: boolean; onWatch: (event: React.MouseEvent) => void }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(rec.target_date);
  const weekday = valid ? weekdayFromDateKey(rec.target_date) : '';
  return (
    <button type="button" onClick={onWatch} className="group block w-full text-left">
      <div className={`relative flex items-stretch gap-4 overflow-hidden rounded-card border p-4 transition-all duration-300 hover:-translate-y-0.5 ${past ? 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:shadow-card' : 'cb-card hover:ring-2 hover:ring-accent/30'}`}>
        <div className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-btn ${past ? 'bg-slate-200 text-slate-600' : 'bg-accent-soft text-accent'}`}>
          {past && <span className="text-[11px] font-bold">{rec.school_year}年度</span>}
          <span className="text-xs font-bold">{valid ? `${Number(rec.target_date.slice(5, 7))}月` : ''}</span>
          <span className="text-2xl font-black leading-none">{valid ? Number(rec.target_date.slice(8, 10)) : '-'}</span>
          <span className="text-xs font-medium">{weekday ? `(${weekday})` : ''}</span>
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {past
              ? <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-white">過去の録画</span>
              : <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white">今年度</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{rec.grade} ・ {rec.subject}</span>
            {rec.recording_type === 'test_prep' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">テスト対策</span>}
            {rec.recording_type === 'group_meeting' && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">グループミーティング</span>}
            {rec.watch_status === 'completed' && <StatusPill tone="success" icon={<CheckCircle2 size={12} aria-hidden />} className="text-[11px]">視聴済み</StatusPill>}
            {rec.watch_status === 'partial' && <StatusPill tone="info" className="text-[11px]">途中まで</StatusPill>}
          </div>
          <h3 className={`line-clamp-2 text-base font-bold ${past ? 'text-slate-700 group-hover:text-slate-900' : 'text-fg group-hover:text-accent'}`}>{rec.title}</h3>
          {rec.unit && rec.unit !== rec.title && <p className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{rec.unit}</p>}
          <p className="mt-1.5 text-xs text-fg-muted">{busy ? '視聴開始を記録中...' : '押すと録画が開きます'}</p>
        </div>
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-full transition-all ${past ? 'bg-slate-200 text-slate-600 group-hover:bg-slate-700 group-hover:text-white' : 'bg-accent-soft text-accent group-hover:bg-accent group-hover:text-accent-ink'}`}>
          {busy ? <Spinner size={22} label="視聴開始を記録中" className="text-current" /> : <PlayCircle size={28} strokeWidth={2.2} aria-hidden />}
        </div>
      </div>
    </button>
  );
}
