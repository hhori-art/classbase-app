'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  ListFilter,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Train,
  Trash2,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { hasAdminAppPermission } from '@/lib/admin-app-permissions';
import {
  ATTENDANCE_GRADES,
  ATTENDANCE_PROGRAM_LABELS,
  OFFICE_TASK_OPTIONS,
  segmentProgram,
  type AttendanceWorkSegment,
} from '@/lib/attendance-work-detail';
import { ATTENDANCE_SCHOOL_DIRECTORY, SCIENCE_SOCIAL_WORKPLACE_ID, SCIENCE_SOCIAL_WORKPLACE_LABEL } from '@/lib/attendance-schools';
import { isDedicatedProfile } from '@/lib/employment-category';
import { attendanceDurationLabel, attendanceTimeLabel } from '@/lib/attendance-display';
import FiveMinuteTimePicker from '@/app/components/FiveMinuteTimePicker';

type Props = { mode: 'school_manager' | 'admin'; backHref: string };
type ClockEdit = { recordId: string; start: string; end: string };
type ViewFilter = 'pending' | 'all';
type ProgramFilter = 'all' | 'science_social' | 'breakthrough';
type SelectedApproval = { work_record_id: string; segment_id: string };
type SegmentEdit = Pick<AttendanceWorkSegment, 'start' | 'end' | 'type'> & Partial<AttendanceWorkSegment>;
type TransportationDraft = { transport_type: string; route_line: string; from: string; to: string; trip_type: 'one_way' | 'round_trip'; cost: number | string };
type NewRecordForm = { teacherId: string; date: string; start: string; end: string; schoolId: string; type: string; grade: string; officeTask: string; useShiftBase: boolean; clockOnly: boolean; transportation: TransportationDraft[]; transportationNone: boolean };
const emptyTransportation = (): TransportationDraft => ({ transport_type: 'train', route_line: '', from: '', to: '', trip_type: 'round_trip', cost: '' });

const selectionKey = (recordId: string, segmentId: string) => `${recordId}\u0000${segmentId}`;
const selectionItem = (key: string): SelectedApproval => {
  const [work_record_id, segment_id] = key.split('\u0000');
  return { work_record_id, segment_id };
};

const time = attendanceTimeLabel;
const timeInputValue = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setSeconds(0, 0);
  date.setMinutes(Math.round(date.getMinutes() / 5) * 5);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
const FiveMinuteTimeSelect = FiveMinuteTimePicker;
const workTimeIso = (date: string, value: string) => new Date(`${date}T${value}:00+09:00`).toISOString();
const typeLabel = (type: string) => ({
  lesson: '集団授業', individual: '個別授業', office: '事務', support: 'サブ（サポート）',
  breakthrough_lesson: '授業', breakthrough_office: '事務', other: 'その他', break: '休憩',
} as Record<string, string>)[type] || type;
const statusLabel = (status: string) => status === 'approved' ? '承認済み' : status === 'rejected' ? '差し戻し済み' : '承認待ち';
const statusClass = (status: string) => status === 'approved'
  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
  : status === 'rejected'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-amber-200 bg-amber-50 text-amber-800';
const durationLabel = attendanceDurationLabel;
const dateHeading = (date: string) => new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
});
const transportTypeLabel = (value: string) => ({
  train: '電車', railway: '電車', bus: 'バス', car: '車', other: 'その他',
} as Record<string, string>)[value] || value || '交通機関';
const needsReview = (segment: any) => (
  segment.type !== 'break'
  && segment.can_review !== false
  && (segment.approval_status || 'pending') === 'pending'
);
const detailMissing = (record: any) => record.detail_missing === true
  || !record.work_segments.some((segment: any) => segment.type !== 'break');
