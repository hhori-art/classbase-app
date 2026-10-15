'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import CourseRegistrationCalendar, { CourseOpeningMap, getCourseDay, getCourseSlot, getCourseSubject } from '@/app/components/CourseRegistrationCalendar';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { loadAnnouncements } from '@/lib/client-announcements';
import { loadStudentCalendar } from '@/lib/client-student-homework';
import { getCourseOptionStableKey } from '@/lib/course-registration-selection';
import { calendarScheduleKind, calendarScheduleLabel } from '@/lib/calendar-schedule-display';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import AppSwitcherLink from '@/app/components/AppSwitcherLink';
import {
  AlertCircle,
  Bell,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Repeat,
  Send,
  Sparkles,
  Video,
  X,
} from 'lucide-react';

type Student = { id: string; student_name?: string; grade?: string; school?: string; school_id?: string; day_of_week?: string; selected_course_ids?: string[] };
type DetailItem = { id: string; title: string; meta: string; body?: string; status?: string };
type RequestMode = 'absence' | 'transfer' | 'student_transfer';
type TransferOption = {
  id: string;
  title: string;
  unit: string;
  subject: string;
  courseName: string;
  period: number;
  meetingId: string;
  targetDate: string;
  matchLabel: string;
  transferToken: string;
};

const emptyDetails = (): Record<string, DetailItem[]> => ({
  homework: [], attendance: [], absence: [], recordings: [], aiMessages: [], announcements: [],
});

const toDateLabel = (value: any) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ja-JP');
};

const toDateTimeLabel = (value: any) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ja-JP');
};

