'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import {
  Clock, CheckCircle, AlertCircle, Play, Square, Briefcase,
  ArrowLeft, Plus, Trash2, Save, X, Edit3, Train,
  ChevronLeft, ChevronRight, Loader2, Copy,
  Calendar, LayoutTemplate, Coffee, DollarSign, Send, LogOut, MapPin
} from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { formatTime } from '@/lib/format';
import { TRANSPORT_TYPE_OPTIONS } from '@/lib/transport-fares';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import TransportLineSelect from '@/app/components/TransportLineSelect';
import TransportStationSearchInput from '@/app/components/TransportStationSearchInput';
import TeacherCommuterPassPanel from '@/app/components/TeacherCommuterPassPanel';
import FiveMinuteTimePicker from '@/app/components/FiveMinuteTimePicker';
import { isDedicatedProfile } from '@/lib/employment-category';
import {
  ATTENDANCE_SCHOOL_OPTION_GROUPS,
  SCIENCE_SOCIAL_WORKPLACE_ID,
  SCIENCE_SOCIAL_WORKPLACE_LABEL,
  attendanceSchoolName,
  isSogakuAttendanceSchool,
  resolveAttendanceSchoolCode,
} from '@/lib/attendance-schools';
import {
  ATTENDANCE_GRADES,
  INDIVIDUAL_LEVEL_OPTIONS,
  individualLevelNeedsRatio,
  type IndividualLevel,
  ATTENDANCE_PROGRAM_LABELS,
  ATTENDANCE_PROGRAMS,
  OFFICE_TASK_OPTIONS,
  attendanceSegmentNeedsSchool,
  normalizeAttendanceSegment,
  payrollTierForSegment,
  segmentProgram,
  validateAttendanceSegment,
  type AttendanceProgram,
} from '@/lib/attendance-work-detail';
import { SHIFT_CATEGORY_LABELS, type AttendanceShiftPlan } from '@/lib/attendance-shift-plan';
import { draftSegmentsFromShiftPlans } from '@/lib/attendance-work-draft';
import {
  CorrectionRequestList,
  MissingClockModal,
  TimeCorrectionModal,
  correctionFormForRecord,
  correctionRequestsNeedingAttention,
  missingClockFormForDate,
  useCorrectionRequests,
  type CorrectionForm,
  type CorrectionRequest,
  type MissingClockForm,
} from './correction-requests';
import { WorkDetailReminderCard, useWorkDetailReminders } from './work-detail-reminder';

// --- 型定義 ---
interface WorkSegment {
  id?: string;
  start: string;
  end: string;
  type: 'lesson' | 'individual' | 'office' | 'support' | 'break' | 'interview' | 'grading' | 'other' | 'breakthrough_lesson' | 'breakthrough_office' | 'breakthrough';
  note: string;
  isAuto?: boolean;
  program?: AttendanceProgram;
  grade?: string;
  lesson_format?: 'group' | 'individual';
  individual_level?: IndividualLevel;
  individual_ratio?: '1:1' | '1:2' | '1:3';
  office_task?: string;
  payroll_tier?: string;
  school_id?: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
  /** 画面上だけの印。シフト予定から下書きした行（保存時には送らない）。 */
  from_shift_plan?: boolean;
}

type AttendanceKind = 'normal' | 'breakthrough';
type SegmentGroup = 'normal' | 'breakthrough';
type AttendanceProgramFilter = 'all' | AttendanceProgram;

const segmentTypeLabel = (type: WorkSegment['type'], short = false) => {
  const labels: Record<WorkSegment['type'], string> = {
    lesson: '授業',
    individual: '個別授業',
    support: short ? 'サブ' : 'サブ（サポート）',
    office: '事務',
    interview: short ? 'サブ' : 'サブ（サポート）',
    grading: short ? '成績' : '成績集約',
    other: 'その他',
    breakthrough_lesson: short ? '突破授業' : '突破ゼミの授業',
    breakthrough_office: short ? '突破事務' : '突破ゼミの事務',
    breakthrough: short ? '突破授業' : '突破ゼミの授業',
    break: '休憩',
  };
  return labels[type] || '事務';
};

const segmentToneClass = (type: WorkSegment['type'], variant: 'chip' | 'row' | 'select' | 'bar' = 'chip') => {
  const tones = {
    lesson: { chip: 'bg-blue-100 text-blue-700', row: 'border-blue-100 bg-blue-50/60', select: 'text-blue-600 border-blue-200 bg-white', bar: 'bg-blue-500' },
    individual: { chip: 'bg-indigo-100 text-indigo-700', row: 'border-indigo-100 bg-indigo-50/60', select: 'text-indigo-600 border-indigo-200 bg-white', bar: 'bg-indigo-500' },
    support: { chip: 'bg-emerald-100 text-emerald-700', row: 'border-emerald-100 bg-emerald-50/60', select: 'text-emerald-600 border-emerald-200 bg-white', bar: 'bg-emerald-500' },
    office: { chip: 'bg-amber-100 text-amber-700', row: 'border-amber-100 bg-amber-50/60', select: 'text-amber-700 border-amber-200 bg-white', bar: 'bg-amber-500' },
    interview: { chip: 'bg-violet-100 text-violet-700', row: 'border-violet-100 bg-violet-50/60', select: 'text-violet-600 border-violet-200 bg-white', bar: 'bg-violet-500' },
    grading: { chip: 'bg-cyan-100 text-cyan-700', row: 'border-cyan-100 bg-cyan-50/60', select: 'text-cyan-600 border-cyan-200 bg-white', bar: 'bg-cyan-500' },
    other: { chip: 'bg-slate-100 text-slate-700', row: 'border-slate-100 bg-slate-50/60', select: 'text-slate-600 border-slate-200 bg-white', bar: 'bg-slate-600' },
    breakthrough_lesson: { chip: 'bg-fuchsia-100 text-fuchsia-700', row: 'border-fuchsia-100 bg-fuchsia-50/60', select: 'text-fuchsia-600 border-fuchsia-200 bg-white', bar: 'bg-fuchsia-500' },
    breakthrough_office: { chip: 'bg-rose-100 text-rose-700', row: 'border-rose-100 bg-rose-50/60', select: 'text-rose-600 border-rose-200 bg-white', bar: 'bg-rose-500' },
    breakthrough: { chip: 'bg-fuchsia-100 text-fuchsia-700', row: 'border-fuchsia-100 bg-fuchsia-50/60', select: 'text-fuchsia-600 border-fuchsia-200 bg-white', bar: 'bg-fuchsia-500' },
    break: { chip: 'bg-slate-200 text-slate-600', row: 'border-slate-100 bg-slate-100', select: 'text-slate-500 border-slate-200 bg-white', bar: 'bg-slate-400' },
  } satisfies Record<WorkSegment['type'], Record<'chip' | 'row' | 'select' | 'bar', string>>;
  return tones[type]?.[variant] || tones.office[variant];
};

const NORMAL_WORK_SEGMENT_OPTIONS: Array<{ value: WorkSegment['type']; label: string }> = [
  { value: 'lesson', label: '集団授業' },
  { value: 'individual', label: '個別授業' },
  { value: 'office', label: '事務' },
  { value: 'support', label: 'サブ（サポート）［サブ給与］' },
  { value: 'other', label: 'その他' },
  { value: 'break', label: '休憩' },
];

const BREAKTHROUGH_WORK_SEGMENT_OPTIONS: Array<{ value: WorkSegment['type']; label: string }> = [
  { value: 'breakthrough_lesson', label: '授業' },
  { value: 'breakthrough_office', label: '事務' },
];

const isBreakthroughSegment = (seg: WorkSegment) =>
  seg.type === 'breakthrough' || seg.type === 'breakthrough_lesson' || seg.type === 'breakthrough_office';

const segmentGroup = (type: WorkSegment['type']): SegmentGroup =>
  type === 'breakthrough' || type === 'breakthrough_lesson' || type === 'breakthrough_office' ? 'breakthrough' : 'normal';

const segmentOptionsForGroup = (group: SegmentGroup) =>
  group === 'breakthrough' ? BREAKTHROUGH_WORK_SEGMENT_OPTIONS : NORMAL_WORK_SEGMENT_OPTIONS;

const mapSegmentTypeToGroup = (type: WorkSegment['type'], group: SegmentGroup): WorkSegment['type'] => {
  if (group === 'breakthrough') {
    return type === 'lesson' || type === 'breakthrough' || type === 'breakthrough_lesson'
      ? 'breakthrough_lesson'
      : 'breakthrough_office';
  }
  if (type === 'breakthrough' || type === 'breakthrough_lesson') return 'lesson';
  if (type === 'breakthrough_office') return 'office';
  return type;
};

const getRecordAttendanceKind = (record: any): AttendanceKind => {
  const segments = Array.isArray(record?.work_segments) ? record.work_segments : [];
  return record?.attendance_kind === 'breakthrough' || segments.some((seg: WorkSegment) => isBreakthroughSegment(seg))
    ? 'breakthrough'
    : 'normal';
};

const getRecordPrograms = (record: any): AttendanceProgram[] => {
  const segments = Array.isArray(record?.work_segments)
    ? record.work_segments.filter((segment: WorkSegment) => segment.type !== 'break')
    : [];
  const programs = Array.from(new Set<AttendanceProgram>(segments.map((segment: WorkSegment) => segmentProgram(segment))));
  if (programs.length > 0) return programs;
  return [record?.attendance_kind === 'breakthrough' ? 'breakthrough' : 'normal'];
};

const programBadgeClass = (program: AttendanceProgram) => {
  if (program === 'science_social') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (program === 'breakthrough') return 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-100';
  return 'bg-blue-50 text-blue-700 ring-1 ring-blue-100';
};

const defaultSegmentNote = (type: WorkSegment['type']) => {
  if (type === 'breakthrough' || type === 'breakthrough_lesson') return '突破ゼミの授業';
  if (type === 'breakthrough_office') return '突破ゼミの事務';
  if (type === 'break') return '休憩';
  return '';
};

const normalizeWorkSegments = (items: WorkSegment[] = []): WorkSegment[] =>
  items.map(seg => ({
    ...normalizeAttendanceSegment(seg),
    school_id: resolveAttendanceSchoolCode(seg.school_id) || undefined,
  }) as WorkSegment);

const attendanceSchoolOptions = () => ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => (
  <optgroup key={group.label} label={group.label}>
    {group.schools.map(school => <option key={school.code} value={school.code}>{school.name}</option>)}
  </optgroup>
));
const FiveMinuteTimeSelect = FiveMinuteTimePicker;
const attendanceWorkplaceName = (record: any) => record?.default_program === 'science_social' || record?.workplace_type === 'science_social'
  ? SCIENCE_SOCIAL_WORKPLACE_LABEL
  : attendanceSchoolName(record?.school_id || record?.school_name);
