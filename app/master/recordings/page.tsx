'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, doc, getDocs, limit, orderBy, query, startAfter, where, writeBatch, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { reportAuditLog } from '@/app/components/master/audit-log-client';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileUp, Loader2, PauseCircle, PlayCircle,
  RefreshCw, Replace, Scissors, Search, Upload, Video,
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, Spinner, buttonClass, useConfirm, usePrompt, useToast } from '@/app/components/ui';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getCurrentSchoolYear, getRecordingYearScope, isZoomRecordingShareUrl, normalizeSchoolYear, recordingTypeLabel } from '@/lib/recordings';
import {
  PERIOD_WINDOWS, RECORDING_UPLOAD_STATE_LABELS, REQUIRED_RECORDING_TYPE,
  type MeetingTrimOptions, type RecordingIssue, type RecordingUploadState,
} from '@/lib/recording-publish-rules';
import { normalizeRecording, parseRecordingCsv, stableCsvRecordingDocId, type PublishedData } from './recording-csv';

// 録画の管理。録画の確認基盤は講師配置（shift_assignments）。Zoomの録画完了通知・日次同期で
// 講師配置に一致した「共有画面付きスピーカービュー」の録画は、不具合がなければ自動でアップされる。
// この画面では講師配置ごとのアップ状況を確認し、停止・再開・差し替え・保留分の公開を行う。

type ZoomCandidate = {
  url?: string; file_id?: string; recording_type?: string; duration_seconds?: number; recording_start?: string; meeting_id?: string; meeting_uuid?: string;
  /** 授業の前後の集会（グループミーティング）の録画。 */
  kind?: 'group_meeting'; meeting_position?: 'before' | 'after';
};

type ShiftData = {
  id: string;
  target_date: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  unit?: string;
  teacher_name?: string;
  note?: string;
  period?: string;
  target_period?: string;
  role_type?: string;
  target_meeting_id?: string;
  target_recording_url?: string;
  target_recording_file_id?: string;
  target_recording_type?: string;
  target_recording_duration_seconds?: number;
  target_recording_trim_start_seconds?: number;
  target_recording_trim_end_seconds?: number | null;
  zoom_recording_files?: any[];
  zoom_recording_candidates?: ZoomCandidate[];
  recording_status?: string;
  recording_issues?: RecordingIssue[];
  recording_publish_mode?: string;
  /** 別の録画にあった集会（グループミーティング）の位置。自動で授業の録画から除いている。 */
  recording_group_meeting?: 'before' | 'after' | null;
  /** 集会と授業が1つの録画につながっているときの切り取り位置の候補。 */
  recording_meeting_trim_options?: MeetingTrimOptions | null;
};

const MEETING_POSITION_LABELS = { before: '授業の前', after: '授業の後' } as const;