const scheduleStart = (item: any) => item.start_date || item.target_date || '';
const scheduleEnd = (item: any) => item.end_date || item.target_date || scheduleStart(item);
const scheduleCoversDate = (item: any, date: string) => scheduleStart(item) <= date && date <= scheduleEnd(item);
const normalizeGrade = (value: any) => {
  const raw = String(value || '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};
export default function ParentDashboardPage() {
  const { user, profile } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [dashboardReload, setDashboardReload] = useState(0);
  const [detailsReload, setDetailsReload] = useState(0);
  const { visibility } = usePortalVisibility('parent');
  const [details, setDetails] = useState<Record<string, DetailItem[]>>(emptyDetails);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState('');
  const [monthlySchedules, setMonthlySchedules] = useState<any[]>([]);
  const [requestMode, setRequestMode] = useState<RequestMode>('absence');
  const [requestText, setRequestText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [savingCourses, setSavingCourses] = useState(false);
  const [pendingCourseRequests, setPendingCourseRequests] = useState<any[]>([]);
  const [activeCourseRequest, setActiveCourseRequest] = useState<any>(null);
  const [transferOptions, setTransferOptions] = useState<TransferOption[]>([]);
  const [selectedTransferShiftId, setSelectedTransferShiftId] = useState('');
  const [loadingTransferOptions, setLoadingTransferOptions] = useState(false);

  const selectedStudent = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);
  const registeredWeekdays = useMemo(() => {
    const registeredIds = new Set(selectedCourseIds.map(String));
    const days = new Set(courseOptions
      .filter(option => registeredIds.has(String(option.id)) || registeredIds.has(String(option.parent_course_option_id || '')) || registeredIds.has(String(option.fallback_curriculum_option_id || '')))
      .map(getCourseDay)
      .filter(Boolean));
    if (days.size === 0 && selectedStudent?.day_of_week) {
      String(selectedStudent.day_of_week).split(/[、,\/]/).map(day => day.replace('曜日', '').trim()).filter(Boolean).forEach(day => days.add(day));
    }
    return Array.from(days);
  }, [courseOptions, selectedCourseIds, selectedStudent?.day_of_week]);

  useEffect(() => {
    const loadStudents = async () => {
      if (!profile || !user) return;
      setLoading(true);
      setDashboardError('');
      try {
        const response = await fetch('/api/parent/dashboard', {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        const fetched: Student[] = Array.isArray(data.students) ? data.students : [];
        setStudents(fetched);
        setSelectedId(current => fetched.some(student => student.id === current) ? current : fetched[0]?.id || '');
      } catch (e) {
        console.error(e);
        setStudents([]);
        setSelectedId('');
        setDashboardError('保護者情報を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
      } finally {
        setLoading(false);
      }
    };

    loadStudents();
  }, [profile, user, dashboardReload]);

  useEffect(() => {
    const loadMonthlySchedules = async () => {
      if (!selectedStudent || !visibility.calendar) return;
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth() + 1;
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const end = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
        const calendar = await loadStudentCalendar(start, end, selectedStudent.id);
        setMonthlySchedules(calendar.schedules);
      } catch (e) {
        console.warn('Monthly schedules read failed:', e);
        setMonthlySchedules([]);
      }
    };
    loadMonthlySchedules();
  }, [currentMonth, selectedStudent, visibility.calendar]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadDetails = async () => {
      if (!selectedId || !user) return;
      setDetailsLoading(true);
      setDetailsError('');
      setDetails(emptyDetails());
      try {
        const [dashboardResponse, announcements] = await Promise.all([
          fetch(`/api/parent/dashboard?student_id=${encodeURIComponent(selectedId)}`, {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store', signal: controller.signal,
          }),
          loadAnnouncements(10),
        ]);
        const dashboard = await dashboardResponse.json().catch(() => ({}));
        if (!dashboardResponse.ok || !dashboard.ok) throw new Error(dashboard.error || 'failed');
        if (!active) return;
        const source = dashboard.details || {};

        setDetails({
          homework: (source.homework || []).map((item: any) => ({ id: item.id, title: item.title, meta: toDateTimeLabel(item.occurred_at), body: item.body, status: item.status })),
          attendance: (source.attendance || []).map((item: any) => ({ id: item.id, title: item.title, meta: item.status, body: item.body })),
          absence: (source.absence || []).map((item: any) => ({ id: item.id, title: item.title, meta: `${item.target_date || '-'} / ${item.status || 'pending'}`, body: item.body, status: item.status })),
          recordings: (source.recordings || []).map((item: any) => ({ id: item.id, title: item.title, meta: `${toDateTimeLabel(item.occurred_at)} / ${item.status}`, body: item.watch_seconds ? `${Math.round(item.watch_seconds / 60)}分視聴` : '' })),
          aiMessages: (source.aiMessages || []).map((item: any) => ({ id: item.id, title: item.role === 'assistant' ? 'AIからの返信' : '生徒の質問', meta: toDateTimeLabel(item.occurred_at), body: item.body })),
          announcements: announcements
            .map((data: any) => {
              return { id: data.id, title: data.title || 'お知らせ', meta: toDateLabel(data.created_at), body: data.content || data.body || '' };
            }),
        });
      } catch (e) {
        if (!active) return;
        console.error(e);
        setDetailsError('学習・出席情報を読み込めませんでした。空の履歴ではありません。再読み込みしてください。');
      } finally {
        if (active) setDetailsLoading(false);
      }
    };

    loadDetails();
    return () => { active = false; controller.abort(); };
  }, [selectedId, user, detailsReload]);

  useEffect(() => {
    const loadCourseOptions = async () => {
      if (!user || !selectedStudent) return;
      try {
        const [optionData, registrationSnap] = await Promise.all([
          loadCourseRegistrationOptions({
            grade: normalizeGrade(selectedStudent.grade),
            getToken: forceRefresh => user.getIdToken(forceRefresh),
          }),
          getDocs(query(collection(db, 'course_registrations'), where('parent_id', '==', user.uid), limit(50))).catch(() => ({ docs: [] as any[] })),
        ]);
        const selectedGrade = normalizeGrade(selectedStudent.grade);
        const options = (Array.isArray(optionData.options) ? optionData.options : [])
          .filter((item: any) => item.is_active !== false)
          .filter((item: any) => canStudentRegisterCourseOption(selectedGrade, item))
          .sort((a: any, b: any) => `${a.year}_${a.term}_${a.subject}_${a.course_name}`.localeCompare(`${b.year}_${b.term}_${b.subject}_${b.course_name}`));
        const registrations = registrationSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((item: any) => item.student_id === selectedStudent.id);
        setCourseOptions(options);
        const latest = registrations.sort((a: any, b: any) => String(b.updated_at?.seconds || 0).localeCompare(String(a.updated_at?.seconds || 0)))[0];
        setSelectedCourseIds(Array.isArray(latest?.selected_course_ids)
          ? latest.selected_course_ids.map(String)
          : Array.isArray(selectedStudent.selected_course_ids) ? selectedStudent.selected_course_ids.map(String) : []);
      } catch (e) {
        console.warn('Course options read failed:', e);
        setCourseOptions([]);
      }
    };
    loadCourseOptions();
  }, [user, selectedStudent]);

  useEffect(() => {
    const loadCourseRequests = async () => {
      if (!user || !selectedStudent) return;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [requestSnap, registrationSnap] = await Promise.all([
          getDocs(query(collection(db, 'registration_requests'), where('is_active', '==', true), limit(50))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, 'course_registrations'), where('parent_id', '==', user.uid), limit(50))).catch(() => ({ docs: [] as any[] })),
        ]);
        const answered = new Set(
          registrationSnap.docs
            .map((d: any) => d.data())
            .filter((item: any) => item.student_id === selectedStudent.id)
            .map((item: any) => item.request_id || item.registration_request_id)
            .filter(Boolean)
        );
        const selectedGrade = normalizeGrade(selectedStudent.grade);
        const requests = requestSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((req: any) => req.request_kind === 'course_registration' || req.type === 'course_registration')
          .filter((req: any) => !answered.has(req.id))
          .filter((req: any) => !req.period_start || req.period_start <= today)
          .filter((req: any) => !req.period_end || today <= req.period_end)
          .filter((req: any) => req.target_audience !== 'grade' || !Array.isArray(req.target_grades) || req.target_grades.map(normalizeGrade).includes(selectedGrade));
        setPendingCourseRequests(requests);
        setActiveCourseRequest(requests[0] || null);
        if (requests[0]?.course_option_ids?.length) {
          setSelectedCourseIds([]);
        }
      } catch (e) {
        console.warn('Course registration requests read failed:', e);
      }
    };
    loadCourseRequests();
  }, [user, selectedStudent, courseOptions]);

  useEffect(() => {
    const loadTransferOptions = async () => {
      setSelectedTransferShiftId('');
      setTransferOptions([]);
      if (!selectedStudent || !selectedDate || requestMode !== 'transfer') return;
      setLoadingTransferOptions(true);
      try {
        const token = await user?.getIdToken();
        if (!token) throw new Error('ログイン情報を確認できません。');
        const params = new URLSearchParams({ student_id: selectedStudent.id, absence_date: selectedDate });
        const res = await fetch(`/api/student/transfer-options?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
        setTransferOptions((Array.isArray(data.options) ? data.options : []).map((option: any) => ({
          id: String(option.id || ''), title: String(option.title || ''), unit: String(option.unit || ''),
          subject: String(option.subject || ''), courseName: String(option.course_name || ''),
          period: Number(option.period) || 0, meetingId: String(option.meeting_id || ''),
          targetDate: String(option.target_date || ''), matchLabel: '欠席授業と同じ単元の振替候補',
          transferToken: String(option.transfer_token || ''),
        })));
      } catch (e) {
        console.warn('Transfer options read failed:', e);
        setTransferOptions([]);
      } finally {
        setLoadingTransferOptions(false);
      }
    };
    loadTransferOptions();
  }, [user, selectedStudent, selectedDate, requestMode]);

  const submitCalendarRequest = async () => {
    if (!user || !selectedStudent || !selectedDate) return;
    const selectedTransfer = transferOptions.find(option => option.id === selectedTransferShiftId);
    if (requestMode === 'transfer' && !selectedTransfer) {
      alert('振替で参加したい授業を選択してください。');
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const isTransfer = requestMode === 'transfer';
      const isStudentTransfer = requestMode === 'student_transfer';
      const res = await fetch('/api/parent/absence-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          type: isTransfer ? 'transfer' : 'absence',
          absence_type: isTransfer ? null : 'absent',
          target_date: selectedDate,
          reason: requestText,
          student_selects_transfer: isStudentTransfer,
          transfer_selection_mode: isStudentTransfer ? 'student' : isTransfer ? 'parent' : null,
          transfer_title: isTransfer ? selectedTransfer?.title || '' : '',
          transfer_shift_id: isTransfer ? selectedTransfer?.id || '' : '',
          target_shift_id: isTransfer ? selectedTransfer?.id || '' : '',
          transfer_unit: isTransfer ? selectedTransfer?.unit || '' : '',
          transfer_subject: isTransfer ? selectedTransfer?.subject || '' : '',
          transfer_course_name: isTransfer ? selectedTransfer?.courseName || '' : '',
          transfer_period: isTransfer ? selectedTransfer?.period || null : null,
          transfer_meeting_id: isTransfer ? selectedTransfer?.meetingId || '' : '',
          transfer_token: isTransfer ? selectedTransfer?.transferToken || '' : '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setRequestText('');
      setSelectedTransferShiftId('');
      setSelectedDate('');
      alert(isTransfer ? '振替を確定しました。' : isStudentTransfer ? '欠席連絡を送信しました。生徒画面に振替選択を表示します。' : '欠席連絡を送信しました。');
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  const saveCourseRegistration = async (term: string, year: number, requestId = '') => {
    if (!user || !selectedStudent || selectedCourseIds.length === 0) return alert('受講する講座を選択してください。');
    setSavingCourses(true);
    try {
      const token = await user.getIdToken();
      const selectedCourseKeys = courseOptions
        .filter(option => selectedCourseIds.includes(String(option.id)))
        .map(getCourseOptionStableKey)
        .filter(Boolean);
      const registrationTokens = courseOptions
        .filter(option => selectedCourseIds.includes(String(option.id)))
        .map(option => option.registration_token)
        .filter(Boolean);
      const res = await fetch('/api/parent/course-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          request_id: requestId,
          term,
          year,
          selected_course_ids: selectedCourseIds,
          selected_course_keys: selectedCourseKeys,
          registration_tokens: registrationTokens,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      alert('受講講座を登録しました。');
      if (requestId) {
        setPendingCourseRequests(prev => prev.filter(req => req.id !== requestId));
        setActiveCourseRequest(null);
      }
    } catch (e: any) {
      alert(`登録に失敗しました: ${e.message || e}`);
    } finally {
      setSavingCourses(false);
    }
  };

  if (loading && students.length === 0) {
    return <div className="min-h-[60vh]" aria-busy="true" />;
  }

  if (dashboardError) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center"><AlertCircle className="mx-auto mb-3 text-rose-500" /><p className="font-black text-rose-900">{dashboardError}</p><button type="button" onClick={() => setDashboardReload(value => value + 1)} className="mt-5 rounded-xl bg-rose-600 px-5 py-3 text-sm font-black text-white">再読み込み</button></div>;
  }

  if (students.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto mb-3 text-amber-500" />
        <p className="font-black text-gray-800">紐づく生徒がまだ登録されていません</p>
        <p className="mt-2 text-sm font-bold text-gray-400">校舎へ保護者アカウントの紐づけをご依頼ください。</p>
      </div>
    );
  }

  const sections = [
    { key: 'homework', label: '宿題提出', icon: ClipboardCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { key: 'attendance', label: '出席状況', icon: CalendarCheck, color: 'text-blue-600', bg: 'bg-blue-50' },
    { key: 'absence', label: '欠席・振替', icon: Send, color: 'text-orange-600', bg: 'bg-orange-50' },
    { key: 'recordings', label: '録画視聴', icon: MonitorPlay, color: 'text-rose-600', bg: 'bg-rose-50' },
    { key: 'aiMessages', label: 'AIメッセージ', icon: MessageCircle, color: 'text-violet-600', bg: 'bg-violet-50' },
    { key: 'announcements', label: 'お知らせ', icon: Bell, color: 'text-slate-600', bg: 'bg-slate-50' },
  ].filter(section => visibility[section.key as keyof typeof visibility]);

  const totalItems = sections.reduce((sum, section) => sum + (details[section.key] || []).length, 0);
  const pendingAbsences = details.absence.filter(item => item.status === 'pending').length;
  const latestAnnouncement = details.announcements[0];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <AppSwitcherLink className="w-full sm:w-auto" />
      </div>
      <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-indigo-300">Parent Dashboard</p>
            <h2 className="mt-2 text-3xl font-black">お子さまの学習をひと目で確認</h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-300">宿題、出席、欠席・振替、録画視聴、AIメッセージ、月間予定をまとめて確認できます。</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <MiniStat icon={BookOpen} label="確認項目" value={`${totalItems}件`} />
              <MiniStat icon={Send} label="申請中" value={`${pendingAbsences}件`} />
              <MiniStat icon={Sparkles} label="今月の予定" value={`${monthlySchedules.length}件`} />
            </div>
          </div>
          <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/10">
            <label className="mb-2 block text-xs font-black text-slate-300">表示する生徒</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200">
              {students.map(s => <option key={s.id} value={s.id}>{s.student_name || s.id} {s.grade ? `(${s.grade})` : ''}</option>)}
            </select>
            {latestAnnouncement && (
              <div className="mt-4 rounded-2xl bg-white p-4 text-slate-900">
                <p className="text-[10px] font-black text-indigo-500">最新のお知らせ</p>
                <p className="mt-1 line-clamp-2 text-sm font-black">{latestAnnouncement.title}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {detailsError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-900"><span>{detailsError}</span><button type="button" onClick={() => setDetailsReload(value => value + 1)} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white">再読み込み</button></div>}

      {visibility.calendar && (
        <ParentActionCalendar
          month={currentMonth}
          onChangeMonth={setCurrentMonth}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          canAbsence={visibility.absence}
          canTransfer={visibility.transfer}
          schedules={monthlySchedules}
          registeredWeekdays={registeredWeekdays}
        />
      )}

      <ParentCourseRequestModal
        request={activeCourseRequest}
        options={courseOptions}
        selectedCourseIds={selectedCourseIds}
        onChangeSelectedCourseIds={setSelectedCourseIds}
        onSubmit={(term, year, requestId) => saveCourseRegistration(term, year, requestId)}
        onClose={() => setActiveCourseRequest(null)}
        saving={savingCourses}
      />

      {selectedDate && (visibility.absence || visibility.transfer) && (
        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black text-indigo-500">{selectedDate}</p>
              <h3 className="mt-1 text-lg font-black text-slate-900">欠席・振替を登録</h3>
            </div>
            <button onClick={() => setSelectedDate('')} className="rounded-xl bg-slate-100 p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end">
            <div>
              <label className="mb-2 block text-xs font-black text-slate-500">種類</label>
              <div className="grid gap-2">
                {visibility.absence && <button type="button" onClick={() => setRequestMode('absence')} className={`rounded-2xl border-2 px-3 py-3 text-sm font-black ${requestMode === 'absence' ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>欠席</button>}
                {visibility.absence && <button type="button" onClick={() => setRequestMode('student_transfer')} className={`rounded-2xl border-2 px-3 py-3 text-sm font-black ${requestMode === 'student_transfer' ? 'border-sky-300 bg-sky-50 text-sky-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>お子様が選択</button>}
                {visibility.transfer && <button type="button" onClick={() => setRequestMode('transfer')} className={`rounded-2xl border-2 px-3 py-3 text-sm font-black ${requestMode === 'transfer' ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>保護者が振替確定</button>}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-black text-slate-500">理由・希望内容</label>
              {requestMode === 'transfer' && (
                <div className="mb-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-black text-indigo-700">
                    <Video size={14} /> この日に実施している単元から選択
                  </div>
                  {loadingTransferOptions ? (
                    <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-xs font-bold text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> 読み込み中...
                    </div>
                  ) : transferOptions.length === 0 ? (
                    <div className="rounded-xl bg-white px-3 py-3 text-xs font-bold text-slate-500">この日に選択できる振替候補がありません。</div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {transferOptions.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedTransferShiftId(option.id)}
                          className={`rounded-xl border-2 p-3 text-left transition ${selectedTransferShiftId === option.id ? 'border-indigo-400 bg-white text-indigo-700 shadow-sm' : 'border-white bg-white/80 text-slate-700 hover:border-indigo-200'}`}
                        >
                          <p className="text-sm font-black">{option.title}</p>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">{option.unit || '単元名未設定'} / {option.matchLabel}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {requestMode === 'student_transfer' && (
                <div className="mb-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs font-bold text-sky-700">
                  欠席連絡後、生徒画面に振替選択ポップアップを表示します。お子様が振替先を選ぶまでホーム画面を進めない設定になります。
                </div>
              )}
              <textarea value={requestText} onChange={e => setRequestText(e.target.value)} className="min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" placeholder={requestMode === 'transfer' ? '希望時間や補足を入力してください' : '欠席理由を入力してください'} />
            </div>
            <button onClick={submitCalendarRequest} disabled={submitting || ((requestMode === 'absence' || requestMode === 'student_transfer') && !requestText.trim()) || (requestMode === 'transfer' && !selectedTransferShiftId)} className="rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
              {submitting ? '送信中...' : '送信'}
            </button>
          </div>
        </section>
      )}

      {detailsLoading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-indigo-500" /></div>}

      {!detailsLoading && totalItems === 0 ? (
        <section className="rounded-[28px] bg-white px-6 py-8 text-center shadow-sm">
          <ClipboardCheck className="mx-auto mb-3 text-slate-300" size={28} />
          <h3 className="text-sm font-black text-slate-700">学習履歴はまだありません</h3>
          <p className="mt-1 text-xs font-bold text-slate-400">宿題提出、出席、録画視聴などの記録が入ると、ここにまとめて表示されます。</p>
        </section>
      ) : <section className="grid gap-4 lg:grid-cols-2">
        {sections.filter(section => (details[section.key] || []).length > 0).map(section => {
          const Icon = section.icon;
          const items = details[section.key] || [];
          return (
            <div key={section.key} className="rounded-[28px] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${section.bg} ${section.color}`}>
                    <Icon size={22} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800">{section.label}</h3>
                    <p className="text-xs font-bold text-slate-400">{items.length}件</p>
                  </div>
                </div>
              </div>
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {items.map(item => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-slate-800">{item.title}</p>
                        {item.status && <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-400">{item.status}</span>}
                      </div>
                      <p className="text-[11px] font-bold text-slate-400">{item.meta}</p>
                      {item.body && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">{item.body}</p>}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </section>}
    </div>
  );
}

function CourseRegistrationPanel({
  options,
  registrations,
  selectedCourseIds,
  onToggleCourse,
  onSave,
	saving,
}: {
  options: any[];
  registrations: any[];
  selectedCourseIds: string[];
  onToggleCourse: (id: string) => void;
  onSave: (term: string, year: number) => void;
  saving: boolean;
}) {
  if (options.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const grouped = options.reduce((acc, option) => {
    const key = `${option.year || ''}_${option.term || 'other'}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(option);
    return acc;
  }, {} as Record<string, any[]>);
  const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)) as [string, any[]][];
  const activeGroup = groups.find(([, items]) => {
    const open = items[0]?.registration_opens_at;
    const start = items[0]?.term_start_date;
    return open && start && open <= today && today <= start;
  }) || groups.find(([, items]) => items[0]?.term_start_date && today <= items[0].term_start_date) || groups[0];
  if (!activeGroup) return null;
  const items = activeGroup[1];
  const first = items[0] || {};
  const saved = registrations.find(item => item.term === first.term && Number(item.year) === Number(first.year));
  const isOpen = first.registration_opens_at && first.term_start_date && first.registration_opens_at <= today && today <= first.term_start_date;
  return (
    <section className="rounded-[28px] bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black text-indigo-500">受講講座登録</p>
          <h3 className="mt-1 text-xl font-black text-slate-900">{first.term_label || '次ターム'}の受講講座</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {isOpen ? '次のターム開始が近づいています。受講する講座を選択してください。' : '次タームの講座候補です。受付開始日になると登録できます。'}
          </p>
        </div>
        <div className="rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-black text-indigo-700">
          受付開始 {first.registration_opens_at || '-'} / ターム開始 {first.term_start_date || '-'}
        </div>
      </div>
      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
          <CheckCircle2 size={18} /> 登録済みです。変更する場合は選び直して再登録できます。
        </div>
      )}
      <div className="mb-5">
        <CourseOpeningMap options={items} selectedIds={selectedCourseIds} title="現在の週間開講状況" />
      </div>
      <CourseRegistrationCalendar
        options={items}
        selectedIds={selectedCourseIds}
        onToggle={onToggleCourse}
      />
      <button
        onClick={() => onSave(first.term, Number(first.year))}
        disabled={saving || !isOpen}
        className="mt-5 w-full rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? '登録中...' : isOpen ? '受講講座を登録する' : '受付開始前です'}
      </button>
    </section>
  );
}

function ParentCourseRequestModal({
  request,
  options,
  selectedCourseIds,
  onChangeSelectedCourseIds,
  onSubmit,
  onClose,
  saving,
}: {
  request: any;
  options: any[];
  selectedCourseIds: string[];
  onChangeSelectedCourseIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  onSubmit: (term: string, year: number, requestId: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const requestOptionIds = Array.isArray(request?.course_option_ids) ? request.course_option_ids : [];
  const annotatedRequestOptions = options.filter(option => String(option.registration_request_id || '') === String(request?.id || ''));
  const requestOptions = annotatedRequestOptions.length > 0
    ? annotatedRequestOptions
    : requestOptionIds.length > 0
      ? options.filter(option => requestOptionIds.includes(option.id) || requestOptionIds.includes(option.parent_course_option_id) || requestOptionIds.includes(option.fallback_curriculum_option_id))
      : options;
  const first = requestOptions[0] || {};
  const [selectedCourseKeys, setSelectedCourseKeys] = useState<string[]>([]);

  const courseKey = (option: any) => [
    option.grade || '',
    getCourseSubject(option) || '',
    option.course_name || option.title || getCourseSubject(option) || '講座',
  ].join('__');
  const timeKey = (option: any) => [
    getCourseDay(option) || '曜日未設定',
    getCourseSlot(option) || '時間未設定',
  ].join('__');
  const courseChoices = (Object.values(requestOptions.reduce((acc, option: any) => {
    const key = courseKey(option);
    if (!acc[key]) acc[key] = { key, option, count: 0, daySlots: new Set<string>(), units: new Set<string>() };
    acc[key].count += 1;
    const day = getCourseDay(option);
    const slot = getCourseSlot(option);
    if (day || slot) acc[key].daySlots.add([day && `${day}曜`, slot].filter(Boolean).join(' '));
    [
      option.resolved_unit,
      option.unit,
      ...(Array.isArray(option.matched_units) ? option.matched_units : []),
      ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
    ].forEach((unit: any) => {
      const value = String(unit || '').trim();
      if (value) acc[key].units.add(value);
    });
    return acc;
  }, {} as Record<string, { key: string; option: any; count: number; daySlots: Set<string>; units: Set<string> }>)) as {
    key: string;
    option: any;
    count: number;
    daySlots: Set<string>;
    units: Set<string>;
  }[]).sort((a, b) => `${getCourseSubject(a.option) || ''}_${a.option.course_name || a.option.title || ''}`.localeCompare(`${getCourseSubject(b.option) || ''}_${b.option.course_name || b.option.title || ''}`, 'ja', { numeric: true }));

  useEffect(() => {
    const selectedOptionKeys = Array.from(new Set(
      requestOptions
        .filter((option: any) => selectedCourseIds.includes(option.id))
        .map(courseKey)
    ));
    setSelectedCourseKeys(prev => {
      const validKeys = new Set(courseChoices.map(choice => choice.key));
      const kept = prev.filter(key => validKeys.has(key));
      const merged = Array.from(new Set([...kept, ...selectedOptionKeys]));
      return merged.length > 0 ? merged : kept;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, requestOptions.length]);

  const visibleCourseOptions = selectedCourseKeys.length > 0
    ? requestOptions.filter(option => selectedCourseKeys.includes(courseKey(option)))
    : [];
  const visibleOptionIds = new Set(visibleCourseOptions.map(option => option.id));
  const visibleSelectedIds = selectedCourseIds.filter(id => visibleOptionIds.has(id));
  const toggleCourseKey = (key: string) => {
    const targetOptions = requestOptions.filter(option => courseKey(option) === key);
    const targetOptionIds = new Set(targetOptions.map(option => option.id));
    const selected = selectedCourseKeys.includes(key);
    setSelectedCourseKeys(prev => selected ? prev.filter(item => item !== key) : [...prev, key]);
    if (selected) {
      onChangeSelectedCourseIds(current => current.filter(id => !targetOptionIds.has(id)));
      return;
    }
    const scheduleKeys = new Set(targetOptions.map(timeKey));
    if (scheduleKeys.size === 1) {
      onChangeSelectedCourseIds(prev => {
        const visibleIds = new Set(requestOptions.map(option => option.id));
        const selectedInRequest = new Set(prev.filter(id => visibleIds.has(id)));
        const outsideRequest = prev.filter(id => !visibleIds.has(id));
        requestOptions
          .filter(option => scheduleKeys.has(timeKey(option)))
          .forEach(option => selectedInRequest.delete(option.id));
        targetOptions.forEach(option => selectedInRequest.add(option.id));
        return Array.from(new Set([...outsideRequest, ...Array.from(selectedInRequest)]));
      });
    }
  };
  const toggleCourseGroup = (ids: string[]) => {
    const cleanIds = Array.from(new Set(ids.filter(Boolean)));
    if (cleanIds.length === 0) return;
    onChangeSelectedCourseIds(prev => {
      const visibleIds = new Set(requestOptions.map(option => option.id));
      const selectedInRequest = new Set(prev.filter(id => visibleIds.has(id)));
      const outsideRequest = prev.filter(id => !visibleIds.has(id));
      const allSelected = cleanIds.every(id => selectedInRequest.has(id));
      if (allSelected) {
        cleanIds.forEach(id => selectedInRequest.delete(id));
        return Array.from(new Set([...outsideRequest, ...Array.from(selectedInRequest)]));
      }

      const selectedOptions = requestOptions.filter(option => cleanIds.includes(option.id));
      const conflictKeys = new Set(selectedOptions.map(timeKey));
      requestOptions
        .filter(option => conflictKeys.has(timeKey(option)))
        .forEach(option => selectedInRequest.delete(option.id));
      cleanIds.forEach(id => selectedInRequest.add(id));
      return Array.from(new Set([...outsideRequest, ...Array.from(selectedInRequest)]));
    });
  };
  const toggleSingleCourseOption = (id: string) => toggleCourseGroup([id]);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="shrink-0 bg-gradient-to-r from-indigo-600 to-sky-600 p-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-100">Course Registration</p>
              <h2 className="mt-2 text-2xl font-black">{request.title || '受講講座登録'}</h2>
              <p className="mt-2 text-sm font-bold text-indigo-50">登録期間: {request.period_start || '-'} - {request.period_end || request.deadline || '-'}</p>
            </div>
            <button onClick={onClose} className="rounded-full bg-white/15 p-2 hover:bg-white/25"><X size={20} /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          <div className="space-y-5">
            <CourseOpeningMap
              options={requestOptions}
              selectedIds={visibleSelectedIds}
              title="この登録で選べる週間開講状況"
              description="先に曜日と時限の全体像を確認してから、下で講座を選べます。"
            />
            <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-indigo-500">1. 科目</p>
                  <h3 className="text-base font-black text-slate-900">受講したい講座を選ぶ</h3>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-indigo-600">{selectedCourseKeys.length}科目</span>
              </div>
              {courseChoices.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-indigo-100 bg-white/70 p-5 text-center text-sm font-black text-slate-400">
                  この登録で選べる講座が見つかりません。時間をおいて再度確認してください。
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {courseChoices.map(choice => {
                    const active = selectedCourseKeys.includes(choice.key);
                    const option = choice.option;
                    const units = Array.from(choice.units);
                    const daySlots = Array.from(choice.daySlots);
                    return (
                      <button
                        key={choice.key}
                        type="button"
                        onClick={() => toggleCourseKey(choice.key)}
                        aria-pressed={active}
                        className={`rounded-2xl border-2 p-4 text-left transition ${
                          active
                            ? 'border-indigo-500 bg-white text-indigo-700 shadow-sm'
                            : 'border-white bg-white/80 text-slate-700 hover:border-indigo-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black">{[option.grade, getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}</p>
                            <p className="mt-1 text-[11px] font-bold text-slate-400">
                              {daySlots.slice(0, 4).join(' / ') || '曜日・時間未設定'}
                              {daySlots.length > 4 ? ` ほか${daySlots.length - 4}件` : ''}
                            </p>
                            <p className="mt-2 text-[11px] font-black text-emerald-600">
                              {daySlots.length === 1 ? '選ぶだけで曜日・時間も確定' : `${daySlots.length}個の曜日・時間から選択`}
                              {units.length > 0 ? ` ・ 全${units.length}単元` : ''}
                            </p>
                          </div>
                          {active && <CheckCircle2 size={18} className="shrink-0 text-indigo-600" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-slate-500">2. 曜日・時間</p>
                  <h3 className="text-base font-black text-slate-900">通える曜日・時間を決める</h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">同じ曜日・同じ時限は1つだけ選べます。別の講座を選ぶと前の選択は自動で外れます。</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">{visibleSelectedIds.length}件</span>
              </div>
              {selectedCourseKeys.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-black text-slate-400">
                  先に受講したい科目を選択してください
                </div>
              ) : (
                <CourseRegistrationCalendar
                  options={visibleCourseOptions}
                  selectedIds={visibleSelectedIds}
                  onToggle={toggleSingleCourseOption}
                  onToggleGroup={toggleCourseGroup}
                  compact
                  emptyMessage="選択した科目に開講曜日がありません。別の科目を選択してください。"
                />
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-100 bg-slate-50 p-5">
          <button
            onClick={() => onSubmit(first.term || request.term || 'term', Number(first.year || request.year || new Date().getFullYear()), request.id)}
            disabled={saving || requestOptions.length === 0 || visibleSelectedIds.length === 0}
            className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? '登録中...' : 'この内容で登録する'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
      <Icon className="mb-2 text-indigo-200" size={18} />
      <p className="text-[10px] font-black text-slate-300">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  );
}

function ParentActionCalendar({
  month,
  onChangeMonth,
  selectedDate,
  onSelectDate,
  canAbsence,
  canTransfer,
  schedules,
  registeredWeekdays,
}: {
  month: Date;
  onChangeMonth: (value: Date) => void;
  selectedDate: string;
  onSelectDate: (value: string) => void;
  canAbsence: boolean;
  canTransfer: boolean;
  schedules: any[];
  registeredWeekdays: string[];
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const days = Array.from({ length: firstDay.getDay() }, (_, i) => ({ label: '', date: '', key: `blank-${i}` }))
    .concat(Array.from({ length: lastDay.getDate() }, (_, i) => {
      const day = i + 1;
      return {
        label: String(day),
        date: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        key: String(day),
      };
    }));

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-900">{year}年 {monthIndex + 1}月</h3>
          <p className="text-xs font-bold text-slate-400">日付を選ぶと欠席連絡・振替希望を登録できます。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onChangeMonth(new Date(year, monthIndex - 1, 1))} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><ChevronLeft size={18} /></button>
          <button onClick={() => onChangeMonth(new Date(year, monthIndex + 1, 1))} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-7 text-center text-xs font-black text-slate-400">
        {['日', '月', '火', '水', '木', '金', '土'].map(day => <div key={day}>{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(day => day.date ? (() => {
          const daySchedules = schedules.filter(item => scheduleCoversDate(item, day.date));
          const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${day.date}T12:00:00`).getDay()];
          const isClosedDay = daySchedules.some(item => calendarScheduleKind(item) === 'closed');
          const isLessonDay = daySchedules.some(item => calendarScheduleKind(item) === 'lesson');
          const isRegisteredDay = registeredWeekdays.includes(weekday);
          const actionable = !isClosedDay && isRegisteredDay && (canAbsence || canTransfer);
          return (
          <button key={day.key} disabled={!actionable} onClick={() => actionable && onSelectDate(day.date)} className={`min-h-24 rounded-2xl border p-2 text-left transition ${selectedDate === day.date ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : isClosedDay ? 'cursor-default border-rose-200 bg-rose-50 text-rose-500' : isLessonDay ? 'border-sky-200 bg-sky-50 text-sky-800' : actionable ? 'border-slate-100 bg-slate-50 hover:border-slate-200' : 'cursor-default border-slate-100 bg-slate-50/60 text-slate-400'}`}>
            <span className="text-sm font-black">{day.label}</span>
            <div className="mt-2 flex flex-col gap-1">
              {daySchedules.slice(0, 2).map(item => {
                const kind = calendarScheduleKind(item);
                return <span key={item.id} className={`rounded px-1.5 py-0.5 text-[9px] font-black ${kind === 'closed' ? 'bg-rose-100 text-rose-700' : kind === 'lesson' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-700'}`}>{calendarScheduleLabel(item)}</span>;
              })}
              {actionable && canAbsence && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-black text-orange-600">欠席</span>}
              {actionable && canTransfer && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-600"><Repeat size={8} className="inline" /> 振替</span>}
            </div>
          </button>
          );
        })() : <div key={day.key} className="min-h-20" />)}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-black text-slate-600">
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-sky-200" />授業実施日</span>
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-rose-200" />休み・休講</span>
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-emerald-200" />その他予定</span>
        <span className="font-bold text-slate-400">予定がない日は休みとは判定しません。</span>
      </div>
    </section>
  );
}
