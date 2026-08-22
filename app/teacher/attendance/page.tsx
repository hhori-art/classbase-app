'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import {
  Clock, CheckCircle, AlertCircle, Play, Square, Briefcase,
  ArrowLeft, Plus, Trash2, Save, X, Edit3, Train,
  ChevronLeft, ChevronRight, Loader2, Copy,
  Calendar, LayoutTemplate, Coffee, DollarSign, Send, LogOut
} from 'lucide-react';
import Link from 'next/link';
import { TRANSPORT_TYPE_OPTIONS } from '@/lib/transport-fares';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import TransportLineSelect from '@/app/components/TransportLineSelect';
import TransportStationSearchInput from '@/app/components/TransportStationSearchInput';
import TeacherCommuterPassPanel from '@/app/components/TeacherCommuterPassPanel';
import { isDedicatedProfile } from '@/lib/employment-category';

// --- 型定義 ---
interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office' | 'support' | 'break' | 'interview' | 'grading' | 'other' | 'breakthrough_lesson' | 'breakthrough_office' | 'breakthrough';
  note: string;
  isAuto?: boolean;
}

type AttendanceKind = 'normal' | 'breakthrough';
type SegmentGroup = 'normal' | 'breakthrough';

const segmentTypeLabel = (type: WorkSegment['type'], short = false) => {
  const labels: Record<WorkSegment['type'], string> = {
    lesson: '授業',
    support: short ? 'サブ' : 'サブ（面接）',
    office: '事務',
    interview: short ? 'サブ' : 'サブ（面接）',
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
    support: { chip: 'bg-green-100 text-green-700', row: 'border-green-100 bg-green-50/60', select: 'text-green-600 border-green-200 bg-white', bar: 'bg-green-500' },
    office: { chip: 'bg-orange-100 text-orange-700', row: 'border-orange-100 bg-orange-50/60', select: 'text-orange-600 border-orange-200 bg-white', bar: 'bg-orange-500' },
    interview: { chip: 'bg-violet-100 text-violet-700', row: 'border-violet-100 bg-violet-50/60', select: 'text-violet-600 border-violet-200 bg-white', bar: 'bg-violet-500' },
    grading: { chip: 'bg-cyan-100 text-cyan-700', row: 'border-cyan-100 bg-cyan-50/60', select: 'text-cyan-600 border-cyan-200 bg-white', bar: 'bg-cyan-500' },
    other: { chip: 'bg-slate-100 text-slate-700', row: 'border-slate-100 bg-slate-50/60', select: 'text-slate-600 border-slate-200 bg-white', bar: 'bg-slate-600' },
    breakthrough_lesson: { chip: 'bg-fuchsia-100 text-fuchsia-700', row: 'border-fuchsia-100 bg-fuchsia-50/60', select: 'text-fuchsia-600 border-fuchsia-200 bg-white', bar: 'bg-fuchsia-500' },
    breakthrough_office: { chip: 'bg-rose-100 text-rose-700', row: 'border-rose-100 bg-rose-50/60', select: 'text-rose-600 border-rose-200 bg-white', bar: 'bg-rose-500' },
    breakthrough: { chip: 'bg-fuchsia-100 text-fuchsia-700', row: 'border-fuchsia-100 bg-fuchsia-50/60', select: 'text-fuchsia-600 border-fuchsia-200 bg-white', bar: 'bg-fuchsia-500' },
    break: { chip: 'bg-gray-200 text-gray-600', row: 'border-gray-100 bg-gray-100', select: 'text-gray-500 border-gray-200 bg-white', bar: 'bg-slate-400' },
  } satisfies Record<WorkSegment['type'], Record<'chip' | 'row' | 'select' | 'bar', string>>;
  return tones[type]?.[variant] || tones.office[variant];
};