const attendanceSchoolForProfile = (profile: any) => resolveAttendanceSchoolCode(
  profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || profile?.classroom || (Array.isArray(profile?.school_ids) ? profile.school_ids[0] : '')
);

interface Transportation {
  from: string;
  to: string;
  cost: number | string;
  transport_type?: string;
  route_line?: string;
  trip_type?: 'one_way' | 'round_trip';
  one_way_fare?: number;
  fare_source?: string;
  fare_provider?: string;
  commuter_pass_applied?: boolean;
  commuter_pass_count?: number;
}

const normalizeTransportExpenses = (items: any[] = []): Transportation[] =>
  items.map(item => ({
    ...item,
    route_line: item?.route_line || '',
    trip_type: item?.trip_type || 'round_trip',
  }));

const removeFareMetadata = (item: Transportation): Transportation => {
  const {
    one_way_fare,
    fare_source,
    fare_provider,
    commuter_pass_applied,
    commuter_pass_count,
    ...rest
  } = item;
  return rest;
};

const formatTransportationForSave = (items: Transportation[]) => {
  return items
    .filter(item =>
      item.transport_type ||
      item.route_line ||
      item.from ||
      item.to ||
      String(item.cost ?? '').trim()
    )
    .map(item => {
      const cost = Number(item.cost);
      const oneWayFare = Number(item.one_way_fare);
      const commuterPassCount = Number(item.commuter_pass_count);
      const payload: Record<string, string | number | boolean> = {
        from: String(item.from || '').trim(),
        to: String(item.to || '').trim(),
        cost: Number.isFinite(cost) ? cost : 0,
        trip_type: item.trip_type === 'one_way' ? 'one_way' : 'round_trip',
      };

      if (item.transport_type) payload.transport_type = String(item.transport_type);
      if (item.route_line) payload.route_line = String(item.route_line);
      if (Number.isFinite(oneWayFare) && oneWayFare > 0) payload.one_way_fare = oneWayFare;
      if (item.fare_source) payload.fare_source = String(item.fare_source);
      if (item.fare_provider) payload.fare_provider = String(item.fare_provider);
      if (typeof item.commuter_pass_applied === 'boolean') payload.commuter_pass_applied = item.commuter_pass_applied;
      if (Number.isFinite(commuterPassCount)) payload.commuter_pass_count = commuterPassCount;

      return payload;
    });
};

// シフト情報の型定義
type AttendanceDiagnostic = {
  type: string;
  date: string;
  teacher_name: string;
  work_record_id?: string;
  shift_assignment_id?: string;
  warnings: Array<{ code: string; label: string; severity: 'info' | 'warning' | 'danger'; detail: string }>;
};