const pendingReviewCount = (record: any) => (
  record.work_segments.filter(needsReview).length + (detailMissing(record) ? 1 : 0)
);
const recordNeedsReview = (record: any) => pendingReviewCount(record) > 0;
const includesScienceSocial = (record: any) => record.work_segments.some(
  (segment: any) => segment.type !== 'break' && segmentProgram(segment) === 'science_social'
);
const includesBreakthrough = (record: any) => record.work_segments.some(
  (segment: any) => segment.type !== 'break' && segmentProgram(segment) === 'breakthrough'
);
const segmentToneClass = (segment: any, variant: 'chip' | 'bar' | 'card') => {
  const tones: Record<string, Record<'chip' | 'bar' | 'card', string>> = {
    lesson: { chip: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', card: 'border-blue-100 bg-blue-50/40' },
    individual: { chip: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500', card: 'border-indigo-100 bg-indigo-50/40' },
    support: { chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', card: 'border-emerald-100 bg-emerald-50/40' },
    office: { chip: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', card: 'border-orange-100 bg-orange-50/40' },
    breakthrough_lesson: { chip: 'bg-fuchsia-100 text-fuchsia-700', bar: 'bg-fuchsia-500', card: 'border-fuchsia-100 bg-fuchsia-50/40' },
    breakthrough_office: { chip: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', card: 'border-rose-100 bg-rose-50/40' },
    break: { chip: 'bg-slate-200 text-slate-600', bar: 'bg-slate-400', card: 'border-slate-200 bg-slate-50' },
  };
  return (tones[String(segment.type)] || tones.office)[variant];
};
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';

export default function AttendanceApprovalsWorkspace({ mode, backHref }: Props) {
  const { user, profile, loading: authLoading } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedSchool, setSelectedSchool] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('pending');
  const [programFilter, setProgramFilter] = useState<ProgramFilter>('all');
  const [details, setDetails] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [reconciliationAlerts, setReconciliationAlerts] = useState<any[]>([]);
  const [jumpRecordId, setJumpRecordId] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState('');
  const [canReject, setCanReject] = useState(false);
  const [canUnlock, setCanUnlock] = useState(false);
  const [clockEdit, setClockEdit] = useState<ClockEdit | null>(null);
  const [loadError, setLoadError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selectedApprovals, setSelectedApprovals] = useState<Set<string>>(() => new Set());
  const [selectedCorrections, setSelectedCorrections] = useState<Set<string>>(() => new Set());
  const [staff, setStaff] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRecord, setNewRecord] = useState<NewRecordForm>({ teacherId: '', date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), start: '09:00', end: '18:00', schoolId: '', type: 'office', grade: '', officeTask: 'lesson_preparation', useShiftBase: false, clockOnly: true, transportation: [], transportationNone: false });
  const schoolManager = Boolean(profile && isDedicatedProfile(profile) && profile.attendance_school_manager === true);
  const adminManager = Boolean(profile && (profile.role === 'master' || hasAdminAppPermission(profile.role, profile, 'attendance')));
  const allowed = mode === 'school_manager' ? schoolManager : adminManager;

  const load = useCallback(async (requestedMonth?: string) => {
    if (!user || !allowed) return;
    const targetMonth = requestedMonth || month;
    setLoading(true);
    setLoadError('');
    try {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [detailResponse, correctionResponse] = await Promise.all([
        fetch(`/api/attendance-detail-approvals?month=${targetMonth}`, { headers, cache: 'no-store' }),
        fetch(`/api/attendance-corrections?scope=admin&status=pending&month=${targetMonth}&limit=100`, { headers, cache: 'no-store' }),
      ]);
      const [detailBody, correctionBody] = await Promise.all([
        detailResponse.json().catch(() => ({})),
        correctionResponse.json().catch(() => ({})),
      ]);
      if (!detailResponse.ok) throw new Error(detailBody.error || '勤務詳細を取得できませんでした。');
      if (!correctionResponse.ok) throw new Error(correctionBody.error || '打刻修正依頼を取得できませんでした。');
      setDetails(detailBody.records || []);
      setCorrections(correctionBody.requests || []);
      setReconciliationAlerts(detailBody.reconciliation_alerts || []);
      setSelectedApprovals(new Set());
      setSelectedCorrections(new Set());
      setCanReject(detailBody.can_reject === true);
      setCanUnlock(detailBody.can_unlock === true);
      setUpdatedAt(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '承認データを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [allowed, month, user]);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    if (!user) throw new Error('ログイン情報を確認できません。');
    const token = await user.getIdToken();
    const response = await fetch('/api/attendance-detail-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  };

  const reviewSegment = async (recordId: string, segmentId: string, status: 'approved' | 'rejected' | 'pending') => {
    const action = status === 'approved' ? '承認' : status === 'rejected' ? '差し戻し' : '承認解除';
    if (!confirm(`この勤務実績を${action}しますか？`)) return;
    setProcessing(`${recordId}_${segmentId}`);
    try {
      await post({ work_record_id: recordId, segment_id: segmentId, status });
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : `${action}処理に失敗しました。`);
    } finally {
      setProcessing('');
    }
  };

  const createRecord = async () => {
    const target = staff.find(item => item.id === newRecord.teacherId);
    if (!target) return alert('職員を選択してください。');
    if (!newRecord.schoolId) return alert('勤務校舎を選択してください。');
    if (!confirm(`${target.name}さんの${newRecord.date}の勤務実績を作成しますか？`)) return;
    setProcessing('create_record');
    setSuccessMessage('');
    try {
      const created = await post({
        action: 'create_record', teacher_id: newRecord.teacherId, date: newRecord.date,
        start: newRecord.start, end: newRecord.end, school_id: newRecord.schoolId,
        use_shift_base: newRecord.useShiftBase,
        clock_only: newRecord.clockOnly && !newRecord.useShiftBase,
        transportation: newRecord.transportation,
        transportation_status: newRecord.transportationNone ? 'none' : newRecord.transportation.length ? 'entered' : 'unset',
        segment: {
          start: newRecord.start, end: newRecord.end, type: newRecord.type,
          grade: newRecord.grade || undefined, school_id: newRecord.schoolId,
          lesson_format: newRecord.type === 'individual' ? 'individual' : newRecord.type === 'lesson' ? 'group' : undefined,
          individual_level: newRecord.type === 'individual' ? 'standard' : undefined,
          individual_ratio: newRecord.type === 'individual' ? '1:2' : undefined,
          office_task: newRecord.type === 'office' ? newRecord.officeTask || 'lesson_preparation' : undefined,
        },
      });
      const targetMonth = newRecord.date.slice(0, 7);
      const createdRecordId = String(created.record_id || '');
      setShowCreate(false);
      setMonth(targetMonth);
      setSelectedSchool('');
      setProgramFilter('all');
      setViewFilter('pending');
      setJumpRecordId(createdRecordId);
      setSuccessMessage(`${target.name}さんの${newRecord.date}の勤務実績を作成しました。作成した実績を表示しています。`);
      await load(targetMonth);
      window.setTimeout(() => {
        document.getElementById(`attendance-record-${createdRecordId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    } catch (error) {
      alert(error instanceof Error ? error.message : '勤務実績を作成できませんでした。');
    } finally {
      setProcessing('');
    }
  };

  const openCreate = async () => {
    setShowCreate(true);
    if (!user || staff.length) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/attendance-detail-approvals?staff_only=1', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '職員一覧を取得できませんでした。');
      setStaff(body.staff || []);
    } catch (error) {
      alert(error instanceof Error ? error.message : '職員一覧を取得できませんでした。');
    }
  };

  const approveSelected = async () => {
    const items = Array.from(selectedApprovals, selectionItem);
    if (!items.length || !confirm(`選択した勤務実績 ${items.length}件を一括承認しますか？`)) return;
    setProcessing('selected');
    try {
      await post({ action: 'approve_selected', items });
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : '選択した勤務実績を一括承認できませんでした。');
    } finally {
      setProcessing('');
    }
  };

  const reviewCorrection = async (id: string, status: 'approved' | 'rejected') => {
    if (!user || !confirm(`この打刻修正を${status === 'approved' ? '承認' : '差し戻し'}しますか？`)) return;
    setProcessing(`correction_${id}`);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'review', request_id: id, status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : '承認処理に失敗しました。');
    } finally {
      setProcessing('');
    }
  };

  const approveSelectedCorrections = async () => {
    const ids = Array.from(selectedCorrections).filter(id => visibleCorrections.some(item => item.id === id));
    if (!user || !ids.length || !confirm(`選択した打刻修正依頼 ${ids.length}件を一括承認しますか？`)) return;
    setProcessing('corrections_selected');
    try {
      const token = await user.getIdToken();
      const results = await Promise.allSettled(ids.map(async id => {
        const response = await fetch('/api/attendance-corrections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'review', request_id: id, status: 'approved' }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
        return id;
      }));
      const failed = results.filter(result => result.status === 'rejected');
      await load();
      if (failed.length) alert(`${ids.length - failed.length}件を承認しました。${failed.length}件は承認できなかったため、内容を確認してください。`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '選択した打刻修正依頼を一括承認できませんでした。');
    } finally {
      setProcessing('');
    }
  };

  const saveClockEdit = async (record: any) => {
    if (!clockEdit || clockEdit.recordId !== record.id) return;
    if (!clockEdit.start || !clockEdit.end || clockEdit.start >= clockEdit.end) {
      alert('退勤時刻は出勤時刻より後にしてください。');
      return;
    }
    if (!confirm(`${record.teacher_name}さんの打刻時刻を ${clockEdit.start}〜${clockEdit.end} に修正しますか？`)) return;
    setProcessing(`clock_${record.id}`);
    try {
      await post({
        action: 'edit_clock',
        work_record_id: record.id,
        start_time: workTimeIso(record.date, clockEdit.start),
        end_time: workTimeIso(record.date, clockEdit.end),
      });
      setClockEdit(null);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打刻時刻の修正に失敗しました。');
    } finally {
      setProcessing('');
    }
  };

  const saveSegmentEdit = async (recordId: string, segmentId: string, segment: SegmentEdit) => {
    const key = `edit_${recordId}_${segmentId}`;
    setProcessing(key);
    try {
      await post({ action: 'edit_segment', work_record_id: recordId, segment_id: segmentId, segment });
      await load();
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : '勤務詳細の修正に失敗しました。');
      return false;
    } finally {
      setProcessing('');
    }
  };

  const saveSegments = async (recordId: string, segments: SegmentEdit[]) => {
    setProcessing(`segments_${recordId}`);
    try {
      const body = await post({ action: 'save_segments', work_record_id: recordId, segments });
      setDetails(current => current.map(record => record.id === recordId ? {
        ...record,
        work_segments: body.work_segments || [],
        detail_missing: !(body.work_segments || []).length,
        detail_approval_status: 'pending',
      } : record));
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : '勤務詳細を保存できませんでした。');
      return false;
    } finally { setProcessing(''); }
  };

  const saveTransportation = async (recordId: string, transportation: TransportationDraft[], transportationNone: boolean) => {
    setProcessing(`transportation_${recordId}`);
    try {
      const body = await post({
        action: 'save_transportation', work_record_id: recordId, transportation,
        transportation_status: transportationNone ? 'none' : transportation.length ? 'entered' : 'unset',
      });
      setDetails(current => current.map(record => record.id === recordId ? {
        ...record,
        transportation: body.transportation || [],
        transportation_status: body.transportationStatus || 'unset',
      } : record));
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : '交通費を保存できませんでした。');
      return false;
    } finally {
      setProcessing('');
    }
  };

  const deleteRecord = async (record: any) => {
    if (!confirm(`${record.teacher_name}さんの${record.date}の打刻と勤務詳細を削除しますか？`)) return;
    setProcessing(`delete_${record.id}`);
    try {
      await post({ action: 'delete_record', work_record_id: record.id });
      setDetails(current => current.filter(item => item.id !== record.id));
    } catch (error) {
      alert(error instanceof Error ? error.message : '打刻を削除できませんでした。');
    } finally { setProcessing(''); }
  };

  const pendingCorrections = useMemo(
    () => corrections.filter(item => (item.status || 'pending') === 'pending'),
    [corrections]
  );
  const visibleCorrections = useMemo(() => pendingCorrections.filter(item => (
    !selectedSchool || String(item.school_id || '') === selectedSchool
  )), [pendingCorrections, selectedSchool]);
  const schoolOptions = useMemo(() => {
    const options = new Map<string, string>();
    details.forEach(record => {
      if (record.school_id) options.set(String(record.school_id), String(record.school_name || record.school_id));
      record.work_segments.forEach((segment: any) => {
        if (segment.school_id) options.set(String(segment.school_id), String(segment.school_name || segment.school_id));
      });
    });
    pendingCorrections.forEach(item => {
      if (item.school_id) options.set(String(item.school_id), String(item.school_name || item.school_id));
    });
    return Array.from(options, ([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [details, pendingCorrections]);
  const schoolFilteredDetails = useMemo(() => details.filter(record => (
    !selectedSchool
    || record.school_id === selectedSchool
    || record.work_segments.some((segment: any) => segment.school_id === selectedSchool)
  )), [details, selectedSchool]);
  const programFilteredDetails = useMemo(() => schoolFilteredDetails.filter(record => (
    programFilter === 'all'
    || (programFilter === 'science_social' && includesScienceSocial(record))
    || (programFilter === 'breakthrough' && includesBreakthrough(record))
  )), [programFilter, schoolFilteredDetails]);
  const visibleDetails = useMemo(() => programFilteredDetails.filter(record => (
    viewFilter === 'all' || recordNeedsReview(record)
  )), [programFilteredDetails, viewFilter]);
  const dateGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    visibleDetails.forEach(record => groups.set(record.date, [...(groups.get(record.date) || []), record]));
    return Array.from(groups, ([date, records]) => ({ date, records })).sort((a, b) => b.date.localeCompare(a.date));
  }, [visibleDetails]);
  const selectableKeys = useMemo(() => visibleDetails.flatMap(record => record.work_segments
    .filter(needsReview)
    .map((segment: any) => selectionKey(record.id, segment.id))), [visibleDetails]);
  const allVisibleSelected = selectableKeys.length > 0 && selectableKeys.every(key => selectedApprovals.has(key));
  const toggleSelection = (recordId: string, segmentId: string) => {
    const key = selectionKey(recordId, segmentId);
    setSelectedApprovals(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleSelections = (keys: string[]) => {
    if (!keys.length) return;
    setSelectedApprovals(current => {
      const next = new Set(current);
      const remove = keys.every(key => next.has(key));
      keys.forEach(key => remove ? next.delete(key) : next.add(key));
      return next;
    });
  };
  const toggleAllVisible = () => {
    toggleSelections(selectableKeys);
  };
  const pendingCount = useMemo(() => programFilteredDetails.reduce(
    (sum, record) => sum + pendingReviewCount(record),
    0
  ), [programFilteredDetails]);
  const pendingPeople = useMemo(
    () => programFilteredDetails.filter(recordNeedsReview).length,
    [programFilteredDetails]
  );
  const scienceSocialCount = useMemo(
    () => schoolFilteredDetails.filter(includesScienceSocial).length,
    [schoolFilteredDetails]
  );

  if (authLoading || !profile) {
    return <main className="grid min-h-screen place-items-center p-6"><Loader2 className="animate-spin text-emerald-600" size={34} /></main>;
  }
  if (!allowed) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CircleAlert className="mx-auto text-amber-500" size={34} />
          <p className="mt-4 font-black text-slate-800">勤怠の承認権限がありません。</p>
          <Link href={backHref} className={`mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white ${focusRing}`}>
            <ArrowLeft size={16} />戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7fa] px-3 py-4 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)]">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              <Link
                href={backHref}
                aria-label="前の画面へ戻る"
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 ${focusRing}`}
              >
                <ArrowLeft size={19} />
              </Link>
              <div className="min-w-0">
                <p className="text-xs font-black tracking-wide text-emerald-700">
                  {mode === 'school_manager' ? '担当校舎の勤怠管理' : '勤怠管理者メニュー'}
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">勤怠承認</h1>
                <p className="mt-1.5 text-xs font-bold leading-5 text-slate-500 sm:text-sm">
                  内容を確認し、勤務実績ごとに承認または差し戻しを行ってください。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => showCreate ? setShowCreate(false) : void openCreate()}
                className={`inline-flex min-h-11 items-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-500 ${focusRing}`}
              >
                <Plus size={17} />新規実績
              </button>
              {updatedAt && (
                <p className="text-[11px] font-bold text-slate-400">
                  最終更新 {updatedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <button
                type="button"
                aria-label="最新の情報に更新"
                title="最新の情報に更新"
                onClick={() => void load()}
                disabled={loading}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="grid border-t border-slate-100 bg-slate-50/80 sm:grid-cols-2 xl:grid-cols-4 sm:divide-x sm:divide-slate-200">
            <Summary icon={<CircleAlert size={20} />} label="要確認の実績" value={`${pendingCount}件`} note={`${pendingPeople}名分`} tone="amber" />
            <Summary icon={<Clock3 size={20} />} label="打刻修正依頼" value={`${visibleCorrections.length}件`} note={selectedSchool ? '選択校舎・未処理' : '全校舎・未処理'} tone="rose" />
            <Summary icon={<Building2 size={20} />} label="対象校舎" value={`${selectedSchool ? 1 : schoolOptions.length}校舎`} note={selectedSchool ? schoolOptions.find(school => school.code === selectedSchool)?.name : 'すべて表示'} tone="emerald" />
            <Summary icon={<BookOpen size={20} />} label="理社講座の勤務" value={`${scienceSocialCount}名`} note={programFilter === 'science_social' ? '絞り込み中' : '対象月'} tone="sky" />
          </div>
        </header>

        {loadError && (
          <div role="alert" className="flex items-start justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            <span className="flex items-start gap-2"><CircleAlert className="mt-0.5 shrink-0" size={17} />{loadError}</span>
            <button type="button" onClick={() => void load()} className={`shrink-0 underline underline-offset-2 ${focusRing}`}>再試行</button>
          </div>
        )}

        {successMessage && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
            <span className="flex min-w-0 items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0" size={17} /><span className="break-words [overflow-wrap:anywhere]">{successMessage}</span></span>
            <button type="button" onClick={() => setSuccessMessage('')} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-black text-emerald-700 hover:bg-emerald-100 ${focusRing}`}>閉じる</button>
          </div>
        )}

        {profile?.role === 'master' && reconciliationAlerts.length > 0 && (
          <section className="min-w-0 rounded-3xl border-2 border-amber-300 bg-amber-50 p-5" aria-label="理社講座の照合アラート">
            <h2 className="flex flex-wrap items-center gap-2 whitespace-normal font-black text-amber-950"><CircleAlert className="shrink-0" size={19} />理社講座の講師配置との不一致</h2>
            <div className="mt-3 space-y-2">
              {reconciliationAlerts.map(alertItem => (
                <div key={`${alertItem.shift_id}-${alertItem.code}`} className="min-w-0 rounded-xl bg-white px-4 py-3 text-sm font-bold text-amber-900">
                  <div className="flex min-w-0 flex-wrap items-start gap-2 sm:gap-x-3">
                    <span className="max-w-full break-words whitespace-normal font-black [overflow-wrap:anywhere]">{alertItem.date}・{alertItem.teacher_name}</span>
                    <span className="min-w-0 basis-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] sm:basis-64 sm:flex-1">{alertItem.message}</span>
                    {alertItem.record_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setJumpRecordId(alertItem.record_id);
                          window.setTimeout(() => document.getElementById(`attendance-record-${alertItem.record_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
                        }}
                        className={`min-h-10 shrink-0 self-stretch rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-black text-white sm:min-h-0 sm:self-start ${focusRing}`}
                      >
                        該当実績へ
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {showCreate && (
          <section className="rounded-3xl border-2 border-emerald-200 bg-white p-5 shadow-sm" aria-label="勤務実績の新規作成">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-[11px] font-black tracking-wide text-emerald-600">NEW WORK RECORD</p><h2 className="text-lg font-black text-slate-950">職員の勤務実績を作成</h2></div>
              <button type="button" onClick={() => setShowCreate(false)} className={`grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600 ${focusRing}`}><X size={17} /></button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>職員</span><select value={newRecord.teacherId} onChange={event => { const item = staff.find(value => value.id === event.target.value); setNewRecord(value => ({ ...value, teacherId: event.target.value, schoolId: item?.school_id || value.schoolId })); }} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`}><option value="">選択してください</option>{staff.map(item => <option key={item.id} value={item.id}>{item.name}{item.login_id ? `（${item.login_id}）` : ''}</option>)}</select></label>
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>勤務日</span><input type="date" value={newRecord.date} onChange={event => setNewRecord(value => ({ ...value, date: event.target.value }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`} /></label>
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>勤務校舎</span><select value={newRecord.schoolId} onChange={event => setNewRecord(value => ({ ...value, schoolId: event.target.value }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`}><option value="">選択してください</option>{ATTENDANCE_SCHOOL_DIRECTORY.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>出勤</span><FiveMinuteTimeSelect value={newRecord.start} onChange={start => setNewRecord(value => ({ ...value, start }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`} /></label>
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>退勤</span><FiveMinuteTimeSelect value={newRecord.end} onChange={end => setNewRecord(value => ({ ...value, end }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`} /></label>
              <label className="grid gap-1 text-xs font-black text-slate-600"><span>勤務内容</span><select disabled={newRecord.useShiftBase || newRecord.clockOnly} value={newRecord.type} onChange={event => setNewRecord(value => ({ ...value, type: event.target.value, officeTask: event.target.value === 'office' ? value.officeTask || 'lesson_preparation' : value.officeTask }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 disabled:bg-slate-100 ${focusRing}`}><option value="office">事務</option><option value="lesson">集団授業</option><option value="individual">個別授業</option><option value="support">サブ（サポート）</option><option value="other">その他</option></select></label>
              {newRecord.type === 'office' && !newRecord.useShiftBase && !newRecord.clockOnly && <label className="grid gap-1 text-xs font-black text-slate-600"><span>事務内容</span><select value={newRecord.officeTask} onChange={event => setNewRecord(value => ({ ...value, officeTask: event.target.value }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`}>{OFFICE_TASK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
              {(newRecord.type === 'lesson' || newRecord.type === 'individual') && !newRecord.useShiftBase && <label className="grid gap-1 text-xs font-black text-slate-600"><span>学年{newRecord.type === 'individual' ? '（任意）' : ''}</span><select value={newRecord.grade} onChange={event => setNewRecord(value => ({ ...value, grade: event.target.value }))} className={`min-h-11 rounded-xl border border-slate-200 px-3 ${focusRing}`}><option value="">{newRecord.type === 'individual' ? '指定なし' : '選択してください'}</option>{ATTENDANCE_GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-950"><input type="checkbox" checked={newRecord.clockOnly} onChange={event => setNewRecord(value => ({ ...value, clockOnly: event.target.checked, useShiftBase: event.target.checked ? false : value.useShiftBase }))} className="mt-0.5 h-5 w-5 accent-emerald-600" /><span>まず打刻時間だけ作成する<span className="mt-1 block text-xs font-bold text-emerald-700">作成後に事務・授業などを複数行でまとめて登録できます。</span></span></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-black text-indigo-950"><input type="checkbox" checked={newRecord.useShiftBase} onChange={event => setNewRecord(value => ({ ...value, useShiftBase: event.target.checked, clockOnly: event.target.checked ? false : value.clockOnly }))} className="mt-0.5 h-5 w-5 accent-indigo-600" /><span>勤怠シフトから詳細を作成する<span className="mt-1 block text-xs font-bold text-indigo-700">承認者が登録した集団・個別・事務の勤務予定を自動展開します。</span></span></label>
            </div>
            <div className="mt-4">
              <TransportationEditor
                items={newRecord.transportation}
                setItems={transportation => setNewRecord(value => ({ ...value, transportation }))}
                none={newRecord.transportationNone}
                setNone={transportationNone => setNewRecord(value => ({ ...value, transportationNone, transportation: transportationNone ? [] : value.transportation }))}
                title="交通費（任意）"
              />
            </div>
            <div className="mt-4 flex justify-end"><button type="button" disabled={Boolean(processing)} onClick={() => void createRecord()} className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-50 ${focusRing}`}>{processing === 'create_record' ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}実績を作成</button></div>
          </section>
        )}

        <section aria-label="表示条件" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-800">
            <ListFilter size={17} className="text-indigo-600" />表示する勤怠を絞り込む
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(10rem,0.7fr)_minmax(13rem,1fr)_minmax(12rem,0.85fr)_auto] xl:items-end">
            <label className="grid gap-1.5 text-xs font-black text-slate-600">
              <span>対象月</span>
              <input
                type="month"
                value={month}
                onChange={event => { setMonth(event.target.value); setSelectedSchool(''); }}
                className={`min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 transition hover:border-slate-300 ${focusRing}`}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-black text-slate-600">
              <span>勤務校舎</span>
              <select
                value={selectedSchool}
                onChange={event => setSelectedSchool(event.target.value)}
                className={`min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 transition hover:border-slate-300 ${focusRing}`}
              >
                <option value="">すべての関係校舎</option>
                {schoolOptions.map(school => <option key={school.code} value={school.code}>{school.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-black text-slate-600">
              <span className="inline-flex items-center gap-1.5"><BookOpen size={14} className="text-blue-600" />勤務区分</span>
              <select
                value={programFilter}
                onChange={event => setProgramFilter(event.target.value as ProgramFilter)}
                className={`min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 transition hover:border-slate-300 ${focusRing}`}
              >
                <option value="all">すべての勤務</option>
                <option value="science_social">理社講座を含む勤務のみ</option>
                <option value="breakthrough">突破ゼミを含む勤務のみ</option>
              </select>
            </label>
            <div role="group" aria-label="承認状態" className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <FilterButton active={viewFilter === 'pending'} onClick={() => setViewFilter('pending')}>要確認</FilterButton>
              <FilterButton active={viewFilter === 'all'} onClick={() => setViewFilter('all')}>すべて</FilterButton>
            </div>
          </div>
          <p className="mt-3 text-[11px] font-bold text-slate-400">
            {programFilter === 'science_social' ? '理社講座の勤務詳細を1件以上含む日だけを表示中です。 ' : ''}
            {programFilter === 'breakthrough' ? '突破ゼミの勤務詳細を1件以上含む日だけを表示中です。 ' : ''}
            {viewFilter === 'pending' ? 'あなたが承認できる、承認待ちの実績だけを表示しています。' : '承認済み・差し戻し済みを含むすべての勤務実績を表示しています。'}
          </p>
        </section>

        <CorrectionSection
          items={visibleCorrections}
          processing={processing}
          selected={selectedCorrections}
          onToggle={id => setSelectedCorrections(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onToggleAll={() => setSelectedCorrections(current => {
            const visibleIds = visibleCorrections.map(item => String(item.id));
            const allSelected = visibleIds.length > 0 && visibleIds.every(id => current.has(id));
            const next = new Set(current);
            visibleIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
            return next;
          })}
          onApproveSelected={approveSelectedCorrections}
          onReview={reviewCorrection}
        />

        <section aria-labelledby="work-approval-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
            <div>
              <p className="text-[11px] font-black tracking-wide text-indigo-600">WORK RECORDS</p>
              <h2 id="work-approval-heading" className="mt-0.5 text-lg font-black text-slate-950">勤務実績の確認</h2>
            </div>
            {!loading && <p className="text-xs font-bold text-slate-500">{visibleDetails.length}名・{dateGroups.length}日分を表示</p>}
          </div>
          {!loading && selectableKeys.length > 0 && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-3 text-sm font-black text-indigo-950">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  className={`h-5 w-5 rounded border-indigo-300 text-indigo-600 ${focusRing}`}
                />
                表示中の承認待ちをすべて選択
                <span className="rounded-full bg-white px-2.5 py-1 text-xs text-indigo-700">{selectableKeys.length}件</span>
              </label>
              <p className="text-xs font-bold text-indigo-700">承認する明細にチェックを付けてください</p>
            </div>
          )}
          {loading ? (
            <div className="grid min-h-56 place-items-center rounded-3xl border border-slate-200 bg-white" aria-live="polite">
              <div className="text-center">
                <Loader2 className="mx-auto animate-spin text-indigo-600" size={32} />
                <p className="mt-3 text-xs font-bold text-slate-500">勤怠データを読み込んでいます</p>
              </div>
            </div>
          ) : dateGroups.length ? (
            <div className="space-y-5">
              {dateGroups.map(group => (
                <DateGroup
                  key={group.date}
                  date={group.date}
                  records={group.records}
                  canReject={canReject}
                  canUnlock={canUnlock}
                  processing={processing}
                  clockEdit={clockEdit}
                  setClockEdit={setClockEdit}
                  onSaveClock={saveClockEdit}
                  onSaveSegment={saveSegmentEdit}
                  onSaveSegments={saveSegments}
                  onSaveTransportation={saveTransportation}
                  onDeleteRecord={deleteRecord}
                  jumpRecordId={jumpRecordId}
                  onReview={reviewSegment}
                  selectedApprovals={selectedApprovals}
                  onToggleSelection={toggleSelection}
                  onToggleSelections={toggleSelections}
                />
              ))}
            </div>
          ) : (
            <Empty allClear={viewFilter === 'pending' && !loadError} />
          )}
        </section>
      </div>
      {selectedApprovals.size > 0 && (
        <div className="sticky bottom-20 z-30 mx-auto mt-5 flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white shadow-2xl sm:bottom-3 sm:flex-row sm:items-center sm:justify-between" role="region" aria-label="選択した勤務の一括操作">
          <div>
            <p className="text-sm font-black">{selectedApprovals.size}件を選択中</p>
            <p className="text-[11px] font-bold text-slate-400">選択した勤務実績だけをまとめて承認します</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={Boolean(processing)} onClick={() => setSelectedApprovals(new Set())} className={`min-h-11 rounded-xl border border-slate-600 px-4 text-xs font-black hover:bg-slate-800 disabled:opacity-50 ${focusRing}`}>選択解除</button>
            <button type="button" disabled={Boolean(processing)} onClick={() => void approveSelected()} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-xs font-black text-white hover:bg-emerald-400 disabled:opacity-50 ${focusRing}`}>
              {processing === 'selected' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}選択した{selectedApprovals.size}件を一括承認
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Summary({ icon, label, value, note, tone }: {
  icon: ReactNode;
  label: string;
  value: string;
  note?: string;
  tone: 'amber' | 'rose' | 'emerald' | 'indigo' | 'sky';
}) {
  const tones = {
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    sky: 'bg-sky-100 text-sky-700',
  };
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 last:border-b-0 sm:border-b-0 sm:px-6">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-black text-slate-500">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <p className="text-xl font-black tracking-tight text-slate-950">{value}</p>
          {note && <p className="truncate text-[10px] font-bold text-slate-400">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 rounded-lg px-4 text-xs font-black transition ${focusRing} ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function CorrectionSection({ items, processing, selected, onToggle, onToggleAll, onApproveSelected, onReview }: {
  items: any[];
  processing: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onApproveSelected: () => void;
  onReview: (id: string, status: 'approved' | 'rejected') => void;
}) {
  const selectedCount = items.filter(item => selected.has(String(item.id))).length;
  const allSelected = items.length > 0 && selectedCount === items.length;
  return (
    <section aria-labelledby="clock-correction-heading">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-black tracking-wide text-amber-600">CLOCK CORRECTIONS</p>
          <h2 id="clock-correction-heading" className="mt-0.5 flex flex-wrap items-center gap-2 whitespace-normal text-lg font-black text-slate-950">
            打刻修正依頼
            {items.length > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-800">{items.length}</span>}
          </h2>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="h-4 w-4 accent-emerald-600" />
              全て選択
            </label>
            <button
              type="button"
              disabled={!selectedCount || Boolean(processing)}
              onClick={onApproveSelected}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
            >
              {processing === 'corrections_selected' ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
              選択した{selectedCount}件を一括承認
            </button>
          </div>
        )}
      </div>
      {items.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map(item => {
            const itemId = String(item.id);
            const checked = selected.has(itemId);
            const busy = processing === `correction_${item.id}` || processing === 'corrections_selected';
            const scienceSocial = item.school_id === SCIENCE_SOCIAL_WORKPLACE_ID || item.school_name === SCIENCE_SOCIAL_WORKPLACE_LABEL;
            return (
              <article key={item.id} className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${checked ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-amber-200'}`}>
                <div className="border-l-4 border-amber-400 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`${item.teacher_name || '講師未設定'} ${item.target_date || ''}の打刻修正依頼を選択`}
                        checked={checked}
                        disabled={Boolean(processing)}
                        onChange={() => onToggle(itemId)}
                        className="mt-2 h-5 w-5 shrink-0 accent-emerald-600"
                      />
                      <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><UserRound size={17} /></span>
                        <div className="min-w-0">
                          <h3 className="break-words font-black text-slate-950 [overflow-wrap:anywhere]">{item.teacher_name || '講師未設定'}</h3>
                          <p className="break-words text-[11px] font-bold text-slate-500 [overflow-wrap:anywhere]">{item.target_date}</p>
                        </div>
                      </div>
                      <p className={`mt-2 flex w-full max-w-full flex-wrap items-start gap-x-1.5 gap-y-1 rounded-2xl px-2.5 py-1 text-xs font-black whitespace-normal ${scienceSocial ? 'bg-indigo-100 text-indigo-800' : 'bg-sky-50 text-sky-700'}`}>
                        {scienceSocial ? <BookOpen size={13} className="mt-0.5 shrink-0" /> : <MapPin size={13} className="mt-0.5 shrink-0" />}
                        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{scienceSocial ? '勤務区分: 理社講座' : `勤務校舎: ${item.school_name || '未取得'}`}</span>
                        {!scienceSocial && item.school_id && <span className="break-all font-mono text-[10px] text-sky-500">({item.school_id})</span>}
                      </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-800">承認待ち</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-950 px-4 py-3 text-white">
                    <Clock3 size={18} className="shrink-0 text-amber-300" />
                    <p className="min-w-0 break-words font-mono text-lg font-black tracking-tight [overflow-wrap:anywhere]">{time(item.requested_start_time)}<span className="mx-2 text-slate-500">→</span>{time(item.requested_end_time)}</p>
                  </div>
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                    <p className="text-[10px] font-black text-slate-400">申請理由</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-slate-700 [overflow-wrap:anywhere]">{item.reason || '理由は入力されていません。'}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onReview(item.id, 'rejected')}
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 ${focusRing}`}
                    >
                      <XCircle size={15} />差し戻す
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onReview(item.id, 'approved')}
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50 ${focusRing}`}
                    >
                      {busy ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}承認する
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0" />未処理の打刻修正依頼はありません。
        </div>
      )}
    </section>
  );
}

function DateGroup({ date, records, canReject, canUnlock, processing, clockEdit, setClockEdit, onSaveClock, onSaveSegment, onSaveSegments, onSaveTransportation, onDeleteRecord, onReview, selectedApprovals, onToggleSelection, onToggleSelections, jumpRecordId }: {
  date: string;
  records: any[];
  canReject: boolean;
  canUnlock: boolean;
  processing: string;
  clockEdit: ClockEdit | null;
  setClockEdit: Dispatch<SetStateAction<ClockEdit | null>>;
  onSaveClock: (record: any) => void;
  onSaveSegment: (recordId: string, segmentId: string, segment: SegmentEdit) => Promise<boolean>;
  onSaveSegments: (recordId: string, segments: SegmentEdit[]) => Promise<boolean>;
  onSaveTransportation: (recordId: string, items: TransportationDraft[], none: boolean) => Promise<boolean>;
  onDeleteRecord: (record: any) => void;
  onReview: (recordId: string, segmentId: string, status: 'approved' | 'rejected' | 'pending') => void;
  selectedApprovals: Set<string>;
  onToggleSelection: (recordId: string, segmentId: string) => void;
  onToggleSelections: (keys: string[]) => void;
  jumpRecordId: string;
}) {
  const pending = records.reduce(
    (sum, record) => sum + pendingReviewCount(record),
    0
  );
  const dateKeys = records.flatMap(record => record.work_segments
    .filter(needsReview)
    .map((segment: any) => selectionKey(record.id, segment.id)));
  const selectedCount = dateKeys.filter(key => selectedApprovals.has(key)).length;
  const allSelected = dateKeys.length > 0 && selectedCount === dateKeys.length;
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-600 text-white shadow-sm"><CalendarDays size={20} /></span>
          <div>
            <h3 className="text-base font-black text-slate-950 sm:text-lg">{dateHeading(date)}</h3>
            <p className="text-[11px] font-bold text-slate-500">{records.length}名の勤務記録</p>
          </div>
        </div>
        {pending > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {dateKeys.length > 0 && (
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-800">
                <input type="checkbox" checked={allSelected} onChange={() => onToggleSelections(dateKeys)} aria-label={`${dateHeading(date)}の承認待ちをすべて選択`} className={`h-5 w-5 rounded border-indigo-300 text-indigo-600 ${focusRing}`} />
                この日を全部チェック
                {selectedCount > 0 && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px]">{selectedCount}/{dateKeys.length}</span>}
              </label>
            )}
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">要確認 {pending}件</span>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"><Check size={13} />確認済み</span>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {records.map(record => (
          <RecordCard
            key={record.id}
            record={record}
            canReject={canReject}
            canUnlock={canUnlock}
            processing={processing}
            clockEdit={clockEdit}
            setClockEdit={setClockEdit}
            onSaveClock={onSaveClock}
            onSaveSegment={onSaveSegment}
            onSaveSegments={onSaveSegments}
            onSaveTransportation={onSaveTransportation}
            onDeleteRecord={onDeleteRecord}
            onReview={onReview}
            selectedApprovals={selectedApprovals}
            onToggleSelection={onToggleSelection}
            onToggleSelections={onToggleSelections}
            jumpRecordId={jumpRecordId}
          />
        ))}
      </div>
    </section>
  );
}

function RecordCard({ record, canReject, canUnlock, processing, clockEdit, setClockEdit, onSaveClock, onSaveSegment, onSaveSegments, onSaveTransportation, onDeleteRecord, onReview, selectedApprovals, onToggleSelection, onToggleSelections, jumpRecordId }: {
  record: any;
  canReject: boolean;
  canUnlock: boolean;
  processing: string;
  clockEdit: ClockEdit | null;
  setClockEdit: Dispatch<SetStateAction<ClockEdit | null>>;
  onSaveClock: (record: any) => void;
  onSaveSegment: (recordId: string, segmentId: string, segment: SegmentEdit) => Promise<boolean>;
  onSaveSegments: (recordId: string, segments: SegmentEdit[]) => Promise<boolean>;
  onSaveTransportation: (recordId: string, items: TransportationDraft[], none: boolean) => Promise<boolean>;
  onDeleteRecord: (record: any) => void;
  onReview: (recordId: string, segmentId: string, status: 'approved' | 'rejected' | 'pending') => void;
  selectedApprovals: Set<string>;
  onToggleSelection: (recordId: string, segmentId: string) => void;
  onToggleSelections: (keys: string[]) => void;
  jumpRecordId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [drafts, setDrafts] = useState<Array<SegmentEdit & { id: string }>>([]);
  const [transportEditing, setTransportEditing] = useState(false);
  const [transportDrafts, setTransportDrafts] = useState<TransportationDraft[]>([]);
  const [transportationNone, setTransportationNone] = useState(false);
  const transportTotal = (record.transportation || []).reduce((sum: number, item: any) => sum + (Number(item.cost) || 0), 0);
  const pending = record.work_segments.filter(needsReview).length;
  const missing = detailMissing(record);
  const scienceSocial = includesScienceSocial(record);
  const recordKeys = record.work_segments.filter(needsReview).map((segment: any) => selectionKey(record.id, segment.id));
  const recordSelectedCount = recordKeys.filter((key: string) => selectedApprovals.has(key)).length;
  const recordAllSelected = recordKeys.length > 0 && recordSelectedCount === recordKeys.length;
  const isJumpTarget = jumpRecordId === record.id;

  useEffect(() => {
    if (isJumpTarget) setExpanded(true);
  }, [isJumpTarget]);

  return (
    <article
      id={`attendance-record-${record.id}`}
      className={`scroll-mt-6 p-3 transition sm:px-5 sm:py-4 ${scienceSocial ? 'bg-sky-50/30 ring-1 ring-inset ring-sky-100' : ''} ${isJumpTarget ? 'relative z-10 ring-2 ring-inset ring-amber-400' : ''}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {recordKeys.length > 0 && (
            <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-indigo-200 bg-white px-2.5 text-[10px] font-black text-indigo-700" title="この人のこの日の承認待ちをすべて選択">
              <input type="checkbox" checked={recordAllSelected} onChange={() => onToggleSelections(recordKeys)} aria-label={`${record.teacher_name || '講師'}さんの${dateHeading(record.date)}の承認待ちをすべて選択`} className={`h-5 w-5 rounded border-indigo-300 text-indigo-600 ${focusRing}`} />
              <span>承認</span>
            </label>
          )}
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${pending > 0 || missing ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            <UserRound size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-black text-slate-950">{record.teacher_name || '講師未設定'}</h4>
              {scienceSocial && <span className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-black text-white"><BookOpen size={11} />理社講座勤務あり</span>}
              {missing ? (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-900">勤怠詳細未登録</span>
              ) : pending > 0 ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-800">要確認 {pending}件{recordSelectedCount > 0 ? `・${recordSelectedCount}件選択` : ''}</span>
              ) : record.detail_approval_status === 'rejected' ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-700">差し戻し済み</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700"><Check size={11} />すべて承認済み</span>
              )}
              {record.can_edit_clock && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-700">打刻修正可</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-600">
              <span className="inline-flex items-center gap-1.5"><Clock3 size={14} className="text-slate-400" />{time(record.start_time)}〜{time(record.end_time)}<span className="text-slate-400">（{durationLabel(record.start_time, record.end_time)}）</span></span>
              {record.school_name && <span className="inline-flex items-center gap-1.5"><Building2 size={14} className="text-slate-400" />所属 {record.school_name}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
        {record.can_edit_clock && (
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setDrafts(record.work_segments.length ? record.work_segments.map((segment: any) => ({ id: segment.id, ...segmentDraft(segment) })) : [{ id: crypto.randomUUID(), start: timeInputValue(record.start_time), end: timeInputValue(record.end_time), type: 'office', program: 'normal', school_id: record.school_id, office_task: 'lesson_preparation' }]);
              setBulkEditing(true);
            }}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700 ${focusRing}`}
          ><ListFilter size={14} />勤務詳細をまとめて編集</button>
        )}
        {record.can_edit_clock && (
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setTransportDrafts((record.transportation || []).map((item: any) => ({
                transport_type: String(item.transport_type || 'train'), route_line: String(item.route_line || ''),
                from: String(item.from || ''), to: String(item.to || ''),
                trip_type: item.trip_type === 'one_way' ? 'one_way' : 'round_trip', cost: Number(item.cost || 0),
              })));
              setTransportationNone(record.transportation_status === 'none');
              setTransportEditing(true);
            }}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 text-xs font-black text-sky-700 ${focusRing}`}
          ><Train size={14} />交通費を編集・追加</button>
        )}
        {record.can_edit_clock && (
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setClockEdit({ recordId: record.id, start: timeInputValue(record.start_time), end: timeInputValue(record.end_time) });
            }}
            className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 ${focusRing}`}
          >
            <Pencil size={14} />打刻時刻を修正
          </button>
        )}
        {record.can_edit_clock && (
          <button type="button" disabled={processing === `delete_${record.id}`} onClick={() => onDeleteRecord(record)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 disabled:opacity-50 ${focusRing}`}>
            {processing === `delete_${record.id}` ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}打刻を削除
          </button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`attendance-detail-${record.id}`}
          onClick={() => setExpanded(value => !value)}
          className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 ${focusRing}`}
        >
          <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? '詳細を閉じる' : '詳細を表示'}
        </button>
        </div>
      </div>

      {expanded && (
      <div id={`attendance-detail-${record.id}`}>
      {clockEdit?.recordId === record.id && (
        <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="mb-3 text-xs font-black text-indigo-900">打刻時刻を修正</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-xs font-black text-indigo-900">
              <span>出勤時刻</span>
              <FiveMinuteTimeSelect value={clockEdit?.start || ''} onChange={start => setClockEdit(current => current ? { ...current, start } : current)} className={`min-h-10 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 ${focusRing}`} />
            </label>
            <ChevronRight className="mb-2 hidden text-indigo-300 sm:block" size={18} />
            <label className="grid gap-1 text-xs font-black text-indigo-900">
              <span>退勤時刻</span>
              <FiveMinuteTimeSelect value={clockEdit?.end || ''} onChange={end => setClockEdit(current => current ? { ...current, end } : current)} className={`min-h-10 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 ${focusRing}`} />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={processing === `clock_${record.id}`} onClick={() => onSaveClock(record)} className={`inline-flex min-h-10 items-center gap-1 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white disabled:opacity-50 ${focusRing}`}>
                {processing === `clock_${record.id}` ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}保存
              </button>
              <button type="button" onClick={() => setClockEdit(null)} aria-label="時刻修正をキャンセル" className={`grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 ${focusRing}`}><X size={15} /></button>
            </div>
          </div>
        </div>
      )}

      {bulkEditing && (
        <div className="mt-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-black text-indigo-950">勤務詳細をまとめて編集</p><p className="text-xs font-bold text-indigo-700">打刻時間内で、事務・授業・休憩を必要な数だけ追加してください。休憩も時刻を変更できます。</p></div>
            <button type="button" onClick={() => setDrafts(current => [...current, { id: crypto.randomUUID(), start: current.at(-1)?.end || timeInputValue(record.start_time), end: timeInputValue(record.end_time), type: 'office', program: 'normal', school_id: record.school_id, office_task: 'lesson_preparation' }])} className={`inline-flex min-h-10 items-center gap-1 rounded-xl bg-white px-3 text-xs font-black text-indigo-700 ${focusRing}`}><Plus size={14} />行を追加</button>
          </div>
          <div className="space-y-3">
            {drafts.map((draft, index) => (
              <div key={draft.id} className="rounded-2xl border border-indigo-100 bg-white p-3">
                <div className="mb-1 flex justify-between"><span className="text-xs font-black text-slate-500">詳細 {index + 1}</span><button type="button" onClick={() => setDrafts(current => current.filter(item => item.id !== draft.id))} className="text-rose-600" aria-label={`詳細${index + 1}を削除`}><Trash2 size={16} /></button></div>
                <SegmentEditForm draft={draft} setDraft={update => setDrafts(current => current.map(item => item.id === draft.id ? { ...item, ...(typeof update === 'function' ? update(item) : update) } : item))} busy={false} onSave={() => {}} onCancel={() => {}} hideActions />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setBulkEditing(false)} className={`min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black ${focusRing}`}>キャンセル</button>
            <button type="button" disabled={processing === `segments_${record.id}` || drafts.length === 0} onClick={async () => { if (await onSaveSegments(record.id, drafts)) setBulkEditing(false); }} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white disabled:opacity-50 ${focusRing}`}>{processing === `segments_${record.id}` ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}すべてまとめて保存</button>
          </div>
        </div>
      )}

      {!missing && <WorkTimeline record={record} />}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.8fr)]">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h5 className="flex items-center gap-2 text-xs font-black text-slate-600"><Eye size={15} />勤務内容</h5>
            <p className="text-[10px] font-bold text-slate-400">内容と勤務校舎を確認してください</p>
          </div>
          <div className="space-y-2">
            {missing && (
              <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-xs font-black text-amber-800">勤務詳細が登録されていないため、承認できません。</div>
            )}
            {record.work_segments.map((segment: any) => (
              <SegmentCard key={segment.id} recordId={record.id} segment={segment} canReject={canReject} canUnlock={canUnlock} processing={processing} onReview={onReview} onSaveEdit={onSaveSegment} selected={selectedApprovals.has(selectionKey(record.id, segment.id))} onToggleSelection={onToggleSelection} />
            ))}
          </div>
        </section>
        <div>
          <TransportationPanel items={record.transportation || []} total={transportTotal} status={record.transportation_status} />
          {transportEditing && (
            <div className="mt-3">
              <TransportationEditor items={transportDrafts} setItems={setTransportDrafts} none={transportationNone} setNone={setTransportationNone} title="交通費を修正" />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setTransportEditing(false)} className={`min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black ${focusRing}`}>キャンセル</button>
                <button type="button" disabled={processing === `transportation_${record.id}`} onClick={async () => { if (await onSaveTransportation(record.id, transportDrafts, transportationNone)) setTransportEditing(false); }} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-black text-white disabled:opacity-50 ${focusRing}`}>
                  {processing === `transportation_${record.id}` ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}交通費を保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </article>
  );
}

function WorkTimeline({ record }: { record: any }) {
  const toMinutes = (value: string) => {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : NaN;
  };
  const startLabel = timeInputValue(record.start_time);
  const endLabel = timeInputValue(record.end_time);
  const rangeStart = toMinutes(startLabel);
  const rangeEnd = toMinutes(endLabel);
  const duration = rangeEnd - rangeStart;
  if (!Number.isFinite(duration) || duration <= 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="勤務時間タイムライン">
      <div className="mb-2 flex items-center justify-between text-[10px] font-black text-slate-500">
        <span>{startLabel}</span>
        <span>勤務内容の時間配分</span>
        <span>{endLabel}</span>
      </div>
      <div className="relative h-10 overflow-hidden rounded-xl bg-slate-200 ring-1 ring-inset ring-slate-300">
        {record.work_segments.map((segment: any) => {
          const segmentStart = toMinutes(segment.start);
          const segmentEnd = toMinutes(segment.end);
          if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return null;
          const left = Math.max(0, Math.min(100, ((segmentStart - rangeStart) / duration) * 100));
          const right = Math.max(0, Math.min(100, ((segmentEnd - rangeStart) / duration) * 100));
          const width = Math.max(1, right - left);
          return (
            <div
              key={segment.id}
              className={`absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-lg px-1 text-[9px] font-black text-white shadow-sm ${segmentToneClass(segment, 'bar')}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${segment.start}〜${segment.end} ${ATTENDANCE_PROGRAM_LABELS[segmentProgram(segment)]}・${typeLabel(segment.type)}`}
            >
              {width >= 14 ? typeLabel(segment.type) : ''}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SegmentCard({ recordId, segment, canReject, canUnlock, processing, onReview, onSaveEdit, selected, onToggleSelection }: {
  recordId: string;
  segment: any;
  canReject: boolean;
  canUnlock: boolean;
  processing: string;
  onReview: (recordId: string, segmentId: string, status: 'approved' | 'rejected' | 'pending') => void;
  onSaveEdit: (recordId: string, segmentId: string, segment: SegmentEdit) => Promise<boolean>;
  selected: boolean;
  onToggleSelection: (recordId: string, segmentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SegmentEdit>(() => segmentDraft(segment));
  const busy = processing === `${recordId}_${segment.id}`;
  const editBusy = processing === `edit_${recordId}_${segment.id}`;
  const details = [
    segment.grade && `学年 ${segment.grade}`,
    segment.individual_level === 'advanced' ? '個別中受・高' : segment.individual_level === 'standard' ? '個別通常' : '',
    segment.individual_ratio && `人数 ${segment.individual_ratio}`,
    segment.office_task && (OFFICE_TASK_OPTIONS.find(option => option.value === segment.office_task)?.label || segment.office_task),
    segment.payroll_tier && `給与区分 ${segment.payroll_tier}`,
    segment.note,
  ].filter(Boolean);
  const reviewable = segment.can_review && segment.type !== 'break';
  const editable = reviewable && segment.approval_status !== 'approved';
  const saveEdit = async () => {
    if (await onSaveEdit(recordId, segment.id, draft)) setEditing(false);
  };
  return (
    <div className={`overflow-hidden rounded-2xl border transition ${selected ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200' : segmentToneClass(segment, 'card')} ${reviewable ? '' : 'opacity-75'}`}>
      <div className={`p-4 ${reviewable && (segment.approval_status || 'pending') === 'pending' ? 'border-l-4 border-l-amber-400' : reviewable && segment.approval_status === 'rejected' ? 'border-l-4 border-l-rose-400' : ''}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {needsReview(segment) && (
              <label className="mt-0.5 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-indigo-200 bg-white" title="一括承認の対象に選択">
                <input type="checkbox" checked={selected} onChange={() => onToggleSelection(recordId, segment.id)} aria-label={`${segment.start}から${segment.end}の勤務を一括承認対象に選択`} className={`h-5 w-5 rounded border-indigo-300 text-indigo-600 ${focusRing}`} />
              </label>
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-black tracking-tight text-slate-950">{segment.start}〜{segment.end}</span>
              <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${segmentToneClass(segment, 'chip')}`}>{typeLabel(segment.type)}</span>
              <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${segmentProgram(segment) === 'science_social' ? 'bg-sky-100 text-sky-700' : segmentProgram(segment) === 'breakthrough' ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600'}`}>{ATTENDANCE_PROGRAM_LABELS[segmentProgram(segment)]}</span>
              {segment.type !== 'break' && <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${statusClass(segment.approval_status)}`}>{statusLabel(segment.approval_status)}</span>}
            </div>
            <p className={`mt-2 flex items-center gap-1.5 text-xs font-bold ${segmentProgram(segment) === 'science_social' ? 'text-sky-700' : 'text-slate-600'}`}><Building2 size={13} className="text-slate-400" />{segmentProgram(segment) === 'science_social' ? '理社講座（校舎指定不要）' : `勤務校舎 ${segment.school_name || '未設定'}`}</p>
            {details.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-slate-500">
                {details.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
              </div>
            )}
            </div>
          </div>
          {!reviewable && segment.type !== 'break' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black text-slate-600"><Eye size={12} />閲覧のみ</span>
          )}
        </div>
        {editing && (
          <SegmentEditForm draft={draft} setDraft={setDraft} busy={editBusy} onSave={() => void saveEdit()} onCancel={() => {
            setDraft(segmentDraft(segment));
            setEditing(false);
          }} />
        )}
        {reviewable && !editing && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            {editable && (
              <button type="button" disabled={busy || editBusy} onClick={() => setEditing(true)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 ${focusRing}`}>
                <Pencil size={14} />詳細を編集
              </button>
            )}
            {segment.approval_status === 'approved' ? (
              canUnlock && (
                <button type="button" disabled={busy} onClick={() => onReview(recordId, segment.id, 'pending')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 text-xs font-black text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 ${focusRing}`}>
                  <RotateCcw size={14} />承認を解除
                </button>
              )
            ) : (
              <>
                {canReject && segment.approval_status === 'pending' && (
                  <button type="button" disabled={busy} onClick={() => onReview(recordId, segment.id, 'rejected')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 ${focusRing}`}>
                    <XCircle size={14} />差し戻す
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => onReview(recordId, segment.id, 'approved')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50 ${focusRing}`}>
                  {busy ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}{segment.approval_status === 'rejected' ? '再承認する' : '承認する'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const segmentDraft = (segment: any): SegmentEdit => ({
  start: String(segment.start || ''),
  end: String(segment.end || ''),
  type: String(segment.type || 'office'),
  program: segmentProgram(segment),
  school_id: String(segment.school_id || ''),
  grade: String(segment.grade || ''),
  individual_level: segment.individual_level || undefined,
  individual_ratio: segment.individual_ratio || undefined,
  office_task: String(segment.office_task || ''),
  note: String(segment.note || ''),
});

function SegmentEditForm({ draft, setDraft, busy, onSave, onCancel, hideActions = false }: {
  draft: SegmentEdit;
  setDraft: Dispatch<SetStateAction<SegmentEdit>>;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  hideActions?: boolean;
}) {
  const program = draft.program || 'normal';
  const update = (values: Partial<SegmentEdit>) => setDraft(current => ({ ...current, ...values }));
  const typeOptions = program === 'breakthrough'
    ? [{ value: 'breakthrough_lesson', label: '授業' }, { value: 'breakthrough_office', label: '事務' }]
    : [
        { value: 'lesson', label: '集団授業' },
        { value: 'individual', label: '個別授業' },
        { value: 'support', label: 'サブ（サポート）' },
        { value: 'office', label: '事務' },
        { value: 'other', label: 'その他' },
        { value: 'break', label: '休憩' },
      ];
  const inputClass = `min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 ${focusRing}`;
  return (
    <div className="mt-4 rounded-2xl border border-indigo-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-[11px] font-black text-slate-600">
          <span>開始</span><FiveMinuteTimeSelect value={draft.start} onChange={start => update({ start })} className={inputClass} />
        </label>
        <label className="grid gap-1 text-[11px] font-black text-slate-600">
          <span>終了</span><FiveMinuteTimeSelect value={draft.end} onChange={end => update({ end })} className={inputClass} />
        </label>
        <label className="grid gap-1 text-[11px] font-black text-slate-600">
          <span>プログラム</span>
          <select disabled={draft.type === 'break'} value={program} onChange={event => {
            const nextProgram = event.target.value as AttendanceWorkSegment['program'];
            update({ program: nextProgram, type: nextProgram === 'breakthrough' ? 'breakthrough_lesson' : 'lesson' });
          }} className={`${inputClass} disabled:bg-slate-100`}>
            <option value="normal">通常</option><option value="science_social">理社講座</option><option value="breakthrough">突破ゼミ</option>
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-black text-slate-600">
          <span>勤務区分</span>
          <select value={draft.type} onChange={event => {
            const type = event.target.value;
            update({ type, program: type === 'break' ? 'normal' : draft.program, office_task: type === 'office' || type === 'breakthrough_office' ? draft.office_task || 'lesson_preparation' : undefined });
          }} className={inputClass}>
            {typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {draft.type !== 'break' && program !== 'science_social' && (
          <label className="grid gap-1 text-[11px] font-black text-slate-600 sm:col-span-2">
            <span>勤務校舎</span>
            <select value={draft.school_id || ''} onChange={event => update({ school_id: event.target.value })} className={inputClass}>
              <option value="">選択してください</option>
              {ATTENDANCE_SCHOOL_DIRECTORY.map(school => <option key={school.code} value={school.code}>{school.name}</option>)}
            </select>
          </label>
        )}
        {(draft.type === 'lesson' || draft.type === 'individual') && (
          <label className="grid gap-1 text-[11px] font-black text-slate-600">
            <span>学年</span><select value={draft.grade || ''} onChange={event => update({ grade: event.target.value })} className={inputClass}><option value="">選択</option>{ATTENDANCE_GRADES.map(grade => <option key={grade}>{grade}</option>)}</select>
          </label>
        )}
        {draft.type === 'individual' && (
          <>
            <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>単価区分</span><select value={draft.individual_level || ''} onChange={event => update({ individual_level: event.target.value as AttendanceWorkSegment['individual_level'] })} className={inputClass}><option value="">選択</option><option value="standard">通常</option><option value="advanced">中受・高校生</option></select></label>
            <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>人数</span><select value={draft.individual_ratio || ''} onChange={event => update({ individual_ratio: event.target.value as AttendanceWorkSegment['individual_ratio'] })} className={inputClass}><option value="">選択</option><option value="1:1">1対1</option><option value="1:2">1対2</option><option value="1:3">1対3</option></select></label>
          </>
        )}
        {(draft.type === 'office' || draft.type === 'breakthrough_office') && (
          <label className="grid gap-1 text-[11px] font-black text-slate-600 sm:col-span-2"><span>事務内容</span><select value={draft.office_task || ''} onChange={event => update({ office_task: event.target.value })} className={inputClass}><option value="">選択</option>{OFFICE_TASK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        )}
        <label className="grid gap-1 text-[11px] font-black text-slate-600 sm:col-span-2 lg:col-span-4"><span>補足</span><textarea rows={2} maxLength={500} value={draft.note || ''} onChange={event => update({ note: event.target.value })} className={inputClass} /></label>
      </div>
      {!hideActions && <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className={`min-h-10 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-600 disabled:opacity-50 ${focusRing}`}>キャンセル</button>
        <button type="button" disabled={busy} onClick={onSave} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white disabled:opacity-50 ${focusRing}`}>{busy ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}修正を保存</button>
      </div>}
    </div>
  );
}

function TransportationEditor({ items, setItems, none, setNone, title }: {
  items: TransportationDraft[];
  setItems: (items: TransportationDraft[]) => void;
  none: boolean;
  setNone: (none: boolean) => void;
  title: string;
}) {
  const updateItem = (index: number, values: Partial<TransportationDraft>) => setItems(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item));
  const inputClass = `min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 ${focusRing}`;
  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-black text-sky-950">{title}</p><p className="text-[11px] font-bold text-sky-700">経路ごとに片道・往復と金額を登録できます。</p></div>
        {!none && <button type="button" onClick={() => setItems([...items, emptyTransportation()])} className={`inline-flex min-h-10 items-center gap-1 rounded-xl border border-sky-200 bg-white px-3 text-xs font-black text-sky-700 ${focusRing}`}><Plus size={14} />経路を追加</button>}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-800">
        <input type="checkbox" checked={none} onChange={event => setNone(event.target.checked)} className="h-4 w-4 accent-emerald-600" />交通費なしとして登録
      </label>
      {!none && (
        <div className="mt-3 space-y-3">
          {items.length === 0 && <p className="rounded-xl border border-dashed border-sky-200 bg-white p-3 text-center text-xs font-bold text-slate-500">交通費がある場合は「経路を追加」してください。</p>}
          {items.map((item, index) => (
            <div key={index} className="rounded-xl border border-sky-100 bg-white p-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-600">経路 {index + 1}</span><button type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))} className="text-rose-600" aria-label={`経路${index + 1}を削除`}><Trash2 size={16} /></button></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>交通手段</span><select value={item.transport_type} onChange={event => updateItem(index, { transport_type: event.target.value })} className={inputClass}><option value="train">電車</option><option value="bus">バス</option><option value="car">車</option><option value="other">その他</option></select></label>
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>路線名（任意）</span><input maxLength={100} value={item.route_line} onChange={event => updateItem(index, { route_line: event.target.value })} className={inputClass} /></label>
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>出発地</span><input maxLength={100} value={item.from} onChange={event => updateItem(index, { from: event.target.value })} className={inputClass} placeholder="例：西神中央" /></label>
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>到着地</span><input maxLength={100} value={item.to} onChange={event => updateItem(index, { to: event.target.value })} className={inputClass} placeholder="例：元町" /></label>
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>区分</span><select value={item.trip_type} onChange={event => updateItem(index, { trip_type: event.target.value as TransportationDraft['trip_type'] })} className={inputClass}><option value="round_trip">往復</option><option value="one_way">片道</option></select></label>
                <label className="grid gap-1 text-[11px] font-black text-slate-600"><span>金額（円）</span><input type="number" min={0} max={1000000} step={1} value={item.cost} onChange={event => updateItem(index, { cost: event.target.value })} className={inputClass} /></label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TransportationPanel({ items, total, status }: { items: any[]; total: number; status?: string }) {
  return (
    <section>
      <h5 className="mb-2 flex items-center gap-2 text-xs font-black text-slate-600"><Train size={15} />交通費・移動経路</h5>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        {items.length ? (
          <>
            <div className="space-y-3">
              {items.map((item: any, index: number) => (
                <div key={index} className="border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black text-sky-700">{transportTypeLabel(item.transport_type)}{item.route_line ? `・${item.route_line}` : ''}</span>
                    <span className="font-mono text-sm font-black text-slate-900">¥{Number(item.cost || 0).toLocaleString()}</span>
                  </div>
                  <p className="mt-1.5 flex items-start gap-1 text-xs font-bold leading-5 text-slate-700"><MapPin size={13} className="mt-0.5 shrink-0 text-rose-500" />{item.from || '未設定'} → {item.to || '未設定'}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">{item.trip_type === 'one_way' ? '片道' : '往復'}{item.commuter_pass_applied ? '・定期区間控除済み' : ''}{item.fare_source ? `・${item.fare_source}` : ''}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-300 pt-3 text-xs font-black">
              <span className="text-slate-600">交通費合計</span>
              <span className="font-mono text-lg text-sky-700">¥{total.toLocaleString()}</span>
            </div>
          </>
        ) : status === 'none' ? (
          <p className="py-3 text-center text-xs font-black text-emerald-700">交通費なし（確認済み）</p>
        ) : (
          <p className="py-3 text-center text-xs font-black text-amber-700">交通費が未入力です</p>
        )}
      </div>
    </section>
  );
}

function Empty({ allClear = false }: { allClear?: boolean }) {
  return (
    <div className={`rounded-3xl border-2 border-dashed p-10 text-center ${allClear ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      {allClear ? (
        <>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={25} /></span>
          <p className="mt-4 font-black text-emerald-900">確認が必要な勤怠はありません</p>
          <p className="mt-1 text-xs font-bold text-emerald-700">この月の承認作業は完了しています。</p>
        </>
      ) : (
        <>
          <p className="font-black text-slate-600">この条件に一致する勤怠データはありません</p>
          <p className="mt-1 text-xs font-bold text-slate-400">対象月や勤務校舎を変更して確認してください。</p>
        </>
      )}
    </div>
  );
}