const NORMAL_WORK_SEGMENT_OPTIONS: Array<{ value: WorkSegment['type']; label: string }> = [
  { value: 'lesson', label: '授業' },
  { value: 'office', label: '事務' },
  { value: 'support', label: 'サブ（面接）［サブ給与］' },
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

const defaultSegmentNote = (type: WorkSegment['type']) => {
  if (type === 'breakthrough' || type === 'breakthrough_lesson') return '突破ゼミの授業';
  if (type === 'breakthrough_office') return '突破ゼミの事務';
  if (type === 'break') return '休憩';
  return '';
};

const normalizeWorkSegments = (items: WorkSegment[] = []): WorkSegment[] =>
  items.map(seg => ({
    ...seg,
    type: seg.type === 'breakthrough' ? 'breakthrough_lesson' : seg.type === 'interview' ? 'support' : seg.type,
  }));

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

type CorrectionRequest = {
  id: string;
  work_record_id?: string | null;
  request_type?: string;
  target_date?: string | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  reason?: string;
  status: string;
  created_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string;
  revision_number?: number;
  superseded_by?: string;
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
const timeLabel = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
};
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
    <div className="relative w-full h-12 bg-gray-100 rounded-lg overflow-hidden mb-4 border border-gray-200">
      <div className="absolute top-0 bottom-0 bg-gray-200/50 border-x-2 border-gray-300" style={{ left: `${workStartPos}%`, width: `${workWidth}%` }} />
      {currentSegments.map((seg, i) => {
        if (!seg.start || !seg.end) return null;
        const left = getPosition(seg.start);
        const width = getWidth(seg.start, seg.end);

        const colorClass = segmentToneClass(seg.type, 'bar');

        return (
          <div key={i} className={`absolute top-1 bottom-1 rounded-md shadow-sm ${colorClass} opacity-90 hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-bold truncate px-1`} style={{ left: `${left}%`, width: `${width}%` }} title={`${seg.start}-${seg.end} ${seg.note}`}>
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
  const isDedicated = profile ? isDedicatedProfile(profile) : false;
  const isAttendanceOnly = !hasScienceSocialProgram(profile);
  const [loading, setLoading] = useState(true);
  const [clockLabel, setClockLabel] = useState({ weekday: '', time: '--:--' });
  const [clockClosed, setClockClosed] = useState(false);

  const [currentSession, setCurrentSession] = useState<any>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [viewDate, setViewDate] = useState(new Date());

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [correctionTarget, setCorrectionTarget] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [missingCorrectionOpen, setMissingCorrectionOpen] = useState(false);
  const [correctionSending, setCorrectionSending] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({ requested_start_time: '', requested_end_time: '', reason: '' });
  const [missingCorrectionForm, setMissingCorrectionForm] = useState({
    target_date: getJstDateKey(),
    requested_start_time: '',
    requested_end_time: '',
    reason: '',
  });
  const [attendanceAlerts, setAttendanceAlerts] = useState<AttendanceDiagnostic[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequest[]>([]);
  const [showCorrectionRequests, setShowCorrectionRequests] = useState(false);
  const [fareLookupIndex, setFareLookupIndex] = useState<number | null>(null);

  useEffect(() => {
    if (profile && isDedicated) window.location.replace('/teacher/attendance/dedicated');
  }, [isDedicated, profile]);

  useEffect(() => {
    if (user) {
      fetchTodayStatus();
      fetchMonthlyHistory();
      fetchAttendanceAlerts();
    }
  }, [user, viewDate]);

  useEffect(() => {
    if (user && showCorrectionRequests) {
      fetchCorrectionRequests();
    }
  }, [user, viewDate, showCorrectionRequests]);

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await logout();
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
  const fetchTodayStatus = async () => {
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
    } catch (e) { console.error(e); setLoading(false); }
  };

  const fetchMonthlyHistory = async () => {
    try {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth() + 1;
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr = `${year}-${String(month).padStart(2, '0')}-31`;
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), where('date', '>=', startStr), where('date', '<=', endStr), orderBy('date', 'desc'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  };

  const fetchAttendanceAlerts = async () => {
    if (!user) return;
    try {
      setCorrectionRequests([]);
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

  const fetchCorrectionRequests = async () => {
    if (!user) return;
    try {
      const month = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
      const token = await user.getIdToken();
      const res = await fetch(`/api/attendance-corrections?month=${month}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setCorrectionRequests(data.requests || []);
    } catch (e) {
      console.warn('打刻修正依頼取得エラー:', e);
    }
  };

  // --- アクション ---
  const handleClockIn = async () => {
    if (isClockClosedNow()) {
      alert('23時以降は打刻できません。打刻忘れ申請から管理者へ申請してください。');
      return;
    }
    if (todayRecord) {
      alert('本日は既に勤務記録が完了しています。1日1回のみ打刻可能です。');
      return;
    }
    if (!confirm('出勤時刻を記録しますか？')) return;

    try {
      setLoading(true);
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/attendance-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'clock_in' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'active work record already exists'
          ? '本日はすでに出勤中の勤務記録があります。1日に同じ先生が複数の打刻を作ることはできません。'
          : data.error === 'work record already completed today'
          ? '本日はすでに勤務記録が完了しています。1日に同じ先生が複数の打刻を作ることはできません。'
          : data.error || '出勤打刻に失敗しました';
        throw new Error(message);
      }
      await fetchTodayStatus();
      await fetchMonthlyHistory();
    } catch (e: any) { alert('エラー: ' + e.message); } finally { setLoading(false); }
  };

  const handleClockOut = async () => {
    if (isClockClosedNow()) {
      alert('23時以降は退勤打刻できません。打刻修正依頼から退勤時刻を申請してください。');
      return;
    }
    if (!confirm('退勤しますか？')) return;
    try {
      setLoading(true);
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/attendance-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'clock_out', work_record_id: currentSession.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '退勤打刻に失敗しました');
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        alert(`退勤しました。\n\n確認が必要な項目があります:\n${data.warnings.map((w: any) => `・${w.label}`).join('\n')}`);
      }
      await fetchTodayStatus();
      await fetchMonthlyHistory();
      await fetchAttendanceAlerts();
    } catch (e: any) { alert('エラー: ' + e.message); } finally { setLoading(false); }
  };

  // --- 編集モーダル ---

  const openEditModal = (rec: any) => {
    setEditingRecord(rec);
    setExpenses(normalizeTransportExpenses(rec.transportation || []));

    if (rec.work_segments && rec.work_segments.length > 0) {
      const sorted = normalizeWorkSegments(rec.work_segments).sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
      setSegments(sorted);
    } else {
      setSegments([]);
    }
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
    } else {
      const textField = field as Exclude<keyof WorkSegment, 'type' | 'isAuto'>;
      current[textField] = value;
    }

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
    setSegments([...segments, { start: nextStart, end: '', type: defaultType, note: defaultSegmentNote(defaultType) }]);
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
      alert('交通機関・出発駅・到着駅を選択してください。');
      return;
    }

    setFareLookupIndex(index);
    try {
      const token = await user?.getIdToken();
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
        const message = data.route_url
          ? `${data.message || 'APIから数値運賃を取得できませんでした。'}\n確認URLを開いて金額を確認しますか？`
          : data.message || '運賃を取得できませんでした。金額は手入力してください。';
        if (data.route_url && confirm(message)) window.open(data.route_url, '_blank', 'noopener,noreferrer');
        else if (!data.route_url) alert(message);
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
      alert('運賃の取得に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setFareLookupIndex(null);
    }
  };

  const handleCopyLastTransport = async () => {
    try {
      const q = query(collection(db, 'work_records'), where('teacher_id', '==', user?.uid), orderBy('created_at', 'desc'), limit(10));
      const snap = await getDocs(q);
      const lastRecord = snap.docs.map(d => d.data()).find((d: any) => d.transportation?.length > 0 && d.id !== editingRecord.id);
      if (lastRecord && confirm(`${lastRecord.date} の交通費情報をコピーしますか？`)) {
        setExpenses(normalizeTransportExpenses(lastRecord.transportation));
      } else if (!lastRecord) alert('過去の交通費データが見つかりませんでした');
    } catch (e) { console.error(e); }
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
    if (!editingRecord) return;

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
          return alert('【エラー】業務内訳の開始・終了時刻は5分単位（0, 5, 10...）で入力してください。');
        }
      }
      if (seg.type === 'other' && !String(seg.note || '').trim()) {
        return alert('【エラー】「その他」を選択した場合は、具体的な業務内容を入力してください。');
      }
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
             return alert(`【エラー】業務内訳は打刻時間に基づき「${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}」から「${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')}」の間で入力してください。`);
          }
        }
      }

      // 最初の業務までの空白チェック＆休憩チェック
      if (segments.length > 0) {
        const sortedSegments = [...segments].filter(s => s.start && s.end).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        if (sortedSegments.length > 0) {
          const firstSegMin = toMinutes(sortedSegments[0].start);
          if (firstSegMin > startMin) {
            return alert(`【エラー】出勤時刻（打刻丸め後: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}）から最初の業務までに空白時間を作ることはできません。\n最初の業務の開始時刻を合わせるか、管理者に打刻時刻の修正を依頼してください。`);
          }
          if (sortedSegments[0].type === 'break') {
            return alert('【エラー】出勤直後の最初の業務区分に「休憩」を登録することはできません。');
          }
        }
      }
    }

    try {
      const validSegments = segments.filter(s => s.start && s.end);
      validSegments.sort((a, b) => a.start.localeCompare(b.start));
      const filledSegments = fillGaps(validSegments, editingRecord.start_time, editingRecord.end_time);

      // ★ 修正: 最後が休憩で終わることを禁止するバリデーション
      if (filledSegments.length > 0) {
        const lastSeg = filledSegments[filledSegments.length - 1];
        if (lastSeg.type === 'break') {
          return alert('【エラー】最後が「休憩」で終わることはできません。\n最後の業務の終了時刻と退勤時刻(丸め後)を一致させてください。');
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
        return alert(
          `【エラー】勤務時間が${workMinutes > 8 * 60 ? '8時間' : '6時間'}を超える場合は、${requiredBreakMinutes}分以上の休憩が必要です。\n` +
          `現在の休憩時間は${breakMinutes}分です。休憩区分を追加・修正してから保存してください。`
        );
      }

      const formattedExpenses = formatTransportationForSave(expenses);
      const nextAttendanceKind: AttendanceKind = filledSegments.some(seg => isBreakthroughSegment(seg)) ? 'breakthrough' : 'normal';

      await updateDoc(doc(db, 'work_records', editingRecord.id), {
        attendance_kind: nextAttendanceKind,
        work_segments: filledSegments,
        transportation: formattedExpenses,
        updated_at: new Date().toISOString()
      });

      alert('保存しました。');
      setEditingRecord(null);
      fetchMonthlyHistory();
      fetchAttendanceAlerts();
    } catch (e: any) {
      const code = String(e?.code || '');
      const message = String(e?.message || '');
      if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
        alert('保存権限を確認できませんでした。ページを再読み込みしてから、もう一度「保存して完了」を押してください。続く場合は、承認済みの勤怠ではないかをご確認ください。');
        return;
      }
      alert('保存エラー: ' + (message || '保存に失敗しました。'));
    }
  };

  const toLocalInputValue = (value?: string | null) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const formatDateTimeLabel = (value?: string | null) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const openCorrectionForRecord = (record: any) => {
    if (!record) return;
    if (record.status === 'approved') {
      alert('承認済みの勤怠記録は講師側から修正できません。管理者へ連絡してください。');
      return;
    }
    setCorrectionTarget(record);
    setCorrectionForm({
      requested_start_time: toLocalInputValue(record.start_time),
      requested_end_time: toLocalInputValue(record.end_time),
      reason: '',
    });
    setCorrectionModalOpen(true);
  };

  const openCorrectionModal = () => {
    if (!editingRecord) return;
    openCorrectionForRecord(editingRecord);
  };

  const openMissingCorrectionModal = () => {
    const targetDate = getJstDateKey();
    setMissingCorrectionForm({
      target_date: targetDate,
      requested_start_time: `${targetDate}T19:20`,
      requested_end_time: `${targetDate}T21:40`,
      reason: '',
    });
    setMissingCorrectionOpen(true);
  };

  const reopenCorrectionRequest = (request: CorrectionRequest) => {
    const record = request.work_record_id
      ? history.find(item => item.id === request.work_record_id)
      : null;

    if (record) {
      if (record.status === 'approved') {
        alert('承認済みの勤怠記録は講師側から再申請できません。管理者へ連絡してください。');
        return;
      }
      setCorrectionTarget(record);
      setCorrectionForm({
        requested_start_time: toLocalInputValue(request.requested_start_time || record.start_time),
        requested_end_time: toLocalInputValue(request.requested_end_time || record.end_time),
        reason: '',
      });
      setCorrectionModalOpen(true);
      return;
    }

    const targetDate = String(request.target_date || '').slice(0, 10);
    if (!targetDate) {
      alert('申請日を確認できません。新規の打刻忘れ申請から入力してください。');
      return;
    }
    setMissingCorrectionForm({
      target_date: targetDate,
      requested_start_time: toLocalInputValue(request.requested_start_time) || `${targetDate}T19:20`,
      requested_end_time: toLocalInputValue(request.requested_end_time) || `${targetDate}T21:40`,
      reason: '',
    });
    setMissingCorrectionOpen(true);
  };

  const updateMissingTargetDate = (targetDate: string) => {
    setMissingCorrectionForm(prev => ({
      ...prev,
      target_date: targetDate,
      requested_start_time: prev.requested_start_time ? `${targetDate}T${prev.requested_start_time.slice(11, 16)}` : '',
      requested_end_time: prev.requested_end_time ? `${targetDate}T${prev.requested_end_time.slice(11, 16)}` : '',
    }));
  };

  const requestTimeCorrection = async () => {
    const targetRecord = correctionTarget || editingRecord;
    if (!targetRecord) return;
    if (!correctionForm.reason.trim()) return alert('修正理由を入力してください。');
    if (!correctionForm.requested_start_time && !correctionForm.requested_end_time) return alert('修正後の出勤時刻または退勤時刻を入力してください。');
    if (correctionForm.requested_start_time && correctionForm.requested_end_time && new Date(correctionForm.requested_start_time) >= new Date(correctionForm.requested_end_time)) {
      return alert('退勤時刻は出勤時刻より後にしてください。');
    }

    try {
      setCorrectionSending(true);
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'request',
          work_record_id: targetRecord.id,
          requested_start_time: correctionForm.requested_start_time ? new Date(correctionForm.requested_start_time).toISOString() : null,
          requested_end_time: correctionForm.requested_end_time ? new Date(correctionForm.requested_end_time).toISOString() : null,
          reason: correctionForm.reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'approved work records cannot be changed by teacher'
          ? '承認済みの勤怠記録は講師側から修正できません。管理者へ連絡してください。'
          : data.error === 'requested end time must be after start time'
          ? '退勤時刻は出勤時刻より後にしてください。'
          : data.error === 'invalid requested time'
          ? '出勤時刻または退勤時刻の形式を確認してください。'
          : data.error || 'failed';
        throw new Error(message);
      }
      setCorrectionModalOpen(false);
      setCorrectionTarget(null);
      setShowCorrectionRequests(true);
      await fetchTodayStatus();
      await fetchMonthlyHistory();
      await fetchCorrectionRequests();
      alert('勤怠修正依頼を送信しました。管理者の承認後に反映されます。');
    } catch (e: any) {
      alert(`修正依頼の送信に失敗しました: ${e.message || e}`);
    } finally {
      setCorrectionSending(false);
    }
  };

  const requestMissingClockCorrection = async () => {
    if (!missingCorrectionForm.target_date) return alert('申請する日付を選択してください。');
    if (!missingCorrectionForm.requested_start_time || !missingCorrectionForm.requested_end_time) return alert('出勤時刻と退勤時刻を入力してください。');
    if (!missingCorrectionForm.reason.trim()) return alert('申請理由を入力してください。');
    if (new Date(missingCorrectionForm.requested_start_time) >= new Date(missingCorrectionForm.requested_end_time)) {
      return alert('退勤時刻は出勤時刻より後にしてください。');
    }
    const exists = history.some(rec => rec.date === missingCorrectionForm.target_date);
    if (exists) {
      return alert('この日はすでに勤務記録があります。1日に同じ先生の勤怠は1件のみ作成できます。既存の記録から「打刻修正依頼」を送ってください。');
    }
    try {
      setCorrectionSending(true);
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'request',
          target_date: missingCorrectionForm.target_date,
          requested_start_time: new Date(missingCorrectionForm.requested_start_time).toISOString(),
          requested_end_time: new Date(missingCorrectionForm.requested_end_time).toISOString(),
          reason: missingCorrectionForm.reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'work record already exists for target_date'
          ? 'この日はすでに勤務記録があります。該当日の「詳細・交通費を入力」から打刻修正依頼を送ってください。'
          : data.error || 'failed';
        throw new Error(message);
      }
      setMissingCorrectionOpen(false);
      setShowCorrectionRequests(true);
      await fetchMonthlyHistory();
      await fetchCorrectionRequests();
      alert('打刻忘れの申請を送信しました。管理者の承認後に勤務記録が作成されます。');
    } catch (e: any) {
      alert(`申請の送信に失敗しました: ${e.message || e}`);
    } finally {
      setCorrectionSending(false);
    }
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

  const calcSegmentTotal = (segs: WorkSegment[], type: string) => {
    return segs.filter(s => s.type === type).reduce((acc, s) => {
      const start = new Date(`2000/01/01 ${s.start}`);
      const end = new Date(`2000/01/01 ${s.end}`);
      const diff = (end.getTime() - start.getTime()) / (1000 * 60);
      return acc + (isNaN(diff) ? 0 : diff);
    }, 0);
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + (Number(item.cost) || 0), 0) : 0;

  const monthlySummary = useMemo(() => {
    let totalMinutes = 0, totalTransportCost = 0;
    history.forEach(rec => {
      if (rec.end_time) totalMinutes += calcDurationMinutes(rec.start_time, rec.end_time);
      if (rec.transportation) totalTransportCost += calcTotalCost(rec.transportation);
    });
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, cost: totalTransportCost };
  }, [history]);

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 pb-48 font-sans sm:px-4 md:p-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {!isAttendanceOnly && (
              <Link href="/teacher/work" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50"><ArrowLeft size={20} /></Link>
            )}
            <h1 className="flex min-w-0 items-center gap-2 text-xl font-black text-gray-800 sm:text-2xl"><Briefcase className="shrink-0 text-blue-600" /> 勤怠打刻</h1>
          </div>
          {isAttendanceOnly && (
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl border border-red-100 bg-white px-3 text-xs font-black text-red-500 shadow-sm transition-colors hover:bg-red-50 sm:px-4 sm:text-sm"
            >
              <LogOut size={16} />
              ログアウト
            </button>
          )}
        </div>

        {/* 今日の打刻 */}
        <div className="relative mb-5 overflow-hidden rounded-[28px] border border-white bg-white p-5 text-center shadow-lg shadow-blue-50 sm:mb-6 sm:rounded-[32px] sm:p-6 md:p-8">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-400 via-green-400 to-orange-400"></div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md">TODAY</span>
            <span className="text-xs font-bold text-gray-400">{clockLabel.weekday || ' '}</span>
          </div>
          <div className="mb-6 mt-2 font-mono text-5xl font-black tracking-tighter text-gray-800 sm:text-6xl">
            {clockLabel.time}
          </div>
          {loading ? <div className="h-16 flex items-center justify-center"><Loader2 className="animate-spin text-gray-300"/></div> : currentSession ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full text-sm font-bold animate-pulse border border-green-100 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                勤務中 ({new Date(currentSession.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 〜)
              </div>
              {clockClosed && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black leading-relaxed text-amber-800">
                  23時以降は退勤打刻できません。退勤時刻は下の修正依頼から申請してください。
                </div>
              )}
              <button
                onClick={handleClockOut}
                disabled={clockClosed}
                className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 py-4 text-lg font-bold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400 disabled:shadow-none sm:hover:shadow-xl sm:hover:shadow-red-200"
              >
                <Square fill="currentColor" size={18} /> 退勤する
              </button>
              <button
                onClick={() => openCorrectionForRecord(currentSession)}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-black text-amber-700 shadow-sm transition-all hover:bg-amber-50 active:scale-[0.99]"
              >
                <Send size={16} /> 退勤打刻の修正依頼
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {todayRecord ? (
                <div className="py-6 px-4 bg-gray-50 rounded-2xl border border-gray-200 text-gray-500 flex flex-col items-center justify-center gap-2">
                  <div className="font-bold text-lg text-slate-600">お疲れ様でした 🎉</div>
                  <div className="text-xs">本日の業務記録は完了しています</div>
                  <div className="text-sm font-bold bg-white px-4 py-1.5 rounded-full border border-gray-200 shadow-sm mt-1 text-slate-700">
                    実働 {formatDuration(calcDurationMinutes(todayRecord.start_time, todayRecord.end_time))}
                  </div>
                </div>
              ) : (
                <>
                  {clockClosed && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black leading-relaxed text-amber-800">
                      23時以降は出勤打刻できません。打刻を忘れた日は「打刻を忘れた日の申請」から申請してください。
                    </div>
                  )}
                  <button
                    onClick={handleClockIn}
                    disabled={clockClosed}
                    className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-4 text-lg font-bold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400 disabled:shadow-none sm:hover:shadow-xl sm:hover:shadow-blue-200"
                  >
                    <Play fill="currentColor" size={18} /> 出勤する
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {attendanceAlerts.length > 0 && (
          <section className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-black text-amber-900">
                  <AlertCircle size={18} /> 勤怠確認アラート
                </h2>
                <p className="mt-1 text-xs font-bold text-amber-700">講師配置・業務詳細・交通費の確認が必要な可能性があります。</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">{attendanceAlerts.length}件</span>
            </div>
            <div className="space-y-2">
              {attendanceAlerts.slice(0, 5).map((item, index) => (
                <div key={`${item.date}_${item.work_record_id || item.shift_assignment_id || index}`} className="rounded-2xl bg-white p-3 text-xs shadow-sm ring-1 ring-amber-100">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-black text-slate-800">{item.date}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">{item.type === 'missing_work_record' ? '勤務記録なし' : '要確認'}</span>
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

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
                <Send size={18} className="text-amber-500" /> 送信済みの打刻修正依頼
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                {viewDate.getFullYear()}年{viewDate.getMonth() + 1}月分だけを確認できます。
              </p>
            </div>
            <button
              onClick={() => setShowCorrectionRequests(prev => !prev)}
              className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-slate-700"
            >
              {showCorrectionRequests ? '閉じる' : '見る'}
            </button>
          </div>
        </section>

        {showCorrectionRequests && (
          <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
                  <Send size={18} className="text-amber-500" /> {viewDate.getFullYear()}年{viewDate.getMonth() + 1}月の申請
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-400">自分が送った申請の承認状況を確認できます。</p>
              </div>
              <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">{correctionRequests.length}件</span>
            </div>
            {correctionRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs font-black text-slate-400">
                この月の打刻修正依頼はありません
              </div>
            ) : (
              <div className="space-y-3">
                {correctionRequests.map(req => {
                const statusLabel = req.status === 'approved'
                  ? '承認済み'
                  : req.status === 'rejected'
                  ? '却下'
                  : req.status === 'superseded'
                  ? '再申請に更新済み'
                  : '承認待ち';
                const statusClass = req.status === 'approved'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                  : req.status === 'rejected'
                  ? 'bg-rose-50 text-rose-700 ring-rose-100'
                  : req.status === 'superseded'
                  ? 'bg-slate-100 text-slate-500 ring-slate-200'
                  : 'bg-amber-50 text-amber-700 ring-amber-100';
                return (
                  <div key={req.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-800">
                          {req.request_type === 'missing_clock' || !req.work_record_id ? '打刻忘れ申請' : '打刻修正依頼'}
                        </p>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {req.target_date || '日付未設定'} / 申請: {formatDateTimeLabel(req.created_at)}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black ring-1 ${statusClass}`}>{statusLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[10px] font-black text-slate-400">申請出勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{formatDateTimeLabel(req.requested_start_time)}</p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[10px] font-black text-slate-400">申請退勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{formatDateTimeLabel(req.requested_end_time)}</p>
                      </div>
                    </div>
                    {req.reason && <p className="mt-3 text-xs font-bold leading-relaxed text-slate-600">{req.reason}</p>}
                    {req.review_note && <p className="mt-2 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{req.review_note}</p>}
                    <button
                      type="button"
                      onClick={() => reopenCorrectionRequest(req)}
                      className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-50"
                    >
                      <Send size={14} /> 内容を変更して再申請
                    </button>
                  </div>
                );
                })}
              </div>
            )}
          </section>
        )}

        {/* 月次サマリー */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm sm:rounded-full sm:px-4">
            <button onClick={() => changeMonth(-1)} className="grid h-11 w-11 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"><ChevronLeft size={22}/></button>
            <h2 className="flex items-center gap-2 text-base font-black text-gray-700 sm:text-lg"><Calendar size={18} className="mb-0.5 text-blue-500"/> {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月</h2>
            <button onClick={() => changeMonth(1)} className="grid h-11 w-11 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"><ChevronRight size={22}/></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-h-[92px] flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Hours</span>
              <div className="text-xl font-black text-gray-800">{monthlySummary.hours}<span className="text-xs font-bold text-gray-400 ml-0.5">時間</span>{monthlySummary.minutes > 0 && <span className="ml-1 text-lg">{monthlySummary.minutes}<span className="text-xs font-bold text-gray-400">分</span></span>}</div>
            </div>
            <div className="flex min-h-[92px] flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Cost</span>
              <div className="text-xl font-black text-gray-800 flex items-baseline"><span className="text-sm text-gray-400 mr-1">¥</span>{monthlySummary.cost.toLocaleString()}</div>
            </div>
          </div>
          <button
            onClick={openMissingCorrectionModal}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-700 shadow-sm transition-all hover:bg-amber-100 active:scale-[0.99]"
          >
            <Send size={16} /> 打刻を忘れた日の申請をする
          </button>
        </div>

        {/* 履歴リスト */}
        <div className="space-y-4 pb-24">
          {history.length === 0 ? <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-gray-100"><Clock size={40} className="mx-auto text-gray-200 mb-2"/><p className="text-gray-400 font-bold text-sm">この月の履歴はありません</p></div> : history.map((rec) => {
             const duration = rec.end_time ? calcDurationMinutes(rec.start_time, rec.end_time) : 0;
             if(currentSession && currentSession.id === rec.id) return null;
             const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
             const recAttendanceKind = getRecordAttendanceKind(rec);

             return (
              <div key={rec.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md sm:p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex min-w-[3.5rem] shrink-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="text-[10px] font-black text-blue-500">{dayLabel(rec.date)}曜日</span>
                      <span className="text-xl font-black text-gray-700">{dateLabel(rec.date)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 font-mono text-lg font-black text-gray-800">{new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}<ArrowLeft size={12} className="rotate-180 text-gray-300"/>{rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-500">{formatDuration(duration)}</span>
                        <span className={`rounded px-2 py-1 text-[10px] font-black ${recAttendanceKind === 'breakthrough' ? 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-100' : 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'}`}>
                          {recAttendanceKind === 'breakthrough' ? '突破ゼミ勤怠' : '通常勤怠'}
                        </span>
                        {rec.status === 'approved' ? <span className="flex items-center gap-0.5 text-[10px] font-bold text-green-600"><CheckCircle size={10}/> 承認済</span> : <span className="flex items-center gap-0.5 text-[10px] font-bold text-orange-400"><AlertCircle size={10}/> 承認待</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {displaySegments?.length > 0 ? (
                  <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100 mb-4">
                    {displaySegments.map((seg: WorkSegment, i: number) => (
                      <div key={i} className={`flex items-center px-3 py-2 text-xs border-b border-gray-100 last:border-0 ${segmentToneClass(seg.type, 'row')}`}>
                        <div className="w-20 font-mono font-bold text-gray-600 shrink-0">{seg.start} - {seg.end}</div>
                        <div className={`px-2 py-0.5 rounded font-bold mr-3 shrink-0 text-[10px] ${segmentToneClass(seg.type, 'chip')}`}>
                          {segmentTypeLabel(seg.type, true)}
                        </div>
                        <div className="truncate text-gray-600 font-medium">{seg.note}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="mb-4 text-xs text-amber-600 font-bold flex items-center gap-1 bg-amber-50 p-2 rounded-lg border border-amber-100"><LayoutTemplate size={14}/> 業務詳細が未入力です</div>}

                {rec.transportation?.length > 0 && <div className="mb-4 pt-2 border-t border-dashed border-gray-100 flex items-center justify-between text-xs text-gray-500 px-1"><span className="flex items-center gap-1 font-bold"><Train size={12}/> 交通費あり</span><span className="font-mono font-bold">¥{calcTotalCost(rec.transportation).toLocaleString()}</span></div>}
                {rec.end_time && rec.status !== 'approved' ? (
                  <button onClick={() => openEditModal(rec)} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gray-50 py-3 text-xs font-bold text-gray-600 transition-all hover:bg-blue-50 hover:text-blue-600"><Edit3 size={14}/> {displaySegments?.length > 0 ? '詳細を修正' : '詳細・交通費を入力'}</button>
                ) : !rec.end_time && rec.status !== 'approved' ? (
                  <button onClick={() => openCorrectionForRecord(rec)} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-50 py-3 text-xs font-bold text-amber-700 transition-all hover:bg-amber-100"><Send size={14}/> 退勤打刻の修正依頼</button>
                ) : rec.end_time && (
                  <div className="w-full rounded-xl bg-emerald-50 px-4 py-3 text-center text-xs font-black text-emerald-700">
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
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center z-[9999] p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl h-[94dvh] sm:h-[90vh] rounded-t-[28px] sm:rounded-[32px] shadow-2xl flex flex-col overflow-hidden">

            {/* モーダルヘッダー */}
            <div className="bg-white p-4 sm:p-5 border-b border-gray-100 flex justify-between items-start gap-3 shrink-0">
              <div className="min-w-0"><h3 className="font-black text-gray-800 text-base sm:text-lg flex items-center gap-2"><LayoutTemplate size={20} className="text-blue-600 shrink-0"/> 業務詳細修正</h3><p className="text-xs text-gray-400 font-bold mt-0.5">{editingRecord.date}（{dayLabel(editingRecord.date)}）</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={openCorrectionModal} className="min-h-[44px] rounded-xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100">打刻修正依頼</button>
                <button onClick={() => setEditingRecord(null)} className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"><X size={20} className="text-gray-600"/></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 bg-gray-50 space-y-5 sm:space-y-6 custom-scrollbar">
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-[10px] font-black text-blue-500">実打刻</p>
                  <p className="mt-1 text-lg font-black text-slate-800">{timeLabel(editingRecord.start_time)} - {timeLabel(editingRecord.end_time)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-[10px] font-black text-emerald-600">入力可能範囲</p>
                  <p className="mt-1 text-lg font-black text-slate-800">{roundedWorkRange(editingRecord).start} - {roundedWorkRange(editingRecord).end}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-[10px] font-black text-amber-600">確認ポイント</p>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">打刻時間を見ながら、業務内訳を5分単位で入力してください。</p>
                </div>
              </section>

              {/* ビジュアルタイムライン */}
              <section>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 px-1 gap-2">
                  <h4 className="text-xs font-bold text-gray-500">1日の流れ</h4>
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="flex items-center gap-1 text-blue-600"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>授業</span>
                    <span className="flex items-center gap-1 text-green-600"><span className="w-2 h-2 bg-green-500 rounded-full"></span>サポート</span>
                    <span className="flex items-center gap-1 text-orange-600"><span className="w-2 h-2 bg-orange-500 rounded-full"></span>事務</span>
                    <span className="flex items-center gap-1 text-fuchsia-600"><span className="w-2 h-2 bg-fuchsia-500 rounded-full"></span>突破授業</span>
                    <span className="flex items-center gap-1 text-rose-600"><span className="w-2 h-2 bg-rose-500 rounded-full"></span>突破事務</span>
                    <span className="flex items-center gap-1 text-violet-600"><span className="w-2 h-2 bg-violet-500 rounded-full"></span>面接</span>
                    <span className="flex items-center gap-1 text-cyan-600"><span className="w-2 h-2 bg-cyan-500 rounded-full"></span>成績</span>
                    <span className="flex items-center gap-1 text-gray-400"><span className="w-2 h-2 bg-slate-400 rounded-full"></span>休憩</span>
                  </div>
                </div>
                <TimelineVisual record={editingRecord} currentSegments={segments} />
              </section>

              {/* 編集テーブル */}
              <section>
                <div className="flex flex-col gap-2 mb-3 px-1 text-[10px] text-gray-600 font-bold bg-gray-100 p-3 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-1"><AlertCircle size={12} className="shrink-0 text-gray-500"/> 始まりと終わりの隙間は自動で「休憩」になり、空白時間を埋めます（出勤直後は不可）。</div>
                  <div className="flex items-center gap-1 text-red-500"><AlertCircle size={12} className="shrink-0"/> ※勤務時間が6時間を超える場合は45分以上、8時間を超える場合は1時間以上の休憩が必要です。</div>
                </div>

                <div className="space-y-3 md:hidden">
                  {segments.map((seg, i) => (
                    <div key={i} className={`rounded-2xl border p-4 shadow-sm ${segmentToneClass(seg.type, 'row')}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-black text-gray-500">業務 {i + 1}</span>
                        <button onClick={() => removeSegment(i)} className="flex min-h-[40px] items-center gap-1 rounded-xl bg-white px-3 text-xs font-black text-red-500 shadow-sm">
                          <Trash2 size={14}/> 削除
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="mb-1 block text-[10px] font-black text-gray-500">開始</span>
                          <input type="time" className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-base font-black outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} />
                        </label>
                        <label>
                          <span className="mb-1 block text-[10px] font-black text-gray-500">終了</span>
                          <input type="time" className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-base font-black outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} />
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[10px] font-black text-gray-500">種別</span>
                        <select
                          className={`min-h-[48px] w-full rounded-xl border px-3 text-sm font-black outline-none ${segmentGroup(seg.type) === 'breakthrough' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-blue-200 bg-white text-blue-700'}`}
                          value={segmentGroup(seg.type)}
                          onChange={(e) => updateSegmentGroup(i, e.target.value as SegmentGroup)}
                        >
                          <option value="normal">通常</option>
                          <option value="breakthrough">突破ゼミ</option>
                        </select>
                      </label>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[10px] font-black text-gray-500">区分</span>
                        <select
                          className={`min-h-[48px] w-full rounded-xl border px-3 text-sm font-black outline-none ${segmentToneClass(seg.type, 'select')}`}
                          value={seg.type}
                          onChange={(e) => updateSegment(i, 'type', e.target.value as any)}
                        >
                          {segmentOptionsForGroup(segmentGroup(seg.type)).map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[10px] font-black text-gray-500">詳細</span>
                        <input type="text" className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="hidden bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden overflow-x-auto md:block">
                  <table className="w-full text-sm border-collapse min-w-[500px] sm:min-w-0">
                    <thead className="bg-gray-100 text-gray-500 text-xs font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-2 text-left w-16">開始</th>
                        <th className="px-2 py-2 text-left w-16">終了</th>
                        <th className="px-2 py-2 text-left w-24">種別</th>
                        <th className="px-2 py-2 text-left w-32">区分</th>
                        <th className="px-2 py-2 text-left hidden sm:table-cell">詳細</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {segments.map((seg, i) => (
                        <tr key={i} className={`transition-colors ${segmentToneClass(seg.type, 'row')}`}>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} /></td>
                          <td className="p-2"><input type="time" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
                          <td className="p-2">
                            <div className="flex flex-col sm:flex-row gap-1">
                              <select
                                className={`w-full text-xs font-bold p-1 rounded border outline-none ${segmentGroup(seg.type) === 'breakthrough' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-blue-200 bg-white text-blue-700'}`}
                                value={segmentGroup(seg.type)}
                                onChange={(e) => updateSegmentGroup(i, e.target.value as SegmentGroup)}
                              >
                                <option value="normal">通常</option>
                                <option value="breakthrough">突破ゼミ</option>
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
                                {segmentOptionsForGroup(segmentGroup(seg.type)).map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <input type="text" className="sm:hidden w-full bg-transparent border-b border-gray-300 text-xs p-1 mt-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                            </div>
                          </td>
                          <td className="p-2 hidden sm:table-cell"><input type="text" className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none text-xs p-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} /></td>
                          <td className="p-2 text-center w-10 whitespace-nowrap"><button onClick={() => removeSegment(i)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors shrink-0"><Trash2 size={16}/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-[10px] text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-1 font-bold"><Coffee size={12} className="shrink-0"/> 入力のない時間は自動的に「休憩」となります</span>
                  <button onClick={() => addSegment('office')} className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-blue-50 px-4 text-xs font-black text-blue-600 hover:bg-blue-100"><Plus size={14}/> 行を追加</button>
                </div>
              </section>

              {/* 交通費セクション */}
              <section className="pt-4 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-3 gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                      <Train size={16}/> 交通費申請
                    </h4>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">購入済み定期券を登録している場合は、自動入力時に定期区間を控除します。</p>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <button onClick={handleCopyLastTransport} className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-blue-50 px-3 text-[10px] font-bold text-blue-600 hover:bg-blue-100 sm:text-xs">
                      <Copy size={12}/> 前回をコピー
                    </button>
                    <button onClick={addExpense} className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-green-100 px-3 text-[10px] font-bold text-green-700 hover:bg-green-200 sm:text-xs">
                      <Plus size={12}/> 追加
                    </button>
                  </div>
                </div>
                <div className="mb-3">
                  <TeacherCommuterPassPanel />
                </div>
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="relative overflow-visible rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <button onClick={() => removeExpense(i)} className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-300 shadow-sm ring-1 ring-gray-100 hover:text-red-500"><X size={14}/></button>
                      <div className="flex flex-col gap-3">
                        <div className="flex w-full flex-col gap-2 pr-10">
                          <div className="grid gap-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <select
                                className="min-h-[44px] w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-bold text-gray-700 outline-none focus:border-green-400"
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
                              <ChevronRight size={14} className="hidden self-center justify-self-center text-gray-300 md:block"/>
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
                              className="flex min-h-[34px] items-center gap-1.5 rounded-full bg-emerald-100 px-3 text-[11px] font-black text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              {fareLookupIndex === i ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                              運賃を自動入力
                            </button>
                            {exp.fare_source ? (
                              <span className="text-[10px] font-bold text-emerald-600">
                                取得元: {exp.fare_source}{exp.commuter_pass_applied ? ' / 定期控除済み' : ''}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400">取得できない場合は金額を手入力してください</span>
                            )}
                          </div>
                        </div>
                        <div className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[8rem_minmax(10rem,14rem)] sm:items-center sm:justify-end">
                            <select
                              value={exp.trip_type || 'round_trip'}
                              onChange={(e) => updateTripType(i, e.target.value as 'one_way' | 'round_trip')}
                              className="min-h-[40px] w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-black text-gray-700 outline-none focus:border-green-400"
                            >
                              <option value="one_way">片道</option>
                              <option value="round_trip">往復</option>
                            </select>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">¥</span>
                              <input type="number" className="min-h-[44px] w-full rounded-lg border border-gray-100 bg-white pl-7 pr-3 text-right font-mono text-lg font-black text-gray-800 outline-none placeholder:text-gray-200 focus:border-green-400" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                            </div>
	                      </div>
	                    </div>
                    </div>
	                  ))}
                </div>
              </section>
              <div className="h-10"></div>
            </div>

            {/* 保存ボタンエリア */}
            <div className="bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10">
              <div className="flex justify-between items-center mb-2 px-2 text-xs font-bold text-gray-500">
                <span>合計勤務時間 (休憩除く)</span>
                <span className="text-gray-800 text-sm">
                  {formatDuration(
                    calcSegmentTotal(segments, 'lesson') +
                    calcSegmentTotal(segments, 'breakthrough') +
                    calcSegmentTotal(segments, 'breakthrough_lesson') +
                    calcSegmentTotal(segments, 'breakthrough_office') +
                    calcSegmentTotal(segments, 'support') +
                    calcSegmentTotal(segments, 'office') +
                    calcSegmentTotal(segments, 'interview') +
                    calcSegmentTotal(segments, 'grading')
                  )}
                </span>
              </div>
              <button onClick={saveData} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 text-lg"><Save size={20}/> 保存して完了</button>
            </div>
          </div>
        </div>
      )}

      {(correctionTarget || editingRecord) && correctionModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
            <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-500">Time Correction</p>
                  <h3 className="mt-1 text-xl font-black text-slate-900">打刻修正依頼</h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">{(correctionTarget || editingRecord).date} の出退勤時刻を管理者へ申請します</p>
                </div>
                <button onClick={() => { setCorrectionModalOpen(false); setCorrectionTarget(null); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black text-slate-400">現在の出勤</p>
                  <p className="mt-1 text-sm font-black text-slate-800">{formatDateTimeLabel((correctionTarget || editingRecord).start_time)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black text-slate-400">現在の退勤</p>
                  <p className="mt-1 text-sm font-black text-slate-800">{formatDateTimeLabel((correctionTarget || editingRecord).end_time)}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs font-black text-slate-600">修正後の出勤時刻</span>
                  <input
                    type="datetime-local"
                    value={correctionForm.requested_start_time}
                    onChange={e => setCorrectionForm(prev => ({ ...prev, requested_start_time: e.target.value }))}
                    className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black text-slate-600">修正後の退勤時刻</span>
                  <input
                    type="datetime-local"
                    value={correctionForm.requested_end_time}
                    onChange={e => setCorrectionForm(prev => ({ ...prev, requested_end_time: e.target.value }))}
                    className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
              </div>

              <label>
                <span className="mb-2 block text-xs font-black text-slate-600">修正理由</span>
                <textarea
                  value={correctionForm.reason}
                  onChange={e => setCorrectionForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="例: 退勤ボタンを押し忘れたため、22:10退勤へ修正をお願いします。"
                  className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-800">
                送信後は管理者の承認が必要です。承認されるまで、元の打刻時間は変更されません。
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:p-5">
              <button onClick={() => { setCorrectionModalOpen(false); setCorrectionTarget(null); }} className="min-h-[48px] rounded-2xl px-5 py-3 text-sm font-black text-slate-500 hover:bg-slate-200">キャンセル</button>
              <button onClick={requestTimeCorrection} disabled={correctionSending} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-amber-100 hover:bg-amber-600 disabled:opacity-60">
                {correctionSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 依頼を送信
              </button>
            </div>
          </div>
        </div>
      )}

      {missingCorrectionOpen && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
            <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-500">Missing Clock</p>
                  <h3 className="mt-1 text-xl font-black text-slate-900">打刻忘れ申請</h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">打刻をしていない日も、任意の日付を選んで管理者へ申請できます。</p>
                </div>
                <button onClick={() => setMissingCorrectionOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
              <label>
                <span className="mb-2 block text-xs font-black text-slate-600">申請する日付</span>
                <input
                  type="date"
                  value={missingCorrectionForm.target_date}
                  onChange={e => updateMissingTargetDate(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs font-black text-slate-600">申請する出勤時刻</span>
                  <input
                    type="datetime-local"
                    value={missingCorrectionForm.requested_start_time}
                    onChange={e => setMissingCorrectionForm(prev => ({ ...prev, requested_start_time: e.target.value }))}
                    className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black text-slate-600">申請する退勤時刻</span>
                  <input
                    type="datetime-local"
                    value={missingCorrectionForm.requested_end_time}
                    onChange={e => setMissingCorrectionForm(prev => ({ ...prev, requested_end_time: e.target.value }))}
                    className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  />
                </label>
              </div>

              <label>
                <span className="mb-2 block text-xs font-black text-slate-600">申請理由</span>
                <textarea
                  value={missingCorrectionForm.reason}
                  onChange={e => setMissingCorrectionForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="例: 出勤・退勤の打刻を忘れたため、勤務実績の作成をお願いします。"
                  className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-800">
                承認されると、指定した日付・時刻で勤務記録が新規作成されます。勤務詳細と交通費は、作成後に通常の勤務記録から入力できます。
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:p-5">
              <button onClick={() => setMissingCorrectionOpen(false)} className="min-h-[48px] rounded-2xl px-5 py-3 text-sm font-black text-slate-500 hover:bg-slate-200">キャンセル</button>
              <button onClick={requestMissingClockCorrection} disabled={correctionSending} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-amber-100 hover:bg-amber-600 disabled:opacity-60">
                {correctionSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 申請を送信
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
