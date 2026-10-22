'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import CourseRegistrationCalendar, { CourseOpeningMap, getCourseDay, getCourseSlot, getCourseSubject } from '@/app/components/CourseRegistrationCalendar';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { loadAnnouncements } from '@/lib/client-announcements';
import { loadStudentCalendar } from '@/lib/client-student-homework';
import { courseOptionMatchesSelection, getCourseOptionCourseKey, getCourseOptionScheduleKey, getCourseOptionStableKey, hasCourseOptionSelection, removeCourseOptionSelections } from '@/lib/course-registration-selection';
import { calendarScheduleKind, calendarScheduleLabel } from '@/lib/calendar-schedule-display';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { DEFAULT_CLASS_BUTTON_SETTINGS } from '@/lib/class-button-settings';
import { jstTodayKey, lessonDayEnded } from '@/lib/lesson-deadline';
import { AbsenceRequestError, isTransferOptionError } from '@/lib/absence-request-errors';
import LessonDayList, { summarizeLessonDays, type LessonDay } from '@/app/components/parent/LessonDayList';
import Link from 'next/link';
import { ParentCard, ParentEmpty, ParentPageHeader, ParentSectionTitle, parentStatusLabel, parentStatusPillTone } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { Button, ButtonLink, ErrorState, IconButton, Modal, Skeleton, Spinner, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  MonitorPlay,
  Send,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';

type Student = { id: string; student_name?: string; grade?: string; school?: string; school_id?: string; day_of_week?: string; selected_course_ids?: string[] };
type DetailItem = { id: string; title: string; meta: string; body?: string; status?: string; requestType?: string; targetDate?: string };
type RequestMode = 'absence' | 'late' | 'transfer' | 'student_transfer';
type SentRequest = { target_date: string; kind: 'absent' | 'late' | 'transfer'; absence_id?: string };
type HomeSummary = { unread_replies: number; urgent_news: { id: string; title: string; label: string; published_at: string }[] };
/** 見送り・取消になった連絡（カレンダーでは「連絡済み」にしない） */
type DeclinedRequest = { target_date: string; status: string };
type DashboardSummary = { window_days: number; homework_count: number; ai_question_count: number };
const INACTIVE_REQUEST_STATUSES = ['rejected', 'cancelled', 'canceled'];
const requestDateLabel = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : '';
type ClassTimes = { period1_end: string; period2_end: string };
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

const toDateLabel = (value: any) => (value ? formatDate(value, { withYear: true }) || String(value) : '-');

const toDateTimeLabel = (value: any) => (value ? formatDateTime(value, { withYear: true }) || String(value) : '-');

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
  const toast = useToast();
  const confirm = useConfirm();
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
  const [transferOptionsReload, setTransferOptionsReload] = useState(0);
  const [activityTab, setActivityTab] = useState('');
  const [lessons, setLessons] = useState<LessonDay[]>([]);
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
  const [declinedRequests, setDeclinedRequests] = useState<DeclinedRequest[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [cancellingId, setCancellingId] = useState('');
  const [classTimes, setClassTimes] = useState<ClassTimes>({ period1_end: DEFAULT_CLASS_BUTTON_SETTINGS.period1_end, period2_end: DEFAULT_CLASS_BUTTON_SETTINGS.period2_end });
  const requestPanelRef = useRef<HTMLDivElement>(null);

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
  // 欠席・遅刻の連絡締切は、サーバー（/api/parent/absence-requests）と同じく、その日いちばん遅い授業（2時間目）の終了時刻。
  // 授業が終わった日でも、振替（休んだ授業の補講）の登録はできる。
  const lessonEndFor = (_date: string) => classTimes.period2_end;
  const selectedDateEnded = Boolean(selectedDate) && lessonDayEnded(selectedDate, lessonEndFor(selectedDate));
  /** その日に表示する連絡の種類（画面のボタンの並びと同じ順）。 */
  const allowedRequestModes = (date: string): RequestMode[] => {
    const ended = lessonDayEnded(date, lessonEndFor(date));
    return [
      ...(visibility.absence && !ended ? ['absence', 'late', 'student_transfer'] as RequestMode[] : []),
      ...(visibility.transfer ? ['transfer'] as RequestMode[] : []),
    ];
  };
  const REQUEST_PANEL_TITLE: Record<RequestMode, string> = {
    absence: '欠席を連絡', late: '遅刻を連絡', student_transfer: '欠席を連絡', transfer: '振替を登録',
  };

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
        setSelectedId(current => pickChildId(user.uid, fetched.map(student => student.id), current));
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
      setLessons([]);
      setSentRequests([]);
      setDeclinedRequests([]);
      setSummary(null);
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
        setLessons(Array.isArray(source.lessons) ? source.lessons : []);
        // カレンダーの「連絡済み」は休む日（振替は元の授業日）に付ける。振替済みを優先して1日1件にまとめる。
        // 見送り・取消になった連絡は「連絡済み」にせず、別に結果だけを表示する。
        const markers = new Map<string, SentRequest['kind']>();
        const absenceIds = new Map<string, string>();
        const declined = new Map<string, string>();
        (source.absence || []).forEach((item: any) => {
          const date = String(item.type === 'transfer' ? item.absence_date || '' : item.target_date || '');
          if (!date) return;
          if (INACTIVE_REQUEST_STATUSES.includes(String(item.status || ''))) {
            if (!declined.has(date) || item.status === 'rejected') declined.set(date, String(item.status));
            return;
          }
          const kind: SentRequest['kind'] = item.type === 'transfer' || item.transfer_status === 'registered' ? 'transfer' : item.absence_type === 'late' ? 'late' : 'absent';
          if (markers.get(date) !== 'transfer') markers.set(date, kind);
          if (item.type === 'absence' && item.id) absenceIds.set(date, String(item.id));
        });
        setSentRequests(Array.from(markers, ([target_date, kind]) => ({ target_date, kind, absence_id: absenceIds.get(target_date) })));
        setDeclinedRequests(Array.from(declined).filter(([date]) => !markers.has(date)).map(([target_date, status]) => ({ target_date, status })));
        setSummary(dashboard.summary && typeof dashboard.summary === 'object' ? {
          window_days: Number(dashboard.summary.window_days) || 60,
          homework_count: Number(dashboard.summary.homework_count) || 0,
          ai_question_count: Number(dashboard.summary.ai_question_count) || 0,
        } : null);
        if (dashboard.class_times?.period2_end) setClassTimes(dashboard.class_times);

        setDetails({
          homework: (source.homework || []).map((item: any) => ({ id: item.id, title: item.title, meta: toDateTimeLabel(item.occurred_at), body: item.body, status: item.status })),
          absence: (source.absence || []).map((item: any) => {
            const target = requestDateLabel(String(item.target_date || ''));
            const original = requestDateLabel(String(item.absence_date || ''));
            const meta = item.type === 'transfer' && original ? `${original}の授業 → ${target || '日付未定'}に振替` : target || '日付未定';
            return { id: item.id, title: item.title, meta, body: item.body, status: item.status, requestType: String(item.type || ''), targetDate: String(item.target_date || '') };
          }),
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

  // 教室からの返信の未読数と、まだ読んでいない重要・緊急のお知らせ（保護者本人の分だけ）。
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/parent/home-summary', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        if (active) setHomeSummary({ unread_replies: Number(data.unread_replies) || 0, urgent_news: Array.isArray(data.urgent_news) ? data.urgent_news : [] });
      } catch (e) {
        // ご対応のお願いの追加表示だけなので、失敗しても画面全体はエラーにしない。
        console.warn('Parent home summary failed:', e);
      }
    })();
    return () => { active = false; };
  }, [user, dashboardReload]);

  useEffect(() => {
    const loadCourseOptions = async () => {
      if (!user || !selectedStudent) return;
      try {
        const [optionData, registrationSnap] = await Promise.all([
          loadCourseRegistrationOptions({
            grade: normalizeGrade(selectedStudent.grade),
            studentId: selectedStudent.id,
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
        const today = jstTodayKey();
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
        if (!res.ok || data.ok === false) throw new AbsenceRequestError(data, '振替候補を読み込めませんでした。');
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
  }, [user, selectedStudent, selectedDate, requestMode, transferOptionsReload]);

  useEffect(() => {
    if (selectedDate) requestPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedDate]);

  // 「欠席・遅刻の連絡」（/parent#absence）から来たときは、カレンダーまで移動する。
  useEffect(() => {
    if (loading || typeof window === 'undefined' || window.location.hash !== '#absence') return;
    const timer = window.setTimeout(() => document.getElementById('absence')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => window.clearTimeout(timer);
  }, [loading, students.length]);

  const submitCalendarRequest = async () => {
    if (!user || !selectedStudent || !selectedDate) return;
    const selectedTransfer = transferOptions.find(option => option.id === selectedTransferShiftId);
    if (requestMode === 'transfer' && !selectedTransfer) {
      toast.error('振替で参加したい授業を選択してください。');
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const isTransfer = requestMode === 'transfer';
      const isStudentTransfer = requestMode === 'student_transfer';
      const isLate = requestMode === 'late';
      const res = await fetch('/api/parent/absence-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          type: isTransfer ? 'transfer' : 'absence',
          absence_type: isTransfer ? null : isLate ? 'late' : 'absent',
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
      if (!res.ok || data.ok === false) throw new AbsenceRequestError(data);
      setRequestText('');
      setSelectedTransferShiftId('');
      // 同じ日の連絡は1件にまとめて更新されるので、目印も置き換える。
      setSentRequests(current => [
        ...current.filter(item => item.target_date !== selectedDate),
        { target_date: selectedDate, kind: isTransfer ? 'transfer' : isLate ? 'late' : 'absent' },
      ]);
      setSelectedDate('');
      setDetailsReload(value => value + 1);
      toast.success(isTransfer ? '振替を確定しました。' : isStudentTransfer ? '欠席連絡を送信しました。お子さまの画面に振替を選ぶ案内を表示します。' : isLate ? '遅刻の連絡を送信しました。' : '欠席連絡を送信しました。');
    } catch (e) {
      console.error(e);
      // 候補の期限切れ・変更のときは、最新の候補を読み込み直してから選び直してもらう。
      if (requestMode === 'transfer' && e instanceof AbsenceRequestError && isTransferOptionError(e.code)) {
        setTransferOptionsReload(value => value + 1);
      }
      toast.error(e instanceof Error ? e.message : '送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  /** 送った欠席・遅刻の連絡を取り消す。振替が登録されているときは、振替も取り消すかを改めて確認する。 */
  const cancelAbsenceRequest = async (absenceId: string, targetDate: string, kindLabel: string) => {
    if (!user || !selectedStudent || !absenceId || cancellingId) return;
    const dateLabel = formatDate(targetDate);
    if (!(await confirm({
      title: `${dateLabel}の${kindLabel}連絡を取り消しますか？`,
      message: `取り消すと、教室と${selectedStudent.student_name || 'お子さま'}さんに取り消したことが届きます。`,
      confirmLabel: '取り消す',
      cancelLabel: 'やめる',
      tone: 'danger',
    }))) return;
    setCancellingId(absenceId);
    try {
      const send = async (cancelTransfer: boolean) => {
        const res = await fetch('/api/parent/absence-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
          body: JSON.stringify({ action: 'cancel', request_id: absenceId, cancel_transfer: cancelTransfer }),
        });
        return { res, data: await res.json().catch(() => ({})) };
      };
      let { res, data } = await send(false);
      if (res.status === 409 && data.error === 'transfer-registered') {
        const transferLabel = String(data.transfer?.label || '').trim();
        const alsoTransfer = await confirm({
          title: '振替も一緒に取り消しますか？',
          message: `${data.message || 'この欠席には振替が登録されています。'}${transferLabel ? `（振替先：${transferLabel}）` : ''}`,
          confirmLabel: '振替も取り消す',
          cancelLabel: 'やめる',
          tone: 'danger',
        });
        if (!alsoTransfer) return;
        ({ res, data } = await send(true));
      }
      if (!res.ok || data.ok === false) throw new AbsenceRequestError(data, '取り消しできませんでした。');
      setSentRequests(current => current.filter(item => item.target_date !== targetDate));
      setDeclinedRequests(current => [...current.filter(item => item.target_date !== targetDate), { target_date: targetDate, status: 'cancelled' }]);
      setDetails(current => ({ ...current, absence: current.absence.map(item => item.id === absenceId || (data.transfer_cancelled && item.requestType === 'transfer' && item.id === `${absenceId}_transfer`) ? { ...item, status: 'cancelled' } : item) }));
      setDetailsReload(value => value + 1);
      toast.success(data.transfer_cancelled ? `${kindLabel}連絡と振替を取り消しました。` : `${kindLabel}連絡を取り消しました。`);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : '取り消しできませんでした。');
    } finally {
      setCancellingId('');
    }
  };

  const saveCourseRegistration = async (term: string, year: number, requestId = '', scopedSelectedIds?: string[]) => {
    if (!user || !selectedStudent) return;
    const intendedSelectedCourseIds = scopedSelectedIds ?? selectedCourseIds;
    if (intendedSelectedCourseIds.length === 0 && !(await confirm({
      title: `${selectedStudent.student_name || 'お子さま'}さんの登録済みの講座をすべて解除しますか？`,
      message: '解除すると、次のタームの受講講座が未登録になります。',
      confirmLabel: 'すべて解除する',
      tone: 'danger',
    }))) return;
    setSavingCourses(true);
    try {
      const selectedBeforeRefresh = courseOptions.filter(option => intendedSelectedCourseIds.includes(String(option.id)));
      const identities = new Set([
        ...intendedSelectedCourseIds,
        ...selectedBeforeRefresh.map(getCourseOptionStableKey).filter(Boolean),
      ]);
      const refreshed = intendedSelectedCourseIds.length > 0 ? await loadCourseRegistrationOptions({
        grade: normalizeGrade(selectedStudent.grade),
        year,
        studentId: selectedStudent.id,
        getToken: forceRefresh => user.getIdToken(forceRefresh),
        force: true,
      }) : { options: [] };
      const selected = (Array.isArray(refreshed.options) ? refreshed.options : [])
        .filter((option: any) => Number(option.year || year) === year)
        .filter((option: any) => String(option.term || option.term_label || '') === term)
        .filter((option: any) => courseOptionMatchesSelection(option, identities));
      if (intendedSelectedCourseIds.length > 0 && (selected.length === 0 || selected.some((option: any) => !option.registration_token))) {
        throw new Error('講座候補が更新されました。画面を再読み込みして選択内容を確認してください。');
      }
      const freshSelectedCourseIds = selected.map((option: any) => String(option.id || '')).filter(Boolean);
      const selectedCourseKeys = selected.map(getCourseOptionStableKey).filter(Boolean);
      const registrationTokens = selected.map((option: any) => option.registration_token).filter(Boolean);
      const token = await user.getIdToken(true);
      const res = await fetch('/api/parent/course-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          request_id: requestId,
          term,
          year,
          selected_course_ids: freshSelectedCourseIds,
          selected_course_keys: selectedCourseKeys,
          registration_tokens: registrationTokens,
          registration_type: 'regular',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setSelectedCourseIds(freshSelectedCourseIds);
      toast.success(freshSelectedCourseIds.length === 0 ? '受講講座の登録を解除しました。' : '受講講座を登録しました。');
      if (requestId) {
        setPendingCourseRequests(prev => prev.filter(req => req.id !== requestId));
        setActiveCourseRequest(null);
      }
    } catch (e: any) {
      toast.error(`登録に失敗しました: ${e.message || e}`);
    } finally {
      setSavingCourses(false);
    }
  };

  if (loading && students.length === 0) {
    return (
      <div className="space-y-6" role="status" aria-label="読み込み中">
        <div aria-hidden className="h-48 rounded-hero bg-accent/80 motion-safe:animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-28 w-full rounded-card" />)}</div>
      </div>
    );
  }

  if (dashboardError) {
    return <ErrorState message={dashboardError} onRetry={() => setDashboardReload(value => value + 1)} />;
  }

  if (students.length === 0) {
    return (
      <div className="space-y-6">
        <ParentPageHeader eyebrow="はじめに" title="保護者ページへようこそ" description="お子さまのアカウントとの紐づけが完了すると、学習の様子をここで確認できます。" icon={GraduationCap} />
        <ParentCard>
          <ParentEmpty icon={Users} title="紐づくお子さまがまだ登録されていません" description="お手数ですが、通塾中の校舎へ保護者アカウントの紐づけをご依頼ください。" />
        </ParentCard>
      </div>
    );
  }

  const sections = [
    { key: 'homework', label: TERMS.homework, icon: ClipboardCheck, tone: 'emerald' as const },
    { key: 'lessons', label: TERMS.lesson, icon: Video, tone: 'sky' as const },
    { key: 'absence', label: '欠席・振替', icon: Send, tone: 'amber' as const },
    { key: 'aiMessages', label: 'AI学習', icon: MessageCircle, tone: 'violet' as const },
    { key: 'announcements', label: TERMS.news, icon: Bell, tone: 'navy' as const },
  ].filter(section => section.key === 'lessons'
    ? Boolean(visibility.attendance || visibility.recordings)
    : visibility[section.key as keyof typeof visibility]);

  const countFor = (key: string) => key === 'lessons' ? lessons.length : (details[key] || []).length;
  const totalItems = sections.reduce((sum, section) => sum + countFor(section.key), 0);
  const lessonSummary = summarizeLessonDays(lessons);
  const pendingAbsences = details.absence.filter(item => item.status === 'pending').length;
  const latestAnnouncement = visibility.announcements ? details.announcements[0] : undefined;
  const sectionsWithItems = sections.filter(section => countFor(section.key) > 0);
  const currentActivity = sectionsWithItems.find(section => section.key === activityTab) || sectionsWithItems[0];
  const studentName = selectedStudent?.student_name || 'お子さま';
  const guardianName = String(profile?.parent_name || profile?.name || '').trim();
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }).format(now).replace(/\D/g, '')) % 24;
  const greeting = hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';
  const todayLabel = formatDate(now);
  // 件数はサーバーが直近の期間（日本時間）で数えた値。一覧は新しい順の一部だけなので数には使わない。
  const aiQuestions = summary ? summary.ai_question_count : details.aiMessages.filter(item => item.title === '生徒の質問').length;
  const homeworkCount = summary ? summary.homework_count : details.homework.length;
  const summaryDays = summary?.window_days || 60;
  const stats = [
    visibility.attendance && { key: 'lessons', label: 'Zoomで参加', value: lessonSummary.liveDays, unit: '日', icon: Video, tone: 'text-info bg-info-soft' },
    visibility.homework && { key: 'homework', label: '宿題の提出', value: homeworkCount, unit: '件', icon: ClipboardCheck, tone: 'text-success bg-success-soft' },
    visibility.recordings && { key: 'lessons-recording', label: '録画で視聴', value: lessonSummary.recordingCount, unit: '本', icon: MonitorPlay, tone: 'text-danger bg-danger-soft' },
    visibility.aiMessages && { key: 'aiMessages', label: 'AIへの質問', value: aiQuestions, unit: '回', icon: MessageCircle, tone: 'text-accent bg-accent-soft' },
  ].filter(Boolean) as { key: string; label: string; value: number; unit: string; icon: any; tone: string }[];
  const urgentNewsTodos = visibility.announcements ? (homeSummary?.urgent_news || []).map(news => ({
    key: `news_${news.id}`, icon: Megaphone,
    tone: news.label === 'alert' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warning/30 bg-warning-soft text-warning',
    title: `【${news.label === 'alert' ? '緊急' : '重要'}】${news.title}`,
    description: `まだお読みになっていない大切な${TERMS.news}です。${news.published_at ? `（${toDateLabel(news.published_at)}）` : ''}`,
    href: `/parent/news/${encodeURIComponent(news.id)}`, actionLabel: '読む',
  })) : [];
  const unreadReplies = visibility.contact !== false ? homeSummary?.unread_replies || 0 : 0;
  const todos = [
    ...urgentNewsTodos,
    unreadReplies > 0 && {
      key: 'replies', icon: MessagesSquare, tone: 'border-accent/30 bg-accent-soft text-accent',
      title: `教室から返信があります（${unreadReplies}件）`,
      description: `「${TERMS.parentContact}」で内容をご確認ください。`,
      href: '/parent/contact', actionLabel: '返信を見る',
    },
    pendingCourseRequests.length > 0 && {
      key: 'course', icon: BookOpen, tone: 'border-warning/30 bg-warning-soft text-warning',
      title: `受講講座の登録をお願いします（${pendingCourseRequests.length}件）`,
      description: pendingCourseRequests[0]?.title || '次のタームで受講する講座をお選びください。',
      action: () => setActiveCourseRequest(pendingCourseRequests[0]), actionLabel: '登録する',
    },
    pendingAbsences > 0 && {
      key: 'absence', icon: Send, tone: 'border-info/30 bg-info-soft text-info',
      title: `欠席・振替の連絡 ${pendingAbsences}件を教室で確認中です`,
      description: '確認が終わると、このページの「欠席・振替」に結果が表示されます。',
      action: () => setActivityTab('absence'), actionLabel: '内容を見る',
    },
  ].filter(Boolean) as { key: string; icon: any; tone: string; title: string; description: string; action?: () => void; href?: string; actionLabel: string }[];
  const learningVisible = Boolean(visibility.attendance || visibility.recordings || visibility.homework);
  const quickActions = [
    visibility.absence && { href: '/parent#absence', label: TERMS.absenceContact, description: 'カレンダーから休む日・遅れる日を選びます', icon: CalendarX2 },
    visibility.contact !== false && { href: '/parent/contact', label: TERMS.parentContact, description: '先生とのやりとりを残せます', icon: MessagesSquare },
    learningVisible && { href: '/parent/pf', label: '学習状況', description: 'いつ・どの授業を受けたか', icon: BarChart3 },
    visibility.announcements && { href: '/parent/news', label: TERMS.news, description: '教室からの正式なご案内', icon: Megaphone },
  ].filter(Boolean) as { href: string; label: string; description: string; icon: any }[];
  const childOptions = students.map(student => ({ id: student.id, name: student.student_name }));

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-hero bg-accent text-accent-ink shadow-card">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative grid gap-6 p-6 sm:p-7 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold text-accent-ink/75">{todayLabel}</p>
            <h1 className="mt-2 text-2xl font-black leading-snug sm:text-3xl">
              {greeting}{guardianName ? `、${guardianName} 様` : ''}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-accent-ink/80">
              {studentName}さんの学習の様子をお届けします。毎日の積み重ねを、ご家庭でもあたたかく見守ってください。
            </p>
            <ChildSwitcher tone="hero" className="mt-5" options={childOptions} value={selectedId} onChange={setSelectedId} />
          </div>
          <div className="rounded-card bg-white/10 p-5 ring-1 ring-white/15">
            <div className="flex items-center gap-4">
              <div aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-btn bg-surface text-xl font-bold text-accent">{studentName.slice(0, 1)}</div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-accent-ink/70">表示中のお子さま</p>
                <p className="truncate text-lg font-bold">{studentName}<span className="ml-1 text-sm font-medium text-accent-ink/75">さん</span></p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
              {selectedStudent?.grade && <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">{selectedStudent.grade}</span>}
              {selectedStudent?.school && <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">{selectedStudent.school}</span>}
              {registeredWeekdays.length > 0 && <span className="rounded-full bg-white/20 px-3 py-1 ring-1 ring-white/25">通塾 {registeredWeekdays.map(day => `${day}曜`).join('・')}</span>}
            </div>
            <Link href="/parent/courses" className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-btn text-xs font-bold text-accent-ink/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              受講講座の登録・変更<ChevronRight size={14} aria-hidden />
            </Link>
            {latestAnnouncement && (
              <Link href="/parent/news" className="mt-4 flex min-h-12 items-center gap-3 rounded-btn bg-surface p-3.5 text-fg hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <Megaphone size={18} className="shrink-0 text-warning" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg-muted">最新の{TERMS.news} ・ {latestAnnouncement.meta}</span>
                  <span className="block truncate text-sm font-bold">{latestAnnouncement.title}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </section>

      {detailsError && <ErrorState title="一部の情報を読み込めませんでした" message={detailsError} onRetry={() => setDetailsReload(value => value + 1)} />}

      {todos.length > 0 && (
        <section className="space-y-3" aria-label="ご対応のお願い">
          {todos.map(todo => {
            const Icon = todo.icon;
            return (
              <div key={todo.key} className={cn('flex flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center', todo.tone)}>
                <div className="flex flex-1 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-surface/80"><Icon size={19} aria-hidden /></span>
                  <div>
                    <p className="text-sm font-bold text-fg">{todo.title}</p>
                    <p className="mt-0.5 text-sm text-fg-muted">{todo.description}</p>
                  </div>
                </div>
                {todo.href
                  ? <ButtonLink variant="secondary" href={todo.href} className="shrink-0">{todo.actionLabel}</ButtonLink>
                  : <Button variant="secondary" onClick={todo.action} className="shrink-0">{todo.actionLabel}</Button>}
              </div>
            );
          })}
        </section>
      )}

      {stats.length > 0 && (
        <section aria-labelledby="parent-stats-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-1 px-1">
            <h2 id="parent-stats-heading" className="text-base font-bold text-fg">{studentName}さんのがんばり</h2>
            <p className="text-xs text-fg-muted">直近{summaryDays}日間の記録から集計</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map(stat => {
              const Icon = stat.icon;
              return (
                <button key={stat.key} type="button" onClick={() => setActivityTab(stat.key.startsWith('lessons') ? 'lessons' : stat.key)} className="cb-card p-4 text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <span className={cn('mb-3 flex h-9 w-9 items-center justify-center rounded-btn', stat.tone)}><Icon size={18} aria-hidden /></span>
                  <p className="text-xs font-bold text-fg-muted">{stat.label}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-fg">{detailsLoading ? '…' : stat.value}<span className="ml-1 text-xs font-bold text-fg-muted">{stat.unit}</span></p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {quickActions.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="よく使う操作">
          {quickActions.map(action => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href} className="cb-card group flex min-h-16 items-center gap-3 p-4 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-accent-ink"><Icon size={19} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-fg">{action.label}</span>
                  <span className="block truncate text-xs text-fg-muted">{action.description}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-hidden />
              </Link>
            );
          })}
        </section>
      )}

      {(visibility.calendar || visibility.absence) && (
        <ParentActionCalendar
          month={currentMonth}
          onChangeMonth={setCurrentMonth}
          selectedDate={selectedDate}
          onSelectDate={date => {
            setSelectedDate(date);
            setCurrentMonth(new Date(`${date}T12:00:00`));
            // 日付を選ぶたびに、その日に選べる最初の種類へ戻す（前の日の選択や、表示されない種類が残らないように）。
            // 授業が終わった日は振替の登録だけできる。
            setRequestMode(allowedRequestModes(date)[0] || 'absence');
            setRequestText('');
          }}
          canAbsence={visibility.absence}
          canTransfer={visibility.transfer}
          schedules={monthlySchedules}
          registeredWeekdays={registeredWeekdays}
          lessonEndFor={lessonEndFor}
          sentRequests={sentRequests}
          declinedRequests={declinedRequests}
          studentName={studentName}
        />
      )}

      <ParentCourseRequestModal
        request={activeCourseRequest}
        options={courseOptions}
        selectedCourseIds={selectedCourseIds}
        onChangeSelectedCourseIds={setSelectedCourseIds}
        onSubmit={(term, year, requestId, scopedIds) => saveCourseRegistration(term, year, requestId, scopedIds)}
        onClose={() => setActiveCourseRequest(null)}
        saving={savingCourses}
      />

      {selectedDate && (visibility.absence || visibility.transfer) && (
        <div ref={requestPanelRef} className="scroll-mt-20">
        <ParentCard className="ring-2 ring-accent/10">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-accent">{formatDate(selectedDate)}</p>
              <h3 className="mt-1 text-lg font-bold text-fg">{studentName}さんの{REQUEST_PANEL_TITLE[requestMode]}</h3>
              {sentRequests.some(item => item.target_date === selectedDate && item.kind === 'transfer')
                ? <p className="mt-1 text-sm text-success">この日は振替を登録済みです。振替先を変える場合は教室へご連絡ください。</p>
                : sentRequests.some(item => item.target_date === selectedDate)
                  ? <p className="mt-1 text-sm text-success">この日はすでに連絡済みです。欠席・遅刻の切り替えや理由の修正は、もう一度送信すると同じ連絡として更新されます。</p>
                  : declinedRequests.some(item => item.target_date === selectedDate) && <p className="mt-1 text-sm text-danger">この日の連絡は「{parentStatusLabel(declinedRequests.find(item => item.target_date === selectedDate)?.status)}」になりました。必要な場合は、もう一度連絡するか教室へご相談ください。</p>}
              {selectedDateEnded && <p className="mt-1 text-sm text-fg-muted">この日の授業は終わったため、欠席・遅刻の連絡はできません。振替先の登録だけできます。</p>}
              {(() => {
                const sent = sentRequests.find(item => item.target_date === selectedDate && item.absence_id);
                if (!sent?.absence_id || selectedDateEnded || !visibility.absence) return null;
                const kindLabel = sent.kind === 'late' ? '遅刻' : '欠席';
                return (
                  <Button variant="secondary" size="sm" className="mt-2" loading={cancellingId === sent.absence_id} disabled={Boolean(cancellingId)}
                    onClick={() => void cancelAbsenceRequest(sent.absence_id!, selectedDate, kindLabel)}>
                    この{kindLabel}連絡を取り消す
                  </Button>
                );
              })()}
            </div>
            <IconButton label="閉じる" variant="secondary" onClick={() => setSelectedDate('')}><X size={18} aria-hidden /></IconButton>
          </div>
          <div className="grid gap-5 md:grid-cols-[240px_1fr]">
            <div>
              <p className="mb-2 text-sm font-bold text-fg-muted">② 連絡の種類をえらぶ</p>
              <div className="grid gap-2" role="radiogroup" aria-label="連絡の種類">
                {visibility.absence && !selectedDateEnded && <RequestModeButton active={requestMode === 'absence'} onClick={() => setRequestMode('absence')} title="欠席する" description="振替は後で相談" />}
                {visibility.absence && !selectedDateEnded && <RequestModeButton active={requestMode === 'late'} onClick={() => setRequestMode('late')} title="遅刻する" description="授業に遅れて参加" />}
                {visibility.absence && !selectedDateEnded && <RequestModeButton active={requestMode === 'student_transfer'} onClick={() => setRequestMode('student_transfer')} title="欠席して、振替はお子さまが選ぶ" description="生徒画面に振替選択を表示" />}
                {visibility.transfer && <RequestModeButton active={requestMode === 'transfer'} onClick={() => setRequestMode('transfer')} title="振替先をいま決める" description="保護者が授業を選んで確定" />}
              </div>
            </div>
            <div className="space-y-3">
              {requestMode === 'transfer' && (
                <div className="rounded-card border border-line bg-canvas p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-accent">
                    <Video size={15} aria-hidden /> この日に受けられる同じ単元の授業
                  </div>
                  {loadingTransferOptions ? (
                    <div className="rounded-btn bg-surface px-3 py-3"><Spinner label="振替候補を読み込み中" /></div>
                  ) : transferOptions.length === 0 ? (
                    <div className="rounded-btn bg-surface px-3 py-3 text-sm text-fg-muted">この日に選べる振替候補はありません。</div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="振替先の授業">
                      {transferOptions.map(option => {
                        const active = selectedTransferShiftId === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setSelectedTransferShiftId(option.id)}
                            className={cn('min-h-11 rounded-btn border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'border-accent bg-surface text-accent shadow-sm' : 'border-transparent bg-surface text-fg hover:border-line')}
                          >
                            <p className="text-sm font-bold">{option.title}</p>
                            <p className="mt-1 text-xs text-fg-muted">{option.unit || '単元名未設定'} / {option.matchLabel}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {requestMode === 'student_transfer' && (
                <div className="rounded-card border border-info/20 bg-info-soft p-4 text-sm leading-relaxed text-info">
                  連絡後、お子さまの画面に振替先を選ぶ案内が表示されます。振替先を選ぶまで、お子さまのホーム画面は先へ進めません。
                </div>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-fg-muted">③ {requestMode === 'transfer' ? '補足（任意）' : requestMode === 'late' ? '遅刻の理由と、参加できそうな時刻' : '欠席の理由'}</span>
                <textarea value={requestText} onChange={e => setRequestText(e.target.value)} className="min-h-24 w-full resize-none rounded-input border border-line bg-surface p-4 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" placeholder={requestMode === 'transfer' ? '希望時間などがあればご記入ください' : requestMode === 'late' ? '例：部活のため、20時ごろから参加します' : '例：体調不良のため'} />
              </label>
              <Button size="lg" fullWidth onClick={submitCalendarRequest} loading={submitting} disabled={(requestMode !== 'transfer' && !requestText.trim()) || (requestMode === 'transfer' && !selectedTransferShiftId)} icon={<Send size={18} aria-hidden />}>
                {submitting ? '送信中...' : '④ 教室へ連絡する'}
              </Button>
              <p className="text-center text-xs text-fg-muted">連絡すると、校舎・先生と{studentName}さんに理由つきで届きます。</p>
            </div>
          </div>
        </ParentCard>
        </div>
      )}

      <ParentCard>
        <ParentSectionTitle icon={Sparkles} tone="amber" title="最近の学習のようす" description="授業（Zoom参加・録画視聴）・宿題・欠席連絡などを新しい順に表示します。" trailing={detailsLoading ? <Spinner /> : <StatusPill>{totalItems}件</StatusPill>} />
        {!detailsLoading && sectionsWithItems.length === 0 ? (
          <ParentEmpty icon={ClipboardCheck} title="学習の記録はまだありません" description="宿題の提出や授業への出席、録画の視聴などがあると、ここにまとめて表示されます。" />
        ) : (
          <>
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="記録の種類">
              {sectionsWithItems.map(section => {
                const Icon = section.icon;
                const active = currentActivity?.key === section.key;
                return (
                  <button key={section.key} type="button" role="tab" aria-selected={active} onClick={() => setActivityTab(section.key)}
                    className={cn('flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'bg-accent text-accent-ink' : 'bg-canvas text-fg-muted hover:bg-accent-soft hover:text-accent')}>
                    <Icon size={15} aria-hidden />{section.label}<span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-white/15' : 'bg-surface')}>{countFor(section.key)}</span>
                  </button>
                );
              })}
            </div>
            {currentActivity?.key === 'lessons' && (
              <div className="space-y-3">
                <LessonDayList days={lessons.slice(0, 5)} />
                <Link href="/parent/pf" className="flex min-h-11 items-center justify-center gap-1 rounded-btn bg-canvas py-3 text-sm font-bold text-accent hover:bg-accent-soft">月ごとの授業の記録を見る<ChevronRight size={15} aria-hidden /></Link>
              </div>
            )}
            {currentActivity && currentActivity.key !== 'lessons' && (
              <ol className="relative max-h-[28rem] space-y-3 overflow-y-auto pl-5 pr-1 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-line">
                {(details[currentActivity.key] || []).map(item => (
                  <li key={item.id} className="relative">
                    <span aria-hidden className="absolute -left-5 top-4 h-3.5 w-3.5 rounded-full border-[3px] border-surface bg-accent shadow" />
                    <div className="rounded-btn bg-canvas p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-bold text-fg">{item.title}</p>
                        {item.status && <StatusPill tone={parentStatusPillTone(item.status)} className="shrink-0">{parentStatusLabel(item.status)}</StatusPill>}
                      </div>
                      <p className="mt-0.5 text-xs text-fg-muted">{item.meta}</p>
                      {item.body && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-fg">{item.body}</p>}
                      {visibility.absence && item.requestType === 'absence' && item.targetDate && !INACTIVE_REQUEST_STATUSES.includes(String(item.status || '')) && !lessonDayEnded(item.targetDate, lessonEndFor(item.targetDate)) && (
                        <div className="mt-3 flex justify-end">
                          <Button variant="secondary" size="sm" loading={cancellingId === item.id} disabled={Boolean(cancellingId)}
                            onClick={() => void cancelAbsenceRequest(item.id, item.targetDate!, item.title.startsWith('遅刻') ? '遅刻' : '欠席')}>
                            取り消す
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </ParentCard>
    </div>
  );
}

function RequestModeButton({ active, onClick, title, description }: { active: boolean; onClick: () => void; title: string; description: string }) {
  return (
    <button type="button" role="radio" onClick={onClick} aria-checked={active}
      className={cn('min-h-11 rounded-btn border-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg hover:border-accent/30')}>
      <span className="flex items-center gap-2 text-sm font-bold">
        <span aria-hidden className={cn('flex h-4 w-4 items-center justify-center rounded-full border-2', active ? 'border-accent' : 'border-slate-300')}>{active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}</span>
        {title}
      </span>
      <span className="mt-0.5 block pl-6 text-xs text-fg-muted">{description}</span>
    </button>
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
  const today = jstTodayKey();
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
    <section className="cb-card p-card">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-bold text-accent">受講講座登録</p>
          <h3 className="mt-1 text-xl font-bold text-fg">{first.term_label || '次ターム'}の受講講座</h3>
          <p className="mt-1 text-sm text-fg-muted">
            {isOpen ? '次のターム開始が近づいています。受講する講座を選択してください。' : '次タームの講座候補です。受付開始日になると登録できます。'}
          </p>
        </div>
        <div className="rounded-btn bg-accent-soft px-4 py-3 text-xs font-bold text-accent">
          受付開始 {formatDate(first.registration_opens_at) || '-'} / ターム開始 {formatDate(first.term_start_date) || '-'}
        </div>
      </div>
      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-btn bg-success-soft px-4 py-3 text-sm font-bold text-success">
          <CheckCircle2 size={18} aria-hidden /> 登録済みです。変更する場合は選び直して再登録できます。
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
      <Button size="lg" fullWidth className="mt-5" onClick={() => onSave(first.term, Number(first.year))} loading={saving} disabled={!isOpen}>
        {saving ? '登録中...' : isOpen ? '受講講座を登録する' : '受付開始前です'}
      </Button>
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
  onSubmit: (term: string, year: number, requestId: string, scopedSelectedIds: string[]) => void;
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
  const timeKey = getCourseOptionScheduleKey;
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
    const selected = selectedCourseKeys.includes(key);
    setSelectedCourseKeys(prev => selected ? prev.filter(item => item !== key) : [...prev, key]);
    if (selected) {
      onChangeSelectedCourseIds(current => removeCourseOptionSelections(current, targetOptions));
      return;
    }
    const scheduleKeys = new Set(targetOptions.map(timeKey));
    const targetCourseKeys = new Set(targetOptions.map(getCourseOptionCourseKey));
    if (scheduleKeys.size === 1) {
      onChangeSelectedCourseIds(prev => {
        const visibleIds = new Set(requestOptions.map(option => option.id));
        const selectedInRequest = new Set(prev.filter(id => visibleIds.has(id)));
        const outsideRequest = prev.filter(id => !visibleIds.has(id));
        requestOptions
          .filter(option => scheduleKeys.has(timeKey(option)) || targetCourseKeys.has(getCourseOptionCourseKey(option)))
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
      const targetOptions = requestOptions.filter(option => cleanIds.includes(option.id));
      const hasSelected = hasCourseOptionSelection(selectedInRequest, targetOptions);
      if (hasSelected) {
        return removeCourseOptionSelections(prev, targetOptions);
      }

      const conflictKeys = new Set(targetOptions.map(timeKey));
      const duplicateCourseKeys = new Set(targetOptions.map(getCourseOptionCourseKey));
      requestOptions
        .filter(option => conflictKeys.has(timeKey(option)) || duplicateCourseKeys.has(getCourseOptionCourseKey(option)))
        .forEach(option => selectedInRequest.delete(option.id));
      cleanIds.forEach(id => selectedInRequest.add(id));
      return Array.from(new Set([...outsideRequest, ...Array.from(selectedInRequest)]));
    });
  };
  const toggleSingleCourseOption = (id: string) => toggleCourseGroup([id]);

  const submitTerm = first.term || request?.term || 'term';
  const submitYear = Number(first.year || request?.year || new Date().getFullYear());

  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      size="lg"
      title={request?.title || '受講講座登録'}
      description={request ? `登録期間：${formatDate(request.period_start) || '-'} 〜 ${formatDate(request.period_end || request.deadline) || '-'}` : undefined}
      footer={request ? (
        <>
          <button
            type="button"
            onClick={() => onSubmit(submitTerm, submitYear, request.id, [])}
            disabled={saving || requestOptions.length === 0 || visibleSelectedIds.length > 0}
            className="inline-flex min-h-11 items-center justify-center rounded-btn border border-danger/30 bg-surface px-4 text-sm font-bold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:pointer-events-none disabled:opacity-40"
          >
            すべて解除する
          </button>
          <Button
            onClick={() => onSubmit(submitTerm, submitYear, request.id, visibleSelectedIds)}
            loading={saving}
            disabled={requestOptions.length === 0 || visibleSelectedIds.length === 0}
          >
            {saving ? '保存中...' : '登録する'}
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-5">
        <CourseOpeningMap
          options={requestOptions}
          selectedIds={visibleSelectedIds}
          title="この登録で選べる週間開講状況"
          description="先に曜日と時限の全体像を確認してから、下で講座を選べます。"
        />
        <div className="rounded-card border border-accent/15 bg-accent-soft p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-accent">1. 科目</p>
              <h3 className="text-base font-bold text-fg">受講したい講座を選ぶ</h3>
            </div>
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold bg-surface text-accent">{selectedCourseKeys.length}科目</span>
          </div>
          {courseChoices.length === 0 ? (
            <div className="rounded-btn border-2 border-dashed border-line bg-surface/70 p-5 text-center text-sm font-bold text-fg-muted">
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
                    className={cn('rounded-btn border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'border-accent bg-surface text-accent shadow-sm' : 'border-transparent bg-surface/80 text-fg hover:border-accent/30')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{[option.grade, getCourseSubject(option), option.course_name || option.title].filter(Boolean).join(' ')}</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          {daySlots.slice(0, 4).join(' / ') || '曜日・時間未設定'}
                          {daySlots.length > 4 ? ` ほか${daySlots.length - 4}件` : ''}
                        </p>
                        <p className="mt-2 text-xs font-bold text-success">
                          {daySlots.length === 1 ? '選ぶだけで曜日・時間も確定' : `${daySlots.length}個の曜日・時間から選択`}
                          {units.length > 0 ? ` ・ 全${units.length}単元` : ''}
                        </p>
                      </div>
                      {active && <CheckCircle2 size={18} className="shrink-0 text-accent" aria-hidden />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-fg-muted">2. 曜日・時間</p>
              <h3 className="text-base font-bold text-fg">通える曜日・時間を決める</h3>
              <p className="mt-1 text-xs text-fg-muted">同じ曜日・時限は1講座のみ、同じ講座は別の曜日・時限と重複して選べません。</p>
            </div>
            <StatusPill>{visibleSelectedIds.length}件</StatusPill>
          </div>
          {selectedCourseKeys.length === 0 ? (
            <div className="rounded-btn border-2 border-dashed border-line p-6 text-center text-sm font-bold text-fg-muted">
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
    </Modal>
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
  lessonEndFor,
  sentRequests,
  declinedRequests,
  studentName,
}: {
  month: Date;
  onChangeMonth: (value: Date) => void;
  selectedDate: string;
  onSelectDate: (value: string) => void;
  canAbsence: boolean;
  canTransfer: boolean;
  schedules: any[];
  registeredWeekdays: string[];
  lessonEndFor: (date: string) => string;
  sentRequests: SentRequest[];
  declinedRequests: DeclinedRequest[];
  studentName: string;
}) {
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const today = jstTodayKey();
  const canContact = canAbsence || canTransfer;
  const dateKeyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  const isClosed = (date: string) => schedules.some(item => scheduleCoversDate(item, date) && calendarScheduleKind(item) === 'closed');
  const sentKind = (date: string) => sentRequests.find(item => item.target_date === date)?.kind;
  const SENT_LABEL = { absent: '欠席連絡済み', late: '遅刻連絡済み', transfer: '振替済み' } as const;
  const declinedStatus = (date: string) => declinedRequests.find(item => item.target_date === date)?.status;

  // これから連絡できる通塾日（今日を含めて最大3日）。授業が終わった日は含めない。
  const upcoming = useMemo(() => {
    const result: string[] = [];
    const cursor = new Date(`${today}T12:00:00`);
    for (let i = 0; i < 42 && result.length < 3; i += 1) {
      const date = dateKeyOf(cursor);
      if (registeredWeekdays.includes(weekdayOf(date)) && !isClosed(date) && !lessonDayEnded(date, lessonEndFor(date))) result.push(date);
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, registeredWeekdays, schedules, lessonEndFor]);

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
    <section id="absence" className="cb-card scroll-mt-20 p-card" aria-labelledby="absence-heading">
      <div className="mb-4">
        <p className="text-xs font-bold text-warning">{TERMS.absenceContact}（欠席・遅刻）</p>
        <h3 id="absence-heading" className="mt-0.5 text-lg font-bold text-fg">{studentName}さんの通塾カレンダー</h3>
        {canContact && (
          <ol className="mt-3 grid gap-2 text-sm font-bold text-fg sm:grid-cols-2 lg:grid-cols-4">
            <li className="flex items-center gap-2 rounded-btn bg-warning-soft px-3 py-2 text-warning"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning text-xs text-white">1</span>休む日・遅れる日をタップ</li>
            <li className="flex items-center gap-2 rounded-btn bg-canvas px-3 py-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs text-white">2</span>連絡の種類をえらぶ</li>
            <li className="flex items-center gap-2 rounded-btn bg-canvas px-3 py-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs text-white">3</span>理由などを入力</li>
            <li className="flex items-center gap-2 rounded-btn bg-canvas px-3 py-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs text-white">4</span>「教室へ連絡する」を押す</li>
          </ol>
        )}
      </div>

      {canContact && (
        <div className="mb-5">
          <p className="mb-2 text-sm font-bold text-fg-muted">次の通塾日</p>
          {upcoming.length === 0 ? (
            <p className="rounded-btn bg-canvas px-4 py-3 text-sm text-fg-muted">連絡できる通塾日が見つかりません。受講講座の登録内容をご確認ください。</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {upcoming.map(date => {
                const sent = sentKind(date);
                const declined = sent ? undefined : declinedStatus(date);
                const active = selectedDate === date;
                return (
                  <button key={date} type="button" onClick={() => onSelectDate(date)} aria-pressed={active}
                    className={cn('flex min-h-14 items-center justify-between gap-2 rounded-btn border-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', active ? 'border-accent bg-accent text-accent-ink' : 'border-warning/30 bg-warning-soft text-fg hover:border-warning/60')}>
                    <span>
                      <span className="block text-sm font-bold">{formatDate(date)}{date === today ? '（今日）' : ''}</span>
                      <span className={cn('block text-xs', active ? 'text-accent-ink/80' : sent ? 'text-success' : declined ? 'text-danger' : 'text-warning')}>{sent ? SENT_LABEL[sent] : declined ? `前回の連絡は${parentStatusLabel(declined)}` : `${lessonEndFor(date)} まで連絡できます`}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden className={active ? 'text-accent-ink/80' : 'text-warning'} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-base font-bold text-fg">{year}年 {monthIndex + 1}月</p>
        <div className="flex gap-2">
          <IconButton label="前の月" variant="secondary" onClick={() => onChangeMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={18} aria-hidden /></IconButton>
          <IconButton label="次の月" variant="secondary" onClick={() => onChangeMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={18} aria-hidden /></IconButton>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-[repeat(7,minmax(0,1fr))] text-center text-xs font-bold text-fg-muted" aria-hidden>
        {WEEKDAYS.map((day, index) => <div key={day} className={index === 0 ? 'text-danger' : index === 6 ? 'text-info' : ''}>{day}</div>)}
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
        {days.map(day => day.date ? (() => {
          const daySchedules = schedules.filter(item => scheduleCoversDate(item, day.date));
          const isClosedDay = daySchedules.some(item => calendarScheduleKind(item) === 'closed');
          const isRegisteredDay = registeredWeekdays.includes(weekdayOf(day.date));
          const ended = isRegisteredDay && lessonDayEnded(day.date, lessonEndFor(day.date));
          // 授業が終わった日は、振替（補講）の登録だけできる。
          const actionable = !isClosedDay && isRegisteredDay && (ended ? canTransfer : canContact);
          const sent = sentKind(day.date);
          const declined = sent ? undefined : declinedStatus(day.date);
          const selected = selectedDate === day.date;
          const tone = selected
            ? 'border-accent bg-accent text-accent-ink shadow-md'
            : isClosedDay ? 'cursor-default border-danger/20 bg-danger-soft text-danger'
            : ended ? `border-line bg-slate-100 text-fg-muted ${actionable ? 'hover:border-slate-300' : 'cursor-default'}`
            : actionable ? 'border-warning/40 bg-warning-soft text-fg hover:border-warning'
            : 'cursor-default border-line bg-surface text-fg-muted';
          const badge = 'truncate rounded px-1 py-0.5 text-[11px] font-bold leading-tight';
          return (
          <button key={day.key} type="button" disabled={!actionable} onClick={() => actionable && onSelectDate(day.date)} aria-pressed={selected} aria-label={`${formatDate(day.date)}${ended ? (actionable ? '（授業は終了・振替の登録のみ）' : '（授業は終了）') : actionable ? '（連絡できます）' : ''}${sent ? `・${SENT_LABEL[sent]}` : ''}`}
            className={cn('min-h-[4.5rem] min-w-0 overflow-hidden rounded-btn border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-24 sm:p-2', tone, day.date === today && !selected && 'ring-2 ring-accent/40')}>
            <span className="text-sm font-bold">{day.label}</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {sent && <span className={cn(badge, selected ? 'bg-white/15 text-white' : 'bg-success-soft text-success')}><span className="sm:hidden">済み</span><span className="hidden sm:inline">{SENT_LABEL[sent]}</span></span>}
              {declined && <span className={cn(badge, selected ? 'bg-white/15 text-white' : 'bg-danger-soft text-danger')}>{parentStatusLabel(declined)}</span>}
              {!sent && !declined && actionable && !ended && <span className={cn(badge, selected ? 'bg-white/15 text-accent-ink' : 'bg-warning/15 text-warning')}><span className="sm:hidden">連絡可</span><span className="hidden sm:inline">連絡できる</span></span>}
              {!sent && !declined && ended && <span className={cn(badge, 'bg-slate-200 text-slate-600')}>{actionable ? <><span className="sm:hidden">振替可</span><span className="hidden sm:inline">終了・振替のみ</span></> : '終了'}</span>}
              {daySchedules.slice(0, 1).map(item => {
                const kind = calendarScheduleKind(item);
                return <span key={item.id} className={cn(badge, 'sm:px-1.5', kind === 'closed' ? 'bg-danger-soft text-danger' : kind === 'lesson' ? 'bg-info-soft text-info' : 'bg-success-soft text-success')}>{calendarScheduleLabel(item)}</span>;
              })}
            </div>
          </button>
          );
        })() : <div key={day.key} className="min-h-20" />)}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 rounded-btn bg-canvas px-4 py-3 text-xs font-bold text-fg-muted">
        <span className="flex items-center gap-1.5"><i aria-hidden className="h-3 w-3 rounded bg-warning-soft ring-1 ring-warning/60" />連絡できる通塾日</span>
        <span className="flex items-center gap-1.5"><i aria-hidden className="h-3 w-3 rounded bg-slate-200" />{canTransfer ? '授業が終わった日（振替の登録のみ）' : '授業が終わった日（連絡できません）'}</span>
        <span className="flex items-center gap-1.5"><i aria-hidden className="h-3 w-3 rounded bg-success-soft ring-1 ring-success/40" />連絡済み</span>
        {declinedRequests.length > 0 && <span className="flex items-center gap-1.5"><i aria-hidden className="h-3 w-3 rounded bg-danger-soft ring-1 ring-danger/40" />見送り・取消（もう一度連絡できます）</span>}
        <span className="flex items-center gap-1.5"><i aria-hidden className="h-3 w-3 rounded bg-danger-soft" />休み・休講</span>
      </div>
    </section>
  );
}