const groupMeetingCandidates = (shift: ShiftData) => (shift.zoom_recording_candidates || []).filter(candidate => candidate.kind === 'group_meeting' && candidate.url && candidate.file_id);
const groupMeetingRecordingId = (shiftId: string, fileId: string) => `meeting_${shiftId}_${fileId}`.replace(/[\/\s#?]/g, '_');
const groupMeetingTitle = (candidate: ZoomCandidate) => `グループミーティング${candidate.meeting_position ? `（${MEETING_POSITION_LABELS[candidate.meeting_position]}）` : ''}`;

type Row = { shift: ShiftData; period: string; state: RecordingUploadState; published?: PublishedData };

type PreviewTarget =
  | { kind: 'shift'; item: ShiftData }
  | { kind: 'published'; item: PublishedData }
  | { kind: 'candidate'; item: ShiftData; candidate: ZoomCandidate };

const STATE_TONES: Record<RecordingUploadState, string> = {
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  replaced: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  stopped: 'bg-slate-100 text-slate-600 ring-slate-300',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-200',
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  waiting: 'bg-sky-50 text-sky-700 ring-sky-200',
  missing: 'bg-amber-100 text-amber-900 ring-amber-300',
};

const SOURCE_LABELS: Record<string, string> = {
  zoom_auto: '自動アップ', zoom_approval: '手動で公開', recording_replacement: '差し替え',
  csv_import: 'CSV取込', annual_recording_csv_up: 'CSV取込', manual: '手動登録',
};

const pad = (value: number) => String(value).padStart(2, '0');
const dateKeyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (key: string, days: number) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return dateKeyOf(date); };
const dateLabel = (key: string) => formatDate(key, { withWeekday: true }) || key;
const minutesLabel = (seconds?: number) => seconds ? `${Math.round(seconds / 60)}分` : '';

const periodOf = (shift: ShiftData) => {
  const text = [shift.period, shift.target_period, shift.note].map(value => String(value || '').normalize('NFKC')).join(' ');
  if (/(^|\D)1限|第1|^1$/.test(text) || String(shift.period || '') === '1') return '1限';
  if (/(^|\D)2限|第2|^2$/.test(text) || String(shift.period || '') === '2') return '2限';
  return '';
};

const isSupportShift = (shift: ShiftData) => {
  const roleType = String(shift.role_type || 'main').toLowerCase();
  if (roleType && !['main', 'teacher', 'primary'].includes(roleType)) return true;
  return [shift.teacher_name, shift.note].some(value => String(value || '').includes('サポート') || String(value || '').includes('チューター')) || shift.target_subject === '学習サポート';
};

const shiftTitle = (shift: ShiftData) => `${shift.target_detail_subject || ''} ${shift.unit || ''}`.trim() || `${shift.target_subject || '授業'}の授業`;

function deriveState(shift: ShiftData, period: string, published: PublishedData | undefined, now: Date): RecordingUploadState {
  if (published) {
    if (published.status === 'stopped') return 'stopped';
    return published.is_replacement ? 'replaced' : 'published';
  }
  if (shift.recording_publish_mode === 'stopped') return 'stopped';
  if (shift.recording_status === 'blocked') return 'blocked';
  if (shift.target_recording_url) return 'pending';
  const today = dateKeyOf(now);
  const window = PERIOD_WINDOWS[period] || PERIOD_WINDOWS['2限'];
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // Zoomの録画処理には時間がかかるため、授業終了から3時間は「録画待ち」とする。
  const overdue = shift.target_date < today || (shift.target_date === today && minutesNow > window.end + 180);
  return overdue ? 'missing' : 'waiting';
}

export default function RecordingAdminPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const ask = usePrompt();
  const [tab, setTab] = useState<'status' | 'library' | 'import'>('status');
  const [endDate, setEndDate] = useState(() => dateKeyOf(new Date()));
  const [rangeDays, setRangeDays] = useState(7);
  const [shifts, setShifts] = useState<ShiftData[]>([]);
  const [published, setPublished] = useState<PublishedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [processing, setProcessing] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'attention' | RecordingUploadState>('all');
  const [search, setSearch] = useState('');
  const [zoomSyncLog, setZoomSyncLog] = useState('');
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewToken, setPreviewToken] = useState('');
  const [replaceRow, setReplaceRow] = useState<Row | null>(null);

  const startDate = addDays(endDate, -(rangeDays - 1));

  // 録画は年度をまたいで1000件を超えるため、500件ずつ最後まで読み込む（固定件数で打ち切ると過去の年度が欠ける）。
  const loadAllRecordings = async () => {
    const docs: QueryDocumentSnapshot[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    for (let page = 0; page < 20; page += 1) {
      const pageQuery: Query = cursor
        ? query(collection(db, 'class_recordings'), orderBy('target_date', 'desc'), startAfter(cursor), limit(500))
        : query(collection(db, 'class_recordings'), orderBy('target_date', 'desc'), limit(500));
      const snap: QuerySnapshot = await getDocs(pageQuery);
      docs.push(...snap.docs);
      if (snap.size < 500) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    return docs;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [pubSnap, shiftSnap] = await Promise.all([
        loadAllRecordings(),
        getDocs(query(collection(db, 'shift_assignments'), where('target_date', '>=', startDate), where('target_date', '<=', endDate), orderBy('target_date', 'desc'), limit(800))),
      ]);
      setPublished(pubSnap.map(snap => ({ id: snap.id, ...normalizeRecording(snap.data() as any), ...snap.data() } as PublishedData)));
      setShifts(shiftSnap.docs.map(snap => ({ id: snap.id, ...snap.data() } as ShiftData)).filter(shift => !isSupportShift(shift)));
    } catch (error: any) {
      console.error(error);
      setLoadError(String(error?.message || error || ''));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const publishedByShift = useMemo(() => {
    const map = new Map<string, PublishedData>();
    published.forEach(item => {
      if (!item.original_shift_id) return;
      const current = map.get(item.original_shift_id);
      // 停止中より公開中を優先して表示する。
      if (!current || (current.status === 'stopped' && item.status !== 'stopped')) map.set(item.original_shift_id, item);
    });
    return map;
  }, [published]);

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    return shifts
      .map(shift => {
        const period = periodOf(shift);
        const pub = publishedByShift.get(shift.id);
        return { shift, period, published: pub, state: deriveState(shift, period, pub, now) };
      })
      .sort((a, b) => b.shift.target_date.localeCompare(a.shift.target_date) || a.period.localeCompare(b.period) || String(a.shift.target_grade || '').localeCompare(String(b.shift.target_grade || '')));
  }, [shifts, publishedByShift]);

  const counts = useMemo(() => rows.reduce<Record<string, number>>((acc, row) => { acc[row.state] = (acc[row.state] || 0) + 1; return acc; }, {}), [rows]);
  const attentionCount = (counts.blocked || 0) + (counts.pending || 0) + (counts.missing || 0);

  const visibleRows = useMemo(() => {
    const text = search.trim().toLowerCase();
    return rows.filter(row => {
      if (stateFilter === 'attention' && !['blocked', 'pending', 'missing'].includes(row.state)) return false;
      if (stateFilter !== 'all' && stateFilter !== 'attention' && row.state !== stateFilter) return false;
      if (!text) return true;
      return [row.shift.target_date, row.shift.target_grade, row.shift.target_subject, row.shift.target_detail_subject, row.shift.unit, row.shift.teacher_name, row.period]
        .filter(Boolean).join(' ').toLowerCase().includes(text);
    });
  }, [rows, stateFilter, search]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, Row[]>();
    visibleRows.forEach(row => groups.set(row.shift.target_date, [...(groups.get(row.shift.target_date) || []), row]));
    return Array.from(groups.entries());
  }, [visibleRows]);

  // ---------- 操作 ----------
  const now = () => new Date().toISOString();

  const stopRow = async (row: Row) => {
    if (!row.published) return;
    const reason = await ask({
      title: `「${row.published.title || shiftTitle(row.shift)}」の公開を停止しますか？`,
      message: '停止中は自動アップでも再公開されません。',
      label: '停止する理由（任意）',
      defaultValue: '',
      multiline: true,
      confirmLabel: '停止する',
    });
    if (reason === null) return;
    setProcessing(row.shift.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'class_recordings', row.published.id), { status: 'stopped', stopped_reason: reason.trim(), stopped_at: now(), updated_at: now() });
      batch.set(doc(db, 'shift_assignments', row.shift.id), { recording_publish_mode: 'stopped', recording_status: 'stopped' }, { merge: true });
      await batch.commit();
      void reportAuditLog({ action: 'recording_stop', target_type: 'class_recording', target_id: row.published.id, target_label: row.published.title || shiftTitle(row.shift), details: { shift_id: row.shift.id, target_date: row.shift.target_date, reason: reason.trim() } });
      await fetchData();
    } catch (error) { console.error(error); toast.error('停止できませんでした。もう一度お試しください。'); } finally { setProcessing(''); }
  };

  const resumeRow = async (row: Row) => {
    if (!row.published) return;
    if (!(await confirm({ title: `「${row.published.title || shiftTitle(row.shift)}」の公開を再開しますか？`, confirmLabel: '再開する' }))) return;
    setProcessing(row.shift.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'class_recordings', row.published.id), { status: 'published', stopped_reason: '', resumed_at: now(), updated_at: now() });
      batch.set(doc(db, 'shift_assignments', row.shift.id), { recording_publish_mode: null, recording_status: 'published' }, { merge: true });
      await batch.commit();
      void reportAuditLog({ action: 'recording_resume', target_type: 'class_recording', target_id: row.published.id, target_label: row.published.title || shiftTitle(row.shift), details: { shift_id: row.shift.id, target_date: row.shift.target_date } });
      await fetchData();
    } catch (error) { console.error(error); toast.error('再開できませんでした。もう一度お試しください。'); } finally { setProcessing(''); }
  };

  const recordFromShift = (shift: ShiftData, period: string, extra: Record<string, unknown>) => ({
    ...normalizeRecording({
      original_shift_id: shift.id,
      target_date: shift.target_date,
      grade: shift.target_grade || 'その他',
      subject: shift.target_subject || '全科目',
      detail_subject: shift.target_detail_subject || '',
      unit: shift.unit || '',
      teacher_name: shift.teacher_name || '',
      title: shiftTitle(shift),
      video_url: shift.target_recording_url || '',
      recording_type: 'regular',
      zoom_recording_file_id: shift.target_recording_file_id || '',
      target_recording_file_id: shift.target_recording_file_id || '',
      target_recording_type: shift.target_recording_type || '',
      zoom_recording_files: shift.zoom_recording_files || [],
      recording_meeting_id: shift.target_meeting_id || '',
    }),
    original_shift_id: shift.id,
    period,
    status: 'published',
    trim_start_seconds: Number(shift.target_recording_trim_start_seconds || 0),
    trim_end_seconds: shift.target_recording_trim_end_seconds ? Number(shift.target_recording_trim_end_seconds) : null,
    created_at: now(),
    updated_at: now(),
    ...extra,
  });

  /** 保留・確認待ちの録画を、管理者が内容を確認したうえで公開する。 */
  const publishRow = async (row: Row, meetingPosition?: 'before' | 'after') => {
    const trimOption = meetingPosition ? row.shift.recording_meeting_trim_options?.[meetingPosition] : undefined;
    // 集会の位置を選んだときは、その切り取り位置で公開する。
    const shift: ShiftData = trimOption
      ? { ...row.shift, target_recording_trim_start_seconds: trimOption.start, target_recording_trim_end_seconds: trimOption.end }
      : row.shift;
    if (!shift.target_recording_url) return;
    if (shift.target_recording_type !== REQUIRED_RECORDING_TYPE) {
      toast.error('この録画は共有画面付きスピーカービューではないため公開できません。「差し替え」から正しい録画を選んでください。');
      return;
    }
    const issues = (shift.recording_issues || []).map(issue => `・${issue.label}${issue.detail ? `（${issue.detail}）` : ''}`).join('\n');
    if (!(await confirm({
      title: `「${shiftTitle(shift)}」の録画を生徒に公開しますか？`,
      message: issues ? (
        <div className="space-y-2">
          <p className="font-bold">自動アップを止めた理由</p>
          <p className="whitespace-pre-wrap">{issues}</p>
          <p>プレビューで内容を確認してから公開してください。</p>
        </div>
      ) : undefined,
      confirmLabel: '公開する',
      ...(meetingPosition && trimOption ? {
        title: `集会は${MEETING_POSITION_LABELS[meetingPosition]}として、「${shiftTitle(shift)}」の録画を公開しますか？`,
        message: (
          <div className="space-y-2">
            <p>{meetingPosition === 'before' ? '録画の前側にある集会を除き、' : '録画の後ろ側にある集会を除き、'}録画の{trimOption.start ? minutesLabel(trimOption.start) : '最初'}〜{trimOption.end ? minutesLabel(trimOption.end) : '最後'}を授業として公開します。</p>
            <p>公開後に「確認」で切り取り位置が合っているかを見てください。</p>
          </div>
        ),
      } : {}),
    }))) return;
    setProcessing(shift.id);
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'class_recordings', `auto_${shift.id}`);
      batch.set(ref, recordFromShift(shift, row.period, { source: 'zoom_approval', approved_after_review: Boolean(issues) }), { merge: true });
      batch.set(doc(db, 'shift_assignments', shift.id), {
        recording_status: 'published', published_recording_id: ref.id, recording_publish_mode: null,
        ...(trimOption ? { target_recording_trim_start_seconds: trimOption.start, target_recording_trim_end_seconds: trimOption.end, recording_group_meeting: meetingPosition } : {}),
      }, { merge: true });
      await batch.commit();
      void reportAuditLog({ action: 'recording_publish', target_type: 'class_recording', target_id: ref.id, target_label: shiftTitle(shift), details: { shift_id: shift.id, target_date: shift.target_date, approved_after_review: Boolean(issues) } });
      await fetchData();
    } catch (error) { console.error(error); toast.error('公開できませんでした。もう一度お試しください。'); } finally { setProcessing(''); }
  };

  /** 授業の前後の集会の録画を「グループミーティング」として生徒に公開する。授業の録画とは別に扱う。 */
  const publishGroupMeeting = async (row: Row, candidate: ZoomCandidate) => {
    const shift = row.shift;
    if (!candidate.url || !candidate.file_id) return;
    if (!(await confirm({
      title: `「${groupMeetingTitle(candidate)}」を生徒に公開しますか？`,
      message: (
        <div className="space-y-2">
          <p>{formatDate(shift.target_date)} {row.period} ・ {[shift.target_grade, shift.target_subject].filter(Boolean).join(' ')}の会議の録画（{candidate.recording_start ? formatTime(candidate.recording_start) : '時刻不明'}から{minutesLabel(candidate.duration_seconds) || '長さ不明'}）です。</p>
          <p>授業の録画とは別に「グループミーティング」として、{shift.target_grade || '対象学年'}の生徒に表示します。視聴コインは付きません。</p>
          <p>公開前に「集会を確認」で内容を見てください。</p>
        </div>
      ),
      confirmLabel: '公開する',
    }))) return;
    setProcessing(shift.id);
    try {
      const targetDate = String(shift.target_date || '').slice(0, 10);
      const schoolYear = normalizeSchoolYear(targetDate);
      const id = groupMeetingRecordingId(shift.id, candidate.file_id);
      const batch = writeBatch(db);
      batch.set(doc(db, 'class_recordings', id), {
        // original_shift_id は授業の録画だけに使う（自動公開が授業の録画を手動公開と取り違えないよう別の項目にする）。
        group_meeting_shift_id: shift.id,
        target_date: targetDate,
        grade: shift.target_grade || 'その他',
        subject: '全科目',
        detail_subject: '',
        unit: '',
        teacher_name: shift.teacher_name || '',
        title: groupMeetingTitle(candidate),
        period: row.period,
        video_url: candidate.url,
        recording_type: 'group_meeting',
        recording_type_label: recordingTypeLabel('group_meeting'),
        school_year: schoolYear,
        year_scope: getRecordingYearScope(schoolYear),
        zoom_recording_file_id: candidate.file_id,
        target_recording_file_id: candidate.file_id,
        target_recording_type: candidate.recording_type || '',
        zoom_recording_files: [],
        recording_meeting_id: shift.target_meeting_id || candidate.meeting_id || '',
        recording_duration_seconds: Number(candidate.duration_seconds || 0),
        trim_start_seconds: 0,
        trim_end_seconds: null,
        source: 'group_meeting',
        status: 'published',
        created_at: now(),
        updated_at: now(),
      }, { merge: true });
      await batch.commit();
      void reportAuditLog({ action: 'recording_publish', target_type: 'class_recording', target_id: id, target_label: groupMeetingTitle(candidate), details: { shift_id: shift.id, target_date: targetDate, group_meeting: true } });
      toast.success('グループミーティングを公開しました。');
      await fetchData();
    } catch (error) { console.error(error); toast.error('公開できませんでした。もう一度お試しください。'); } finally { setProcessing(''); }
  };

  const syncZoom = async () => {
    if (!(await confirm({
      title: 'Zoomから直近14日分の録画を取得しますか？',
      message: '講師配置と照合し、問題のない録画は自動でアップされます。',
      confirmLabel: '取得する',
    }))) return;
    setProcessing('sync');
    setZoomSyncLog('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/zoom/recordings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days: 14, max_meetings: 180 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Zoom録画の取得に失敗しました');
      setZoomSyncLog(`Zoomの録画 ${data.meetings || 0}件を確認：講師配置と一致 ${data.matched || 0}件 / 自動アップ ${data.published || 0}件 / 保留 ${data.blocked || 0}件${data.truncated ? '（件数が多いため一部のみ）' : ''}`);
      await fetchData();
    } catch (error: any) {
      setZoomSyncLog(`エラー: ${error?.message || error}`);
    } finally { setProcessing(''); }
  };

  const openPreview = async (target: PreviewTarget) => {
    setPreviewToken((await auth.currentUser?.getIdToken()) || '');
    setPreviewTarget(target);
  };

  return (
    <div className="pb-24 text-slate-800">
      <AdminPageHeader
        description="講師配置に一致した「共有画面付きスピーカービュー」の録画は、時間などに問題がなければZoomから届いた時点で自動でアップされます。問題がある録画は保留になります。"
        actions={(
          <>
            <Button onClick={() => void syncZoom()} disabled={Boolean(processing)} loading={processing === 'sync'} icon={<Upload size={16} aria-hidden />}>
              Zoomから今すぐ取得
            </Button>
            <Button variant="secondary" onClick={() => void fetchData()} loading={loading} icon={<RefreshCw size={16} aria-hidden />}>
              再読み込み
            </Button>
          </>
        )}
      />
      {zoomSyncLog && (
        <p className={cn('mb-4 rounded-card border px-4 py-3 text-sm font-bold', zoomSyncLog.startsWith('エラー') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-800')}>{zoomSyncLog}</p>
      )}

      <AdminTabs
        className="mb-5"
        ariaLabel="録画の管理"
        urlParam="tab"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'status', label: 'アップ状況（講師配置ごと）', badge: attentionCount > 0 ? attentionCount : undefined },
          { id: 'library', label: '公開中の録画' },
          { id: 'import', label: '過去録画の取込' },
        ]}
      />

      {tab === 'status' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <IconButton variant="secondary" size="sm" label="前の期間" onClick={() => setEndDate(addDays(endDate, -rangeDays))}><ChevronLeft size={18} aria-hidden /></IconButton>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-900">{dateLabel(startDate)} 〜 {dateLabel(endDate)}</p>
                <p className="text-xs font-bold text-slate-500">講師配置 {rows.length}件</p>
              </div>
              <IconButton variant="secondary" size="sm" label="次の期間" onClick={() => setEndDate(addDays(endDate, rangeDays))} disabled={endDate >= dateKeyOf(new Date())}><ChevronRight size={18} aria-hidden /></IconButton>
              <select value={rangeDays} onChange={event => setRangeDays(Number(event.target.value))} aria-label="表示する期間" className="ml-2 min-h-10 rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-700">
                <option value={1}>1日</option><option value={7}>1週間</option><option value={14}>2週間</option><option value={31}>1か月</option>
              </select>
              {endDate !== dateKeyOf(new Date()) && <Button size="sm" variant="ghost" onClick={() => setEndDate(dateKeyOf(new Date()))}>今日まで</Button>}
            </div>
            <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-3">
              <Search size={15} className="text-slate-400" aria-hidden />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="学年・科目・単元・講師で検索" aria-label="講師配置を検索" className="w-56 bg-transparent py-2 text-sm outline-none" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
            {([['all', 'すべて', rows.length], ['attention', '要対応', attentionCount], ...(Object.keys(RECORDING_UPLOAD_STATE_LABELS) as RecordingUploadState[]).map(state => [state, RECORDING_UPLOAD_STATE_LABELS[state], counts[state] || 0])] as [string, string, number][]).map(([key, label, count]) => (
              <button key={key} onClick={() => setStateFilter(key as typeof stateFilter)}
                aria-pressed={stateFilter === key}
                className={cn('rounded-btn border px-3 py-2.5 text-left transition', stateFilter === key ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-slate-600 hover:border-slate-300')}>
                <span className="block text-xs font-bold opacity-80">{label}</span>
                <span className="text-lg font-bold">{count}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <ListSkeleton rows={4} />
          ) : loadError ? (
            <ErrorState title="録画データを読み込めませんでした" message={loadError || undefined} onRetry={() => void fetchData()} />
          ) : groupedRows.length === 0 ? (
            <EmptyState icon={Video} title="該当する講師配置はありません" description="期間や絞り込み条件を変えてください。" />
          ) : groupedRows.map(([date, dateRows]) => (
            <div key={date} className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                <p className="text-sm font-bold text-slate-800">{dateLabel(date)}</p>
                <p className="text-xs font-bold text-slate-500">{dateRows.length}件</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {dateRows.map(row => <StatusRow key={row.shift.id} row={row} busy={processing === row.shift.id}
                  onPreview={() => void openPreview(row.published ? { kind: 'published', item: row.published } : { kind: 'shift', item: row.shift })}
                  onStop={() => void stopRow(row)} onResume={() => void resumeRow(row)} onPublish={position => void publishRow(row, position)}
                  meetingRecordings={published.filter(item => item.group_meeting_shift_id === row.shift.id)}
                  onPreviewMeeting={candidate => void openPreview({ kind: 'candidate', item: row.shift, candidate })}
                  onPublishMeeting={candidate => void publishGroupMeeting(row, candidate)} onReplace={() => setReplaceRow(row)} />)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tab === 'library' && (loadError
        ? <ErrorState title="録画データを読み込めませんでした" message={loadError || undefined} onRetry={() => void fetchData()} />
        : <LibraryTab published={published} loading={loading} onChanged={fetchData} onPreview={item => void openPreview({ kind: 'published', item })} />)}
      {tab === 'import' && <ImportTab onImported={fetchData} />}

      {previewTarget && <PreviewModal target={previewTarget} token={previewToken} onClose={() => setPreviewTarget(null)} />}
      {replaceRow && <ReplaceModal row={replaceRow} published={published} previewOpen={Boolean(previewTarget)} onClose={() => setReplaceRow(null)} onDone={async () => { setReplaceRow(null); await fetchData(); }} recordFromShift={recordFromShift} onPreview={target => void openPreview(target)} />}
    </div>
  );
}

function StatusRow({ row, busy, onPreview, onStop, onResume, onPublish, onReplace, meetingRecordings, onPreviewMeeting, onPublishMeeting }: {
  row: Row; busy: boolean; onPreview: () => void; onStop: () => void; onResume: () => void; onPublish: (meetingPosition?: 'before' | 'after') => void; onReplace: () => void;
  meetingRecordings: PublishedData[]; onPreviewMeeting: (candidate: ZoomCandidate) => void; onPublishMeeting: (candidate: ZoomCandidate) => void;
}) {
  const { shift, published } = row;
  const hasVideo = Boolean(published?.video_url || shift.target_recording_url);
  const issues = shift.recording_issues || [];
  const meetingChoice = (row.state === 'blocked' || row.state === 'pending') && Boolean(shift.target_recording_url && shift.recording_meeting_trim_options)
    && issues.some(issue => issue.code === 'meeting-suspected');
  return (
    <li className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-btn bg-slate-800 px-2 py-1 text-xs font-bold text-white">{row.period || '時限?'}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{[shift.target_grade, shift.target_subject].filter(Boolean).join(' ')} ・ {published?.title || shiftTitle(shift)}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-500">
            {shift.teacher_name || '講師未設定'}{shift.target_meeting_id ? ` ・ 会議ID ${shift.target_meeting_id}` : ' ・ 会議ID未登録'}
            {shift.target_recording_duration_seconds ? ` ・ 録画 ${minutesLabel(shift.target_recording_duration_seconds)}` : ''}
            {published ? ` ・ ${SOURCE_LABELS[published.source || ''] || published.source || ''}` : ''}
          </p>
          {row.state === 'blocked' && issues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {issues.map(issue => <li key={issue.code} className="flex items-start gap-1.5 text-xs font-bold text-rose-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{issue.label}{issue.detail ? `（${issue.detail}）` : ''}</li>)}
            </ul>
          )}
          {shift.recording_group_meeting && <p className="mt-1 text-xs font-bold text-sky-800">集会（{MEETING_POSITION_LABELS[shift.recording_group_meeting]}）の録画を除いて、授業の録画を設定しました。</p>}
          {groupMeetingCandidates(shift).length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {groupMeetingCandidates(shift).map(candidate => {
                const live = meetingRecordings.find(item => item.zoom_recording_file_id === candidate.file_id);
                return (
                  <li key={`${candidate.file_id}|${candidate.recording_start}`} className="flex flex-wrap items-center gap-2 rounded-btn bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">
                    <span className="min-w-0 flex-1">{groupMeetingTitle(candidate)}の録画 ・ {candidate.recording_start ? formatTime(candidate.recording_start) : '時刻不明'}から{minutesLabel(candidate.duration_seconds) || '長さ不明'}</span>
                    {live
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{live.status === 'stopped' ? '停止中（ライブラリで再開）' : '公開中'}</span>
                      : <>
                        <Button size="sm" variant="secondary" onClick={() => onPreviewMeeting(candidate)} icon={<PlayCircle size={14} aria-hidden />}>集会を確認</Button>
                        <Button size="sm" variant="secondary" onClick={() => onPublishMeeting(candidate)} icon={<Upload size={14} aria-hidden />}>グループミーティングとして公開</Button>
                      </>}
                  </li>
                );
              })}
            </ul>
          )}
          {row.state === 'stopped' && published?.stopped_reason && <p className="mt-1 text-xs font-bold text-slate-500">停止理由：{published.stopped_reason}</p>}
          {row.state === 'replaced' && published?.replacement_reason && <p className="mt-1 text-xs font-bold text-emerald-800">差し替え理由：{published.replacement_reason}</p>}
          {row.state === 'missing' && <p className="mt-1 text-xs font-bold text-amber-800">授業後に録画が届いていません。Zoomの録画設定と会議IDを確認するか、「差し替え」で別の録画を設定してください。</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${STATE_TONES[row.state]}`}>{RECORDING_UPLOAD_STATE_LABELS[row.state]}</span>
        {busy && <Spinner size={16} label="処理中" />}
        {hasVideo && <ActionButton onClick={onPreview} icon={PlayCircle} label="確認" />}
        {(row.state === 'published' || row.state === 'replaced') && <ActionButton onClick={onStop} icon={PauseCircle} label="停止" tone="danger" />}
        {row.state === 'stopped' && published && <ActionButton onClick={onResume} icon={CheckCircle2} label="再開" />}
        {meetingChoice && <ActionButton onClick={() => onPublish('before')} icon={Upload} label="集会は授業の前" tone="primary" />}
        {meetingChoice && <ActionButton onClick={() => onPublish('after')} icon={Upload} label="集会は授業の後" tone="primary" />}
        {(row.state === 'blocked' || row.state === 'pending') && shift.target_recording_url && <ActionButton onClick={() => onPublish()} icon={Upload} label={meetingChoice ? 'そのまま公開' : '確認して公開'} tone={meetingChoice ? 'secondary' : 'primary'} />}
        {row.state !== 'waiting' && <ActionButton onClick={onReplace} icon={Replace} label="差し替え" />}
      </div>
    </li>
  );
}

function ActionButton({ onClick, icon: Icon, label, tone = 'secondary' }: { onClick: () => void; icon: typeof PlayCircle; label: string; tone?: 'secondary' | 'primary' | 'danger' }) {
  return <Button size="sm" variant={tone} onClick={onClick} icon={<Icon size={14} aria-hidden />}>{label}</Button>;
}

function ReplaceModal({ row, published, previewOpen, onClose, onDone, recordFromShift, onPreview }: {
  row: Row;
  /** 確認用の再生画面が上に開いている間は、Esc などでこの画面を閉じない。 */
  previewOpen?: boolean;
  onPreview: (target: PreviewTarget) => void;
  published: PublishedData[];
  onClose: () => void;
  onDone: () => Promise<void>;
  recordFromShift: (shift: ShiftData, period: string, extra: Record<string, unknown>) => Record<string, unknown>;
}) {
  const { shift } = row;
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'zoom' | 'library'>((shift.zoom_recording_candidates || []).length > 0 ? 'zoom' : 'library');
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const zoomCandidates = (shift.zoom_recording_candidates || []).filter(candidate => candidate.url);
  const library = useMemo(() => {
    const text = search.trim().toLowerCase();
    return published
      .filter(item => item.id !== row.published?.id && item.status !== 'stopped')
      .filter(item => !text || [item.target_date, item.grade, item.subject, item.unit, item.title, item.teacher_name].filter(Boolean).join(' ').toLowerCase().includes(text))
      .sort((a, b) => Number(b.grade === shift.target_grade && b.subject === shift.target_subject) - Number(a.grade === shift.target_grade && a.subject === shift.target_subject) || b.target_date.localeCompare(a.target_date))
      .slice(0, 80);
  }, [published, search, row.published?.id, shift.target_grade, shift.target_subject]);

  const apply = async () => {
    if (!selected) { toast.error('差し替える録画を選んでください。'); return; }
    if (!reason.trim()) { toast.error('差し替えの理由を入力してください。'); return; }
    const at = new Date().toISOString();
    let fields: Record<string, unknown>;
    if (mode === 'zoom') {
      const candidate = zoomCandidates.find(item => `${item.file_id}|${item.recording_start}` === selected);
      if (!candidate) return;
      if (candidate.recording_type !== REQUIRED_RECORDING_TYPE && !(await confirm({
        title: `「${shiftTitle(shift)}」の録画を差し替えますか？`,
        message: '選んだ録画は共有画面付きスピーカービューではありません。',
        confirmLabel: '差し替える',
        tone: 'danger',
      }))) return;
      fields = {
        video_url: candidate.url, zoom_recording_file_id: candidate.file_id || '', target_recording_file_id: candidate.file_id || '',
        target_recording_type: candidate.recording_type || '', recording_meeting_id: candidate.meeting_id || shift.target_meeting_id || '', zoom_meeting_uuid: candidate.meeting_uuid || '',
        zoom_recording_files: [], trim_start_seconds: 0, trim_end_seconds: null, replacement_source_title: `Zoom録画 ${candidate.recording_start || ''}`,
      };
    } else {
      const source = published.find(item => item.id === selected);
      if (!source) return;
      fields = {
        video_url: source.video_url, zoom_recording_file_id: source.zoom_recording_file_id || source.target_recording_file_id || '',
        target_recording_file_id: source.target_recording_file_id || source.zoom_recording_file_id || '', target_recording_type: source.target_recording_type || '',
        zoom_recording_files: source.zoom_recording_files || [], recording_meeting_id: source.recording_meeting_id || '',
        trim_start_seconds: source.trim_start_seconds || 0, trim_end_seconds: source.trim_end_seconds ?? null,
        replacement_source_recording_id: source.id, replacement_source_title: source.title, replacement_source_date: source.target_date,
      };
    }
    Object.assign(fields, { is_replacement: true, replacement_reason: reason.trim(), replacement_updated_at: at, source: 'recording_replacement', status: 'published', updated_at: at });
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const ref = row.published ? doc(db, 'class_recordings', row.published.id) : doc(db, 'class_recordings', `auto_${shift.id}`);
      if (row.published) batch.update(ref, fields);
      else batch.set(ref, recordFromShift(shift, row.period, fields), { merge: true });
      batch.set(doc(db, 'shift_assignments', shift.id), { recording_status: 'published', published_recording_id: ref.id, recording_publish_mode: null }, { merge: true });
      await batch.commit();
      await onDone();
    } catch (error) { console.error(error); toast.error('差し替えできませんでした。もう一度お試しください。'); } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      dismissible={!previewOpen}
      title="録画を差し替える"
      description={`${formatDate(shift.target_date)} ${row.period} ${shift.target_grade || ''} ${shift.target_subject || ''} ・ ${shiftTitle(shift)}`}
      footer={(
        <Button fullWidth onClick={() => void apply()} disabled={saving || !selected || !reason.trim()} loading={saving} icon={<Replace size={16} aria-hidden />}>
          この録画に差し替えて公開
        </Button>
      )}
    >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={mode === 'zoom'} onClick={() => { setMode('zoom'); setSelected(''); }} disabled={zoomCandidates.length === 0} className={cn('min-h-11 rounded-btn border px-3 py-2.5 text-xs font-bold disabled:opacity-40', mode === 'zoom' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-slate-600')}>この授業のZoom録画から（{zoomCandidates.length}件）</button>
            <button type="button" aria-pressed={mode === 'library'} onClick={() => { setMode('library'); setSelected(''); }} className={cn('min-h-11 rounded-btn border px-3 py-2.5 text-xs font-bold', mode === 'library' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-slate-600')}>公開済みの別の録画から</button>
          </div>
          {mode === 'zoom' ? (
            <div className="space-y-2">
              {zoomCandidates.map(candidate => {
                const key = `${candidate.file_id}|${candidate.recording_start}`;
                const ok = candidate.recording_type === REQUIRED_RECORDING_TYPE;
                return (
                  <label key={key} className={cn('flex cursor-pointer items-center gap-3 rounded-btn border p-3', selected === key ? 'border-accent bg-accent-soft' : 'border-line')}>
                    <input type="radio" checked={selected === key} onChange={() => setSelected(key)} className="accent-accent" />
                    <span className="min-w-0 flex-1 text-xs font-bold text-slate-700">
                      {candidate.recording_start ? formatDateTime(candidate.recording_start, { withYear: true }) : '開始時刻不明'} ・ {minutesLabel(candidate.duration_seconds) || '長さ不明'}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{ok ? '共有画面付きスピーカービュー' : candidate.recording_type === 'active_speaker' ? 'アクティブスピーカー' : candidate.recording_type || '種類不明'}</span>
                      {candidate.kind === 'group_meeting' && <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700">集会（{candidate.meeting_position ? MEETING_POSITION_LABELS[candidate.meeting_position] : '授業の前後'}）</span>}
                      <span className="mt-0.5 block text-xs text-slate-500">講師：{shift.teacher_name || '未設定'}</span>
                    </span>
                    <Button size="sm" variant="secondary" className="shrink-0" onClick={event => { event.preventDefault(); onPreview({ kind: 'candidate', item: shift, candidate }); }}>確認</Button>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="日付・学年・科目・単元で検索" aria-label="録画を検索" className="min-h-10 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30" />
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {library.length === 0 && <EmptyState title="該当する録画はありません" description="検索語を変えてください。" />}
                {library.map(item => (
                  <label key={item.id} className={cn('flex cursor-pointer items-center gap-3 rounded-btn border p-3', selected === item.id ? 'border-accent bg-accent-soft' : 'border-line')}>
                    <input type="radio" checked={selected === item.id} onChange={() => setSelected(item.id)} className="accent-accent" />
                    <span className="min-w-0 flex-1 text-xs font-bold text-slate-700">
                      <span className="mr-2 rounded-btn bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-500">{normalizeSchoolYear(item.target_date, item.school_year)}年度</span>
                      {item.target_date} ・ {item.grade} {item.subject} ・ {item.title}
                      <span className="mt-0.5 block text-xs text-slate-500">講師：{item.teacher_name || '未設定'}{item.period ? ` ・ ${item.period}` : ''}</span>
                    </span>
                    <Button size="sm" variant="secondary" className="shrink-0" onClick={event => { event.preventDefault(); onPreview({ kind: 'published', item }); }}>確認</Button>
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-bold text-slate-600">差し替えの理由（必須）</span>
            <input value={reason} onChange={event => setReason(event.target.value)} placeholder="例：録画が途中で切れたため、同じ単元の別日の録画に差し替え" className="mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30" />
          </label>
          <p className="text-xs font-bold text-slate-500">差し替えた録画は、Zoomから新しい録画が届いても自動では上書きされません。</p>
        </div>
    </Modal>
  );
}

function LibraryTab({ published, loading, onChanged, onPreview }: { published: PublishedData[]; loading?: boolean; onChanged: () => Promise<void>; onPreview: (item: PublishedData) => void }) {
  const toast = useToast();
  const ask = usePrompt();
  const currentYear = getCurrentSchoolYear();
  const [scope, setScope] = useState<'current' | 'past' | 'stopped'>('current');
  const [search, setSearch] = useState('');
  const [trim, setTrim] = useState<Record<string, { start: string; end: string }>>({});
  const [busy, setBusy] = useState('');
  const list = useMemo(() => {
    const text = search.trim().toLowerCase();
    return published.filter(item => {
      const year = normalizeSchoolYear(item.target_date, item.school_year);
      if (scope === 'stopped' ? item.status !== 'stopped' : item.status === 'stopped') return false;
      if (scope === 'current' && getRecordingYearScope(year) !== 'current') return false;
      if (scope === 'past' && getRecordingYearScope(year) !== 'past') return false;
      return !text || [item.target_date, item.title, item.grade, item.subject, item.unit, item.teacher_name].filter(Boolean).join(' ').toLowerCase().includes(text);
    });
  }, [published, scope, search]);
  const setStatus = async (item: PublishedData, status: 'published' | 'stopped') => {
    const reason = status === 'stopped'
      ? await ask({
        title: `「${item.title || '録画'}」の公開を停止しますか？`,
        message: '停止中は自動アップでも再公開されません。',
        label: '停止する理由（任意）',
        defaultValue: '',
        multiline: true,
        confirmLabel: '停止する',
      })
      : '';
    if (reason === null) return;
    setBusy(item.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'class_recordings', item.id), { status, stopped_reason: status === 'stopped' ? reason.trim() : '', updated_at: new Date().toISOString() });
      if (item.original_shift_id) batch.set(doc(db, 'shift_assignments', item.original_shift_id), { recording_publish_mode: status === 'stopped' ? 'stopped' : null, recording_status: status }, { merge: true });
      await batch.commit();
      await onChanged();
    } catch (error) { console.error(error); toast.error('更新できませんでした。もう一度お試しください。'); } finally { setBusy(''); }
  };
  const saveTrim = async (item: PublishedData) => {
    const value = trim[item.id];
    const start = Number(value?.start || 0);
    const end = value?.end ? Number(value.end) : null;
    if (start < 0 || (end !== null && end <= start)) { toast.error('終了秒は開始秒より大きい値にしてください。'); return; }
    setBusy(item.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'class_recordings', item.id), { trim_start_seconds: start, trim_end_seconds: end, updated_at: new Date().toISOString() });
      await batch.commit();
      await onChanged();
      toast.success('切り出しを保存しました。');
    } catch (error) { console.error(error); toast.error('保存できませんでした。もう一度お試しください。'); } finally { setBusy(''); }
  };
  const count = (target: typeof scope) => published.filter(item => {
    const year = normalizeSchoolYear(item.target_date, item.school_year);
    if (target === 'stopped') return item.status === 'stopped';
    return item.status !== 'stopped' && getRecordingYearScope(year) === target;
  }).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {([['current', `今年度（${currentYear}年度）`], ['past', '過去の年度'], ['stopped', '停止中']] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)} className={cn('min-h-10 rounded-full px-4 py-2 text-xs font-bold', scope === key ? 'bg-accent text-accent-ink' : 'bg-surface text-slate-600 ring-1 ring-line')}>{label} {count(key)}</button>
          ))}
        </div>
        <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-3"><Search size={15} className="text-slate-400" aria-hidden /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="タイトル・単元・日付で検索" aria-label="録画を検索" className="w-56 bg-transparent py-2 text-sm outline-none" /></label>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        {loading && published.length === 0 ? <div className="p-4"><ListSkeleton rows={4} /></div> : list.length === 0 ? <EmptyState icon={Video} title="該当する録画はありません" description={search ? '検索語を変えてください。' : undefined} /> : (
          <ul className="divide-y divide-slate-100">
            {list.map(item => {
              const year = normalizeSchoolYear(item.target_date, item.school_year);
              const value = trim[item.id] || { start: item.trim_start_seconds ? String(item.trim_start_seconds) : '', end: item.trim_end_seconds ? String(item.trim_end_seconds) : '' };
              return (
                <li key={item.id} className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${getRecordingYearScope(year) === 'current' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{year}年度</span>
                      <span className="text-xs font-bold text-slate-500">{formatDate(item.target_date, { withYear: true }) || item.target_date} ・ {item.grade} {item.subject}</span>
                      <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200">{SOURCE_LABELS[item.source || ''] || item.source || '手動'}</span>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700">{recordingTypeLabel(item.recording_type)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-bold text-slate-900">{item.title}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-bold text-slate-500"><Scissors size={12} aria-hidden /><span className="sr-only">切り出し</span>
                      <input value={value.start} onChange={event => setTrim(prev => ({ ...prev, [item.id]: { ...value, start: event.target.value } }))} placeholder="開始秒" aria-label="開始秒" className="min-h-9 w-16 rounded-input border border-line bg-surface px-2 py-1" />
                      〜<input value={value.end} onChange={event => setTrim(prev => ({ ...prev, [item.id]: { ...value, end: event.target.value } }))} placeholder="終了秒" aria-label="終了秒" className="min-h-9 w-16 rounded-input border border-line bg-surface px-2 py-1" />
                      <Button size="sm" variant="secondary" onClick={() => void saveTrim(item)}>保存</Button>
                    </span>
                    {busy === item.id && <Spinner size={15} label="処理中" />}
                    <ActionButton onClick={() => onPreview(item)} icon={PlayCircle} label="確認" />
                    {item.status === 'stopped'
                      ? <ActionButton onClick={() => void setStatus(item, 'published')} icon={CheckCircle2} label="再開" />
                      : <ActionButton onClick={() => void setStatus(item, 'stopped')} icon={PauseCircle} label="停止" tone="danger" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ImportTab({ onImported }: { onImported: () => Promise<void> }) {
  const [encoding, setEncoding] = useState<'utf-8' | 'shift-jis'>('utf-8');
  const [importing, setImporting] = useState(false);
  const [log, setLog] = useState('');
  const importCsv = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setLog('');
    try {
      const text = new TextDecoder(encoding).decode(await file.arrayBuffer());
      const result = parseRecordingCsv(text);
      if (result.items.length === 0) throw new Error(result.isAnnualRecordingList ? 'UPにチェックが入り、録画URLが設定された行が見つかりませんでした。' : '録画URLが入った行が見つかりませんでした。');
      const at = new Date().toISOString();
      for (let index = 0; index < result.items.length; index += 400) {
        const batch = writeBatch(db);
        result.items.slice(index, index + 400).forEach(item => batch.set(doc(db, 'class_recordings', stableCsvRecordingDocId(item)), { ...item, status: 'published', imported_at: at, updated_at: at }, { merge: true }));
        await batch.commit();
      }
      // Zoom APIで録画ファイルを特定する（生徒がパスコードなしでアプリ内で再生できるようにする）。
      const ids = result.items.filter(item => isZoomRecordingShareUrl(item.video_url)).map(item => stableCsvRecordingDocId(item));
      let resolved = 0;
      let linked = 0;
      const unresolved: string[] = [];
      if (ids.length > 0 && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        for (let index = 0; index < ids.length; index += 60) {
          setLog(`Zoomの録画と照合しています… ${Math.min(index + 60, ids.length)} / ${ids.length}`);
          const response = await fetch('/api/admin/recordings/resolve-zoom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ids: ids.slice(index, index + 60) }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok === false) throw new Error(data.error || 'Zoomの録画との照合に失敗しました。');
          resolved += Number(data.resolved || 0);
          linked += Number(data.linked_shifts || 0);
          unresolved.push(...(Array.isArray(data.unresolved) ? data.unresolved.map((item: any) => String(item.id)) : []));
        }
      }
      const zoomNote = ids.length > 0
        ? ` Zoomの録画と照合できた${resolved}件はパスコードなしでアプリ内再生できます（講師配置とのひも付け ${linked}件）。${unresolved.length ? `照合できなかった${unresolved.length}件はZoomの公式プレイヤーで開きます。` : ''}`
        : '';
      setLog((result.isAnnualRecordingList
        ? `UP対象${result.eligibleRows}行の録画${result.items.length}件を取り込みました（UP対象外 ${result.excludedRows}行 / URLなし ${result.noUrlRows}行）。同じ録画は上書き更新されます。`
        : `${result.items.length}件を取り込みました（URLなし ${result.noUrlRows}行）。同じ録画は上書き更新されます。`) + zoomNote);
      await onImported();
    } catch (error: any) {
      setLog(`エラー: ${error?.message || error}`);
    } finally { setImporting(false); }
  };
  return (
    <section className="max-w-3xl space-y-4 rounded-card border border-line bg-surface p-6 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><FileUp size={18} aria-hidden />過去録画の取込（CSV）</h2>
        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
          年度ごとの録画一覧（「UP」列にチェックがある行だけ取込）または、日付・タイトル・URL・学年・科目の列があるCSVを取り込みます。録画一覧の「ID」列のZoomアカウントとURLの開始時刻からZoomの録画を特定するので、生徒は録画パスコードなしでアプリ内で視聴できます。日付の後ろにあるURLは差し替え録画として扱います。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={encoding} onChange={event => setEncoding(event.target.value as typeof encoding)} aria-label="文字コード" className="min-h-11 rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-700">
          <option value="utf-8">UTF-8</option><option value="shift-jis">Shift_JIS（Excel）</option>
        </select>
        <label className={buttonClass('primary', 'md', cn('cursor-pointer', importing && 'cursor-not-allowed opacity-60'))}>
          {importing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FileUp size={16} aria-hidden />}CSVを選んで取込
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing} onChange={event => { void importCsv(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </div>
      {log && <p role={log.startsWith('エラー') ? 'alert' : 'status'} className={cn('rounded-card px-4 py-3 text-sm font-bold', log.startsWith('エラー') ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{log}</p>}
    </section>
  );
}

function PreviewModal({ target, token, onClose }: { target: PreviewTarget; token: string; onClose: () => void }) {
  const externalUrl = target.kind === 'shift' ? target.item.target_recording_url || ''
    : target.kind === 'candidate' ? target.candidate.url || ''
      : target.item.video_url || '';
  // Zoomの録画ファイルが分かっているものは、その時限のファイルだけをアプリ内で再生する
  // （共有リンクを開くと、1限と2限がつながった会議全体が表示されるため）。
  const resolvedZoomFile = target.kind === 'candidate'
    ? Boolean(target.candidate.file_id && target.candidate.meeting_uuid)
    : target.kind === 'shift'
      ? Boolean(target.item.target_meeting_id && target.item.target_recording_file_id && (target.item.zoom_recording_files || []).length > 0)
      : Boolean(target.item.recording_meeting_id && (target.item.zoom_recording_file_id || target.item.target_recording_file_id));
  const usesZoomPlayer = !resolvedZoomFile && isZoomRecordingShareUrl(externalUrl);
  const idParam = target.kind === 'published'
    ? `recording_id=${encodeURIComponent(target.item.id)}`
    : `shift_id=${encodeURIComponent(target.item.id)}${target.kind === 'candidate' ? `&candidate_file_id=${encodeURIComponent(target.candidate.file_id || '')}` : ''}`;
  const src = usesZoomPlayer
    ? `/api/zoom/recordings/file?mode=share&${idParam}&token=${encodeURIComponent(token)}`
    : `/api/zoom/recordings/file?${idParam}&token=${encodeURIComponent(token)}`;
  const title = target.kind === 'published'
    ? `${target.item.target_date} ${target.item.title}${target.item.teacher_name ? ` ・ ${target.item.teacher_name}` : ''}`
    : `${target.item.target_date} ${target.item.target_grade || ''} ${target.item.target_subject || ''} ${shiftTitle(target.item)}${target.item.teacher_name ? ` ・ ${target.item.teacher_name}` : ''}${target.kind === 'candidate' && target.candidate.recording_start ? ` ・ ${formatTime(target.candidate.recording_start)}開始の録画` : ''}`;
  return (
    <div className="fixed inset-0 z-[220] bg-slate-950/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-card bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
          <p className="min-w-0 truncate text-sm font-bold text-slate-900">{title}</p>
          <div className="flex gap-2">
            {externalUrl && <a href={externalUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>外部で開く</a>}
            <Button size="sm" onClick={onClose}>閉じる</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-slate-950">
          {usesZoomPlayer ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-white">
              <div>
                <PlayCircle className="mx-auto text-sky-300" size={48} aria-hidden />
                <p className="mt-4 text-sm font-bold">Zoom録画は公式プレイヤーで確認してください</p>
                <a href={src} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', 'mt-5')}>Zoomで録画を開く</a>
              </div>
            </div>
          ) : (
            <video key={src} src={src} className="h-full w-full" controls playsInline preload="metadata" />
          )}
        </div>
        <p className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500"><Clock size={13} aria-hidden />切り出し（開始秒・終了秒）は「公開中の録画」タブで設定できます。</p>
      </div>
    </div>
  );
}
