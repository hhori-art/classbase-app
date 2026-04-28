'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import CourseRegistrationCalendar from '@/app/components/CourseRegistrationCalendar';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
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

type Student = { id: string; student_name?: string; grade?: string; school?: string; day_of_week?: string };
type DetailItem = { id: string; title: string; meta: string; body?: string; status?: string };
type RequestMode = 'absence' | 'transfer';
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
};

const defaultVisibility = {
  homework: true,
  attendance: true,
  absence: true,
  transfer: true,
  recordings: true,
  aiMessages: true,
  announcements: true,
  calendar: true,
};

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
const normalizeText = (value: any) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[（）()【】\[\]第・,，、]/g, '');
const periodFromShift = (shift: any) => {
  if (shift.period !== undefined && shift.period !== null && shift.period !== '') return Number(shift.period);
  const raw = `${shift.note || ''} ${shift.time_slot || ''} ${shift.slot || ''} ${shift.target_detail_subject || ''}`.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return 1;
  if (raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return 2;
  return 0;
};
const optionMatchesShift = (option: any, shift: any) => {
  const gradeOk = !option.grade || !shift.target_grade || normalizeGrade(option.grade) === normalizeGrade(shift.target_grade);
  const subjectOk = !option.subject || !shift.target_subject || normalizeText(option.subject) === normalizeText(shift.target_subject);
  const course = normalizeText(option.course_name || option.title);
  const detail = normalizeText(shift.target_detail_subject || shift.target_subject);
  const unit = normalizeText(option.resolved_unit || option.unit || option.matched_units?.[0]);
  const shiftUnit = normalizeText(shift.unit);
  const courseOk = !course || !detail || course === detail || course.includes(detail) || detail.includes(course);
  const unitOk = !unit || !shiftUnit || unit === shiftUnit || unit.includes(shiftUnit) || shiftUnit.includes(unit);
  return gradeOk && subjectOk && (courseOk || unitOk);
};

export default function ParentDashboardPage() {
  const { user, profile } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [details, setDetails] = useState<Record<string, DetailItem[]>>({
    homework: [],
    attendance: [],
    absence: [],
    recordings: [],
    aiMessages: [],
    announcements: [],
  });
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState('');
  const [monthlySchedules, setMonthlySchedules] = useState<any[]>([]);
  const [requestMode, setRequestMode] = useState<RequestMode>('absence');
  const [requestText, setRequestText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [courseRegistrations, setCourseRegistrations] = useState<any[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [savingCourses, setSavingCourses] = useState(false);
  const [pendingCourseRequests, setPendingCourseRequests] = useState<any[]>([]);
  const [activeCourseRequest, setActiveCourseRequest] = useState<any>(null);
  const [transferOptions, setTransferOptions] = useState<TransferOption[]>([]);
  const [selectedTransferShiftId, setSelectedTransferShiftId] = useState('');
  const [loadingTransferOptions, setLoadingTransferOptions] = useState(false);

  const selectedStudent = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);

  useEffect(() => {
    const loadVisibility = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'portal_visibility'));
        if (snap.exists()) setVisibility(prev => ({ ...prev, ...(snap.data().parent || {}) }));
      } catch (e) {
        console.warn('Parent visibility settings read failed:', e);
      }
    };
    loadVisibility();
  }, []);

  useEffect(() => {
    const loadStudents = async () => {
      if (!profile) return;
      setLoading(true);
      try {
        const linkedIds = Array.isArray(profile.student_ids) ? profile.student_ids : [];
        const fetched: Student[] = [];

        if (linkedIds.length > 0) {
          for (const sid of linkedIds.slice(0, 10)) {
            const snap = await getDoc(doc(db, 'users', sid));
            if (snap.exists()) fetched.push({ id: snap.id, ...snap.data() });
          }
        } else {
          const snap = await getDocs(query(collection(db, 'users'), where('parent_uid', '==', profile.uid), limit(10)));
          snap.forEach(d => fetched.push({ id: d.id, ...d.data() }));
        }

        setStudents(fetched);
        setSelectedId(fetched[0]?.id || '');
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    loadStudents();
  }, [profile]);

  useEffect(() => {
    const loadMonthlySchedules = async () => {
      if (!selectedStudent || !visibility.calendar) return;
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth() + 1;
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const end = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
        const rangeSnap = await getDocs(query(
          collection(db, 'monthly_schedules'),
          where('start_date', '<=', end),
          orderBy('start_date', 'asc')
        )).catch(() => ({ docs: [] as any[] }));
        const legacySnap = await getDocs(query(
          collection(db, 'monthly_schedules'),
          where('target_date', '>=', start),
          where('target_date', '<=', end),
          orderBy('target_date', 'asc')
        )).catch(() => ({ docs: [] as any[] }));
        const merged = new Map<string, any>();
        [...rangeSnap.docs, ...legacySnap.docs].forEach((doc: any) => {
          const item = { id: doc.id, ...doc.data() };
          if (scheduleStart(item) <= end && scheduleEnd(item) >= start) merged.set(item.id, item);
        });
        const studentSchool = selectedStudent.school || (selectedStudent as any).school_id || '';
        setMonthlySchedules(Array.from(merged.values())
          .filter((item: any) => !item.archived)
          .filter((item: any) => !item.audience || ['all', 'student_parent', 'parent'].includes(item.audience))
          .filter((item: any) => !item.school_id || item.school_id === studentSchool)
          .filter((item: any) => !Array.isArray(item.grades) || item.grades.length === 0 || item.grades.includes(selectedStudent.grade))
        );
      } catch (e) {
        console.warn('Monthly schedules read failed:', e);
        setMonthlySchedules([]);
      }
    };
    loadMonthlySchedules();
  }, [currentMonth, selectedStudent, visibility.calendar]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedId) return;
      setDetailsLoading(true);
      try {
        const [submissions, attendance, absences, transferRequests, recordingViews, chatHistory, announcements] = await Promise.all([
          getDocs(query(collection(db, 'submissions'), where('student_id', '==', selectedId), limit(20))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'attendance'), where('user_id', '==', selectedId), limit(30))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'requests'), where('user_id', '==', selectedId), where('type', '==', 'absence'), limit(30))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'requests'), where('user_id', '==', selectedId), where('type', '==', 'transfer'), limit(30))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'recording_views'), where('user_id', '==', selectedId), limit(30))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'users', selectedId, 'chat_history'), orderBy('createdAt', 'desc'), limit(20))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'announcements'), orderBy('created_at', 'desc'), limit(10))).catch(() => ({ docs: [] })),
        ]);

        const absenceItems = [
          ...absences.docs.map((d: any) => {
            const data = d.data();
            return {
              id: d.id,
              title: data.absence_type === 'late' ? '遅刻連絡' : '欠席連絡',
              meta: `${data.target_date || '-'} / ${data.status || 'pending'}`,
              body: data.content || data.reason || '',
              status: data.status || 'pending',
            };
          }),
          ...transferRequests.docs.map((d: any) => {
            const data = d.data();
            return {
              id: d.id,
              title: '振替希望',
              meta: `${data.target_date || '-'} / ${data.status || 'pending'}`,
              body: data.content || data.reason || '',
              status: data.status || 'pending',
            };
          }),
        ];

        setDetails({
          homework: submissions.docs.map((d: any) => {
            const data = d.data();
            return { id: d.id, title: data.title || data.homework_title || '宿題提出', meta: toDateTimeLabel(data.submitted_at || data.created_at), body: data.comment || data.memo || '', status: data.status };
          }),
          attendance: attendance.docs.map((d: any) => {
            const data = d.data();
            return { id: d.id, title: data.target_date || data.date || '出席記録', meta: data.status || data.attendance_status || '記録あり', body: data.note || '' };
          }),
          absence: absenceItems,
          recordings: recordingViews.docs.map((d: any) => {
            const data = d.data();
            return { id: d.id, title: data.recording_title || data.title || '録画視聴', meta: `${toDateTimeLabel(data.updated_at || data.started_at || data.created_at)} / ${data.event_type || data.status || 'view'}`, body: data.watch_seconds ? `${Math.round(data.watch_seconds / 60)}分視聴` : '' };
          }),
          aiMessages: chatHistory.docs.map((d: any) => {
            const data = d.data();
            return { id: d.id, title: data.role === 'assistant' ? 'AIからの返信' : '生徒の質問', meta: toDateTimeLabel(data.createdAt || data.created_at), body: data.content || '' };
          }),
          announcements: announcements.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((data: any) => !data.target || ['all', 'parent'].includes(data.target))
            .map((data: any) => {
              return { id: data.id, title: data.title || 'お知らせ', meta: toDateLabel(data.created_at), body: data.content || data.body || '' };
            }),
        });
      } catch (e) {
        console.error(e);
      } finally {
        setDetailsLoading(false);
      }
    };

    loadDetails();
  }, [selectedId]);

  useEffect(() => {
    const loadCourseOptions = async () => {
      if (!user || !selectedStudent) return;
      try {
        const [optionSnap, registrationSnap, curriculumSnap, shiftSnap] = await Promise.all([
          getDocs(query(collection(db, 'course_registration_options'), limit(500))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, 'course_registrations'), where('parent_id', '==', user.uid), limit(50))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, 'annual_curriculum_schedules'), limit(1000))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, 'shift_assignments'), orderBy('target_date', 'asc'), limit(1000))).catch(() => ({ docs: [] as any[] })),
        ]);
        const selectedGrade = normalizeGrade(selectedStudent.grade);
        const rawOptions = optionSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((item: any) => item.is_active !== false)
          .filter((item: any) => !selectedGrade || !item.grade || normalizeGrade(item.grade) === selectedGrade)
          .sort((a: any, b: any) => `${a.year}_${a.term}_${a.subject}_${a.course_name}`.localeCompare(`${b.year}_${b.term}_${b.subject}_${b.course_name}`));
        const options = enrichCourseOptionsWithShifts(
          rawOptions,
          curriculumSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          shiftSnap.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((item: any) => !selectedGrade || normalizeGrade(item.target_grade) === selectedGrade)
        );
        const registrations = registrationSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((item: any) => item.student_id === selectedStudent.id);
        setCourseOptions(options);
        setCourseRegistrations(registrations);
        const latest = registrations.sort((a: any, b: any) => String(b.updated_at?.seconds || 0).localeCompare(String(a.updated_at?.seconds || 0)))[0];
        setSelectedCourseIds(Array.isArray(latest?.selected_course_ids) ? latest.selected_course_ids : []);
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
        const shiftSnap = await getDocs(query(collection(db, 'shift_assignments'), where('target_date', '==', selectedDate), limit(100))).catch(() => ({ docs: [] as any[] }));
        const rawShifts = shiftSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((shift: any) => shift.role_type !== 'sub')
          .filter((shift: any) => !String(shift.teacher_name || '').includes('サポート'))
          .filter((shift: any) => normalizeGrade(shift.target_grade) === normalizeGrade(selectedStudent.grade))
          .filter((shift: any) => shift.target_meeting_id || shift.zoom_url);

        const latestRegistration = [...courseRegistrations]
          .filter((item: any) => item.student_id === selectedStudent.id)
          .sort((a: any, b: any) => Number(b.updated_at?.seconds || b.created_at?.seconds || 0) - Number(a.updated_at?.seconds || a.created_at?.seconds || 0))[0];
        const registeredIds = new Set(Array.isArray(latestRegistration?.selected_course_ids) ? latestRegistration.selected_course_ids.map(String) : selectedCourseIds.map(String));
        const registeredOptions = courseOptions.filter((option: any) => registeredIds.has(option.id) || registeredIds.has(option.parent_course_option_id));
        const registeredShiftIds = new Set<string>();
        registeredOptions.forEach((option: any) => {
          if (Array.isArray(option.matched_shift_ids)) option.matched_shift_ids.forEach((id: any) => registeredShiftIds.add(String(id)));
        });

        const matched = rawShifts
          .filter((shift: any) => {
            if (registeredShiftIds.has(shift.id)) return true;
            if (registeredOptions.length === 0) return true;
            return registeredOptions.some((option: any) => optionMatchesShift(option, shift));
          })
          .map((shift: any) => {
            const courseName = shift.target_detail_subject || shift.target_subject || '講座';
            const unit = shift.unit || shift.curriculum_unit || '';
            const period = periodFromShift(shift);
            return {
              id: shift.id,
              title: `${period ? `${period}限 ` : ''}${shift.target_subject || ''} ${courseName}`,
              unit,
              subject: shift.target_subject || '',
              courseName,
              period,
              meetingId: shift.target_meeting_id || '',
              targetDate: shift.target_date || selectedDate,
              matchLabel: registeredOptions.length > 0 ? '受講登録に紐づく候補' : '同学年の実施講座',
            };
          })
          .sort((a: TransferOption, b: TransferOption) => `${a.period}_${a.subject}_${a.courseName}_${a.unit}`.localeCompare(`${b.period}_${b.subject}_${b.courseName}_${b.unit}`, 'ja'));

        setTransferOptions(matched);
      } catch (e) {
        console.warn('Transfer options read failed:', e);
        setTransferOptions([]);
      } finally {
        setLoadingTransferOptions(false);
      }
    };
    loadTransferOptions();
  }, [selectedStudent, selectedDate, requestMode, courseOptions, courseRegistrations, selectedCourseIds]);

  const submitCalendarRequest = async () => {
    if (!user || !selectedStudent || !selectedDate) return;
    const selectedTransfer = transferOptions.find(option => option.id === selectedTransferShiftId);
    if (requestMode === 'transfer' && !selectedTransfer) {
      alert('振替で参加したい授業を選択してください。');
      return;
    }
    setSubmitting(true);
    try {
      const isTransfer = requestMode === 'transfer';
      await addDoc(collection(db, 'requests'), {
        user_id: selectedStudent.id,
        student_id: selectedStudent.id,
        student_name: selectedStudent.student_name || '生徒',
        parent_id: user.uid,
        parent_name: profile?.parent_name || profile?.name || '保護者',
        type: isTransfer ? 'transfer' : 'absence',
        absence_type: isTransfer ? null : 'absent',
        target_date: selectedDate,
        content: isTransfer
          ? `【振替希望】${selectedTransfer ? `\n${selectedTransfer.title}${selectedTransfer.unit ? ` / ${selectedTransfer.unit}` : ''}` : ''}\n${requestText}`
          : `【欠席連絡】\n${requestText}`,
        reason: requestText,
        transfer_shift_id: selectedTransfer?.id || null,
        target_shift_id: selectedTransfer?.id || null,
        transfer_unit: selectedTransfer?.unit || null,
        transfer_subject: selectedTransfer?.subject || null,
        transfer_course_name: selectedTransfer?.courseName || null,
        transfer_period: selectedTransfer?.period || null,
        transfer_meeting_id: selectedTransfer?.meetingId || null,
        status: 'pending',
        created_at: serverTimestamp(),
      });
      setRequestText('');
      setSelectedTransferShiftId('');
      setSelectedDate('');
      alert(isTransfer ? '振替希望を送信しました。' : '欠席連絡を送信しました。');
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
      const res = await fetch('/api/parent/course-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          request_id: requestId,
          term,
          year,
          selected_course_ids: selectedCourseIds,
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
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;
  }

  if (students.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto mb-3 text-amber-500" />
        <p className="font-black text-gray-800">紐づく生徒がまだ登録されていません</p>
        <p className="mt-2 text-sm font-bold text-gray-400">校舎または管理者に保護者アカウントの紐づけをご依頼ください。</p>
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

      {visibility.calendar && (
        <ParentActionCalendar
          month={currentMonth}
          onChangeMonth={setCurrentMonth}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          canAbsence={visibility.absence}
          canTransfer={visibility.transfer}
          schedules={monthlySchedules}
        />
      )}

      <ParentCourseRequestModal
        request={activeCourseRequest}
        options={courseOptions}
        selectedCourseIds={selectedCourseIds}
        onToggleCourse={(id) => setSelectedCourseIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])}
        onSubmit={(term, year, requestId) => saveCourseRegistration(term, year, requestId)}
        onClose={() => setActiveCourseRequest(null)}
        saving={savingCourses}
      />

      {selectedDate && (visibility.absence || visibility.transfer) && (
        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black text-indigo-500">{selectedDate}</p>
              <h3 className="mt-1 text-lg font-black text-slate-900">カレンダーから申請</h3>
            </div>
            <button onClick={() => setSelectedDate('')} className="rounded-xl bg-slate-100 p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end">
            <div>
              <label className="mb-2 block text-xs font-black text-slate-500">種類</label>
              <div className="grid grid-cols-2 gap-2">
                {visibility.absence && <button type="button" onClick={() => setRequestMode('absence')} className={`rounded-2xl border-2 px-3 py-3 text-sm font-black ${requestMode === 'absence' ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>欠席</button>}
                {visibility.transfer && <button type="button" onClick={() => setRequestMode('transfer')} className={`rounded-2xl border-2 px-3 py-3 text-sm font-black ${requestMode === 'transfer' ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>振替</button>}
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
              <textarea value={requestText} onChange={e => setRequestText(e.target.value)} className="min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" placeholder={requestMode === 'transfer' ? '希望時間や補足を入力してください' : '欠席理由を入力してください'} />
            </div>
            <button onClick={submitCalendarRequest} disabled={submitting || (requestMode === 'absence' && !requestText.trim()) || (requestMode === 'transfer' && !selectedTransferShiftId)} className="rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
              {submitting ? '送信中...' : '送信'}
            </button>
          </div>
        </section>
      )}

      {detailsLoading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-indigo-500" /></div>}

      <section className="grid gap-4 lg:grid-cols-2">
        {sections.map(section => {
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
              {items.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-100 py-8 text-center text-sm font-bold text-slate-400">まだ表示できる情報がありません</div>
              ) : (
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
              )}
            </div>
          );
        })}
      </section>
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
  onToggleCourse,
  onSubmit,
  onClose,
  saving,
}: {
  request: any;
  options: any[];
  selectedCourseIds: string[];
  onToggleCourse: (id: string) => void;
  onSubmit: (term: string, year: number, requestId: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  if (!request) return null;
  const requestOptionIds = Array.isArray(request.course_option_ids) ? request.course_option_ids : [];
  const requestOptions = requestOptionIds.length > 0
    ? options.filter(option => requestOptionIds.includes(option.id) || requestOptionIds.includes(option.parent_course_option_id))
    : options;
  const first = requestOptions[0] || {};

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
          <CourseRegistrationCalendar
            options={requestOptions}
            selectedIds={selectedCourseIds}
            onToggle={onToggleCourse}
            emptyMessage="この登録依頼に紐づく講座が見つかりません。管理者画面でカリキュラムを選択し直してください。"
          />
        </div>
        <div className="shrink-0 border-t border-slate-100 bg-slate-50 p-5">
          <button
            onClick={() => onSubmit(first.term || request.term || 'term', Number(first.year || request.year || new Date().getFullYear()), request.id)}
            disabled={saving || requestOptions.length === 0 || selectedCourseIds.length === 0}
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
}: {
  month: Date;
  onChangeMonth: (value: Date) => void;
  selectedDate: string;
  onSelectDate: (value: string) => void;
  canAbsence: boolean;
  canTransfer: boolean;
  schedules: any[];
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
        {days.map(day => day.date ? (
          <button key={day.key} onClick={() => onSelectDate(day.date)} className={`min-h-24 rounded-2xl border p-2 text-left transition ${selectedDate === day.date ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-slate-50 hover:border-slate-200'}`}>
            <span className="text-sm font-black">{day.label}</span>
            <div className="mt-2 flex flex-col gap-1">
              {schedules.filter(item => scheduleCoversDate(item, day.date)).slice(0, 2).map(item => (
                <span key={item.id} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">{item.title}</span>
              ))}
              {canAbsence && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-black text-orange-600">欠席</span>}
              {canTransfer && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-600"><Repeat size={8} className="inline" /> 振替</span>}
            </div>
          </button>
        ) : <div key={day.key} className="min-h-20" />)}
      </div>
    </section>
  );
}
