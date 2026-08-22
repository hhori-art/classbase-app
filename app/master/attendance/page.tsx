'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, deleteDoc, limit, writeBatch, addDoc } from 'firebase/firestore';
import {
  Briefcase, ArrowLeft, CheckCircle, Edit, Trash2, Search, Filter, Save, X, Plus, Train, Download,
  Loader2, Clock, Layout, Copy, AlertCircle, ChevronRight, Calendar, User, DollarSign, CheckSquare, FileText, Coffee, BookOpen
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { TRANSPORT_TYPE_OPTIONS } from '@/lib/transport-fares';
import TransportLineSelect from '@/app/components/TransportLineSelect';
import TransportStationSearchInput from '@/app/components/TransportStationSearchInput';
import { isSemiDedicatedProfile } from '@/lib/employment-category';

// 型定義
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
    lesson: {
      chip: 'bg-blue-50 border-blue-100 text-blue-800',
      row: 'bg-blue-50/30',
      select: 'text-blue-600 border-blue-200 bg-blue-50',
      bar: 'bg-blue-500',
    },
    support: {
      chip: 'bg-green-50 border-green-100 text-green-800',
      row: 'bg-green-50/30',
      select: 'text-green-600 border-green-200 bg-green-50',
      bar: 'bg-green-500',
    },
    office: {
      chip: 'bg-orange-50 border-orange-100 text-orange-800',
      row: 'bg-orange-50/30',
      select: 'text-orange-600 border-orange-200 bg-orange-50',
      bar: 'bg-orange-500',
    },
    interview: {
      chip: 'bg-violet-50 border-violet-100 text-violet-800',
      row: 'bg-violet-50/30',
      select: 'text-violet-600 border-violet-200 bg-violet-50',
      bar: 'bg-violet-500',
    },
    grading: {
      chip: 'bg-cyan-50 border-cyan-100 text-cyan-800',
      row: 'bg-cyan-50/30',
      select: 'text-cyan-600 border-cyan-200 bg-cyan-50',
      bar: 'bg-cyan-500',
    },
    other: {
      chip: 'bg-slate-50 border-slate-200 text-slate-800',
      row: 'bg-slate-50/50',
      select: 'text-slate-600 border-slate-200 bg-slate-50',
      bar: 'bg-slate-600',
    },
    breakthrough: {
      chip: 'bg-fuchsia-50 border-fuchsia-100 text-fuchsia-800',
      row: 'bg-fuchsia-50/30',
      select: 'text-fuchsia-600 border-fuchsia-200 bg-fuchsia-50',
      bar: 'bg-fuchsia-500',
    },
    breakthrough_lesson: {
      chip: 'bg-fuchsia-50 border-fuchsia-100 text-fuchsia-800',
      row: 'bg-fuchsia-50/30',
      select: 'text-fuchsia-600 border-fuchsia-200 bg-fuchsia-50',
      bar: 'bg-fuchsia-500',
    },
    breakthrough_office: {
      chip: 'bg-rose-50 border-rose-100 text-rose-800',
      row: 'bg-rose-50/30',
      select: 'text-rose-600 border-rose-200 bg-rose-50',
      bar: 'bg-rose-500',
    },
    break: {
      chip: 'bg-gray-50 border-gray-200 text-gray-500',
      row: 'bg-gray-100',
      select: 'text-gray-500 border-gray-300 bg-white',
      bar: 'bg-slate-400',
    },
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

const isBreakthroughLessonSegment = (seg: WorkSegment) =>
  seg.type === 'breakthrough' || seg.type === 'breakthrough_lesson';

const isBreakthroughOfficeSegment = (seg: WorkSegment) =>
  seg.type === 'breakthrough_office';

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

interface UserInfo {
  name: string;
  school_code: string;
  school_name: string;
  staff_id: string;
}

interface CorrectionRequest {
  id: string;
  work_record_id?: string | null;
  request_type?: string;
  teacher_id: string;
  teacher_name?: string;
  target_date?: string | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  reason?: string;
  status: string;
  created_at?: any;
}

type AttendanceDiagnostic = {
  type: string;
  date: string;
  teacher_id: string;
  teacher_name: string;
  work_record_id?: string;
  shift_assignment_id?: string;
  warnings: Array<{ code: string; label: string; severity: 'info' | 'warning' | 'danger'; detail: string }>;
};

export default function MasterAttendancePage() {
  const { user: authUser } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [usersMap, setUsersMap] = useState<{[key:string]: UserInfo}>({});
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterName, setFilterName] = useState('');
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [isCsvGenerating, setIsCsvGenerating] = useState(false);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequest[]>([]);
  const [processingCorrectionId, setProcessingCorrectionId] = useState('');
  const [attendanceDiagnostics, setAttendanceDiagnostics] = useState<AttendanceDiagnostic[]>([]);

  const [filterDate, setFilterDate] = useState('');
  const [newRecordSearch, setNewRecordSearch] = useState('');

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
  const [fareLookupIndex, setFareLookupIndex] = useState<number | null>(null);
  const [mainTime, setMainTime] = useState({ start: '', end: '' });

  // 一括操作用のステート
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // 新規作成用のステート
  const [isNewRecordModalOpen, setIsNewRecordModalOpen] = useState(false);
  const [newRecordData, setNewRecordData] = useState({ teacher_id: '', date: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchCorrectionRequests();
    fetchAttendanceDiagnostics();
    setSelectedRecordIds(new Set()); // 月が切り替わったら選択をリセット
  }, [filterMonth, authUser]);

  const fetchUsers = async () => {
    try {
      // 講師アカウントと勤怠アプリ利用者を勤怠登録の対象にする
      const q = query(collection(db, 'users'), where('role', 'in', ['teacher', 'attendance_admin']));
      const snap = await getDocs(q);
      const map: {[key:string]: UserInfo} = {};

      snap.forEach(doc => {
        const d = doc.data();
        if (!isSemiDedicatedProfile(d)) return;
        map[doc.id] = {
          name: d.student_name || d.name || d.displayName || '名称未設定',
          school_code: d.school_code || d.schoolCode || d.school_id || d.school_number || '999',
          school_name: d.school_name || d.schoolName || d.school || d.classroom || d.affiliation || d.department || '',
          staff_id: d.lifetime_id || d.staff_id || d.staffId || d.employee_id || d.employeeId || d.teacher_code || '9999'
        };
      });
      setUsersMap(map);
    } catch (e) { console.error("Users fetch error:", e); }
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const [y, m] = filterMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const start = `${filterMonth}-01`;
      const end = `${filterMonth}-${lastDay}`;

      const q = query(
        collection(db, 'work_records'),
        where('date', '>=', start),
        where('date', '<=', end),
        orderBy('date', 'desc'),
        orderBy('start_time', 'desc')
      );
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Fetch fallback:", e);
      const q2 = query(collection(db, 'work_records'), orderBy('created_at', 'desc'));
      const snap2 = await getDocs(q2);
      setRecords(snap2.docs.map(d => ({ id: d.id, ...d.data() })).filter((r: any) => r.date && r.date.startsWith(filterMonth)));
    } finally {
      setLoading(false);
    }
  };

  const fetchCorrectionRequests = async () => {
    try {
      const q = query(collection(db, 'attendance_correction_requests'), orderBy('created_at', 'desc'), limit(30));
      const snap = await getDocs(q);
      setCorrectionRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as CorrectionRequest)));
    } catch (e) {
      console.warn('Correction requests fetch error:', e);
      setCorrectionRequests([]);
    }
  };

  const fetchAttendanceDiagnostics = async () => {
    try {
      const token = await authUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`/api/attendance-diagnostics?scope=admin&month=${filterMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setAttendanceDiagnostics(data.diagnostics || []);
    } catch (e) {
      console.warn('Attendance diagnostics fetch error:', e);
      setAttendanceDiagnostics([]);
    }
  };

  const handleCorrectionReview = async (requestId: string, status: 'approved' | 'rejected') => {
    const label = status === 'approved' ? '承認' : '却下';
    if (!confirm(`この打刻修正依頼を${label}しますか？`)) return;

    setProcessingCorrectionId(requestId);
    try {
      const token = await authUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'review', request_id: requestId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'work_record_id is missing on correction request'
          ? '対象の勤務記録が見つかりません。この依頼は古い形式か壊れているため、勤務記録から再申請してください。'
          : data.error === 'target_date is missing on correction request'
          ? '申請日が記録されていないため反映できません。却下して再申請してください。'
          : data.error || 'failed';
        throw new Error(message);
      }
      await fetchCorrectionRequests();
      await fetchRecords();
      await fetchAttendanceDiagnostics();
    } catch (e: any) {
      alert(`修正依頼の${label}に失敗しました: ${e.message || e}`);
    } finally {
      setProcessingCorrectionId('');
    }
  };

  // --- 一括操作関数 ---
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRecordIds(new Set(filteredRecords.map(r => r.id)));
    } else {
      setSelectedRecordIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedRecordIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedRecordIds(next);
  };

  const handleBulkApprove = async () => {
    if (selectedRecordIds.size === 0) return;
    if (!confirm(`${selectedRecordIds.size}件の記録を一括承認しますか？`)) return;

    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedRecordIds.forEach(id => {
        batch.update(doc(db, 'work_records', id), { status: 'approved' });
      });
      await batch.commit();
      setRecords(prev => prev.map(r => selectedRecordIds.has(r.id) ? { ...r, status: 'approved' } : r));
      setSelectedRecordIds(new Set());
    } catch (e: any) {
      alert('承認エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRecordIds.size === 0) return;
    if (!confirm(`${selectedRecordIds.size}件の記録を本当に削除しますか？\nこの操作は取り消せません。`)) return;

    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedRecordIds.forEach(id => {
        batch.delete(doc(db, 'work_records', id));
      });
      await batch.commit();
      setRecords(prev => prev.filter(r => !selectedRecordIds.has(r.id)));
      setSelectedRecordIds(new Set());
    } catch (e: any) {
      alert('削除エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // --- 単体操作関数 ---
  const handleApprove = async (id: string) => {
    if (!confirm('承認しますか？')) return;
    try {
      await updateDoc(doc(db, 'work_records', id), { status: 'approved' });
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    } catch (e) { alert('承認エラー'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？この操作は取り消せません。')) return;
    try {
      await deleteDoc(doc(db, 'work_records', id));
      setRecords(prev => prev.filter(r => r.id !== id));
      setSelectedRecordIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) { alert('削除エラー'); }
  };

  const openEditor = (rec: any) => {
    setEditingRecord(rec);
    const toLocalISO = (iso: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setMainTime({
      start: toLocalISO(rec.start_time),
      end: toLocalISO(rec.end_time)
    });

    const sortedSegments = normalizeWorkSegments(rec.work_segments || []).sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
    setSegments(sortedSegments);
    setExpenses(normalizeTransportExpenses(rec.transportation || []));
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index] };

    if (field === 'type') {
      const prevType = current.type;
      current.type = value as WorkSegment['type'];
      if (prevType === 'break' && (current.note === '休憩' || current.note.includes('自動'))) current.note = '';
      if (value === 'break' && !current.note) current.note = '休憩';
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
    if (segments.length > 0) nextStart = segments[segments.length - 1].end;
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
      const token = await authUser?.getIdToken();
      const params = new URLSearchParams({
        transport_type: exp.transport_type,
        from: exp.from,
        to: exp.to,
        provider: 'ekispert',
      });
      if (editingRecord?.teacher_id) params.set('teacher_id', editingRecord.teacher_id);
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
      const q = query(
        collection(db, 'work_records'),
        where('teacher_id', '==', editingRecord.teacher_id),
        orderBy('created_at', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      const lastRecord = snap.docs
        .map(d => d.data())
        .find((d: any) => d.transportation && d.transportation.length > 0 && d.id !== editingRecord.id);

      if (lastRecord && confirm(`この講師の ${lastRecord.date} の交通費情報をコピーしますか？`)) {
        setExpenses(normalizeTransportExpenses(lastRecord.transportation));
      } else if(!lastRecord) { alert('過去の交通費データが見つかりませんでした'); }
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

  const saveAll = async () => {
    if (!editingRecord) return;
    try {
      const ref = doc(db, 'work_records', editingRecord.id);
      const newStartISO = mainTime.start ? new Date(mainTime.start).toISOString() : editingRecord.start_time;
      const newEndISO = mainTime.end ? new Date(mainTime.end).toISOString() : null;

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
              return alert(`【エラー】出勤時刻（打刻丸め後: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}）から最初の業務までに空白時間を作ることはできません。\n最初の業務の開始時刻を合わせるか、出退勤時刻を変更してください。`);
            }
            if (sortedSegments[0].type === 'break') {
              return alert('【エラー】出勤直後の最初の業務区分に「休憩」を登録することはできません。');
            }
          }
        }
      }

      const filledSegments = fillGaps(segments, newStartISO, newEndISO);

      // ★ 修正: 最後が休憩で終わることを禁止するバリデーション
      if (filledSegments.length > 0) {
        const lastSeg = filledSegments[filledSegments.length - 1];
        if (lastSeg.type === 'break') {
          return alert('【エラー】最後が「休憩」で終わることはできません。\n退勤時刻を前倒しするか、最後の業務の終了時刻と退勤時刻(丸め後)を一致させてください。');
        }
      }

      const formattedExpenses = formatTransportationForSave(expenses);
      const nextAttendanceKind: AttendanceKind = filledSegments.some(seg => isBreakthroughSegment(seg)) ? 'breakthrough' : 'normal';

      await updateDoc(ref, {
        start_time: newStartISO,
        end_time: newEndISO,
        attendance_kind: nextAttendanceKind,
        work_segments: filledSegments,
        transportation: formattedExpenses
      });

      setRecords(prev => prev.map(r => r.id === editingRecord.id ? {
        ...r, start_time: newStartISO, end_time: newEndISO, attendance_kind: nextAttendanceKind, work_segments: filledSegments, transportation: formattedExpenses
      } : r));
      fetchAttendanceDiagnostics();

      setEditingRecord(null);
      alert('保存しました。');
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // 新規勤務データ作成処理
  const handleCreateNewRecord = async () => {
    if (!newRecordData.teacher_id) return alert('先生を選択してください');
    if (!newRecordData.date) return alert('日付を選択してください');

    const userInfo = usersMap[newRecordData.teacher_id];
    if (!userInfo) return alert('ユーザー情報が見つかりません');

    setIsBulkProcessing(true);
    try {
      const duplicateSnap = await getDocs(query(
        collection(db, 'work_records'),
        where('teacher_id', '==', newRecordData.teacher_id),
        where('date', '==', newRecordData.date),
        limit(1)
      ));
      if (!duplicateSnap.empty) {
        alert('【エラー】この先生は指定日にすでに勤務記録があります。1日に同じ先生の勤怠は1件のみ作成できます。');
        return;
      }

      const newDocRef = await addDoc(collection(db, 'work_records'), {
        teacher_id: newRecordData.teacher_id,
        teacher_name: userInfo.name,
        date: newRecordData.date,
        start_time: `${newRecordData.date}T00:00:00+09:00`,
        end_time: `${newRecordData.date}T00:00:00+09:00`,
        status: 'pending',
        attendance_kind: 'normal',
        work_segments: [],
        transportation: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const newRecord = {
        id: newDocRef.id,
        teacher_id: newRecordData.teacher_id,
        teacher_name: userInfo.name,
        date: newRecordData.date,
        start_time: `${newRecordData.date}T00:00:00+09:00`,
        end_time: `${newRecordData.date}T00:00:00+09:00`,
        status: 'pending',
        attendance_kind: 'normal',
        work_segments: [],
        transportation: []
      };

      setRecords([newRecord, ...records]);
      setIsNewRecordModalOpen(false);
      openEditor(newRecord); // 作成後、既存の編集フローへ遷移
    } catch (e: any) {
      alert('作成エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // --- 計算関数 ---
  const calcDurationMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if(isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60));
  };

  const calcDurationStr = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + Number(item.cost), 0) : 0;

  const splitTimeBy22 = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return { before22: 0, after22: 0 };
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startM = start.getHours() * 60 + start.getMinutes();
    let endM = end.getHours() * 60 + end.getMinutes();
    if (endM < startM) endM += 24 * 60;
    const border = 22 * 60;

    let before22 = 0;
    let after22 = 0;

    if (endM <= border) {
      before22 = endM - startM;
    } else if (startM >= border) {
      after22 = endM - startM;
    } else {
      before22 = border - startM;
      after22 = endM - border;
    }
    return { before22, after22 };
  };

  const getAttendanceTypeFlags = (segments: WorkSegment[] = [], date = '') => {
    let hasLesson = false;
    let hasSupport = false;

    segments.forEach(seg => {
      if (!seg.start || !seg.end || !date) return;
      const startISO = `${date}T${seg.start}:00`;
      const endISO = `${date}T${seg.end}:00`;
      const { before22, after22 } = splitTimeBy22(startISO, endISO);
      if (before22 + after22 <= 0) return;
      if (seg.type === 'lesson') hasLesson = true;
      if (seg.type === 'support') hasSupport = true;
    });

    return {
      allowanceLesson: hasLesson ? '1' : '',
      allowanceSupport: !hasLesson && hasSupport ? '1' : '',
    };
  };

  const csvCell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, ' ')}"`;
  };

  const csvLine = (values: unknown[]) => values.map(csvCell).join(',');

  const downloadCsv = (filename: string, lines: string[]) => {
    const csvContent = "\uFEFF" + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const downloadExcelHtml = (filename: string, html: string) => {
    const blob = new Blob([`\uFEFF${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const segmentMinutes = (seg: WorkSegment) => {
    if (!seg.start || !seg.end) return 0;
    const [sh, sm] = seg.start.split(':').map(Number);
    const [eh, em] = seg.end.split(':').map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) end += 24 * 60;
    return Math.max(0, end - start);
  };

  const minutesToExcelTime = (minutes: number) => {
    const safeMinutes = Math.max(0, Math.round(minutes || 0));
    if (!safeMinutes) return '';
    const h = Math.floor(safeMinutes / 60);
    const m = safeMinutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const segmentKindForBreakthrough = (seg: WorkSegment) => {
    if (isBreakthroughLessonSegment(seg)) return 'lesson';
    if (isBreakthroughOfficeSegment(seg)) return 'office';
    return 'break';
  };

  const formatBreakthroughDate = (date: string) => {
    const d = new Date(`${date}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return date;
    const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}(${week})`;
  };

  const formatSegmentRange = (seg: WorkSegment) => seg.start && seg.end ? `${seg.start}～${seg.end}` : '';

  const handleBreakthroughSeminarExport = () => {
    if (!filterDate) {
      alert('突破ゼミ出勤簿は特定日で出力します。日付フィルターを選択してください。');
      return;
    }

    const dayRecords = filteredRecords
      .filter(record => record.date === filterDate)
      .filter(record => (record.work_segments || []).some((seg: WorkSegment) => isBreakthroughSegment(seg) && segmentMinutes(seg) > 0))
      .sort((a, b) => {
        const userA = usersMap[a.teacher_id] || { school_code: '999', staff_id: '9999', name: '' };
        const userB = usersMap[b.teacher_id] || { school_code: '999', staff_id: '9999', name: '' };
        if (userA.school_code !== userB.school_code) return userA.school_code.localeCompare(userB.school_code, undefined, { numeric: true });
        if (userA.staff_id !== userB.staff_id) return userA.staff_id.localeCompare(userB.staff_id, undefined, { numeric: true });
        return (userA.name || a.teacher_name || '').localeCompare(userB.name || b.teacher_name || '', 'ja', { numeric: true });
      });

    if (dayRecords.length === 0) {
      alert('指定日に「突破ゼミの授業」または「突破ゼミの事務」で登録された勤怠データがありません。');
      return;
    }

    const rows = dayRecords.map(record => {
      const userInfo = usersMap[record.teacher_id] || {
        name: record.teacher_name || '不明',
        school_code: '',
        school_name: '',
        staff_id: '',
      };

      let lessonMinutes = 0;
      let interviewMinutes = 0;
      let officeMinutes = 0;
      const detailSegments = (record.work_segments || [])
        .filter((seg: WorkSegment) => isBreakthroughSegment(seg) && segmentMinutes(seg) > 0);

      detailSegments.forEach((seg: WorkSegment) => {
        const kind = segmentKindForBreakthrough(seg);
        const minutes = segmentMinutes(seg);
        if (kind === 'lesson') lessonMinutes += minutes;
        if (kind === 'office') officeMinutes += minutes;
      });

      const details = detailSegments.slice(0, 2);
      const transportCost = calcTotalCost(record.transportation || []);
      const transportText = (record.transportation || [])
        .map((t: Transportation) => {
          const route = [t.transport_type, t.route_line].filter(Boolean).join(' ');
          const section = `${t.from || ''}～${t.to || ''}`.replace(/^～|～$/g, '');
          const trip = t.trip_type === 'one_way' ? '片道' : '往復';
          return [route, section ? `${section}（${trip}）` : ''].filter(Boolean).join(' ');
        })
        .filter(Boolean)
        .join(' / ');

      return {
        school: userInfo.school_name || userInfo.school_code || '',
        venue: userInfo.school_name || userInfo.school_code || '',
        staffId: userInfo.staff_id || '',
        name: userInfo.name || record.teacher_name || '不明',
        date: formatBreakthroughDate(record.date),
        lesson: minutesToExcelTime(lessonMinutes),
        interview: minutesToExcelTime(interviewMinutes),
        office: minutesToExcelTime(officeMinutes),
        time1: details[0] ? formatSegmentRange(details[0]) : '',
        content1: details[0]?.note || (details[0] ? segmentTypeLabel(details[0].type) : ''),
        time2: details[1] ? formatSegmentRange(details[1]) : '',
        content2: details[1]?.note || (details[1] ? segmentTypeLabel(details[1].type) : ''),
        transportCost: transportCost || '',
        transportText,
      };
    });

    const bodyRows = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.school)}</td>
        <td>${escapeHtml(row.venue)}</td>
        <td>${escapeHtml(row.staffId)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="time">${escapeHtml(row.lesson)}</td>
        <td class="time">${escapeHtml(row.interview)}</td>
        <td class="time">${escapeHtml(row.office)}</td>
        <td>${escapeHtml(row.time1)}</td>
        <td>${escapeHtml(row.content1)}</td>
        <td>${escapeHtml(row.time2)}</td>
        <td>${escapeHtml(row.content2)}</td>
        <td class="money">${escapeHtml(row.transportCost)}</td>
        <td>${escapeHtml(row.transportText)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: "Yu Gothic", "Meiryo", sans-serif; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #222; padding: 6px 8px; font-size: 11pt; vertical-align: middle; }
            .title { font-size: 18pt; font-weight: 700; border: none; text-align: left; }
            .note { border: none; font-size: 10pt; color: #333; }
            .head { background: #e5e7eb; font-weight: 700; text-align: center; }
            .subhead { background: #f3f4f6; font-weight: 700; text-align: center; }
            .time, .money { text-align: right; mso-number-format:"\\@"; }
          </style>
        </head>
        <body>
          <table>
            <tr><td class="title" colspan="14">2025年度 高校入試突破ゼミ出勤簿</td></tr>
            <tr><td class="note" colspan="14">出力日: ${escapeHtml(filterDate)} / Classbase準専任勤怠管理から出力</td></tr>
            <tr><td class="note" colspan="14">※勤怠の業務内訳で「突破ゼミの授業」「突破ゼミの事務」として登録された時間のみを出力しています。</td></tr>
            <tr>
              <th class="head" rowspan="2">実施日</th>
              <th class="head" rowspan="2">所属校</th>
              <th class="head" rowspan="2">突破ゼミ勤務会場</th>
              <th class="head" rowspan="2">職員番号</th>
              <th class="head" rowspan="2">氏名</th>
              <th class="head" rowspan="2">授業時間</th>
              <th class="head" rowspan="2">面接指導時間</th>
              <th class="head" rowspan="2">成績集約・事務時間</th>
              <th class="head" colspan="4">授業時間・面接指導時間・事務時間の申請内訳</th>
              <th class="head" rowspan="2">移動交通費</th>
              <th class="head" rowspan="2">移動交通費 申請内訳</th>
            </tr>
            <tr>
              <th class="subhead">時間①</th>
              <th class="subhead">業務内容①</th>
              <th class="subhead">時間②</th>
              <th class="subhead">業務内容②</th>
            </tr>
            ${bodyRows}
          </table>
        </body>
      </html>
    `;

    downloadExcelHtml(`突破ゼミ出勤簿_${filterDate}.xls`, html);
  };

  // --- フィルタリング ---
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const userInfo = usersMap[r.teacher_id];
      if (!userInfo) return false;
      const name = userInfo?.name || r.teacher_name || '';
      const nameMatch = name.includes(filterName);
      const statusMatch = showOnlyPending ? r.status !== 'approved' : true;
      const dateMatch = filterDate ? r.date === filterDate : true;

      return nameMatch && statusMatch && dateMatch;
    });
  }, [records, usersMap, filterName, showOnlyPending, filterDate]);

  // 日付ごとにグループ化
  const groupedRecords = useMemo(() => {
    const groups: { [date: string]: any[] } = {};
    filteredRecords.forEach(rec => {
      if (!groups[rec.date]) {
        groups[rec.date] = [];
      }
      groups[rec.date].push(rec);
    });
    // 日付の降順（新しい日付が上）でソート
    return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => ({
      date,
      records: groups[date]
    }));
  }, [filteredRecords]);

  // サマリー計算
  const summary = useMemo(() => {
    const scopedRecords = records.filter(record => Boolean(usersMap[record.teacher_id]));
    const pending = scopedRecords.filter(r => r.status !== 'approved').length;
    let totalLessonMinutes = 0;
    let totalOfficeMinutes = 0;

    scopedRecords.forEach(rec => {
      rec.work_segments?.forEach((seg: WorkSegment) => {
        if (!seg.start || !seg.end) return;
        const [sh, sm] = seg.start.split(':').map(Number);
        const [eh, em] = seg.end.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);

        if (seg.type === 'lesson') totalLessonMinutes += duration;
        else if (seg.type === 'office' || seg.type === 'support') totalOfficeMinutes += duration;
      });
    });

    return {
      pending,
      lessonTime: calcDurationStr(totalLessonMinutes),
      officeTime: calcDurationStr(totalOfficeMinutes)
    };
  }, [records, usersMap]);

  const pendingCorrectionRequests = useMemo(
    () => correctionRequests.filter(req => Boolean(usersMap[req.teacher_id]) && (req.status || 'pending') === 'pending'),
    [correctionRequests, usersMap]
  );

  const visibleAttendanceDiagnostics = useMemo(
    () => attendanceDiagnostics.filter(item => !item.teacher_id || Boolean(usersMap[item.teacher_id])),
    [attendanceDiagnostics, usersMap]
  );

  const formatCorrectionTime = (value?: string | null) => {
    if (!value) return '変更なし';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '変更なし';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getRecordById = (id: string) => records.find(record => record.id === id);

  // CSV一括出力
  const handleBulkDownload = async () => {
    if (filteredRecords.length === 0) return alert('出力するデータがありません');
    if (!confirm('表示中の全データを校舎・職員番号順にソートしてCSV出力しますか？')) return;

    setIsCsvGenerating(true);

    try {
      const sortedRecords = [...filteredRecords].sort((a, b) => {
        const userA = usersMap[a.teacher_id] || { school_code: '999', school_name: '', staff_id: '9999', name: '' };
        const userB = usersMap[b.teacher_id] || { school_code: '999', school_name: '', staff_id: '9999', name: '' };

        if (userA.school_code !== userB.school_code) {
          return userA.school_code.localeCompare(userB.school_code, undefined, { numeric: true });
        }
        if (userA.staff_id !== userB.staff_id) {
          return userA.staff_id.localeCompare(userB.staff_id, undefined, { numeric: true });
        }
        return a.date.localeCompare(b.date);
      });

      const groupedData: { [key: string]: any[] } = {};
      const teacherOrder: string[] = [];

      sortedRecords.forEach(rec => {
        const tid = rec.teacher_id;
        if (!groupedData[tid]) {
          groupedData[tid] = [];
          teacherOrder.push(tid);
        }
        groupedData[tid].push(rec);
      });

      const csvCell = (value: unknown) => {
        const text = value == null ? '' : String(value);
        return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, ' ')}"`;
      };

      const csvLine = (values: unknown[]) => values.map(csvCell).join(',');

      const formatCsvTime = (value?: string | null) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };

      const header = csvLine([
        '校舎番号', '職員番号', '氏名',
        '日付', '曜日',
        '出勤時刻', '退勤時刻', '休憩時間',
        '授業(開始)', '授業(終了)',
        '事務・研修(開始)', '事務・研修(終了)',
        'サポート(開始)', 'サポート(終了)',
        '授業時間(~22時)', '授業時間(22時~)',
        '事務・研修時間(~22時)', '事務・研修時間(22時~)',
        'サポート時間(~22時)', 'サポート時間(22時~)',
        '勤務形態(授業)', '勤務形態(サポート)',
        '交通費(区間)', '交通費(金額)'
      ]);

      const csvRows: string[] = [];

      const minToHm = (m: number) => {
        if (m <= 0) return '';
        const h = Math.floor(m / 60);
        const min = m % 60;
        return `${h}:${String(min).padStart(2, '0')}`;
      };

      teacherOrder.forEach(tid => {
        const teacherRecords = groupedData[tid];
        const userInfo = usersMap[tid] || { name: teacherRecords[0].teacher_name || '不明', school_code: '', school_name: '', staff_id: '' };

        teacherRecords.forEach(rec => {
          const dateObj = new Date(rec.date);
          const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];

          let lessonStart = '', lessonEnd = '';
          let officeStart = '', officeEnd = '';
          let supportStart = '', supportEnd = '';

          let lessonTimeNormal = 0, lessonTimeLate = 0;
          let officeTimeNormal = 0, officeTimeLate = 0;
          let supportTimeNormal = 0, supportTimeLate = 0;
          let breakTime = 0;

          rec.work_segments?.forEach((seg: WorkSegment) => {
            const startISO = `${rec.date}T${seg.start}:00`;
            const endISO = `${rec.date}T${seg.end}:00`;
            const { before22, after22 } = splitTimeBy22(startISO, endISO);

            if (seg.type === 'lesson') {
              if (!lessonStart || seg.start < lessonStart) lessonStart = seg.start;
              if (!lessonEnd || seg.end > lessonEnd) lessonEnd = seg.end;
              lessonTimeNormal += before22;
              lessonTimeLate += after22;
            } else if (seg.type === 'office') {
              if (!officeStart || seg.start < officeStart) officeStart = seg.start;
              if (!officeEnd || seg.end > officeEnd) officeEnd = seg.end;
              officeTimeNormal += before22;
              officeTimeLate += after22;
            } else if (seg.type === 'support') {
              if (!supportStart || seg.start < supportStart) supportStart = seg.start;
              if (!supportEnd || seg.end > supportEnd) supportEnd = seg.end;
              supportTimeNormal += before22;
              supportTimeLate += after22;
            } else if (seg.type === 'break') {
              breakTime += before22 + after22;
            }
          });

          const { allowanceLesson, allowanceSupport } = getAttendanceTypeFlags(rec.work_segments || [], rec.date);

          const transportText = rec.transportation?.map((t: any) => `${t.from}-${t.to}`).join(' / ') || '';
          const transportCost = calcTotalCost(rec.transportation);

          const startTimeStr = formatCsvTime(rec.start_time);
          const endTimeStr = formatCsvTime(rec.end_time);

          csvRows.push(csvLine([
            userInfo.school_code !== '999' ? userInfo.school_code : '',
            userInfo.staff_id !== '9999' ? userInfo.staff_id : '',
            userInfo.name,
            rec.date, dayOfWeek,
            startTimeStr, endTimeStr, minToHm(breakTime),
            lessonStart, lessonEnd,
            officeStart, officeEnd,
            supportStart, supportEnd,
            minToHm(lessonTimeNormal), minToHm(lessonTimeLate),
            minToHm(officeTimeNormal), minToHm(officeTimeLate),
            minToHm(supportTimeNormal), minToHm(supportTimeLate),
            allowanceLesson, allowanceSupport,
            transportText, transportCost
          ]));
        });
      });

      const csvContent = "\uFEFF" + [header, ...csvRows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `勤怠一覧_${filterMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (e) {
      console.error(e);
      alert('CSV生成に失敗しました');
    } finally {
      setIsCsvGenerating(false);
    }
	  };

  const handlePayrollSummaryDownload = async () => {
    if (filteredRecords.length === 0) return alert('出力するデータがありません');
    if (!confirm('表示中のデータを、指定の講師別・月合計形式でCSV出力しますか？')) return;

    setIsCsvGenerating(true);

    try {
      const groupedData: Record<string, any[]> = {};
      filteredRecords.forEach(rec => {
        const tid = rec.teacher_id || rec.teacher_name || 'unknown';
        if (!groupedData[tid]) groupedData[tid] = [];
        groupedData[tid].push(rec);
      });

      const teacherRows = Object.entries(groupedData)
        .map(([teacherId, teacherRecords]) => {
          const firstRecord = teacherRecords[0] || {};
          const userInfo = usersMap[teacherId] || {
            name: firstRecord.teacher_name || '不明',
            school_code: '',
            school_name: '',
            staff_id: '',
          };

          let lessonCount = 0;
          let supportCount = 0;
          let lessonTimeNormal = 0;
          let lessonTimeLate = 0;
          let officeTimeNormal = 0;
          let officeTimeLate = 0;
          let supportTimeNormal = 0;
          let supportTimeLate = 0;
          let transportCost = 0;

          teacherRecords.forEach(rec => {
            transportCost += calcTotalCost(rec.transportation);
            const { allowanceLesson, allowanceSupport } = getAttendanceTypeFlags(rec.work_segments || [], rec.date);
            if (allowanceLesson) lessonCount += 1;
            if (allowanceSupport) supportCount += 1;

            (rec.work_segments || []).forEach((seg: WorkSegment) => {
              if (!seg.start || !seg.end) return;
              const startISO = `${rec.date}T${seg.start}:00`;
              const endISO = `${rec.date}T${seg.end}:00`;
              const { before22, after22 } = splitTimeBy22(startISO, endISO);
              const minutes = before22 + after22;
              if (minutes <= 0) return;

              if (seg.type === 'lesson') {
                lessonTimeNormal += before22;
                lessonTimeLate += after22;
              } else if (seg.type === 'office') {
                officeTimeNormal += before22;
                officeTimeLate += after22;
              } else if (seg.type === 'support') {
                supportTimeNormal += before22;
                supportTimeLate += after22;
              }
            });
          });

          return {
            teacherId,
            schoolCode: userInfo.school_code !== '999' ? userInfo.school_code : '',
            schoolName: userInfo.school_name || (userInfo.school_code !== '999' ? userInfo.school_code : ''),
            staffId: userInfo.staff_id !== '9999' ? userInfo.staff_id : '',
            name: userInfo.name || firstRecord.teacher_name || '不明',
            lessonCount,
            supportCount,
            lessonTimeNormal,
            lessonTimeLate,
            officeTimeNormal,
            officeTimeLate,
            supportTimeNormal,
            supportTimeLate,
            transportCost,
          };
        })
        .sort((a, b) => {
          if (a.schoolCode !== b.schoolCode) return a.schoolCode.localeCompare(b.schoolCode, undefined, { numeric: true });
          if (a.staffId !== b.staffId) return a.staffId.localeCompare(b.staffId, undefined, { numeric: true });
          return a.name.localeCompare(b.name, 'ja', { numeric: true });
        });

      const minToPayrollHm = (minutes: number) => {
        const safeMinutes = Math.max(0, Math.round(minutes || 0));
        const h = Math.floor(safeMinutes / 60);
        const m = safeMinutes % 60;
        return `${h}:${String(m).padStart(2, '0')}`;
      };

      const header = csvLine([
        '所属校',
        '職員番号',
        '氏名',
        '',
        '',
        '授業',
        'サポート',
        '授業時間(~22時)',
        '授業時間(22時~)',
        '事務・研修時間(~22時)',
        '事務・研修時間(22時~)',
        'サポート時間(~22時)',
        'サポート時間(22時~)',
        '交通費(金額)',
        '',
      ]);

      const rows = teacherRows.map((row, index) => csvLine([
        row.schoolName,
        row.staffId,
        row.name,
        row.name,
        'TRUE',
        row.lessonCount,
        row.supportCount,
        minToPayrollHm(row.lessonTimeNormal),
        minToPayrollHm(row.lessonTimeLate),
        minToPayrollHm(row.officeTimeNormal),
        minToPayrollHm(row.officeTimeLate),
        minToPayrollHm(row.supportTimeNormal),
        minToPayrollHm(row.supportTimeLate),
        row.transportCost,
        index + 1,
      ]));

      downloadCsv(`勤怠集計_指定形式_${filterMonth}.csv`, [header, ...rows]);
    } catch (e) {
      console.error(e);
      alert('指定形式CSVの生成に失敗しました');
    } finally {
      setIsCsvGenerating(false);
    }
  };

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
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 pb-32 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">

        {/* ヘッダーエリア */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-2.5 rounded-full shadow-sm hover:bg-gray-100 text-gray-500 transition-colors border border-gray-200">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Briefcase className="text-indigo-600" /> 準専任勤怠管理
              </h1>
              <p className="text-xs text-gray-500 mt-1">講師の出勤記録の確認と承認を行います</p>
            </div>
          </div>

          <div className="flex gap-4 flex-wrap">
            <Link href={`/master/attendance/dedicated-claims?month=${filterMonth}`} className="bg-sky-600 px-5 py-3 rounded-xl shadow-sm flex flex-col items-center min-w-[120px] text-white hover:bg-sky-700 transition-colors">
              <span className="text-[10px] font-bold uppercase flex items-center gap-1"><Clock size={12}/> 専任申請</span>
              <span className="text-sm font-black">時間外・授業・交通</span>
            </Link>
            <Link href="/master/attendance/employee-lessons" className="bg-emerald-600 px-5 py-3 rounded-xl shadow-sm flex flex-col items-center min-w-[120px] text-white hover:bg-emerald-700 transition-colors">
              <span className="text-[10px] font-bold uppercase flex items-center gap-1"><BookOpen size={12}/> 専任授業</span>
              <span className="text-sm font-black">実績を入力</span>
            </Link>
            <Link href={`/master/attendance/payroll?month=${filterMonth}`} className="bg-indigo-600 px-5 py-3 rounded-xl shadow-sm flex flex-col items-center min-w-[120px] text-white hover:bg-indigo-700 transition-colors">
              <span className="text-[10px] font-bold uppercase flex items-center gap-1"><DollarSign size={12}/> 給与計算</span>
              <span className="text-sm font-black">集計・照合</span>
            </Link>
            <Link href="/master/attendance-corrections" className="bg-amber-500 px-5 py-3 rounded-xl shadow-sm flex flex-col items-center min-w-[120px] text-white hover:bg-amber-600 transition-colors">
              <span className="text-[10px] font-bold uppercase flex items-center gap-1"><CheckSquare size={12}/> 打刻修正</span>
              <span className="text-xl font-black">{pendingCorrectionRequests.length}</span>
            </Link>
            <Link href={`/master/attendance/diagnostics?month=${filterMonth}`} className="bg-white px-5 py-3 rounded-xl border border-rose-200 shadow-sm flex flex-col items-center min-w-[120px] hover:bg-rose-50 transition-colors">
              <span className="text-[10px] text-rose-500 font-bold uppercase flex items-center gap-1"><AlertCircle size={12}/> 要確認</span>
              <span className={`text-xl font-black ${visibleAttendanceDiagnostics.length > 0 ? 'text-rose-600' : 'text-gray-300'}`}>{visibleAttendanceDiagnostics.length}</span>
            </Link>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><FileText size={12}/> 授業時間</span>
              <span className="text-xl font-black text-blue-600 font-mono">{summary.lessonTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><Coffee size={12}/> 事務/サポ</span>
              <span className="text-xl font-black text-orange-500 font-mono">{summary.officeTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase">承認待ち</span>
              <span className={`text-xl font-black ${summary.pending > 0 ? 'text-red-500' : 'text-gray-300'}`}>{summary.pending}</span>
            </div>
          </div>
        </div>

        {pendingCorrectionRequests.length > 0 && (
          <details className="group mb-6 rounded-3xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-black leading-snug text-amber-900">
                  <AlertCircle size={20} className="shrink-0" /> <span className="min-w-0 whitespace-normal break-words">打刻修正依頼</span>
                </h2>
                <p className="mt-1 whitespace-normal break-words text-xs font-bold leading-relaxed text-amber-700">講師から届いた出退勤時刻の修正申請です。承認すると勤務記録へ反映されます。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">未処理 {pendingCorrectionRequests.length}件</span>
                <span className="inline-flex items-center gap-1 text-xs font-black text-amber-800"><span className="group-open:hidden">表示する</span><span className="hidden group-open:inline">閉じる</span><ChevronRight size={16} className="transition-transform group-open:rotate-90" /></span>
              </div>
            </summary>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {pendingCorrectionRequests.map(req => {
                const rec = req.work_record_id ? getRecordById(req.work_record_id) : undefined;
                const teacher = usersMap[req.teacher_id];
                const isMissingClock = req.request_type === 'missing_clock' || !req.work_record_id;
                return (
                  <div key={req.id} className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-slate-900">{teacher?.name || req.teacher_name || rec?.teacher_name || '講師未設定'}</p>
                          {isMissingClock && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">打刻なし新規</span>}
                        </div>
                        <p className="mt-1 text-xs font-bold text-slate-400">{rec?.date || req.target_date || '日付未取得'} / 申請ID: {req.id.slice(0, 8)}</p>
                      </div>
                      <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black text-amber-700">承認待ち</span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black text-slate-400">現在の出勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{isMissingClock ? '記録なし' : formatCorrectionTime(rec?.start_time)}</p>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="text-[10px] font-black text-indigo-400">修正後の出勤</p>
                        <p className="mt-1 text-xs font-black text-indigo-700">{formatCorrectionTime(req.requested_start_time)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black text-slate-400">現在の退勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{isMissingClock ? '記録なし' : formatCorrectionTime(rec?.end_time)}</p>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="text-[10px] font-black text-indigo-400">修正後の退勤</p>
                        <p className="mt-1 text-xs font-black text-indigo-700">{formatCorrectionTime(req.requested_end_time)}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black text-slate-400">理由</p>
                      <p className="mt-1 text-sm font-bold leading-relaxed text-slate-700">{req.reason || '理由未入力'}</p>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        onClick={() => handleCorrectionReview(req.id, 'rejected')}
                        disabled={processingCorrectionId === req.id}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        却下
                      </button>
                      <button
                        onClick={() => handleCorrectionReview(req.id, 'approved')}
                        disabled={processingCorrectionId === req.id}
                        className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {processingCorrectionId === req.id ? <Loader2 className="animate-spin" size={14} /> : <CheckSquare size={14} />} 承認して反映
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {visibleAttendanceDiagnostics.length > 0 && (
          <details className="group mb-6 rounded-3xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none flex-col gap-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-rose-500 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-black leading-snug text-rose-900">
                  <AlertCircle size={20} className="shrink-0" /> <span className="min-w-0 whitespace-normal break-words">勤怠ミス候補</span>
                </h2>
                <p className="mt-1 whitespace-normal break-words text-xs font-bold leading-relaxed text-rose-700">講師配置との不一致、業務詳細未入力、交通費未入力など、確認が必要な可能性がある記録です。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700 ring-1 ring-rose-200">要確認 {visibleAttendanceDiagnostics.length}件</span>
                <span className="inline-flex items-center gap-1 text-xs font-black text-rose-800"><span className="group-open:hidden">表示する</span><span className="hidden group-open:inline">閉じる</span><ChevronRight size={16} className="transition-transform group-open:rotate-90" /></span>
              </div>
            </summary>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {visibleAttendanceDiagnostics.slice(0, 12).map((item, index) => (
                <div key={`${item.date}_${item.work_record_id || item.shift_assignment_id || index}`} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-slate-900">{item.teacher_name || '講師未設定'}</p>
                      <p className="mt-1 text-xs font-bold text-slate-400">{item.date} / {item.type === 'missing_work_record' ? '勤務記録なし' : `勤怠ID: ${(item.work_record_id || '').slice(0, 8)}`}</p>
                    </div>
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-[10px] font-black text-rose-700">{item.warnings.length}項目</span>
                  </div>
                  <div className="space-y-2">
                    {item.warnings.map(w => (
                      <div key={w.code} className={`rounded-xl p-3 text-xs font-bold leading-relaxed ${w.severity === 'danger' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                        <span className="font-black">{w.label}</span>
                        <p className="mt-1">{w.detail}</p>
                      </div>
                    ))}
                  </div>
                  {item.work_record_id && (
                    <button
                      onClick={() => {
                        const target = records.find(r => r.id === item.work_record_id);
                        if (target) openEditor(target);
                      }}
                      className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800"
                    >
                      勤怠を開く
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* フィルター & 操作バー */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-4 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-4 z-20">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
              <Calendar size={16} className="text-gray-400"/>
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-transparent font-bold text-gray-700 outline-none text-sm cursor-pointer" />
            </div>

            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200 relative">
              <Calendar size={16} className="text-indigo-400"/>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="bg-transparent font-bold text-gray-700 outline-none text-sm cursor-pointer pr-4"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate('')}
                  className="absolute right-2 text-gray-400 hover:text-gray-600 bg-gray-50"
                  title="日付をクリア"
                >
                  <X size={14}/>
                </button>
              )}
            </div>

            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
              <input
                type="text"
                placeholder="名前で検索..."
                className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
              />
            </div>

            <button
              onClick={() => setShowOnlyPending(!showOnlyPending)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                showOnlyPending
                  ? 'bg-orange-50 text-orange-600 border-orange-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {showOnlyPending ? <CheckSquare size={16}/> : <Filter size={16}/>}
              承認待ちのみ
            </button>
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={handleBulkDownload}
              disabled={isCsvGenerating || filteredRecords.length === 0}
              className="w-full md:w-auto bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCsvGenerating ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
              {isCsvGenerating ? '生成中...' : 'CSV一括出力'}
            </button>
            <button
              onClick={handlePayrollSummaryDownload}
              disabled={isCsvGenerating || filteredRecords.length === 0}
              className="w-full md:w-auto bg-sky-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-sky-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCsvGenerating ? <Loader2 className="animate-spin" size={18}/> : <FileText size={18}/>}
              指定形式CSV
            </button>
            <button
              onClick={handleBreakthroughSeminarExport}
              disabled={isCsvGenerating || filteredRecords.length === 0}
              className="w-full md:w-auto bg-violet-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-violet-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              title="日付フィルターで特定日を選んでから出力してください"
            >
              {isCsvGenerating ? <Loader2 className="animate-spin" size={18}/> : <FileText size={18}/>}
              突破ゼミ出勤簿
            </button>

            <button
              onClick={() => {
                setNewRecordSearch('');
                setNewRecordData({ teacher_id: '', date: filterDate || filterMonth + '-01' });
                setIsNewRecordModalOpen(true);
              }}
              className="w-full md:w-auto bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-md active:scale-95"
            >
              <Plus size={16}/> 新規追加
            </button>
          </div>
        </div>

        {/* リスト表示 */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-400" size={32}/></div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-bold bg-white rounded-3xl border border-dashed border-gray-200">
            データが見つかりません
          </div>
        ) : (
          <div className="space-y-4">

            {/* 一括操作バー */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 pl-2">
                <input
                  type="checkbox"
                  className="w-5 h-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={filteredRecords.length > 0 && selectedRecordIds.size === filteredRecords.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
                <span className="text-sm font-bold text-gray-600">すべて選択 ({selectedRecordIds.size}件選択中)</span>
              </div>

              {selectedRecordIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkApprove}
                    disabled={isBulkProcessing}
                    className="bg-indigo-50 text-indigo-600 px-5 py-2 rounded-xl text-xs font-bold hover:bg-indigo-100 flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isBulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14}/>}
                    選択した項目を承認
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={isBulkProcessing}
                    className="bg-red-50 text-red-600 px-5 py-2 rounded-xl text-xs font-bold hover:bg-red-100 flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isBulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14}/>}
                    一括削除
                  </button>
                </div>
              )}
            </div>

            {/* 日付ごとにグループ化して表示 */}
            <div className="space-y-8">
              {groupedRecords.map(group => {
                const dateObj = new Date(group.date);
                const dayStr = isNaN(dateObj.getTime()) ? '' : ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()] + '曜日';

                return (
                  <div key={group.date} className="space-y-4">
                    {/* 日付見出し */}
                    <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2 border-b border-gray-200 pb-2 pl-1">
                      <Calendar className="text-indigo-500" size={20}/>
                      {group.date}
                      <span className="text-sm font-normal text-gray-400 ml-2">
                        ({dayStr}) - {group.records.length}件
                      </span>
                    </h2>

                    {/* その日のレコード一覧 */}
                    <div className="grid gap-4">
                      {group.records.map(rec => {
                        const userInfo = usersMap[rec.teacher_id];
                        const displayName = userInfo?.name || rec.teacher_name;
                        const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
                        const isApproved = rec.status === 'approved';
                        const isSelected = selectedRecordIds.has(rec.id);

                        return (
                          <div key={rec.id} className={`relative bg-white p-5 rounded-2xl shadow-sm border transition-all hover:shadow-md ${isApproved ? 'border-gray-200 opacity-80' : 'border-orange-200 ring-1 ring-orange-100'} ${isSelected ? 'bg-indigo-50/30 border-indigo-300' : ''}`}>

                            {/* 各行のチェックボックス */}
                            <div className="absolute top-5 left-4 z-10">
                              <input
                                type="checkbox"
                                className="w-5 h-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                checked={isSelected}
                                onChange={(e) => handleSelectOne(rec.id, e.target.checked)}
                              />
                            </div>

                            <div className="flex flex-col md:flex-row gap-6 pl-8">
                              {/* 左側: 基本情報 */}
                              <div className="md:w-56 shrink-0 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-6">
                                <h3 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
                                  <User size={18} className="text-gray-400"/>
                                  {displayName}
                                </h3>
                                {/* 校舎・職員番号表示 */}
                                <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded">校:{userInfo?.school_code !== '999' ? userInfo?.school_code : '-'}</span>
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded">員:{userInfo?.staff_id !== '9999' ? userInfo?.staff_id : '-'}</span>
                                </div>

                                <div className="bg-gray-50 rounded-lg p-2 text-center">
                                  <div className="text-xs text-gray-400 font-bold mb-1">拘束時間</div>
                                  <div className="text-xl font-black text-gray-700 font-mono">
                                    {calcDurationMinutes(rec.start_time, rec.end_time) > 0 ? calcDurationStr(calcDurationMinutes(rec.start_time, rec.end_time)) : '--'}
                                  </div>
                                </div>
                              </div>

                              {/* 中央: 詳細情報 */}
                              <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3 text-sm">
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">出勤</span>
                                  <span className="font-mono font-bold text-lg">
                                    {rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                                  </span>
                                  <span className="text-gray-300">➜</span>
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">退勤</span>
                                  <span className="font-mono font-bold text-lg">
                                    {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                                  </span>
                                </div>

                                {displaySegments?.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {displaySegments.map((seg: any, i: number) => (
                                      <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${segmentToneClass(seg.type, 'chip')}`}>
                                        <span className="font-mono font-bold">{seg.start}-{seg.end}</span>
                                        <span className="font-bold opacity-70">|</span>
                                        <span className="font-bold">
                                          {segmentTypeLabel(seg.type, true)}
                                        </span>
                                        {seg.note && !seg.isAuto && <span className="opacity-70 truncate max-w-[100px]">({seg.note})</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 italic">詳細なし</span>
                                )}

                                {rec.transportation?.length > 0 && (
                                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit">
                                    <Train size={14}/> 交通費: ¥{calcTotalCost(rec.transportation).toLocaleString()}
                                  </div>
                                )}
                              </div>

                              {/* 右側: アクション */}
                              <div className="flex flex-row md:flex-col justify-center gap-2 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                                {isApproved ? (
                                  <button disabled className="w-full bg-gray-100 text-gray-400 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                                    <CheckCircle size={16}/> 承認済
                                  </button>
                                ) : (
                                  <button onClick={() => handleApprove(rec.id)} className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-sm transition-all active:scale-95">
                                    <CheckCircle size={16}/> 承認する
                                  </button>
                                )}
                                <button onClick={() => openEditor(rec)} className="w-full bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors">
                                  <Edit size={14}/> 編集
                                </button>
                                <button onClick={() => handleDelete(rec.id)} className="w-full bg-white border border-red-100 text-red-500 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
                                  <Trash2 size={14}/> 削除
                                </button>
                              </div>

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {/* 新規勤務データ作成用モーダル */}
      {isNewRecordModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-indigo-600 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold flex items-center gap-2 text-lg"><Plus size={20}/> 新規勤務データ作成</h3>
              <button onClick={() => setIsNewRecordModalOpen(false)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-500 mb-2 block">対象の講師 <span className="text-red-500">*</span></label>

                {/* 検索ボックス */}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
                  <input
                    type="text"
                    placeholder="講師名や校舎番号で検索..."
                    className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    value={newRecordSearch}
                    onChange={e => setNewRecordSearch(e.target.value)}
                  />
                </div>

                {/* フィルタリングされたリストボックス */}
                <select
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newRecordData.teacher_id}
                  onChange={(e) => setNewRecordData({...newRecordData, teacher_id: e.target.value})}
                  size={5}
                >
                  <option value="">-- 講師を選択してください --</option>
                  {Object.entries(usersMap)
                    .filter(([id, info]) => info.name.includes(newRecordSearch) || info.school_code.includes(newRecordSearch))
                    .map(([id, info]) => (
                    <option key={id} value={id}>{info.name} (校舎:{info.school_code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-2 block">勤務日 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newRecordData.date}
                  onChange={(e) => setNewRecordData({...newRecordData, date: e.target.value})}
                />
              </div>
            </div>
            <div className="p-5 border-t bg-gray-50 shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsNewRecordModalOpen(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors text-sm">キャンセル</button>
              <button onClick={handleCreateNewRecord} disabled={isBulkProcessing || !newRecordData.teacher_id} className="px-6 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-all active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50">
                {isBulkProcessing ? <Loader2 size={16} className="animate-spin" /> : '作成して編集へ'} <ChevronRight size={16}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">

            <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg"><Briefcase size={20}/> 勤怠データ編集</h3>
                <p className="text-xs text-slate-400 mt-0.5">{editingRecord.date} - {usersMap[editingRecord.teacher_id]?.name || editingRecord.teacher_name}</p>
              </div>
              <button onClick={() => setEditingRecord(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={24}/></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-8 custom-scrollbar">

              {/* 出退勤時間 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2"><Clock size={18} className="text-indigo-500"/> 出退勤時間</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">出勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.start} onChange={e => setMainTime({...mainTime, start: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">退勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.end} onChange={e => setMainTime({...mainTime, end: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* 時間割・内訳 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="flex flex-col sm:flex-row justify-between items-start mb-4 border-b pb-3 gap-2">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2 shrink-0"><Layout size={18} className="text-orange-500"/> 業務内訳</h4>
                  <div className="text-[10px] text-gray-600 bg-gray-100 px-3 py-2 rounded-lg font-bold flex flex-col gap-1 w-full sm:w-auto">
                    <div className="flex items-center gap-1 text-gray-500"><AlertCircle size={12} className="shrink-0"/> 始まりと終わりの隙間は自動で「休憩」になり、空白時間を埋めます。</div>
                    <div className="flex items-center gap-1 text-red-500"><AlertCircle size={12} className="shrink-0"/> ※勤務時間が6時間を超える場合は45分以上、8時間を超える場合は1時間以上の休憩が必要です。</div>
                  </div>
                </div>

                <div className="mb-6">
                   <div className="flex justify-between items-center mb-2 px-1">
                     <h4 className="text-xs font-bold text-gray-500">1日の流れ</h4>
                     <div className="flex gap-2 text-[10px] font-bold">
                       <span className="flex items-center gap-1 text-blue-600"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>授業</span>
                       <span className="flex items-center gap-1 text-green-600"><span className="w-2 h-2 bg-green-500 rounded-full"></span>サポ</span>
                       <span className="flex items-center gap-1 text-orange-600"><span className="w-2 h-2 bg-orange-500 rounded-full"></span>事務</span>
                       <span className="flex items-center gap-1 text-fuchsia-600"><span className="w-2 h-2 bg-fuchsia-500 rounded-full"></span>突破授業</span>
                       <span className="flex items-center gap-1 text-rose-600"><span className="w-2 h-2 bg-rose-500 rounded-full"></span>突破事務</span>
                       <span className="flex items-center gap-1 text-gray-400"><span className="w-2 h-2 bg-slate-400 rounded-full"></span>休憩</span>
                     </div>
                   </div>
                   <TimelineVisual record={editingRecord} currentSegments={segments} />
                </div>

                <div className="overflow-x-auto pb-2">
                  <table className="w-full text-sm border-collapse min-w-[600px] sm:min-w-0">
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
                          {/* ★ step="300" で5分刻みに */}
                          <td className="p-2"><input type="time" step="300" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} /></td>
                          <td className="p-2"><input type="time" step="300" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
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

                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between">
                  <span className="flex items-center gap-1"><Coffee size={12}/> 入力のない時間は自動的に「休憩」となります</span>
                  <button onClick={() => addSegment('office')} className="flex min-h-[36px] items-center justify-center gap-1 rounded-lg bg-blue-50 px-3 text-blue-600 font-bold hover:bg-blue-100"><Plus size={12}/> 行を追加</button>
                </div>
              </div>

              {/* 交通費セクション */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 border-b pb-3 gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Train size={18} className="text-emerald-500"/> 交通費申請</h4>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">講師が購入済み定期券を登録している場合は、自動入力時に定期区間を控除します。</p>
                  </div>
                  <button onClick={handleCopyLastTransport} className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-100 flex items-center gap-1 transition-colors shrink-0"><Copy size={12}/> 前回をコピー</button>
                </div>

                <div className="space-y-3">
	                  {expenses.map((exp, i) => (
	                    <div key={i} className="flex flex-col gap-3 overflow-visible rounded-xl border border-emerald-100/50 bg-emerald-50/30 p-4">
	                      <div className="grid gap-3">
	                        <div className="grid gap-2 sm:grid-cols-2">
	                          <select
	                            className="min-h-[40px] rounded-lg border border-emerald-100 bg-white px-3 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-emerald-500"
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
	                          <ChevronRight size={16} className="hidden self-center justify-self-center text-gray-300 md:block"/>
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

		                      <div className="flex flex-col gap-3 rounded-xl bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
		                        <div className="flex min-h-5 flex-wrap items-center gap-2">
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
		                        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[8rem_minmax(10rem,14rem)_auto] sm:items-center sm:justify-end">
                            <select
                              value={exp.trip_type || 'round_trip'}
                              onChange={(e) => updateTripType(i, e.target.value as 'one_way' | 'round_trip')}
                              className="min-h-[40px] w-full rounded-lg border border-emerald-100 bg-white px-3 text-sm font-black text-gray-700 outline-none focus:ring-2 focus:ring-emerald-500"
                            >
	                              <option value="one_way">片道</option>
	                              <option value="round_trip">往復</option>
	                            </select>
	                          <div className="relative">
	                            <DollarSign size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
	                            <input type="number" className="min-h-[42px] w-full rounded-lg border border-gray-200 bg-white pl-6 pr-2 text-right font-mono text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
	                          </div>
	                          <button onClick={() => removeExpense(i)} className="flex min-h-[40px] items-center justify-center rounded-lg p-2 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"><X size={16}/></button>
	                        </div>
	                      </div>
	                    </div>
	                  ))}
                  <button onClick={addExpense} className="w-full py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 border border-dashed border-emerald-200 hover:border-emerald-400 rounded-xl flex items-center justify-center gap-2 transition-all">
                    <Plus size={16}/> 交通費を追加
                  </button>
                </div>
              </div>

              <div className="h-10"></div>
            </div>

            <div className="p-5 border-t bg-white shrink-0 z-10 flex justify-end gap-3">
              <button onClick={() => setEditingRecord(null)} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm">キャンセル</button>
              <button onClick={saveAll} className="px-8 py-3 rounded-xl font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all active:scale-95 text-sm flex items-center gap-2">
                <Save size={18}/> 変更を保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