const toLocalDate = (dateStr: string) => new Date(`${String(dateStr || '').slice(0, 10)}T00:00:00+09:00`);
const dayLabel = (dateStr: string) => {
  const date = toLocalDate(dateStr);
  return Number.isNaN(date.getTime()) ? '-' : ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
};
const dateLabel = (dateStr: string) => {
  const date = toLocalDate(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr || '-');
  return `${date.getMonth() + 1}/${date.getDate()}`;
};
const getJstNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000);
const getJstDateKey = () => getJstNow().toISOString().slice(0, 10);
const isClockClosedNow = () => getJstNow().getUTCHours() >= 23;
const timeLabel = (value?: string | null) => formatTime(value) || '-';
const roundedWorkRange = (record: any) => {
  if (!record?.start_time || !record?.end_time) return { start: '-', end: '-' };
  const start = new Date(record.start_time);
  const end = new Date(record.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { start: '-', end: '-' };
  const startMin = Math.ceil((start.getHours() * 60 + start.getMinutes()) / 5) * 5;
  const endMin = Math.floor((end.getHours() * 60 + end.getMinutes()) / 5) * 5;
  const toText = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { start: toText(startMin), end: toText(endMin) };
};
// --- サブコンポーネント: タイムライン表示 ---
const TimelineVisual = ({ record, currentSegments }: { record: any, currentSegments: WorkSegment[] }) => {
  if (!record.start_time || !record.end_time) return null;

  const startTime = new Date(record.start_time);
  const endTime = new Date(record.end_time);

  const displayStart = new Date(startTime);
  displayStart.setMinutes(displayStart.getMinutes() - 30);
  const displayEnd = new Date(endTime);
  displayEnd.setMinutes(displayEnd.getMinutes() + 30);

  const totalDuration = (displayEnd.getTime() - displayStart.getTime());

  const getPosition = (dateStr: string) => {
    const d = new Date(record.start_time);
    const [h, m] = dateStr.split(':').map(Number);
    d.setHours(h, m, 0);
    return ((d.getTime() - displayStart.getTime()) / totalDuration) * 100;
  };

  const getWidth = (startStr: string, endStr: string) => {
    const s = new Date(record.start_time);
    const [sh, sm] = startStr.split(':').map(Number);
    s.setHours(sh, sm, 0);
    const e = new Date(record.start_time);
    const [eh, em] = endStr.split(':').map(Number);
    e.setHours(eh, em, 0);
    return ((e.getTime() - s.getTime()) / totalDuration) * 100;
  };

  const workStartPos = ((startTime.getTime() - displayStart.getTime()) / totalDuration) * 100;
  const workWidth = ((endTime.getTime() - startTime.getTime()) / totalDuration) * 100;

  return (
    <div className="relative mb-4 h-12 w-full overflow-hidden rounded-input border border-slate-200 bg-slate-100">
      <div className="absolute top-0 bottom-0 bg-slate-200/50 border-x-2 border-slate-300" style={{ left: `${workStartPos}%`, width: `${workWidth}%` }} />
      {currentSegments.map((seg, i) => {
        if (!seg.start || !seg.end) return null;
        const left = getPosition(seg.start);
        const width = getWidth(seg.start, seg.end);

        const colorClass = segmentToneClass(seg.type, 'bar');

        return (
          <div key={i} className={`absolute top-1 bottom-1 rounded-md shadow-sm ${colorClass} opacity-90 hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white font-bold truncate px-1`} style={{ left: `${left}%`, width: `${width}%` }} title={`${seg.start}-${seg.end} ${seg.note}`}>
            {width > 10 ? segmentTypeLabel(seg.type, true) : ''}
          </div>
        );
      })}
      <div className="absolute top-0 bottom-0 w-px bg-black/20" style={{ left: `${workStartPos}%` }}></div>
      <div className="absolute top-0 bottom-0 w-px bg-black/20" style={{ left: `${workStartPos + workWidth}%` }}></div>
    </div>
  );
};

export default function TeacherAttendancePage() {
  const { user, profile, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isDedicated = profile ? isDedicatedProfile(profile) : false;
  const isAttendanceOnly = !hasScienceSocialProgram(profile);
  const [loading, setLoading] = useState(true);
  const [clockLabel, setClockLabel] = useState({ weekday: '', time: '--:--' });
  const [clockClosed, setClockClosed] = useState(false);

  const [currentSession, setCurrentSession] = useState<any>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [todayError, setTodayError] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [programFilter, setProgramFilter] = useState<AttendanceProgramFilter>('all');
  const [clockSchoolId, setClockSchoolId] = useState('');

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [correctionTarget, setCorrectionTarget] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
  const [transportationNone, setTransportationNone] = useState(false);
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [missingCorrectionOpen, setMissingCorrectionOpen] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [correctionInitialForm, setCorrectionInitialForm] = useState<CorrectionForm>({ requested_start_time: '', requested_end_time: '', reason: '' });
  const [missingInitialForm, setMissingInitialForm] = useState<MissingClockForm>(() => missingClockFormForDate(getJstDateKey(), ''));
  const [attendanceAlerts, setAttendanceAlerts] = useState<AttendanceDiagnostic[]>([]);
  const [todayShiftPlans, setTodayShiftPlans] = useState<AttendanceShiftPlan[]>([]);
  const [showCorrectionRequests, setShowCorrectionRequests] = useState(false);
  const [fareLookupIndex, setFareLookupIndex] = useState<number | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftFromShift, setDraftFromShift] = useState(false);
  const editingRecordIdRef = useRef<string | null>(null);
  const correctionAutoOpenedRef = useRef('');
  const detailParamHandledRef = useRef(false);
  const viewMonth = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
  const {
    requests: correctionRequests,
    loading: correctionRequestsLoading,
    error: correctionRequestsError,
    reload: fetchCorrectionRequests,
  } = useCorrectionRequests(user, viewMonth);
  const correctionAttention = useMemo(() => correctionRequestsNeedingAttention(correctionRequests), [correctionRequests]);
  const detailReminders = useWorkDetailReminders(user?.uid, Boolean(profile) && !isDedicated);

  useEffect(() => {
    if (profile && isDedicated) router.replace('/teacher/attendance/dedicated');
  }, [isDedicated, profile, router]);

  useEffect(() => {
    if (!clockSchoolId && profile) setClockSchoolId(attendanceSchoolForProfile(profile));
  }, [clockSchoolId, profile]);

  useEffect(() => {
    if (user) {
      fetchTodayStatus();
      fetchMonthlyHistory();
      fetchAttendanceAlerts();
      fetchTodayShiftPlans();
    }
  }, [user, viewDate]);

  // 承認待ち・却下の申請がある月は、申請一覧を自動で開いて管理者のコメントに気づけるようにする。
  useEffect(() => {
    if (correctionAttention.length > 0 && correctionAutoOpenedRef.current !== viewMonth) {
      correctionAutoOpenedRef.current = viewMonth;
      setShowCorrectionRequests(true);
    }
  }, [correctionAttention.length, viewMonth]);

  // 講師ホームのリマインドから ?detail=YYYY-MM-DD で来たら、その日の入力画面を開く。
  useEffect(() => {
    if (detailParamHandledRef.current || !detailReminders.loaded) return;
    detailParamHandledRef.current = true;
    const date = new URLSearchParams(window.location.search).get('detail') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const target = detailReminders.records.find(record => record.date === date);
    if (target) openEditModal(target);
    else toast.info('この日の勤務詳細はすでに入力済みか、入力できない状態です。');
  }, [detailReminders.loaded, detailReminders.records]);

  const handleLogout = async () => {
    if (!(await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' }))) return;
    await logout();
  };

  const getFreshAttendanceToken = async () => {
    if (!user) throw new Error('ログイン情報を確認できません。画面を再読み込みしてください。');
    try {
      return await user.getIdToken(true);
    } catch (error) {
      console.warn('Attendance token refresh failed:', error);
      throw new Error('ログイン情報の有効期限が切れています。一度ログアウトして、再度ログインしてください。');
    }
  };

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const jst = getJstNow();
      setClockLabel({
        weekday: now.toLocaleDateString('ja-JP', { weekday: 'long' }),
        time: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      });
      setClockClosed(jst.getUTCHours() >= 23);
    };
    updateClock();
    const timer = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // --- データ取得 ---
  const fetchTodayStatus = async (): Promise<any | null> => {
    setTodayError(false);
    try {
      const todayStr = getJstDateKey();
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), where('date', '==', todayStr));
      const snap = await getDocs(q);

      let active = null;
      let finished = null;
      if (!snap.empty) {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const latest = docs[0];
        if (latest.end_time === null) active = latest; else finished = latest;
      }
      setCurrentSession(active);
      setTodayRecord(finished);
      setLoading(false);
      return finished;
    } catch (e) { console.error(e); setTodayError(true); setLoading(false); return null; }
  };

  const fetchMonthlyHistory = async () => {
    if (!user) return;
    setHistoryError('');
    try {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth() + 1;
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;
      const sortRecords = (records: any[]) => records.sort((a, b) => {
        const dateOrder = String(b.date || '').localeCompare(String(a.date || ''));
        if (dateOrder !== 0) return dateOrder;
        const createdMillis = (value: any) => {
          if (typeof value?.toMillis === 'function') return value.toMillis();
          const parsed = Date.parse(String(value || ''));
          return Number.isFinite(parsed) ? parsed : 0;
        };
        return createdMillis(b.created_at) - createdMillis(a.created_at);
      });

      try {
        const optimizedQuery = query(
          collection(db, 'work_records'),
          where('teacher_id', '==', user.uid),
          where('date', '>=', startStr),
          where('date', '<=', endStr),
          orderBy('date', 'desc'),
          orderBy('created_at', 'desc')
        );
        const snap = await getDocs(optimizedQuery);
        setHistory(sortRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      } catch (error: any) {
        // 新環境で複合インデックスの反映待ちでも、履歴を「0件」と誤表示しない。
        if (String(error?.code || '') !== 'failed-precondition') throw error;
        console.warn('Attendance history index unavailable; using teacher-scoped fallback query.');
        const fallbackQuery = query(collection(db, 'work_records'), where('teacher_id', '==', user.uid));
        const fallbackSnap = await getDocs(fallbackQuery);
        const monthlyRecords = fallbackSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(record => String(record.date || '') >= startStr && String(record.date || '') <= endStr);
        setHistory(sortRecords(monthlyRecords));
      }
    } catch (e) {
      console.error(e);
      setHistoryError('勤務履歴を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
    }
  };

  const fetchAttendanceAlerts = async () => {
    if (!user) return;
    try {
      const month = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
      const token = await user.getIdToken();
      const res = await fetch(`/api/attendance-diagnostics?month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setAttendanceAlerts(data.diagnostics || []);
    } catch (e) {
      console.warn('勤怠アラート取得エラー:', e);
    }
  };

  const fetchTodayShiftPlans = async () => {
    if (!user || isDedicated) return;
    try {
      const today = getJstDateKey();
      const token = await user.getIdToken();
      // 承認者アカウントでも自分の予定だけを表示・下書きに使う。
      const res = await fetch(`/api/attendance-shifts?start=${today}&end=${today}&scope=mine`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTodayShiftPlans((data.shifts || []).filter((item: AttendanceShiftPlan) => item.reflect_to_attendance !== false && item.teacher_id === user.uid));
      }
    } catch (error) {
      console.warn('今日の勤務予定取得エラー:', error);
    }
  };

  // --- アクション ---
  const handleClockIn = async () => {
    if (isClockClosedNow()) {
      toast.error('23時以降は打刻できません。打刻忘れ申請から管理者へ申請してください。');
      return;
    }
    if (todayRecord) {
      toast.error('本日は既に勤務記録が完了しています。1日1回のみ打刻可能です。');
      return;
    }
    if (!clockSchoolId) {
      toast.error('勤務する校舎を選択してください。');
      return;
    }
    const workplaceLabel = clockSchoolId === SCIENCE_SOCIAL_WORKPLACE_ID ? SCIENCE_SOCIAL_WORKPLACE_LABEL : attendanceSchoolName(clockSchoolId);
    if (!(await confirm({ title: `${workplaceLabel}の勤務として出勤時刻を記録しますか？`, confirmLabel: '出勤する' }))) return;

    try {
      setLoading(true);
      const token = await getFreshAttendanceToken();
      const res = await fetch('/api/teacher/attendance-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'clock_in', school_id: clockSchoolId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'active work record already exists'
          ? '本日はすでに出勤中の勤務記録があります。1日に同じ講師が複数の打刻を作ることはできません。'
          : data.error === 'work record already completed today'
          ? '本日はすでに勤務記録が完了しています。1日に同じ講師が複数の打刻を作ることはできません。'
          : data.error || '出勤打刻に失敗しました';
        throw new Error(message);
      }
      await fetchTodayStatus();
      await fetchMonthlyHistory();
    } catch (e: any) { toast.error(e.message || '打刻に失敗しました。'); } finally { setLoading(false); }
  };

  const handleClockOut = async () => {
    if (isClockClosedNow()) {
      toast.error('23時以降は退勤打刻できません。打刻修正依頼から退勤時刻を申請してください。');
      return;
    }
    if (!(await confirm({ title: '退勤しますか？', confirmLabel: '退勤する' }))) return;
    try {
      setLoading(true);
      const token = await getFreshAttendanceToken();
      const res = await fetch('/api/teacher/attendance-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'clock_out', work_record_id: currentSession.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'work record belongs to another date'
          ? '日付が変わっているため、このまま退勤打刻はできません。打刻修正依頼から前日の退勤時刻を申請してください。'
          : data.error === 'work record already clocked out'
          ? 'すでに退勤打刻済みです。画面を更新してください。'
          : data.error || '退勤打刻に失敗しました';
        throw new Error(message);
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        toast.info(`退勤しました。確認が必要な項目があります: ${data.warnings.map((w: any) => `・${w.label}`).join(' ')}`);
      }
      const finished = await fetchTodayStatus();
      await fetchMonthlyHistory();
      await fetchAttendanceAlerts();
      detailReminders.reload();
      // 退勤した直後に勤務の詳細入力を開く（シフト予定があれば下書き入り。保存は講師が押したときだけ）。
      if (finished && !(Array.isArray(finished.work_segments) && finished.work_segments.length > 0)) {
        openEditModal(finished);
      }
    } catch (e: any) { toast.error(e.message || '打刻に失敗しました。'); } finally { setLoading(false); }
  };

  // --- 編集モーダル ---

  // その日のシフト予定（自分の分・勤怠に反映する予定のみ）から勤務詳細の下書きを作る。保存はしない。
  const loadShiftDraft = async (rec: any) => {
    if (!user || !rec?.date || !rec?.end_time) return;
    // 理社講座の勤務はシフト予定（校舎の勤務）と対応しないため、下書きを作らない。
    if (rec.default_program === 'science_social' || rec.workplace_type === 'science_social') return;
    const range = roundedWorkRange(rec);
    let plans: AttendanceShiftPlan[] = rec.date === getJstDateKey() ? todayShiftPlans : [];
    setDraftLoading(true);
    try {
      if (rec.date !== getJstDateKey() || plans.length === 0) {
        const token = await user.getIdToken();
        const res = await fetch(`/api/attendance-shifts?start=${rec.date}&end=${rec.date}&scope=mine`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
        plans = Array.isArray(data.shifts) ? data.shifts : [];
      }
      const drafts = draftSegmentsFromShiftPlans(plans, {
        teacherId: user.uid,
        date: rec.date,
        schoolId: resolveAttendanceSchoolCode(rec.school_id),
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      // 読み込み中に別の日を開いた／自分で行を追加した場合は上書きしない。
      if (editingRecordIdRef.current !== rec.id || drafts.length === 0) return;
      setSegments(current => current.length > 0 ? current : drafts as WorkSegment[]);
      setDraftFromShift(true);
    } catch (error) {
      console.warn('シフト予定からの下書き作成に失敗:', error);
      if (editingRecordIdRef.current === rec.id) toast.info('シフト予定を読み込めなかったため、勤務の詳細は空欄から入力してください。');
    } finally {
      setDraftLoading(false);
    }
  };

  const openEditModal = (rec: any) => {
    editingRecordIdRef.current = rec?.id || null;
    setEditingRecord(rec);
    setDraftFromShift(false);
    setExpenses(normalizeTransportExpenses(rec.transportation || []));
    setTransportationNone(rec.transportation_status === 'none');

    if (rec.work_segments && rec.work_segments.length > 0) {
      const fallbackSchool = resolveAttendanceSchoolCode(rec.school_id) || attendanceSchoolForProfile(profile);
      const sorted = normalizeWorkSegments(rec.work_segments)
        .map((segment: WorkSegment) => attendanceSegmentNeedsSchool(segment) && !segment.school_id
          ? { ...segment, school_id: fallbackSchool }
          : segment)
        .sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
      setSegments(sorted);
    } else {
      setSegments([]);
      void loadShiftDraft(rec);
    }
  };

  const closeEditModal = () => {
    editingRecordIdRef.current = null;
    setEditingRecord(null);
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index] };

    if (field === 'type') {
      const prevType = current.type;
      current.type = value as WorkSegment['type'];

      if (prevType === 'break' && (current.note === '休憩' || current.note.includes('自動'))) {
        current.note = '';
      }

      if (value === 'break' && !current.note) {
        current.note = '休憩';
      }
      if (value === 'break') delete current.school_id;
      else if (segmentProgram(current) !== 'science_social' && !current.school_id) {
        current.school_id = attendanceSchoolForProfile(profile);
      }
      if (value === 'lesson') current.lesson_format = 'group';
      if (value === 'individual') {
        current.lesson_format = 'individual';
        delete current.grade;
      }
      if (value !== 'individual') {
        delete current.individual_level;
        delete current.individual_ratio;
      }
      if (value === 'office') current.office_task = current.office_task || 'lesson_preparation';
      else if (value !== 'breakthrough_office') delete current.office_task;
    } else {
      (current as Record<string, unknown>)[field] = value;
      // ウイングネット・タブレット学習は人数を問わない単価なので、人数の選択を外す。
      if (field === 'individual_level' && !individualLevelNeedsRatio(value)) delete current.individual_ratio;
    }

    current.payroll_tier = payrollTierForSegment(current) || undefined;
    newSegs[index] = current;
    setSegments(newSegs);
  };

  const updateSegmentProgram = (index: number, program: AttendanceProgram) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index], program };
    if (program === 'breakthrough') {
      current.type = current.type === 'lesson' || current.type === 'individual' ? 'breakthrough_lesson' : 'breakthrough_office';
      current.lesson_format = current.type === 'breakthrough_lesson' ? 'group' : undefined;
    } else if (isBreakthroughSegment(current)) {
      current.type = current.type === 'breakthrough_lesson' ? 'lesson' : 'office';
    }
    if (program === 'science_social') delete current.school_id;
    else if (!current.school_id && current.type !== 'break') current.school_id = attendanceSchoolForProfile(profile);
    current.payroll_tier = payrollTierForSegment(current) || undefined;
    newSegs[index] = current;
    setSegments(newSegs);
  };

  const updateSegmentGroup = (index: number, group: SegmentGroup) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index] };
    const nextType = mapSegmentTypeToGroup(current.type, group);
    current.type = nextType;
    if (!current.note || current.note === defaultSegmentNote(newSegs[index].type)) {
      current.note = defaultSegmentNote(nextType);
    }
    newSegs[index] = current;
    setSegments(newSegs);
  };

  const addSegment = (defaultType: WorkSegment['type'] = 'office') => {
    let nextStart = '';
    let nextEnd = '';
    if (segments.length > 0) {
      nextStart = segments[segments.length - 1].end;
    } else if (editingRecord) {
      // 最初のセグメントを追加する場合は、出勤時刻を5分単位で切り上げた時刻を初期値にする
      const shiftStart = new Date(editingRecord.start_time);
      const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
      const h = Math.floor(startMin / 60);
      const m = startMin % 60;
      nextStart = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    if (editingRecord?.end_time) {
      const shiftEnd = new Date(editingRecord.end_time);
      const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;
      nextEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    }
    const defaultProgram: AttendanceProgram = editingRecord?.default_program === 'science_social'
      ? 'science_social'
      : defaultType.startsWith('breakthrough') ? 'breakthrough' : 'normal';
    setSegments([...segments, normalizeAttendanceSegment({
      start: nextStart,
      end: nextEnd,
      type: defaultType,
      program: defaultProgram,
      lesson_format: defaultType === 'lesson' ? 'group' : undefined,
      school_id: defaultType === 'break' || defaultProgram === 'science_social' ? undefined : attendanceSchoolForProfile(profile),
      office_task: defaultType === 'office' || defaultType === 'breakthrough_office' ? 'lesson_preparation' : undefined,
      note: defaultSegmentNote(defaultType),
    }) as WorkSegment]);
  };

  const removeSegment = (index: number) => setSegments(segments.filter((_, i) => i !== index));

  const updateExpense = (index: number, field: keyof Transportation, value: string | number | undefined) => {
    const newExps = [...expenses];
    newExps[index] = { ...newExps[index], [field]: value };
    setExpenses(newExps);
  };
  const updateTransportType = (index: number, value: string) => {
    const newExps = [...expenses];
    const base = removeFareMetadata(newExps[index] || { from: '', to: '', cost: '', trip_type: 'round_trip' });
    newExps[index] = {
      ...base,
      transport_type: value,
      route_line: '',
      from: '',
      to: '',
      cost: '',
    };
    setExpenses(newExps);
  };
  const updateRouteLine = (index: number, value: string) => {
    const newExps = [...expenses];
    const base = removeFareMetadata(newExps[index] || { from: '', to: '', cost: '', trip_type: 'round_trip' });
    newExps[index] = {
      ...base,
      route_line: value,
      from: '',
      to: '',
      cost: '',
    };
    setExpenses(newExps);
  };
  const updateTripType = (index: number, value: 'one_way' | 'round_trip') => {
    const newExps = [...expenses];
    const oneWayFare = Number(newExps[index]?.one_way_fare || 0);
    newExps[index] = {
      ...newExps[index],
      trip_type: value,
      cost: oneWayFare > 0 ? oneWayFare * (value === 'round_trip' ? 2 : 1) : newExps[index]?.cost || '',
    };
    setExpenses(newExps);
  };
  const addExpense = () => setExpenses([...expenses, { transport_type: '', route_line: '', from: '', to: '', cost: '', trip_type: 'round_trip' }]);
  const removeExpense = (index: number) => setExpenses(expenses.filter((_, i) => i !== index));

  const applyFareLookup = async (index: number) => {
    const exp = expenses[index];
    if (!exp?.transport_type || !exp.from || !exp.to) {
      toast.error('交通機関・出発駅・到着駅を選択してください。');
      return;
    }

    setFareLookupIndex(index);
    try {
      const token = await getFreshAttendanceToken();
      const params = new URLSearchParams({
        transport_type: exp.transport_type,
        from: exp.from,
        to: exp.to,
        provider: 'ekispert',
      });
      const res = await fetch(`/api/transport-fares?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || typeof data.fare !== 'number') {
        if (data.route_url) {
          const openRoute = await confirm({
            title: data.message || 'APIから数値運賃を取得できませんでした。',
            message: '確認URLを開いて金額を確認しますか？',
            confirmLabel: '確認URLを開く',
          });
          if (openRoute) window.open(data.route_url, '_blank', 'noopener,noreferrer');
        } else {
          toast.error(data.message || '運賃を取得できませんでした。金額は手入力してください。');
        }
        return;
      }

      const oneWayFare = Number(data.fare);
      const tripType = exp.trip_type || 'round_trip';
      const newExps = [...expenses];
      newExps[index] = {
        ...newExps[index],
        one_way_fare: oneWayFare,
        fare_source: data.source || '駅すぱあと API',
        fare_provider: data.provider || 'ekispert',
        commuter_pass_applied: Boolean(data.commuter_pass_applied),
        commuter_pass_count: Number(data.commuter_pass_count || 0),
        cost: oneWayFare * (tripType === 'round_trip' ? 2 : 1),
      };
      setExpenses(newExps);
    } catch (error) {
      console.error(error);
      toast.error('運賃の取得に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setFareLookupIndex(null);
    }
  };

  const handleCopyLastTransport = async () => {
    try {
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), orderBy('created_at', 'desc'), limit(10));
      const snap = await getDocs(q);
      const lastRecord = snap.docs.map(d => d.data()).find((d: any) => d.transportation?.length > 0 && d.id !== editingRecord.id);
      if (!lastRecord) {
        toast.info('過去の交通費データが見つかりませんでした');
        return;
      }
      if (await confirm({ title: `${lastRecord.date} の交通費情報をコピーしますか？`, confirmLabel: 'コピーする' })) {
        setExpenses(normalizeTransportExpenses(lastRecord.transportation));
      }
    } catch (e) {
      console.error(e);
      toast.error('前回の交通費を読み込めませんでした。');
    }
  };

  // ★修正: 打刻時間を5分単位に丸めてから隙間を計算する
  const fillGaps = (currentSegments: WorkSegment[], startTime: string, endTime: string | null) => {
    if (!startTime || !endTime) return currentSegments;
    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const toTimeStr = (m: number) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    };

    const shiftStart = new Date(startTime);
    const shiftEnd = new Date(endTime);

    // 出勤時刻は5分単位に「切り上げ」
    const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
    // 退勤時刻は5分単位に「切り捨て」
    const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

    const sorted = [...currentSegments]
      .filter(s => s.start && s.end)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    const result: WorkSegment[] = [];
    let cursor = startMin;

    for (const seg of sorted) {
      const segStart = toMinutes(seg.start);
      const segEnd = toMinutes(seg.end);

      if (cursor < segStart) {
        result.push({
          start: toTimeStr(cursor),
          end: toTimeStr(segStart),
          type: 'break',
          note: '休憩(自動補完)',
          isAuto: true
        });
      }
      result.push(seg);
      cursor = Math.max(cursor, segEnd);
    }

    if (cursor < endMin) {
      result.push({
        start: toTimeStr(cursor),
        end: toTimeStr(endMin),
        type: 'break',
        note: '休憩(自動補完)',
        isAuto: true
      });
    }
    return result;
  };

  const saveData = async () => {
    if (!editingRecord || detailSaving) return;

    // 講師用画面は打刻時間を変更できないため、editingRecordの値をそのまま使う
    const newStartISO = editingRecord.start_time;
    const newEndISO = editingRecord.end_time;

    // ★ 修正: 詳細(業務内訳)の入力のみ5分単位であることをチェック
    const isTimeStrMultipleOf5 = (timeStr: string) => {
      if (!timeStr) return true;
      const [, m] = timeStr.split(':').map(Number);
      return m % 5 === 0;
    };

    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };

    for (const seg of segments) {
      if (seg.start && seg.end) {
        if (!isTimeStrMultipleOf5(seg.start) || !isTimeStrMultipleOf5(seg.end)) {
          return toast.error('【エラー】業務内訳の開始・終了時刻は5分単位（0, 5, 10...）で入力してください。');
        }
      }
      const detailError = validateAttendanceSegment(normalizeAttendanceSegment(seg));
      if (detailError) return toast.error(`【入力を確認してください】${detailError}`);
    }

    // ★ 修正: 打刻時間を丸めた範囲内に詳細が収まっているか、および開始直後の休憩禁止チェック
    if (newStartISO && newEndISO) {
      const shiftStart = new Date(newStartISO);
      const shiftEnd = new Date(newEndISO);
      // 出勤は切り上げ、退勤は切り捨て
      const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
      const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

      // 範囲チェック
      for (const seg of segments) {
        if (seg.start && seg.end) {
          const sMin = toMinutes(seg.start);
          const eMin = toMinutes(seg.end);
          if (sMin < startMin || eMin > endMin) {
             return toast.error(`【エラー】業務内訳は打刻時間に基づき「${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}」から「${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')}」の間で入力してください。`);
          }
        }
      }

      // 最初の業務までの空白チェック＆休憩チェック
      if (segments.length > 0) {
        const sortedSegments = [...segments].filter(s => s.start && s.end).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        if (sortedSegments.length > 0) {
          const firstSegMin = toMinutes(sortedSegments[0].start);
          if (firstSegMin > startMin) {
            return toast.error(`【エラー】出勤時刻（打刻丸め後: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}）から最初の業務までに空白時間を作ることはできません。最初の業務の開始時刻を合わせるか、管理者に打刻時刻の修正を依頼してください。`);
          }
          if (sortedSegments[0].type === 'break') {
            return toast.error('【エラー】出勤直後の最初の業務区分に「休憩」を登録することはできません。');
          }
        }
      }
    }

    setDetailSaving(true);
    try {
      const validSegments = segments.filter(s => s.start && s.end);
      validSegments.sort((a, b) => a.start.localeCompare(b.start));
      const filledSegments = fillGaps(validSegments, editingRecord.start_time, editingRecord.end_time)
        .map(({ from_shift_plan: _fromShiftPlan, ...seg }) => normalizeAttendanceSegment(seg) as WorkSegment);

      // ★ 修正: 最後が休憩で終わることを禁止するバリデーション
      if (filledSegments.length > 0) {
        const lastSeg = filledSegments[filledSegments.length - 1];
        if (lastSeg.type === 'break') {
          return toast.error('【エラー】最後が「休憩」で終わることはできません。最後の業務の終了時刻と退勤時刻(丸め後)を一致させてください。');
        }
      }

      const sumSegmentMinutes = (targetSegments: WorkSegment[], predicate: (seg: WorkSegment) => boolean) => {
        return targetSegments.reduce((total, seg) => {
          if (!predicate(seg)) return total;
          const start = toMinutes(seg.start);
          const end = toMinutes(seg.end);
          return total + Math.max(0, end - start);
        }, 0);
      };

      const workMinutes = sumSegmentMinutes(filledSegments, seg => seg.type !== 'break');
      const breakMinutes = sumSegmentMinutes(filledSegments, seg => seg.type === 'break');
      const requiredBreakMinutes = workMinutes > 8 * 60 ? 60 : workMinutes > 6 * 60 ? 45 : 0;

      if (requiredBreakMinutes > 0 && breakMinutes < requiredBreakMinutes) {
        return toast.error(
          `【エラー】勤務時間が${workMinutes > 8 * 60 ? '8時間' : '6時間'}を超える場合は、${requiredBreakMinutes}分以上の休憩が必要です。` +
          `現在の休憩時間は${breakMinutes}分です。休憩区分を追加・修正してから保存してください。`
        );
      }

      const formattedExpenses = formatTransportationForSave(expenses);
      const nextAttendanceKind: AttendanceKind = filledSegments.some(seg => isBreakthroughSegment(seg)) ? 'breakthrough' : 'normal';

      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
      const response = await fetch('/api/teacher/attendance-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          work_record_id: editingRecord.id,
          attendance_kind: nextAttendanceKind,
          work_segments: filledSegments,
          transportation: formattedExpenses,
          transportation_status: transportationNone ? 'none' : formattedExpenses.length ? 'entered' : 'unset',
        }),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok || responseBody.ok === false) {
        throw new Error(responseBody.error || '勤務詳細を保存できませんでした。');
      }

      toast.success('保存しました。');
      closeEditModal();
      fetchMonthlyHistory();
      fetchAttendanceAlerts();
      fetchTodayStatus();
      detailReminders.reload();
    } catch (e: any) {
      const message = String(e?.message || '');
      toast.error('保存エラー: ' + (message || '保存に失敗しました。'));
    } finally {
      setDetailSaving(false);
    }
  };

  const openCorrectionForRecord = (record: any, request?: CorrectionRequest | null) => {
    if (!record) return;
    if (record.status === 'approved') {
      toast.error('承認済みの勤怠記録は講師側から修正できません。管理者へ連絡してください。');
      return;
    }
    setCorrectionTarget(record);
    setCorrectionInitialForm(correctionFormForRecord(record, request));
    setCorrectionModalOpen(true);
  };

  const openCorrectionModal = () => {
    if (!editingRecord) return;
    openCorrectionForRecord(editingRecord);
  };

  const openMissingCorrectionModal = () => {
    setMissingInitialForm(missingClockFormForDate(getJstDateKey(), clockSchoolId || attendanceSchoolForProfile(profile)));
    setMissingCorrectionOpen(true);
  };

  const reopenCorrectionRequest = (request: CorrectionRequest) => {
    const record = request.work_record_id
      ? history.find(item => item.id === request.work_record_id)
      : null;
    if (record) {
      openCorrectionForRecord(record, request);
      return;
    }
    const targetDate = String(request.target_date || '').slice(0, 10);
    if (!targetDate) {
      toast.error('申請日を確認できません。新規の打刻忘れ申請から入力してください。');
      return;
    }
    setMissingInitialForm(missingClockFormForDate(targetDate, clockSchoolId || attendanceSchoolForProfile(profile), request));
    setMissingCorrectionOpen(true);
  };

  const handleCorrectionSubmitted = async () => {
    setCorrectionModalOpen(false);
    setCorrectionTarget(null);
    setShowCorrectionRequests(true);
    await fetchTodayStatus();
    await fetchMonthlyHistory();
    await fetchCorrectionRequests();
  };

  const handleMissingSubmitted = async () => {
    setMissingCorrectionOpen(false);
    setShowCorrectionRequests(true);
    await fetchMonthlyHistory();
    await fetchCorrectionRequests();
  };

  const changeMonth = (diff: number) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + diff);
    setViewDate(newDate);
  };

  const calcDurationMinutes = (startISO: string, endISO: string) => {
    if (!startISO || !endISO) return 0;
    const diff = new Date(endISO).getTime() - new Date(startISO).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60)));
  };
  const formatDuration = (mins: number) => `${Math.floor(mins / 60)}時間${mins % 60}分`;

  const calcSegmentsMinutes = (segs: WorkSegment[] | undefined, predicate: (seg: WorkSegment) => boolean) => {
    if (!Array.isArray(segs)) return 0;
    return segs.filter(predicate).reduce((acc, s) => {
      const start = new Date(`2000/01/01 ${s.start}`);
      const end = new Date(`2000/01/01 ${s.end}`);
      const diff = (end.getTime() - start.getTime()) / (1000 * 60);
      return acc + (isNaN(diff) ? 0 : Math.max(0, diff));
    }, 0);
  };

  // 実働時間（休憩除く）: 打刻の在席時間から、業務内訳に登録された休憩区分を差し引く
  const calcRecordWorkMinutes = (rec: any) => {
    if (!rec?.start_time || !rec?.end_time) return 0;
    const stayMinutes = calcDurationMinutes(rec.start_time, rec.end_time);
    const breakMinutes = calcSegmentsMinutes(rec.work_segments, seg => seg.type === 'break');
    return Math.max(0, stayMinutes - breakMinutes);
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + (Number(item.cost) || 0), 0) : 0;

  const filteredHistory = useMemo(() => history.filter(record => (
    programFilter === 'all' || getRecordPrograms(record).includes(programFilter)
  )), [history, programFilter]);

  const monthlySummary = useMemo(() => {
    let totalMinutes = 0, totalTransportCost = 0;
    filteredHistory.forEach(rec => {
      if (rec.end_time) totalMinutes += calcRecordWorkMinutes(rec);
      if (rec.transportation) totalTransportCost += calcTotalCost(rec.transportation);
    });
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, cost: totalTransportCost };
  }, [filteredHistory]);

  const correctionRecord = correctionTarget || editingRecord;
  const closeCorrectionModal = () => { setCorrectionModalOpen(false); setCorrectionTarget(null); };
  const todayNeedsDetail = Boolean(todayRecord?.end_time && todayRecord.status !== 'approved'
    && !(Array.isArray(todayRecord.work_segments) && todayRecord.work_segments.length > 0));
  const rejectedCount = correctionAttention.filter(item => item.status === 'rejected').length;
  const pendingCorrectionCount = correctionAttention.length - rejectedCount;
  const schoolSelectClass = 'min-h-[52px] w-full rounded-input border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400';

  // 利用者の区分が分かるまでは何も出さない（専任が準専任用の画面を一瞬見ないようにする）。
  if (!profile || isDedicated) {
    return <div className="px-4 py-5 sm:px-6 md:p-8" aria-busy="true"><div className="mx-auto max-w-xl"><ListSkeleton rows={4} /></div></div>;
  }

  return (
    <div className="px-4 py-5 pb-48 sm:px-6 md:p-8">
      <div className="mx-auto max-w-xl space-y-5 sm:space-y-6">
        <PageHeader
          tone="plain"
          title="勤怠打刻"
          icon={Briefcase}
          backHref={isAttendanceOnly ? undefined : '/teacher/work'}
          actions={isAttendanceOnly ? (
            <Button variant="secondary" icon={<LogOut size={16} aria-hidden />} onClick={handleLogout} className="text-danger hover:text-danger">
              ログアウト
            </Button>
          ) : undefined}
        />

        {todayShiftPlans.length > 0 && (
          <section className="rounded-card border border-indigo-100 bg-accent-soft p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-indigo-950"><Calendar size={17} aria-hidden />今日の勤務予定</h2>
                <p className="mt-1 text-xs font-medium text-indigo-700">承認者が登録したシフトです。打刻後の勤務詳細入力に使用されます。</p>
              </div>
              <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-bold text-accent ring-1 ring-indigo-200">{todayShiftPlans.length}件</span>
            </div>
            <div className="mt-3 space-y-2">
              {todayShiftPlans.map(plan => (
                <div key={plan.id} className="flex items-center gap-3 rounded-input bg-surface px-3 py-3 text-left shadow-sm ring-1 ring-indigo-100">
                  <span className="shrink-0 font-mono text-sm font-bold text-fg">{plan.start}–{plan.end}</span>
                  <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700">{SHIFT_CATEGORY_LABELS[plan.category]}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted">{[plan.title, plan.subject, plan.room].filter(Boolean).join(' ／ ') || '勤務予定'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 今日の打刻 */}
        <section className="cb-card relative overflow-hidden p-5 text-center sm:p-6 md:p-8">
          <div className="absolute left-0 top-0 h-1.5 w-full bg-accent" aria-hidden></div>
          <div className="mb-2 flex items-center justify-between">
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-fg-muted">今日</span>
            <span className="text-xs font-bold text-fg-muted">{clockLabel.weekday || ' '}</span>
          </div>
          <div className="mb-6 mt-2 font-mono text-5xl font-black tracking-tighter text-fg sm:text-6xl">
            {clockLabel.time}
          </div>
          {loading ? (
            <div className="flex h-16 items-center justify-center"><Loader2 className="animate-spin text-accent" aria-label="読み込み中" /></div>
          ) : todayError ? (
            <ErrorState title="今日の打刻状況を読み込めませんでした" onRetry={fetchTodayStatus} />
          ) : currentSession ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-success-soft px-4 py-2 text-sm font-bold text-success shadow-sm motion-safe:animate-pulse">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden></span>
                勤務中 ({formatTime(currentSession.start_time)} 〜)
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-700">
                <MapPin size={14} aria-hidden /> {attendanceWorkplaceName(currentSession) || '勤務校舎未登録'}
                {currentSession.default_program === 'science_social' && <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">実績も理社講座が初期値</span>}
              </div>
              {clockClosed && (
                <div className="rounded-card border border-amber-200 bg-warning-soft px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
                  23時以降は退勤打刻できません。退勤時刻は下の修正依頼から申請してください。
                </div>
              )}
              <Button
                variant="danger"
                size="lg"
                fullWidth
                onClick={handleClockOut}
                disabled={clockClosed}
                icon={<Square fill="currentColor" size={18} aria-hidden />}
                className="min-h-[60px] text-lg"
              >
                退勤する
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => openCorrectionForRecord(currentSession)}
                icon={<Send size={16} aria-hidden />}
                className="min-h-[52px] text-amber-700"
              >
                退勤打刻の修正依頼
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {todayRecord ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-line bg-canvas px-4 py-6 text-fg-muted">
                  <div className="text-lg font-bold text-fg">お疲れ様でした 🎉</div>
                  <div className="text-xs">本日の業務記録は完了しています</div>
                  <div className="mt-1 rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-bold text-fg shadow-sm">
                    実働 {formatDuration(calcRecordWorkMinutes(todayRecord))}
                  </div>
                  {todayNeedsDetail && (
                    <Button
                      size="lg"
                      fullWidth
                      onClick={() => openEditModal(todayRecord)}
                      icon={<Edit3 size={18} aria-hidden />}
                      className="mt-3 min-h-[56px]"
                    >
                      勤務の詳細を入力する
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {clockClosed && (
                    <div className="rounded-card border border-amber-200 bg-warning-soft px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
                      23時以降は出勤打刻できません。打刻を忘れた日は「打刻を忘れた日の申請」から申請してください。
                    </div>
                  )}
                  <label className="block text-left">
                    <span className="mb-2 flex items-center gap-1.5 text-xs font-bold text-fg-muted">
                      <MapPin size={14} className="text-emerald-600" aria-hidden /> 今日勤務する校舎
                    </span>
                    <select
                      value={clockSchoolId}
                      onChange={event => setClockSchoolId(event.target.value)}
                      disabled={clockClosed}
                      className={schoolSelectClass}
                    >
                      <option value="">勤務校舎を選択</option>
                      <option value={SCIENCE_SOCIAL_WORKPLACE_ID}>★ {SCIENCE_SOCIAL_WORKPLACE_LABEL}</option>
                      {attendanceSchoolOptions()}
                    </select>
                  </label>
                  <Button
                    size="lg"
                    fullWidth
                    onClick={handleClockIn}
                    disabled={clockClosed}
                    icon={<Play fill="currentColor" size={18} aria-hidden />}
                    className="min-h-[60px] text-lg"
                  >
                    出勤する
                  </Button>
                </>
              )}
            </div>
          )}
        </section>

        <WorkDetailReminderCard
          records={detailReminders.records.filter(record => record.id !== todayRecord?.id)}
          error={detailReminders.error}
          onRetry={detailReminders.reload}
          onSelect={record => openEditModal(record)}
        />

        {attendanceAlerts.length > 0 && (
          <section className="rounded-card border border-amber-200 bg-warning-soft p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-amber-900">
                  <AlertCircle size={18} aria-hidden /> 勤怠確認アラート
                </h2>
                <p className="mt-1 text-xs font-medium text-amber-700">講師配置・業務詳細・交通費の確認が必要な可能性があります。</p>
              </div>
              <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">{attendanceAlerts.length}件</span>
            </div>
            <div className="space-y-2">
              {attendanceAlerts.slice(0, 5).map((item, index) => (
                <div key={`${item.date}_${item.work_record_id || item.shift_assignment_id || index}`} className="rounded-input bg-surface p-3 text-xs shadow-sm ring-1 ring-amber-100">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-fg">{item.date}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">{item.type === 'missing_work_record' ? '勤務記録なし' : '要確認'}</span>
                  </div>
                  <div className="space-y-1">
                    {item.warnings.map(w => (
                      <p key={w.code} className={w.severity === 'danger' ? 'font-bold text-rose-600' : 'font-bold text-amber-700'}>・{w.label}: {w.detail}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="cb-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-fg">
                <Send size={18} className="text-amber-500" aria-hidden /> 送信済みの打刻修正依頼
                {rejectedCount > 0 && <StatusPill tone="danger">却下 {rejectedCount}件</StatusPill>}
                {pendingCorrectionCount > 0 && <StatusPill tone="warning">承認待ち {pendingCorrectionCount}件</StatusPill>}
              </h2>
              <p className="mt-1 text-xs font-medium text-fg-muted">
                {viewDate.getFullYear()}年{viewDate.getMonth() + 1}月分だけを確認できます。
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCorrectionRequests(prev => !prev)}
              aria-expanded={showCorrectionRequests}
              className="shrink-0"
            >
              {showCorrectionRequests ? '閉じる' : '見る'}
            </Button>
          </div>
          {showCorrectionRequests && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-3 text-xs font-medium text-fg-muted">自分が送った申請の承認状況と、管理者からのコメントを確認できます。</p>
              <CorrectionRequestList
                requests={correctionRequests}
                loading={correctionRequestsLoading}
                error={correctionRequestsError}
                onRetry={fetchCorrectionRequests}
                onReopen={reopenCorrectionRequest}
              />
            </div>
          )}
        </section>

        {/* 月次サマリー */}
        <div className="space-y-4">
          <div className="cb-card flex items-center justify-between px-3 py-2">
            <IconButton label="前の月" onClick={() => changeMonth(-1)}><ChevronLeft size={22} aria-hidden /></IconButton>
            <h2 className="flex items-center gap-2 text-base font-bold text-fg sm:text-lg"><Calendar size={18} className="mb-0.5 text-accent" aria-hidden /> {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月</h2>
            <IconButton label="次の月" onClick={() => changeMonth(1)}><ChevronRight size={22} aria-hidden /></IconButton>
          </div>
          <div className="cb-card p-2">
            <p className="px-2 pb-2 pt-1 text-xs font-bold text-fg-muted">表示する勤怠区分</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ['all', 'すべて'],
                ['normal', ATTENDANCE_PROGRAM_LABELS.normal],
                ['science_social', ATTENDANCE_PROGRAM_LABELS.science_social],
                ['breakthrough', ATTENDANCE_PROGRAM_LABELS.breakthrough],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setProgramFilter(value)}
                  aria-pressed={programFilter === value}
                  className={`min-h-11 rounded-btn px-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    programFilter === value
                      ? value === 'science_social'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : value === 'breakthrough'
                        ? 'bg-fuchsia-600 text-white shadow-sm'
                        : 'bg-accent text-accent-ink shadow-sm'
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="cb-card flex min-h-[92px] flex-col items-center justify-center p-4">
              <span className="mb-1 text-xs font-bold text-fg-muted">実働時間の合計</span>
              <div className="text-xl font-black text-fg">{monthlySummary.hours}<span className="ml-0.5 text-xs font-bold text-fg-muted">時間</span>{monthlySummary.minutes > 0 && <span className="ml-1 text-lg">{monthlySummary.minutes}<span className="text-xs font-bold text-fg-muted">分</span></span>}</div>
            </div>
            <div className="cb-card flex min-h-[92px] flex-col items-center justify-center p-4">
              <span className="mb-1 text-xs font-bold text-fg-muted">交通費の合計</span>
              <div className="flex items-baseline text-xl font-black text-fg"><span className="mr-1 text-sm text-fg-muted">¥</span>{monthlySummary.cost.toLocaleString()}</div>
            </div>
          </div>
          <Button
            variant="secondary"
            fullWidth
            onClick={openMissingCorrectionModal}
            icon={<Send size={16} aria-hidden />}
            className="min-h-[52px] border-amber-200 bg-warning-soft text-amber-700 hover:bg-amber-100"
          >
            打刻を忘れた日の申請をする
          </Button>
        </div>

        {/* 履歴リスト */}
        <div className="space-y-4 pb-24">
          {historyError ? (
            <ErrorState message={historyError} onRetry={fetchMonthlyHistory} />
          ) : filteredHistory.length === 0 ? (
            <EmptyState icon={Clock} title={history.length === 0 ? 'この月の履歴はありません' : 'この区分の勤怠はありません'} />
          ) : filteredHistory.map((rec) => {
             const duration = rec.end_time ? calcRecordWorkMinutes(rec) : 0;
             if(currentSession && currentSession.id === rec.id) return null;
             const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
             const recPrograms = getRecordPrograms(rec);
             const recordSchool = attendanceWorkplaceName(rec);

             return (
              <div key={rec.id} className="cb-card p-4 transition-colors hover:border-indigo-200 sm:p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex min-w-[3.5rem] shrink-0 flex-col items-center justify-center rounded-input border border-line bg-canvas px-3 py-2">
                      <span className="text-xs font-bold text-accent">{dayLabel(rec.date)}曜日</span>
                      <span className="text-xl font-black text-fg">{dateLabel(rec.date)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 font-mono text-lg font-bold text-fg">{formatTime(rec.start_time) || '-'}<ArrowLeft size={12} className="rotate-180 text-slate-300" aria-hidden />{rec.end_time ? formatTime(rec.end_time) || '-' : '...'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{formatDuration(duration)}</span>
                        {recPrograms.map(program => (
                          <span key={program} className={`rounded px-2 py-1 text-xs font-bold ${programBadgeClass(program)}`}>
                            {ATTENDANCE_PROGRAM_LABELS[program]}
                          </span>
                        ))}
                        {rec.status === 'approved' ? <span className="flex items-center gap-0.5 text-xs font-bold text-emerald-600"><CheckCircle size={12} aria-hidden /> 承認済</span> : <span className="flex items-center gap-0.5 text-xs font-bold text-amber-600"><AlertCircle size={12} aria-hidden /> 承認待</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                        <MapPin size={13} className="shrink-0" aria-hidden />
                        <span className="truncate">{recordSchool || '勤務校舎未登録'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {displaySegments?.length > 0 ? (
                  <div className="mb-4 overflow-hidden rounded-input border border-line bg-canvas">
                    {displaySegments.map((seg: WorkSegment, i: number) => (
                      <div key={i} className={`flex items-center border-b border-slate-100 px-3 py-2 text-xs last:border-0 ${segmentToneClass(seg.type, 'row')}`}>
                        <div className="w-20 shrink-0 font-mono font-bold text-slate-600">{seg.start} - {seg.end}</div>
                        <div className={`mr-3 shrink-0 rounded px-2 py-0.5 text-xs font-bold ${segmentToneClass(seg.type, 'chip')}`}>
                          {segmentTypeLabel(seg.type, true)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-600">{seg.note}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-500">
                            <span className={`rounded px-1.5 py-0.5 ${programBadgeClass(segmentProgram(seg))}`}>{ATTENDANCE_PROGRAM_LABELS[segmentProgram(seg)]}</span>
                            {seg.type !== 'break' && (
                              <span className="flex min-w-0 items-center gap-1 text-emerald-700">
                                <MapPin size={10} className="shrink-0" aria-hidden />
                                <span className="truncate">{attendanceSchoolName(seg.school_id || rec.school_id || rec.school_name) || '校舎未登録'}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="mb-4 flex items-center gap-1 rounded-input border border-amber-100 bg-warning-soft p-2 text-xs font-bold text-amber-700"><LayoutTemplate size={14} aria-hidden /> 業務詳細が未入力です</div>}

                {rec.transportation?.length > 0 && <div className="mb-4 flex items-center justify-between border-t border-dashed border-line px-1 pt-2 text-xs text-fg-muted"><span className="flex items-center gap-1 font-bold"><Train size={12} aria-hidden /> 交通費あり</span><span className="font-mono font-bold">¥{calcTotalCost(rec.transportation).toLocaleString()}</span></div>}
                {rec.end_time && rec.status !== 'approved' ? (
                  <Button variant="secondary" fullWidth onClick={() => openEditModal(rec)} icon={<Edit3 size={14} aria-hidden />} className="min-h-12 text-xs">{displaySegments?.length > 0 ? '詳細を修正' : '詳細・交通費を入力'}</Button>
                ) : !rec.end_time && rec.status !== 'approved' ? (
                  <Button variant="secondary" fullWidth onClick={() => openCorrectionForRecord(rec)} icon={<Send size={14} aria-hidden />} className="min-h-12 border-amber-200 bg-warning-soft text-xs text-amber-700 hover:bg-amber-100">退勤打刻の修正依頼</Button>
                ) : rec.end_time && (
                  <div className="w-full rounded-input bg-success-soft px-4 py-3 text-center text-xs font-bold text-emerald-700">
                    承認済みのため、時間・詳細・交通費は講師側では変更できません
                  </div>
                )}
              </div>
            );
          })}
          <div className="h-24 md:hidden"></div>
        </div>
      </div>

      {/* 詳細編集モーダル */}
      <Modal
        open={Boolean(editingRecord)}
        onClose={() => { if (!correctionModalOpen) closeEditModal(); }}
        title="業務詳細修正"
        description={editingRecord ? `${editingRecord.date}（${dayLabel(editingRecord.date)}）` : undefined}
        size="lg"
        footer={editingRecord ? (
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between px-2 text-xs font-bold text-fg-muted">
              <span>合計勤務時間 (休憩除く)</span>
              <span className="text-sm text-fg">
                {formatDuration(
                  calcSegmentsMinutes(segments, seg => seg.type !== 'break')
                )}
              </span>
            </div>
            <Button size="lg" fullWidth onClick={saveData} loading={detailSaving} icon={<Save size={20} aria-hidden />}>
              {detailSaving ? '保存中...' : '保存して完了'}
            </Button>
          </div>
        ) : undefined}
      >
        {editingRecord && (
          <div className="space-y-5 sm:space-y-6">
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={openCorrectionModal} icon={<Send size={14} aria-hidden />} className="text-amber-700">打刻修正依頼</Button>
            </div>
            {draftLoading && (
              <p className="flex items-center gap-2 rounded-input bg-accent-soft px-4 py-3 text-xs font-bold text-indigo-800">
                <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden /> シフト予定を確認しています…
              </p>
            )}
            {draftFromShift && segments.some(seg => seg.from_shift_plan) && (
              <div className="rounded-card border border-indigo-100 bg-accent-soft p-4 text-xs font-bold leading-relaxed text-indigo-900">
                <p className="flex items-center gap-1.5"><Calendar size={14} aria-hidden /> シフト予定から下書きを作成しました（まだ保存されていません）。</p>
                <p className="mt-1 font-medium text-indigo-800">実際の勤務と違うところを直してから「保存して完了」を押してください。</p>
              </div>
            )}
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-card border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-bold text-blue-500">実打刻</p>
                <p className="mt-1 text-lg font-bold text-slate-800">{timeLabel(editingRecord.start_time)} - {timeLabel(editingRecord.end_time)}</p>
              </div>
              <div className="rounded-card border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-bold text-emerald-600">入力可能範囲</p>
                <p className="mt-1 text-lg font-bold text-slate-800">{roundedWorkRange(editingRecord).start} - {roundedWorkRange(editingRecord).end}</p>
              </div>
              <div className="rounded-card border border-amber-100 bg-amber-50 p-4">
                <p className="text-xs font-bold text-amber-600">確認ポイント</p>
                <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">打刻時間を見ながら、業務内訳を5分単位で入力してください。</p>
              </div>
            </section>

            {/* ビジュアルタイムライン */}
            <section>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 px-1 gap-2">
                <h4 className="text-xs font-bold text-slate-500">1日の流れ</h4>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="flex items-center gap-1 text-blue-600"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>授業</span>
                  <span className="flex items-center gap-1 text-emerald-600"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span>サポート</span>
                  <span className="flex items-center gap-1 text-amber-600"><span className="w-2 h-2 bg-amber-500 rounded-full"></span>事務</span>
                  <span className="flex items-center gap-1 text-fuchsia-600"><span className="w-2 h-2 bg-fuchsia-500 rounded-full"></span>突破授業</span>
                  <span className="flex items-center gap-1 text-rose-600"><span className="w-2 h-2 bg-rose-500 rounded-full"></span>突破事務</span>
                  <span className="flex items-center gap-1 text-violet-600"><span className="w-2 h-2 bg-violet-500 rounded-full"></span>面接</span>
                  <span className="flex items-center gap-1 text-cyan-600"><span className="w-2 h-2 bg-cyan-500 rounded-full"></span>成績</span>
                  <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 bg-slate-400 rounded-full"></span>休憩</span>
                </div>
              </div>
              <TimelineVisual record={editingRecord} currentSegments={segments} />
            </section>

            {/* 編集テーブル */}
            <section>
              <div className="flex flex-col gap-2 mb-3 px-1 text-xs text-slate-600 font-bold bg-slate-100 p-3 rounded-input border border-slate-200">
                <div className="flex items-center gap-1"><AlertCircle size={12} className="shrink-0 text-slate-500" aria-hidden /> 始まりと終わりの隙間は自動で「休憩」になり、空白時間を埋めます（出勤直後は不可）。</div>
                <div className="flex items-center gap-1 text-rose-500"><AlertCircle size={12} className="shrink-0" aria-hidden /> ※勤務時間が6時間を超える場合は45分以上、8時間を超える場合は1時間以上の休憩が必要です。</div>
              </div>

              <div className="space-y-3 md:hidden">
                {segments.map((seg, i) => (
                  <div key={i} className={`rounded-card border p-4 shadow-sm ${segmentToneClass(seg.type, 'row')}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                        業務 {i + 1}
                        {seg.from_shift_plan && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">シフト予定から入力</span>}
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => removeSegment(i)} icon={<Trash2 size={14} aria-hidden />} className="text-danger">
                        削除
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label>
                        <span className="mb-1 block text-xs font-bold text-slate-500">開始</span>
                        <FiveMinuteTimeSelect className="min-h-[48px] w-full rounded-input border border-slate-200 bg-white px-3 font-mono text-base font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={seg.start} onChange={value => updateSegment(i, 'start', value)} />
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-bold text-slate-500">終了</span>
                        <FiveMinuteTimeSelect className="min-h-[48px] w-full rounded-input border border-slate-200 bg-white px-3 font-mono text-base font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={seg.end} onChange={value => updateSegment(i, 'end', value)} />
                      </label>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">種別</span>
                      <select
                        className={`min-h-[48px] w-full rounded-input border px-3 text-sm font-bold outline-none ${segmentGroup(seg.type) === 'breakthrough' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-blue-200 bg-white text-blue-700'}`}
                        value={segmentProgram(seg)}
                        onChange={(e) => updateSegmentProgram(i, e.target.value as AttendanceProgram)}
                      >
                        {ATTENDANCE_PROGRAMS.map(program => <option key={program} value={program}>{ATTENDANCE_PROGRAM_LABELS[program]}</option>)}
                      </select>
                    </label>
                    {attendanceSegmentNeedsSchool(seg) && <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">勤務校舎（必須）</span>
                      <select value={seg.school_id || ''} onChange={e => updateSegment(i, 'school_id', e.target.value)} className="min-h-[48px] w-full rounded-input border border-emerald-200 bg-white px-3 text-sm font-bold text-emerald-800">
                        <option value="">校舎を選択</option>
                        {attendanceSchoolOptions()}
                      </select>
                    </label>}
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">区分</span>
                      <select
                        className={`min-h-[48px] w-full rounded-input border px-3 text-sm font-bold outline-none ${segmentToneClass(seg.type, 'select')}`}
                        value={seg.type}
                        onChange={(e) => updateSegment(i, 'type', e.target.value as any)}
                      >
                        {segmentOptionsForGroup(segmentProgram(seg) === 'breakthrough' ? 'breakthrough' : 'normal').map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    {seg.type === 'lesson' && <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-slate-500">学年（必須）</span><select value={seg.grade || ''} onChange={e => updateSegment(i, 'grade', e.target.value)} className="min-h-[48px] w-full rounded-input border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">学年を選択</option>{ATTENDANCE_GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label>}
                    {seg.type === 'lesson' && isSogakuAttendanceSchool(seg.school_id) && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">創学での授業は、創学単価（分給）で計算します。</p>}
                    {seg.type === 'individual' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className={individualLevelNeedsRatio(seg.individual_level) || !seg.individual_level ? '' : 'sm:col-span-2'}><span className="mb-1 block text-xs font-bold text-slate-500">種類・単価区分（必須）</span><select value={seg.individual_level || ''} onChange={e => updateSegment(i, 'individual_level', e.target.value)} className="min-h-[48px] w-full rounded-input border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700"><option value="">種類を選択</option>{INDIVIDUAL_LEVEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      {(individualLevelNeedsRatio(seg.individual_level) || !seg.individual_level) && <label><span className="mb-1 block text-xs font-bold text-slate-500">指導人数（必須）</span><select value={seg.individual_ratio || ''} onChange={e => updateSegment(i, 'individual_ratio', e.target.value)} className="min-h-[48px] w-full rounded-input border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700"><option value="">人数を選択</option><option value="1:1">1対1</option><option value="1:2">1対2</option><option value="1:3">1対3</option></select></label>}
                    </div>}
                    {seg.type === 'office' && <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-slate-500">事務内容（必須）</span><select value={seg.office_task || ''} onChange={e => updateSegment(i, 'office_task', e.target.value)} className="min-h-[48px] w-full rounded-input border border-amber-200 bg-white px-3 text-sm font-bold text-amber-700"><option value="">内容を選択</option>{OFFICE_TASK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-bold text-slate-500">詳細</span>
                      <input type="text" className="min-h-[48px] w-full rounded-input border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                    </label>
                  </div>
                ))}
              </div>

              <div className="hidden bg-white rounded-input shadow-sm border border-slate-200 overflow-hidden overflow-x-auto md:block">
                <table className="w-full text-sm border-collapse min-w-[500px] sm:min-w-0">
                  <thead className="bg-slate-100 text-slate-500 text-xs font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-2 py-2 text-left w-16">開始</th>
                      <th className="px-2 py-2 text-left w-16">終了</th>
                      <th className="px-2 py-2 text-left w-24">種別</th>
                      <th className="px-2 py-2 text-left w-32">区分</th>
                      <th className="px-2 py-2 text-left w-28">勤務校舎</th>
                      <th className="px-2 py-2 text-left hidden sm:table-cell">詳細</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {segments.map((seg, i) => (
                      <tr key={i} className={`transition-colors ${segmentToneClass(seg.type, 'row')}`}>
                        <td className="p-2"><FiveMinuteTimeSelect className="w-full bg-white rounded border border-slate-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={value => updateSegment(i, 'start', value)} />{seg.from_shift_plan && <span className="mt-1 inline-block whitespace-nowrap rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">シフト予定から入力</span>}</td>
                        <td className="p-2"><FiveMinuteTimeSelect className="w-full bg-white rounded border border-slate-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={value => updateSegment(i, 'end', value)} /></td>
                        <td className="p-2">
                          <div className="flex flex-col sm:flex-row gap-1">
                            <select
                              className={`w-full text-xs font-bold p-1 rounded border outline-none ${segmentGroup(seg.type) === 'breakthrough' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-blue-200 bg-white text-blue-700'}`}
                              value={segmentProgram(seg)}
                              onChange={(e) => updateSegmentProgram(i, e.target.value as AttendanceProgram)}
                            >
                              {ATTENDANCE_PROGRAMS.map(program => <option key={program} value={program}>{ATTENDANCE_PROGRAM_LABELS[program]}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-col sm:flex-row gap-1">
                            <select
                              className={`w-full text-xs font-bold p-1 rounded border outline-none ${segmentToneClass(seg.type, 'select')}`}
                              value={seg.type}
                              onChange={(e) => updateSegment(i, 'type', e.target.value as any)}
                            >
                              {segmentOptionsForGroup(segmentProgram(seg) === 'breakthrough' ? 'breakthrough' : 'normal').map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <input type="text" className="sm:hidden w-full bg-transparent border-b border-slate-300 text-xs p-1 mt-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                          </div>
                        </td>
                        <td className="p-2">{attendanceSegmentNeedsSchool(seg) ? <select value={seg.school_id || ''} onChange={e => updateSegment(i, 'school_id', e.target.value)} className="w-full rounded border border-emerald-200 bg-white p-1 text-xs font-bold text-emerald-800"><option value="">校舎を選択</option>{attendanceSchoolOptions()}</select> : <span className="text-xs font-bold text-slate-400">不要</span>}</td>
                        <td className="p-2 hidden sm:table-cell"><div className="grid gap-1"><input type="text" className="w-full bg-transparent border-b border-slate-300 focus:border-indigo-500 outline-none text-xs p-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />{seg.type === 'lesson' && <select value={seg.grade || ''} onChange={e => updateSegment(i, 'grade', e.target.value)} className="rounded border border-slate-200 bg-white p-1 text-xs font-bold"><option value="">学年を選択</option>{ATTENDANCE_GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>}{seg.type === 'individual' && <div className="grid grid-cols-2 gap-1"><select value={seg.individual_level || ''} onChange={e => updateSegment(i, 'individual_level', e.target.value)} className={`rounded border border-slate-200 bg-white p-1 text-xs font-bold ${individualLevelNeedsRatio(seg.individual_level) || !seg.individual_level ? '' : 'col-span-2'}`}><option value="">種類</option>{INDIVIDUAL_LEVEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{(individualLevelNeedsRatio(seg.individual_level) || !seg.individual_level) && <select value={seg.individual_ratio || ''} onChange={e => updateSegment(i, 'individual_ratio', e.target.value)} className="rounded border border-slate-200 bg-white p-1 text-xs font-bold"><option value="">人数</option><option value="1:1">1対1</option><option value="1:2">1対2</option><option value="1:3">1対3</option></select>}</div>}{seg.type === 'office' && <select value={seg.office_task || ''} onChange={e => updateSegment(i, 'office_task', e.target.value)} className="rounded border border-slate-200 bg-white p-1 text-xs font-bold"><option value="">事務内容を選択</option>{OFFICE_TASK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</div></td>
                        <td className="p-2 text-center w-10 whitespace-nowrap"><IconButton label={`業務 ${i + 1} を削除`} size="sm" onClick={() => removeSegment(i)} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} aria-hidden /></IconButton></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 rounded-input border border-slate-100 bg-white px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-1 font-bold"><Coffee size={12} className="shrink-0" aria-hidden /> 入力のない時間は自動的に「休憩」となります</span>
                <Button variant="secondary" onClick={() => addSegment('office')} icon={<Plus size={14} aria-hidden />} className="text-accent">行を追加</Button>
              </div>
            </section>

            {/* 交通費セクション */}
            <section className="pt-4 border-t border-slate-200">
              <label className="mb-4 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-input border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-800">
                <input type="checkbox" checked={transportationNone} onChange={event => { setTransportationNone(event.target.checked); if (event.target.checked) setExpenses([]); }} className="h-5 w-5 accent-emerald-600" />
                交通費なし（入力漏れではありません）
              </label>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-3 gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Train size={16} aria-hidden /> 交通費申請
                  </h4>
                  <p className="text-xs text-slate-500 font-bold mt-1">購入済み定期券を登録している場合は、自動入力時に定期区間を控除します。</p>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                  <Button variant="secondary" onClick={handleCopyLastTransport} icon={<Copy size={14} aria-hidden />} className="text-xs">
                    前回をコピー
                  </Button>
                  <Button variant="secondary" disabled={transportationNone} onClick={addExpense} icon={<Plus size={14} aria-hidden />} className="text-xs text-emerald-700">
                    追加
                  </Button>
                </div>
              </div>
              <div className="mb-3">
                <TeacherCommuterPassPanel />
              </div>
              <div className="space-y-3">
                {expenses.map((exp, i) => (
                  <div key={i} className="relative overflow-visible rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                    <IconButton label={`交通費 ${i + 1} を削除`} size="sm" variant="secondary" onClick={() => removeExpense(i)} className="absolute right-3 top-3 z-10 text-slate-400 hover:text-rose-600"><X size={14} aria-hidden /></IconButton>
                    <div className="flex flex-col gap-3">
                      <div className="flex w-full flex-col gap-2 pr-10">
                        <div className="grid gap-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select
                              className="min-h-[44px] w-full rounded-input border border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
                              value={exp.transport_type || ''}
                              onChange={(e) => updateTransportType(i, e.target.value)}
                            >
                              <option value="">交通機関</option>
                              {TRANSPORT_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <TransportLineSelect
                              transportType={exp.transport_type}
                              value={exp.route_line || ''}
                              onChange={(value) => updateRouteLine(i, value)}
                            />
                          </div>
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] md:items-start">
                            <TransportStationSearchInput
                              transportType={exp.transport_type}
                              line={exp.route_line}
                              value={exp.from}
                              placeholder="出発駅・停留所"
                              onChange={(value) => updateExpense(i, 'from', value)}
                              onSelect={(value) => updateExpense(i, 'from', value)}
                            />
                            <ChevronRight size={14} className="hidden self-center justify-self-center text-slate-300 md:block" aria-hidden />
                            <TransportStationSearchInput
                              transportType={exp.transport_type}
                              line={exp.route_line}
                              value={exp.to}
                              placeholder="到着駅・停留所"
                              onChange={(value) => updateExpense(i, 'to', value)}
                              onSelect={(value) => updateExpense(i, 'to', value)}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => applyFareLookup(i)}
                            disabled={fareLookupIndex === i || !exp.transport_type || !exp.from || !exp.to}
                            className="flex min-h-9 items-center gap-1.5 rounded-btn bg-emerald-100 px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {fareLookupIndex === i ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                            運賃を自動入力
                          </button>
                          {exp.fare_source ? (
                            <span className="text-xs font-bold text-emerald-600">
                              取得元: {exp.fare_source}{exp.commuter_pass_applied ? ' / 定期控除済み' : ''}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">取得できない場合は金額を手入力してください</span>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-2 rounded-input bg-slate-50 p-3 sm:grid-cols-[8rem_minmax(10rem,14rem)] sm:items-center sm:justify-end">
                          <select
                            value={exp.trip_type || 'round_trip'}
                            onChange={(e) => updateTripType(i, e.target.value as 'one_way' | 'round_trip')}
                            className="min-h-[40px] w-full rounded-input border border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
                          >
                            <option value="one_way">片道</option>
                            <option value="round_trip">往復</option>
                          </select>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">¥</span>
                            <input type="number" className="min-h-[44px] w-full rounded-input border border-slate-100 bg-white pl-7 pr-3 text-right font-mono text-lg font-bold text-slate-800 outline-none placeholder:text-slate-200 focus:border-emerald-400" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                          </div>
	                      </div>
	                    </div>
                  </div>
	                  ))}
              </div>
            </section>
          </div>
        )}
      </Modal>

      <TimeCorrectionModal
        open={Boolean(correctionRecord && correctionModalOpen)}
        record={correctionRecord}
        initialForm={correctionInitialForm}
        user={user}
        onClose={closeCorrectionModal}
        onSubmitted={handleCorrectionSubmitted}
      />

      <MissingClockModal
        open={missingCorrectionOpen}
        initialForm={missingInitialForm}
        user={user}
        hasRecordOnDate={date => history.some(rec => rec.date === date)}
        onClose={() => setMissingCorrectionOpen(false)}
        onSubmitted={handleMissingSubmitted}
      />
    </div>
  );
}
