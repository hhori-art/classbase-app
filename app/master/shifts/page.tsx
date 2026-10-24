'use client';

import { useState, useEffect } from 'react';
import { hasAdminAppPermission } from '@/lib/admin-app-permissions';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, orderBy, limit, getDoc } from 'firebase/firestore';
import { reportAuditLog } from '@/app/components/master/audit-log-client';
import { Trash2, Video, Save, Loader2, Link as LinkIcon, Users, MapPin, User, GripVertical, CheckCircle, HelpCircle, Clock, KeyRound, Zap, BarChart2, X, Settings, AlertTriangle, Bell, XCircle, ClipboardCheck, Search, ChevronDown, ChevronUp, CalendarClock, UserPlus, GitMerge } from 'lucide-react';
import { usePathname } from 'next/navigation';
import ShiftImportButton from '@/app/components/ShiftImportButton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { useAuth } from '@/app/context/AuthContext';
import { jstDateKey } from '@/lib/date-key';
import { selectDisplayShiftAssignments } from '@/lib/shift-assignment-display';
import { availabilityStatusForWeeklyDay, weekdayKeyForDate, weeklyDaySummary, type TeacherAvailabilityProfile } from '@/lib/teacher-weekly-availability';
import { isConfigurableAdminRole } from '@/lib/admin-app-permissions';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, ButtonLink, buttonClass, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, Spinner, useConfirm, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

// --- 型定義 ---
type ShiftAssignment = {
  id: string;
  user_id: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_place?: string | null;
  teacher_workplace?: string | null;
  target_meeting_id?: string | null;
  target_password?: string | null;
  target_signin_address?: string | null;
  unit: string | null;
  note: string;
  parent_id?: string;
  start_url?: string; 
  target_join_url?: string;
  target_recording_url?: string;
  school_id?: string | null;
  school?: string | null;
};

type Teacher = {
  id: string;
  student_name?: string;
  name?: string;
  lifetime_id?: string;
  role: string;
  survey_url?: string;
};

type TeacherAvailability = {
  id: string;
  teacher_id?: string;
  user_id?: string;
  teacher_name?: string;
  available_date: string;
  time_range?: string;
  workplace?: string;
  location?: string;
  note?: string;
  roles?: string[];
  status?: string;
  source?: 'date' | 'weekly';
};

const normalizeMeetingId = (value?: string | null) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[^\d]/g, '');

const buildMeetingJoinUrl = (meetingId?: string | null, passcode?: string | null) => {
  const cleanMeetingId = normalizeMeetingId(meetingId);
  if (!cleanMeetingId) return null;
  const url = new URL(`https://zoom.us/j/${cleanMeetingId}`);
  if (passcode) url.searchParams.set('pwd', passcode);
  return url.toString();
};

type ClassGroup = {
  id: string;
  main: ShiftAssignment | null;
  subs: ShiftAssignment[];
  subject: string | null;
  grade: string | null;
  unit: string | null;
  place: string | null;
  studio: string | null;
  url: string | null;
};

const SUBJECT_DETAILS = {
  '理科': ['物理', '化学', '生物', '地学'],
  '社会': ['地理', '歴史', '公民']
};

const WORK_LOCATIONS = ['元町', '本山', '西神南', '姫路', '加古川', '明石'];

const teacherIdOfAvailability = (availability: TeacherAvailability) => availability.teacher_id || availability.user_id || '';
const teacherNameOf = (teacher?: Teacher | null) => teacher?.student_name || teacher?.name || '名称未設定';

export default function ShiftManagementPage() {
  const pathname = usePathname();
  const teacherSurface = pathname.startsWith('/teacher/');
  const { user, profile } = useAuth();
  // 授業の合併は、マスターと理社講座の管理者だけが使える（専任の承認者は使わない）。
  const canMergeShifts = Boolean(profile && hasAdminAppPermission(profile.role, profile, 'science_social'));
  const toast = useToast();
  const confirm = useConfirm();
  const schoolAdminReadOnly = isConfigurableAdminRole(profile?.role) && profile?.role !== 'master';
  const [date, setDate] = useState(jstDateKey());
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const [availabilities, setAvailabilities] = useState<TeacherAvailability[]>([]);
  const [availabilityProfiles, setAvailabilityProfiles] = useState<TeacherAvailabilityProfile[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [urlMaster, setUrlMaster] = useState<{[key: string]: string}>({});
  const [unassignedNotice, setUnassignedNotice] = useState<{ count: number; names: string[]; notified: number } | null>(null);

  const [editingShift, setEditingShift] = useState<ShiftAssignment | null>(null);
  const [creatingZoom, setCreatingZoom] = useState(false); 
  const [updatingPasscode, setUpdatingPasscode] = useState(false);

  // アンケート関連
  const [surveyQuestions, setSurveyQuestions] = useState<any[]>([]);
  const [surveyResults, setSurveyResults] = useState<any[]>([]);
  const [isSurveyModalOpen, setIsSurveyModalOpen] = useState(false);
  const [selectedTeacherForResults, setSelectedTeacherForResults] = useState<{id: string, name: string} | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyError, setSurveyError] = useState(false);

  // ドラッグ＆ドロップ用
  const [draggedTeacher, setDraggedTeacher] = useState<Teacher | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<'main' | 'sub' | 'general' | null>(null);

  const [form, setForm] = useState({
    userId: '',
    role: 'main',
    grade: '中1',
    subject: '理科',
    detail_subject: '物理',
    studio: '',
    unit: '',
    time_slot: '1限',
    targetClassId: ''
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentTarget, setAssignmentTarget] = useState<{
    role: 'main' | 'sub' | 'general';
    targetClass?: ShiftAssignment;
    period: string;
  } | null>(null);

  // データ取得
  const fetchData = async () => {
    try {
      setLoadError(false);
      const tQ = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const avQ = query(collection(db, 'teacher_availability'), where('available_date', '==', date));
      const asQ = query(collection(db, 'shift_assignments'), where('target_date', '==', date));
      const [tSnap, avSnap, profileSnap, asSnap, urlSnap, tmplSnap] = await Promise.all([
        getDocs(tQ),
        getDocs(avQ),
        getDocs(collection(db, 'teacher_availability_profiles')),
        getDocs(asQ),
        getDocs(collection(db, 'subject_urls')),
        getDoc(doc(db, 'survey_templates', 'default')),
      ]);
      setAllTeachers(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as Teacher)));

      const availabilityData = avSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherAvailability));
      availabilityData.sort((a, b) => {
        const aName = a.teacher_name || '';
        const bName = b.teacher_name || '';
        return aName.localeCompare(bName, 'ja');
      });
      setAvailabilities(availabilityData);

      setAvailabilityProfiles(profileSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherAvailabilityProfile)));

      setAssignments(selectDisplayShiftAssignments(
        asSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)),
      ));

      const urls: {[key: string]: string} = {};
      urlSnap.forEach(doc => { urls[doc.id] = doc.data().url; });
      setUrlMaster(urls);

      if (tmplSnap.exists()) {
        setSurveyQuestions(tmplSnap.data().questions || []);
      }

    } catch (e) { console.error(e); setLoadError(true); } finally { setLoading(false); }
  };

  const reloadData = () => {
    setLoading(true);
    fetchData();
  };

  const notifyUnassignedTeachers = async () => {
    try {
      const token = await user?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/shifts/unassigned-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_date: date }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setUnassignedNotice({ count: data.unassigned_count || 0, names: data.names || [], notified: data.notified_count || 0 });
      }
    } catch (error) {
      console.error('unassigned notification error:', error);
    }
  };

  const relinkShiftTeachers = async () => {
    if (!(await confirm({
      title: `${date} の講師配置を再照合しますか？`,
      message: 'この日の講師配置を、講師名から再照合して紐付け直します。',
      confirmLabel: '再照合する',
      tone: 'danger',
    }))) return;
    setRelinking(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/admin/shifts/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_date: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'relink failed');
      toast.success(`再照合しました。更新 ${data.updated}件／未解決 ${data.unresolved}件`);
      await fetchData();
    } catch (e: any) {
      toast.error(`紐付けを再照合できませんでした。${userErrorMessage(e, '')}`);
    } finally {
      setRelinking(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const d = new Date(date);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    setDayOfWeek(days[d.getDay()]);
    fetchData();
  }, [date]);

  useEffect(() => {
    if (user && !loading && !schoolAdminReadOnly) notifyUnassignedTeachers();
  }, [user, loading, date, schoolAdminReadOnly]);

  useEffect(() => {
    if (form.subject === '理科' && !SUBJECT_DETAILS['理科'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '物理' }));
    if (form.subject === '社会' && !SUBJECT_DETAILS['社会'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '地理' }));
  }, [form.subject]);

  // 配置処理
  const executeAssign = async (
    teacherId: string, 
    role: 'main' | 'sub' | 'general', 
    targetClass?: ShiftAssignment,
    periodStr: string = '1限'
  ) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;
    const teacherName = teacherNameOf(teacher);
    const availability = availabilitiesByTeacher.get(teacherId)?.find(a => a.status !== 'impossible');
    const requestedWorkplace = availability?.workplace || availability?.location || '';
    
    try {
      const shiftData: any = {
        user_id: teacherId,
        teacher_name: teacherName,
        target_date: date,
        role_type: role,
        note: `【${periodStr}】`,
        teacher_availability_id: availability?.source === 'weekly' ? null : availability?.id || null,
        availability_source: availability?.source || 'date',
        teacher_workplace: requestedWorkplace || null,
        requested_time_range: availability?.time_range || null,
        created_at: new Date().toISOString()
      };

      if (role === 'main') {
        if (targetClass) {
           await updateDoc(doc(db, 'shift_assignments', targetClass.id), {
             user_id: teacherId,
             teacher_name: teacherName
           });
        } else {
           shiftData.target_grade = form.grade;
           shiftData.target_subject = form.subject;
           shiftData.target_detail_subject = form.detail_subject;
           shiftData.target_place = form.studio || requestedWorkplace;
           shiftData.unit = form.unit;
           await addDoc(collection(db, 'shift_assignments'), shiftData);
        }
      } else if (role === 'sub') {
        if (!targetClass) return;
        shiftData.target_grade = targetClass.target_grade;
        shiftData.target_subject = targetClass.target_subject;
        shiftData.target_detail_subject = targetClass.target_detail_subject;
        shiftData.target_place = targetClass.target_place || requestedWorkplace;
        shiftData.parent_id = targetClass.id;
        await addDoc(collection(db, 'shift_assignments'), shiftData);
      } else {
        await addDoc(collection(db, 'shift_assignments'), shiftData);
      }
      
      fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(`配置できませんでした。${userErrorMessage(e, '')}`);
    }
  };

  const handleManualAssign = () => {
    if (!form.userId) return toast.error('講師を選択してください。');
    let targetClass: ShiftAssignment | undefined = undefined;
    if (form.role === 'sub' && form.targetClassId) {
      targetClass = assignments.find(a => a.id === form.targetClassId);
    }
    executeAssign(form.userId, form.role as any, targetClass, form.time_slot);
  };

  const handleDragStart = (e: React.DragEvent, teacher: Teacher) => {
    setDraggedTeacher(teacher);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, cardId: string, zone: 'main' | 'sub' | 'general') => {
    e.preventDefault();
    setDragOverCardId(cardId);
    setDragOverZone(zone);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setDragOverCardId(null);
    setDragOverZone(null);
  };

  const handleDrop = async (e: React.DragEvent, targetClass: ShiftAssignment | null, zone: 'main' | 'sub' | 'general', periodStr?: string) => {
    e.preventDefault();
    setDragOverCardId(null);
    setDragOverZone(null);

    if (!draggedTeacher) return;

    const actualPeriodStr = periodStr || (targetClass?.note.includes('1限') ? '1限' : '2限');

    if (zone === 'main' && targetClass) {
      if (!(await confirm({ title: `「${targetClass.target_subject}」の担当講師を「${draggedTeacher.student_name || draggedTeacher.name}」先生に変更しますか？`, confirmLabel: '変更する' }))) return;
      await executeAssign(draggedTeacher.id, 'main', targetClass, actualPeriodStr);
    } else if (zone === 'sub' && targetClass) {
      if (!(await confirm({ title: `「${targetClass.target_subject}」に「${draggedTeacher.student_name || draggedTeacher.name}」先生をサポートとして追加しますか？`, confirmLabel: '追加する' }))) return;
      await executeAssign(draggedTeacher.id, 'sub', targetClass, actualPeriodStr);
    } else if (zone === 'general') {
      if (!(await confirm({ title: `「${actualPeriodStr}」の全体サポートに「${draggedTeacher.student_name || draggedTeacher.name}」先生を追加しますか？`, confirmLabel: '追加する' }))) return;
      await executeAssign(draggedTeacher.id, 'general', undefined, actualPeriodStr);
    }
    setDraggedTeacher(null);
  };

  const handleDelete = async (id: string) => {
    const target = assignments.find(a => a.id === id);
    const targetName = target?.teacher_name ? `「${target.teacher_name}」先生の配置` : 'この配置';
    if (!(await confirm({
      title: `${targetName}を解除しますか？`,
      message: target ? [target.note, target.target_grade, target.target_subject, target.target_detail_subject].filter(Boolean).join(' ') : undefined,
      confirmLabel: '解除する',
      tone: 'danger',
    }))) return;
    try {
      await deleteDoc(doc(db, 'shift_assignments', id));
      setAssignments(prev => prev.filter(a => a.id !== id));
      void reportAuditLog({
        action: 'shift_unassign',
        target_type: 'shift_assignment',
        target_id: id,
        target_label: [target?.teacher_name, target?.target_date, target?.target_subject].filter(Boolean).join(' '),
        details: { teacher_id: target?.user_id || null, target_date: target?.target_date || null, role_type: target?.role_type || null },
      });
    } catch (e: any) {
      console.error(e);
      toast.error(`配置を解除できませんでした。${userErrorMessage(e, '')}`);
    }
  };

  const handleUpdate = async () => {
    if (!editingShift) return;
    try {
      await updateDoc(doc(db, 'shift_assignments', editingShift.id), {
        target_place: editingShift.target_place,
        teacher_workplace: editingShift.target_place || null,
        unit: editingShift.unit,
        target_meeting_id: editingShift.target_meeting_id,
        target_signin_address: editingShift.target_signin_address,
        start_url: editingShift.start_url || null,
        target_join_url: editingShift.target_join_url || null,
        target_recording_url: editingShift.target_recording_url || null 
      });
      setEditingShift(null);
      fetchData();
    } catch (e) {
      console.error(e);
      toast.error('保存できませんでした。通信状態を確認して、もう一度お試しください。');
    }
  };

  const handleUpdateZoomPasscode = async () => {
    if (!editingShift) return;
    const meetingId = normalizeMeetingId(editingShift.target_meeting_id);
    const passcode = String(editingShift.target_password || '').trim();
    if (!meetingId) return toast.error('先にZoom IDを入力してください。');
    if (!passcode) return toast.error('Zoomパスコードを入力してください。');
    if (!/^[A-Za-z0-9@_-]{1,10}$/.test(passcode)) {
      return toast.error('Zoomパスコードは半角英数字と @ _ - を使い、10文字以内で入力してください。');
    }

    setUpdatingPasscode(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const response = await fetch(`/api/admin/shifts/${editingShift.id}/passcode`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ passcode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Zoomパスコードを更新できませんでした。');

      setEditingShift(previous => previous ? { ...previous, target_password: result.passcode || passcode } : previous);
      setAssignments(previous => previous.map(shift => (
        shift.id === editingShift.id ? { ...shift, target_password: result.passcode || passcode } : shift
      )));
      if (result.join_url_ready) {
        toast.success('Zoomのパスコードを更新し、暗号化済みの生徒用参加リンクも取得しました。');
      } else {
        toast.error(`Zoomのパスコードは更新しましたが、生徒用参加リンクを取得できませんでした。${result.warning ? ` ${result.warning}` : ''}`);
      }
    } catch (error: any) {
      toast.error(`パスコードを更新できませんでした。${error?.message || '通信エラー'}`);
    } finally {
      setUpdatingPasscode(false);
    }
  };

  const handleManualZoomCreate = async () => {
    if (!editingShift) return;
    
    const isFirstPeriod = editingShift.note?.includes('1限');
    const startTimeISO = isFirstPeriod 
      ? `${editingShift.target_date}T19:20:00` 
      : `${editingShift.target_date}T20:35:00`;

    setCreatingZoom(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/create-zoom-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          shift_id: editingShift.id,
          topic: `${editingShift.target_grade}${editingShift.target_subject} (${editingShift.teacher_name}先生)`,
          startTime: startTimeISO,
          duration: 75
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Zoomミーティングを発行できませんでした。');

      if (data.success) {
        setEditingShift({
          ...editingShift,
          target_meeting_id: String(data.meeting_id),
          target_password: data.passcode,
          start_url: data.start_url,
          target_join_url: data.join_url,
        });
        setAssignments(previous => previous.map(shift => shift.id === editingShift.id ? {
          ...shift,
          target_meeting_id: String(data.meeting_id),
          target_password: data.passcode,
          start_url: data.start_url,
          target_join_url: data.join_url,
        } : shift));
        toast.success('Zoomミーティングを発行し、講師配置へ保存しました。');
      } else {
        toast.error(`Zoomミーティングを発行できませんでした。${data.error || ''}`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Zoomミーティングを発行できませんでした。${userErrorMessage(e, '通信エラー')}`);
    } finally {
      setCreatingZoom(false);
    }
  };

  const handleShowSurveyResults = async (e: React.MouseEvent, teacherId: string, teacherName: string) => {
    e.stopPropagation();
    if (!teacherId) return;
    setSelectedTeacherForResults({ id: teacherId, name: teacherName });
    setSurveyLoading(true);
    setSurveyError(false);
    setIsSurveyModalOpen(true);
    try {
      const q = query(
        collection(db, 'survey_responses'),
        where('teacher_id', '==', teacherId),
        orderBy('created_at', 'desc'),
        limit(100)
      );
      const snap = await getDocs(q);
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSurveyResults(results);
    } catch (err) {
      console.error(err);
      setSurveyResults([]);
      setSurveyError(true);
    } finally {
      setSurveyLoading(false);
    }
  };

  const calculateRatingStats = (questionId: number) => {
    const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    surveyResults.forEach((res: any) => {
      const val = res.answers?.[questionId];
      if (typeof val === 'number' && val >= 1 && val <= 5) {
        const rating = val as 1 | 2 | 3 | 4 | 5;
        counts[rating]++;
        sum += rating;
        total++;
      }
    });
    const average = total > 0 ? (sum / total).toFixed(1) : '0.0';
    const data = [
      { name: '5', count: counts[5], fill: '#4ade80' },
      { name: '4', count: counts[4], fill: '#a3e635' },
      { name: '3', count: counts[3], fill: '#facc15' },
      { name: '2', count: counts[2], fill: '#fb923c' },
      { name: '1', count: counts[1], fill: '#f87171' },
    ];
    return { average, total, data };
  };

  const getTextAnswers = (questionId: number) => {
    return surveyResults
      .filter((res: any) => res.answers?.[questionId])
      .map((res: any) => ({
        id: res.id,
        text: res.answers[questionId],
        date: res.created_at?.seconds ? formatDate(new Date(res.created_at.seconds * 1000), { withYear: true }) : '',
        student: res.student_name,
        subject: res.subject
      }));
  };

  const getAllClassesForSubject = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => {
      const isTime = (a.note && a.note.includes(`【${time}】`));
      const isSubject = a.target_subject === subject;
      return isTime && isSubject;
    });

    if (slotAssignments.length === 0) return [];

    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');

    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub =>
        sub.parent_id === main.id ||
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );
      
      let joinUrl = buildMeetingJoinUrl(main.target_meeting_id, main.target_password);
      if (!joinUrl && main.target_detail_subject && dayOfWeek) {
         joinUrl = urlMaster[`${main.target_detail_subject}_${dayOfWeek}`];
      }

      return {
        id: main.id,
        main: main,
        subs: relatedSubs,
        subject: main.target_subject,
        grade: main.target_grade,
        unit: main.unit,
        place: main.target_detail_subject, 
        studio: main.target_place || null, 
        url: joinUrl
      };
    });

    classes.sort((a, b) => {
      if (a.grade !== b.grade) return (a.grade || '').localeCompare(b.grade || '');
      return (a.place || '').localeCompare(b.place || '');
    });

    return classes;
  };

  const getGeneralSupport = (time: string) => {
    return assignments.filter(a => a.role_type === 'general' && a.note.includes(`【${time}】`));
  };

  const weekdayKey = weekdayKeyForDate(date);
  const explicitTeacherIds = new Set(availabilities.map(teacherIdOfAvailability).filter(Boolean));
  const effectiveAvailabilities = [...availabilities];
  availabilityProfiles.forEach(profile => {
    const teacherId = profile.teacher_id || profile.user_id || profile.id;
    const weeklyDay = profile.weekdays?.[weekdayKey];
    if (!teacherId || !weeklyDay || explicitTeacherIds.has(teacherId)) return;
    effectiveAvailabilities.push({
      id: `weekly-${teacherId}-${weekdayKey}`,
      teacher_id: teacherId,
      user_id: teacherId,
      teacher_name: profile.teacher_name,
      available_date: date,
      time_range: weeklyDaySummary(weeklyDay),
      workplace: weeklyDay.workplace,
      location: weeklyDay.workplace,
      roles: weeklyDay.roles,
      status: availabilityStatusForWeeklyDay(weeklyDay),
      note: weeklyDay.note || weeklyDaySummary(weeklyDay),
      source: 'weekly',
    });
  });

  const availabilitiesByTeacher = new Map<string, TeacherAvailability[]>();
  effectiveAvailabilities.forEach(availability => {
    const teacherId = teacherIdOfAvailability(availability);
    if (!teacherId) return;
    const current = availabilitiesByTeacher.get(teacherId) || [];
    current.push(availability);
    availabilitiesByTeacher.set(teacherId, current);
  });

  const assignedTeacherIds = new Set(assignments.map(a => a.user_id).filter(Boolean));
  const submittedTeachers = allTeachers
    .filter(t => (availabilitiesByTeacher.get(t.id) || []).length > 0)
    .sort((a, b) => teacherNameOf(a).localeCompare(teacherNameOf(b), 'ja'));
  const workableTeachers = submittedTeachers.filter(t => (availabilitiesByTeacher.get(t.id) || []).some(a => a.status !== 'impossible'));
  const unavailableTeachers = submittedTeachers.filter(t => (availabilitiesByTeacher.get(t.id) || []).every(a => a.status === 'impossible'));
  const notSubmittedTeachers = allTeachers.filter(t => !(availabilitiesByTeacher.get(t.id) || []).length);
  const unassignedSubmittedTeachers = workableTeachers.filter(t => !assignedTeacherIds.has(t.id));

  // 講師リストのグループ分け
  const groupedTeachers = {
    available: [] as Teacher[],
    maybe: [] as Teacher[],
    unavailable: [] as Teacher[],
    unsubmitted: [] as Teacher[],
  };

  allTeachers.forEach(t => {
    const teacherAvailabilities = availabilitiesByTeacher.get(t.id) || [];
    const avail = teacherAvailabilities.find(a => a.status !== 'impossible');

    if (teacherAvailabilities.length === 0) {
      groupedTeachers.unsubmitted.push(t);
    } else if (!avail) {
      groupedTeachers.unavailable.push(t);
    } else {
      // それ以外（possible, またはステータス不明でもレコードがあれば提出済みとみなす）
      if (avail.status === 'maybe' || avail.note?.includes('△')) {
        groupedTeachers.maybe.push(t);
      } else {
        groupedTeachers.available.push(t);
      }
    }
  });

  const teacherMatches = (teacher: Teacher, search: string) => {
    const normalized = search.trim().toLocaleLowerCase('ja');
    if (!normalized) return true;
    const availabilityText = (availabilitiesByTeacher.get(teacher.id) || [])
      .map(item => [item.workplace, item.location, item.time_range, item.note, item.roles?.join(' ')].filter(Boolean).join(' '))
      .join(' ');
    return [teacherNameOf(teacher), teacher.lifetime_id, availabilityText]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ja')
      .includes(normalized);
  };

  const renderTeacherList = (list: Teacher[], type: 'available' | 'maybe' | 'unavailable' | 'unsubmitted') => {
    const filteredList = list.filter(teacher => teacherMatches(teacher, teacherSearch));
    if (filteredList.length === 0) return <div className="text-xs text-slate-400 p-2">該当なし</div>;
    
    return filteredList.map(t => {
      const assignedCount = assignments.filter(a => a.user_id === t.id).length;
      const teacherAvailabilities = availabilitiesByTeacher.get(t.id) || [];
      const avail = teacherAvailabilities.find(a => a.status !== 'impossible') || teacherAvailabilities[0]; 

      // 不可で提出されている場合
      const workplace = avail?.workplace || avail?.location;
      const roles = Array.isArray(avail?.roles) ? avail?.roles.join(' / ') : '';

      return (
        <div 
          key={t.id}
          draggable 
          onDragStart={(e) => handleDragStart(e, t)}
          onClick={() => setForm({ ...form, userId: t.id })}
          className={`p-3 rounded-btn border mb-2 cursor-grab active:cursor-grabbing transition-all text-sm group relative flex flex-col shadow-sm
            ${form.userId === t.id ? 'ring-2 ring-accent/20 bg-accent-soft border-accent' : 'bg-white hover:bg-slate-50 border-slate-200'}
            ${assignedCount > 0 ? 'opacity-70 bg-slate-50' : ''}
          `}
        >
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-slate-300" />
              <div>
                <span className="font-bold text-slate-700 block">{teacherNameOf(t)}</span>
              </div>
            </div>
            {type === 'available' && <CheckCircle size={16} className="text-emerald-500" />}
            {type === 'maybe' && <HelpCircle size={16} className="text-amber-500" />}
            {type === 'unavailable' && <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-600">提出済・勤務不可</span>}
            {type === 'unsubmitted' && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">未提出</span>}
          </div>
          
          <div className="pl-6 mt-1.5 flex flex-wrap gap-2 items-center w-full">
             {avail && type !== 'unsubmitted' && (
               <div className="text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded border border-accent/20 w-full truncate">
                 <span className="text-accent/70 mr-1 text-xs uppercase">{avail.source === 'weekly' ? '基本設定:' : '個別提出:'}</span>
                 {[workplace, avail.time_range, roles || avail.note].filter(Boolean).join(' / ')}
               </div>
             )}
             {assignedCount > 0 && (
               <span className="text-xs text-white bg-emerald-500 px-1.5 py-0.5 rounded-full">配置済: {assignedCount}</span>
             )}
          </div>
        </div>
      );
    });
  };

  if (schoolAdminReadOnly && !teacherSurface) {
    const schools = new Set([
      ...(Array.isArray(profile?.school_ids) ? profile.school_ids : []),
      profile?.school_id,
      profile?.school,
    ].map(value => String(value || '').trim()).filter(Boolean));
    const scopedAssignments = assignments.filter(item => {
      const assignedSchool = String(item.school_id || item.school || '').trim();
      return !assignedSchool || schools.size === 0 || schools.has(assignedSchool);
    });
    return (
      <div className="text-slate-800">
        <div className="space-y-5">
          <AdminPageHeader
            title="シフト配置・提出確認（閲覧のみ）"
            description="配置の変更はマスター管理者へ依頼してください。"
            actions={<label className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-white px-4 text-slate-700"><CalendarClock size={18} aria-hidden /><span className="sr-only">表示する日付</span><input type="date" value={date} onChange={event => setDate(event.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none" /></label>}
          />
          {loading ? <ListSkeleton rows={4} /> : loadError ? <ErrorState onRetry={reloadData} /> : (
            <section className="rounded-card border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">{date}（{dayOfWeek}）の配置</h2><p className="mt-1 text-xs font-bold text-slate-400">講師・担当・教室を一覧で確認できます。</p></div><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{scopedAssignments.length}件</span></div>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {scopedAssignments.map(item => <article key={item.id} className="rounded-card border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{item.teacher_name || '講師未設定'}</p><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-accent">{item.note?.match(/[12]限/)?.[0] || ({ main: '主担当', sub: 'サポート', general: '全体サポート' } as Record<string, string>)[String(item.role_type || '')] || item.role_type}</span></div><p className="mt-3 text-sm font-bold text-slate-700">{[item.target_grade, item.target_subject, item.target_detail_subject].filter(Boolean).join('・') || '全体サポート'}</p><p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-500"><MapPin size={13} />{item.target_place || item.teacher_workplace || '教室未設定'}</p>{item.unit ? <p className="mt-2 text-xs font-medium text-slate-500">単元：{item.unit}</p> : null}</article>)}
                {scopedAssignments.length === 0 ? <EmptyState className="col-span-full" title="この日の配置はありません" description="別の日付を選ぶと、その日の配置を確認できます。" /> : null}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-40 font-sans text-slate-800">
      <div>
        <AdminPageHeader
          title={teacherSurface ? 'シフト配置・提出確認' : undefined}
          backHref={teacherSurface ? '/teacher/attendance-approvals' : undefined}
          actions={<>
            {/* 同じ内容の授業を1つの Zoom に集約する（授業の合併）。 */}
            {!teacherSurface && canMergeShifts && <ButtonLink href={`/master/shifts/merge`} variant="secondary" icon={<GitMerge size={16} aria-hidden />}>授業の合併</ButtonLink>}
            <Button
              variant="secondary"
              onClick={() => setToolsOpen(previous => !previous)}
              aria-expanded={toolsOpen}
              icon={<Settings size={16} aria-hidden />}
            >
              データ取込・設定 {toolsOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
            </Button>
            <div className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-white p-1.5">
              <input type="date" aria-label="表示する日付" className="font-bold bg-transparent outline-none text-slate-700 cursor-pointer text-sm px-2" value={date} onChange={e => setDate(e.target.value)} />
              <span className="text-xs font-bold bg-accent-soft text-accent px-3 py-1.5 rounded-btn">{dayOfWeek}曜日</span>
            </div>
          </>}
        />

        {toolsOpen && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mr-auto">
              <p className="text-sm font-bold text-slate-700">データ取込・保守設定</p>
              <p className="mt-0.5 text-xs text-slate-500">通常の配置作業では閉じたままで問題ありません。</p>
            </div>
            <ShiftImportButton onSuccess={fetchData} />
            <Button
              variant="secondary"
              onClick={relinkShiftTeachers}
              loading={relinking}
              icon={<Settings size={16} aria-hidden />}
            >
              紐付け再照合
            </Button>
            {!teacherSurface && <ButtonLink href="/master/settings" variant="secondary" icon={<LinkIcon size={16} aria-hidden />}>
              URL設定
            </ButtonLink>}
          </div>
        )}

        {loadError && <ErrorState className="mb-4" title="シフトを読み込めませんでした" onRetry={reloadData} />}

        {unassignedSubmittedTeachers.length > 0 && (
          <div className="mb-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm font-bold">シフト提出済みで、まだ配置されていない先生がいます</p>
                  <p className="mt-1 text-xs font-bold text-amber-800">
                    {unassignedSubmittedTeachers.map(teacherNameOf).slice(0, 8).join('、')}
                    {unassignedSubmittedTeachers.length > 8 ? ` ほか${unassignedSubmittedTeachers.length - 8}名` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-xs font-bold text-amber-800">
                <Bell size={14} />
                管理者通知 {unassignedNotice?.notified ?? 0}件
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 rounded-card border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <ClipboardCheck size={16} className="text-accent" /> 本日の提出・勤務可能状況
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              全講師 {allTeachers.length}名
            </span>
          </div>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100"><p className="text-xs font-bold text-emerald-600">勤務可能</p><p className="mt-1 text-2xl font-black text-emerald-800">{workableTeachers.length}<span className="ml-1 text-xs">名</span></p></div>
            <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-100"><p className="text-xs font-bold text-amber-600">勤務可能・未配置</p><p className="mt-1 text-2xl font-black text-amber-800">{unassignedSubmittedTeachers.length}<span className="ml-1 text-xs">名</span></p></div>
            <div className="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-100"><p className="text-xs font-bold text-rose-600">提出済・勤務不可</p><p className="mt-1 text-2xl font-black text-rose-800">{unavailableTeachers.length}<span className="ml-1 text-xs">名</span></p></div>
            <div className="rounded-xl bg-slate-100 p-3"><p className="text-xs font-bold text-slate-500">未提出</p><p className="mt-1 text-2xl font-black text-slate-700">{notSubmittedTeachers.length}<span className="ml-1 text-xs">名</span></p></div>
          </div>
          {submittedTeachers.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {submittedTeachers.map(teacher => {
                const teacherAvailabilities = availabilitiesByTeacher.get(teacher.id) || [];
                const assignedCount = assignments.filter(a => a.user_id === teacher.id).length;
                const canWork = teacherAvailabilities.some(availability => availability.status !== 'impossible');
                return (
                  <div key={teacher.id} className={`rounded-xl border p-3 ${!canWork ? 'border-rose-100 bg-rose-50/60' : assignedCount > 0 ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/70'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800">{teacherNameOf(teacher)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${!canWork ? 'bg-rose-600 text-white' : assignedCount > 0 ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                        {!canWork ? '勤務不可' : assignedCount > 0 ? `配置済 ${assignedCount}` : '勤務可能・未配置'}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {teacherAvailabilities.map(availability => (
                        <div key={availability.id} className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                          <span className={`rounded px-2 py-1 ${availability.source === 'weekly' ? 'bg-accent-soft text-accent' : 'bg-sky-100 text-sky-700'}`}>{availability.source === 'weekly' ? '基本設定' : '個別提出'}</span>
                          <span className="flex items-center gap-1 rounded bg-white px-2 py-1"><MapPin size={11} className="text-slate-400" />{availability.workplace || availability.location || '勤務地未設定'}</span>
                          <span className="flex items-center gap-1 rounded bg-white px-2 py-1"><Clock size={11} className="text-slate-400" />{availability.time_range || '時間未設定'}</span>
                          <span className="rounded bg-white px-2 py-1">{Array.isArray(availability.roles) && availability.roles.length ? availability.roles.join(' / ') : availability.note || '希望未設定'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="この日付のシフト提出はまだありません" description="講師がシフトを提出すると、ここに勤務可能状況が出ます。" />
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar pr-2">
            <div className="bg-white p-4 rounded-card shadow-sm border border-accent/20 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-700 text-xs flex gap-2 items-center">
                  <Save size={16} className="text-accent"/> 新規クラス作成
                </h3>
              </div>
              <div className="space-y-3">
                <div className={`p-2 rounded-btn text-center font-bold text-xs border ${form.userId ? 'bg-accent-soft border-accent/40 text-accent' : 'bg-slate-50 text-slate-400 border-dashed'}`}>
                  {form.userId ? teacherNameOf(allTeachers.find(t => t.id === form.userId)) : "講師を選択してください"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="時限" className="w-full min-h-10 p-2 border border-line rounded-input text-xs" value={form.time_slot} onChange={e => setForm({...form, time_slot: e.target.value})}>
                    <option>1限</option><option>2限</option>
                  </select>
                  <select aria-label="役割" className="w-full min-h-10 p-2 border border-line rounded-input text-xs" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                    <option value="main">メイン</option>
                    <option value="general">全体</option>
                  </select>
                </div>
                {form.role === 'main' && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <select className="min-h-10 border border-line rounded-input p-1" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}><option>中1</option><option>中2</option><option>中3</option></select>
                    <select className="min-h-10 border border-line rounded-input p-1" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}><option>理科</option><option>社会</option></select>
                     <input className="min-h-10 border border-line rounded-input p-1 col-span-2" placeholder="詳細科目" value={form.detail_subject} onChange={e => setForm({...form, detail_subject: e.target.value})}/>
                  </div>
                )}
                <Button size="sm" fullWidth onClick={handleManualAssign}>配置</Button>
              </div>
            </div>

            <div className="sticky top-0 z-10 rounded-card border border-slate-200 bg-white p-3 shadow-sm">
              <label className="mb-2 block text-xs font-bold text-slate-700">講師・勤務条件を検索</label>
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <Search size={16} className="text-slate-400" />
                <input
                  value={teacherSearch}
                  onChange={event => setTeacherSearch(event.target.value)}
                  placeholder="氏名、ID、校舎、時間で検索"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
                />
                {teacherSearch && <IconButton size="sm" label="検索をクリア" onClick={() => setTeacherSearch('')}><X size={15} aria-hidden /></IconButton>}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <CheckCircle size={14}/> 出勤可能 (シフト提出済)
                </h3>
                <div className="space-y-1">
                  {renderTeacherList(groupedTeachers.available, 'available')}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-amber-700 bg-amber-50 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <HelpCircle size={14}/> 調整可能
                </h3>
                <div className="space-y-1">
                  {renderTeacherList(groupedTeachers.maybe, 'maybe')}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <XCircle size={14}/> 提出済・勤務不可
                </h3>
                <div className="space-y-1 opacity-90">
                  {renderTeacherList(groupedTeachers.unavailable, 'unavailable')}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <User size={14}/> 未提出
                </h3>
                <div className="space-y-1 opacity-70">
                  {renderTeacherList(groupedTeachers.unsubmitted, 'unsubmitted')}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-8 min-w-0">
            {['1限', '2限'].map((period) => (
              <div key={period} className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between shrink-0 ${period === '1限' ? 'bg-slate-800 text-white' : 'bg-slate-700 text-slate-100'}`}>
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Clock size={16} className={period === '1限' ? 'text-sky-300' : 'text-sky-200'}/>
                    {period} <span className="opacity-60 font-mono text-xs font-normal ml-1">{period === '1限' ? '19:20 - 20:25' : '20:35 - 21:40'}</span>
                  </div>
                  <div className="flex gap-2 text-xs font-bold">
                    <span className="bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-100">理 {getAllClassesForSubject(period, '理科').length}</span>
                    <span className="bg-amber-500/20 px-2 py-0.5 rounded text-amber-100">社 {getAllClassesForSubject(period, '社会').length}</span>
                  </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar p-3 bg-slate-50/50">
                  <div className="flex gap-4 min-w-max items-start">
                    
                    <div className="flex flex-col gap-2 min-w-[220px] shrink-0">
                      <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 border-b border-emerald-100 pb-1 mb-1">
                        <Users size={12}/> 理科グループ
                      </div>
                      <div className="flex gap-2">
                        {getAllClassesForSubject(period, '理科').map(info => (
                           <ClassCard 
                             key={info.id} 
                             info={info} 
                             onDelete={handleDelete}
                             onEdit={setEditingShift}
                             onShowResults={handleShowSurveyResults}
                             onDragOver={handleDragOver}
                             onDragLeave={handleDragLeave}
                             onDrop={(e: any, t: any, z: any) => handleDrop(e, t, z, period)}
                             onSearchAssign={(role: 'main' | 'sub') => { setAssignmentSearch(''); setAssignmentTarget({ role, targetClass: info.main || undefined, period }); }}
                             dragOverCardId={dragOverCardId}
                             dragOverZone={dragOverZone}
                           />
                        ))}
                      </div>
                    </div>

                    <div className="w-px bg-slate-200 self-stretch my-2"></div>

                    <div className="flex flex-col gap-2 min-w-[220px] shrink-0">
                      <div className="flex items-center gap-1 text-xs font-bold text-amber-700 border-b border-amber-100 pb-1 mb-1">
                        <Users size={12}/> 社会グループ
                      </div>
                      <div className="flex gap-2">
                        {getAllClassesForSubject(period, '社会').map(info => (
                           <ClassCard 
                             key={info.id} 
                             info={info} 
                             onDelete={handleDelete}
                             onEdit={setEditingShift}
                             onShowResults={handleShowSurveyResults}
                             onDragOver={handleDragOver}
                             onDragLeave={handleDragLeave}
                             onDrop={(e: any, t: any, z: any) => handleDrop(e, t, z, period)}
                             onSearchAssign={(role: 'main' | 'sub') => { setAssignmentSearch(''); setAssignmentTarget({ role, targetClass: info.main || undefined, period }); }}
                             dragOverCardId={dragOverCardId}
                             dragOverZone={dragOverZone}
                           />
                        ))}
                      </div>
                    </div>

                    <div className="w-px bg-slate-200 self-stretch my-2"></div>

                    <div className="flex flex-col gap-1 ml-1 shrink-0">
                      <div 
                        className={`bg-slate-100 rounded-xl p-2 border border-slate-200 w-[200px] min-h-[140px] flex flex-col transition-all duration-200
                          ${dragOverCardId === `general-${period}` ? 'bg-accent-soft border-accent/40 ring-2 ring-accent/20 shadow-md' : ''}
                        `}
                        onDragOver={(e) => handleDragOver(e, `general-${period}`, 'general')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, null, 'general', period)}
                      >
                        <div className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1 uppercase tracking-wider shrink-0">
                          <User size={12}/> 全体サポート
                          <button
                            type="button"
                            onClick={() => { setAssignmentSearch(''); setAssignmentTarget({ role: 'general', period }); }}
                            className="ml-auto flex items-center gap-1 rounded-btn bg-white px-2 py-1 normal-case text-accent shadow-sm hover:bg-accent-soft"
                          >
                            <Search size={12} aria-hidden /> 検索
                          </button>
                        </div>
                        
                        <div className="flex flex-col gap-2 flex-1 overflow-y-auto custom-scrollbar">
                          {getGeneralSupport(period).map(a => (
                            <div key={a.id} className="w-full bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-between shadow-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><User size={12}/></div>
                                <div className="min-w-0">
                                  <button onClick={(e) => handleShowSurveyResults(e, a.user_id, a.teacher_name)} className="font-bold text-slate-700 text-xs hover:underline truncate block">{a.teacher_name}</button>
                                </div>
                              </div>
                              <IconButton size="sm" label={`${a.teacher_name}先生の配置を解除`} onClick={() => handleDelete(a.id)} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} aria-hidden /></IconButton>
                            </div>
                          ))}
                          {getGeneralSupport(period).length === 0 && (
                            <div className="flex-1 flex items-center justify-center text-xs text-slate-300 font-bold border-2 border-dashed border-slate-200 rounded-lg">
                              ドラッグして追加
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(assignmentTarget)}
        onClose={() => setAssignmentTarget(null)}
        size="lg"
        title="講師を検索して配置"
        description={assignmentTarget ? (
          <span className="font-bold">
            {assignmentTarget.period}・{assignmentTarget.role === 'main' ? '主担当' : assignmentTarget.role === 'sub' ? 'サポート' : '全体サポート'}
            {assignmentTarget.targetClass ? `／${assignmentTarget.targetClass.target_grade || ''} ${assignmentTarget.targetClass.target_subject || ''} ${assignmentTarget.targetClass.target_detail_subject || ''}` : ''}
          </span>
        ) : undefined}
      >
        {assignmentTarget && (
          <>
            <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-3 border-b border-line bg-surface px-5 py-3">
              <div className="flex items-center gap-2 rounded-input border border-slate-300 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <Search size={17} className="text-slate-400" aria-hidden />
                <input data-autofocus aria-label="講師を検索" value={assignmentSearch} onChange={event => setAssignmentSearch(event.target.value)} placeholder="氏名、ID、校舎、勤務可能時間で検索" className="min-w-0 flex-1 py-3 text-sm outline-none" />
              </div>
            </div>
            <div className="space-y-2">
              {allTeachers
                .filter(teacher => teacherMatches(teacher, assignmentSearch))
                .sort((left, right) => {
                  const rank = (teacher: Teacher) => {
                    const items = availabilitiesByTeacher.get(teacher.id) || [];
                    if (items.some(item => item.status === 'possible' || !item.status)) return 0;
                    if (items.some(item => item.status === 'maybe')) return 1;
                    if (items.length === 0) return 2;
                    return 3;
                  };
                  return rank(left) - rank(right) || teacherNameOf(left).localeCompare(teacherNameOf(right), 'ja');
                })
                .map(teacher => {
                  const items = availabilitiesByTeacher.get(teacher.id) || [];
                  const available = items.find(item => item.status !== 'impossible') || items[0];
                  const unavailable = items.length > 0 && items.every(item => item.status === 'impossible');
                  const isMaybe = available?.status === 'maybe';
                  const alreadyAssigned = assignments.filter(item => item.user_id === teacher.id).length;
                  return (
                    <div key={teacher.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center ${unavailable ? 'border-rose-200 bg-rose-50/60' : isMaybe ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-slate-800">{teacherNameOf(teacher)}</p>
                          {teacher.lifetime_id && <span className="text-xs font-bold text-slate-400">{teacher.lifetime_id}</span>}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${unavailable ? 'bg-rose-600 text-white' : isMaybe ? 'bg-amber-500 text-white' : available ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                            {unavailable ? '勤務不可' : isMaybe ? '予定終了後なら可能' : available ? '勤務可能' : '未提出'}
                          </span>
                          {alreadyAssigned > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">配置済 {alreadyAssigned}</span>}
                        </div>
                        <p className="mt-1 text-xs font-bold text-slate-600">{available ? [available.workplace || available.location, available.time_range, available.note].filter(Boolean).join(' ／ ') : '基本勤務設定・個別希望とも未提出'}</p>
                        {available?.roles?.length ? <p className="mt-1 text-xs font-bold text-slate-400">希望役割: {available.roles.join(' / ')}　{available.source === 'weekly' ? '（基本設定）' : '（個別提出）'}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (unavailable && !(await confirm({
                            title: `${teacherNameOf(teacher)}先生は勤務不可として申告しています。配置を続けますか？`,
                            confirmLabel: '配置する',
                          }))) return;
                          await executeAssign(teacher.id, assignmentTarget.role, assignmentTarget.targetClass, assignmentTarget.period);
                          setAssignmentTarget(null);
                        }}
                        className={buttonClass(unavailable ? 'danger' : 'secondary', 'sm', 'shrink-0')}
                      >
                        {assignmentTarget.role === 'main' ? 'この先生に変更' : 'この先生を追加'}
                      </button>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </Modal>

      <Modal closeOnBackdrop={false} open={Boolean(editingShift)} onClose={() => setEditingShift(null)} title="シフト編集">
        {editingShift && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500">勤務地</label>
                <select
                  className="w-full min-h-11 p-2 border border-line rounded-input mt-1 bg-white"
                  value={editingShift.target_place || ''}
                  onChange={e => setEditingShift({...editingShift, target_place: e.target.value})}
                >
                  <option value="">未設定</option>
                  {WORK_LOCATIONS.map(location => <option key={location} value={location}>{location}</option>)}
                  {editingShift.target_place && !WORK_LOCATIONS.includes(editingShift.target_place) && (
                    <option value={editingShift.target_place}>{editingShift.target_place}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">単元</label>
                <input className="w-full min-h-11 p-2 border border-line rounded-input mt-1" value={editingShift.unit || ''} onChange={e => setEditingShift({...editingShift, unit: e.target.value})}/>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">Zoomサインインアドレス</label>
                <input className="w-full min-h-11 p-2 border border-line rounded-input mt-1 font-mono" value={editingShift.target_signin_address || ''} onChange={e => setEditingShift({...editingShift, target_signin_address: e.target.value})} placeholder="abc@sozogakuen.co.jp"/>
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-500 flex justify-between items-center">
                  <span>Zoom ID (ミーティングID)</span>
                  <button 
                    onClick={handleManualZoomCreate} 
                    disabled={creatingZoom || !!editingShift.target_meeting_id}
                    type="button"
                    className={`text-xs flex items-center gap-1 px-2 py-1 rounded-btn transition-colors ${editingShift.target_meeting_id ? 'bg-emerald-100 text-emerald-700 cursor-default' : 'bg-accent-soft text-accent hover:bg-accent/15'}`}
                  >
                    {creatingZoom ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                    {editingShift.target_meeting_id ? '発行済み' : 'Zoom URLを自動発行'}
                  </button>
                </label>
                <input className="w-full min-h-11 p-2 border border-line rounded-input mt-1 font-mono" value={editingShift.target_meeting_id || ''} onChange={e => setEditingShift({...editingShift, target_meeting_id: e.target.value})} placeholder="123 456 7890"/>
                {editingShift.start_url && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                    <CheckCircle size={10}/> ホストURL発行済み
                  </p>
                )}
              </div>

              <div className="rounded-btn border border-accent/20 bg-accent-soft p-3">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <KeyRound size={14} className="text-accent" /> Zoomパスコード
                </label>
                <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">
                  Zoomの会議設定と生徒・講師の参加リンクを同じパスコードに更新します。
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    autoComplete="new-password"
                    maxLength={10}
                    className="min-w-0 flex-1 min-h-11 rounded-input border border-line bg-white p-2 font-mono tracking-wider outline-none focus:border-accent"
                    value={editingShift.target_password || ''}
                    onChange={event => setEditingShift({ ...editingShift, target_password: event.target.value.replace(/\s/g, '') })}
                    placeholder="例: Risha2026"
                  />
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    onClick={handleUpdateZoomPasscode}
                    disabled={!normalizeMeetingId(editingShift.target_meeting_id)}
                    loading={updatingPasscode}
                    icon={<KeyRound size={16} aria-hidden />}
                  >
                    Zoomに反映して保存
                  </Button>
                </div>
              </div>

              <Button fullWidth size="lg" className="mt-4" onClick={handleUpdate} icon={<Save size={18} aria-hidden />}>保存</Button>
            </div>
        )}
      </Modal>

      <Modal
        open={isSurveyModalOpen}
        onClose={() => setIsSurveyModalOpen(false)}
        size="lg"
        title="アンケート集計"
        description={<>対象: <span className="font-bold text-fg">{selectedTeacherForResults?.name}</span> 先生</>}
      >
            <div className="-mx-5 -my-4 min-h-full bg-slate-50 px-5 py-4">
              {surveyLoading ? (
                <div className="flex justify-center py-20"><Spinner size={30} /></div>
              ) : surveyError ? (
                <ErrorState title="アンケート結果を読み込めませんでした" onRetry={() => selectedTeacherForResults && handleShowSurveyResults({ stopPropagation: () => {} } as React.MouseEvent, selectedTeacherForResults.id, selectedTeacherForResults.name)} />
              ) : surveyResults.length === 0 ? (
                <EmptyState icon={BarChart2} title="まだ回答データがありません" />
              ) : (
                <div className="space-y-8">
                  {surveyQuestions.map(q => {
                    if (q.type === 'rating') {
                      const { average, total, data } = calculateRatingStats(q.id);
                      return (
                        <div key={q.id} className="bg-white p-5 rounded-card shadow-sm border border-slate-100">
                          <h4 className="font-bold text-slate-800 mb-4 text-sm">{q.text}</h4>
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <span className="text-3xl font-black text-accent">{average}</span>
                              <span className="text-xs text-slate-400 ml-1">/ 5.0</span>
                            </div>
                            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">回答数: {total}</span>
                          </div>
                          <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={20} tick={{fontSize: 10, fontWeight: 'bold'}} />
                                <Tooltip cursor={{fill: 'transparent'}} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12}>
                                  {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    } else {
                      const answers = getTextAnswers(q.id);
                      if (answers.length === 0) return null;
                      return (
                        <div key={q.id} className="bg-white p-5 rounded-card shadow-sm border border-slate-100">
                          <h4 className="font-bold text-slate-800 mb-3 text-sm">{q.text}</h4>
                          <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                            {answers.map((a: any) => (
                              <div key={a.id} className="bg-slate-50 p-3 rounded-xl text-xs">
                                <p className="text-slate-700 leading-relaxed mb-2">{a.text}</p>
                                <div className="flex justify-between text-xs text-slate-400 border-t border-slate-200 pt-2">
                                  <span>{a.date}</span>
                                  <span>{a.subject}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
      </Modal>
    </div>
  );
}

// ClassCard (DnD対応・管理者向け・デザイン統一)
function ClassCard({ info, onDelete, onEdit, onShowResults, onDragOver, onDragLeave, onDrop, onSearchAssign, dragOverCardId, dragOverZone }: any) {
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const isTarget = dragOverCardId === info.id;
  const isEmerald = info.subject === '理科';

  const loginEmail = info.main?.target_signin_address?.trim();
  const hasHostPermission = !!loginEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail);
  const displayLoginId = loginEmail ? loginEmail.split('@')[0] : '';

  // 管理者画面なので、名前の指定はそのクラスの担当講師名を使う
  const teacherName = info.main?.teacher_name || '';
  const surname = teacherName.split(/[\s　]+/)[0];

  const theme = isEmerald ? {
    border: 'border-emerald-100',
    headerBg: 'bg-emerald-600',
    headerText: 'text-white',
    badge: 'bg-white/20 text-white',
    iconBg: 'bg-emerald-500',
    activeRing: 'ring-2 ring-emerald-400',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200',
  } : {
    border: 'border-amber-100',
    headerBg: 'bg-amber-500',
    headerText: 'text-white',
    badge: 'bg-white/20 text-white',
    iconBg: 'bg-amber-500',
    activeRing: 'ring-2 ring-amber-400',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200',
  };

  const confno = normalizeMeetingId(info.main?.target_meeting_id) || normalizeMeetingId(info.main?.start_url ? info.main.start_url.split('/').pop()?.split('?')[0] : '');

  const launchWebUrl = (url: string, targetWindow?: Window | null) => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.replace(url);
      return;
    }

    // API待機後の新規ウィンドウがブラウザに拒否されても、
    // ホスト開始URLは現在のタブで確実に開く。
    const openedWindow = window.open(url, '_blank');
    if (!openedWindow) window.location.assign(url);
  };
  // 管理者用ホスト開始ロジック (先生画面と同じ)
  const handleEnterZoom = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confno) {
      toast.error('ミーティングIDが設定されていません。');
      return;
    }

    if (hasHostPermission) {
      if (!(await confirm({
        title: `「${teacherName}」先生としてホストを開始しますか？`,
        message: `ログインID: ${loginEmail}`,
        confirmLabel: 'ホスト開始',
      }))) return;

      const popup = window.open('', '_blank');
      if (popup) {
        popup.document.write('<p style="font-family: sans-serif; padding: 24px;">Zoomホスト開始を準備しています...</p>');
        popup.document.close();
      }
      setLoading(true);
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('not-authenticated');
        const token = await currentUser.getIdToken();
        
        const res = await fetch('/api/get-zoom-zak', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ 
            email: loginEmail,
            meetingId: confno,
            shiftId: info.main?.id || info.id,
            name: surname // 担当講師の苗字で名前書き換え
          }) 
        });
        const data = await res.json();
        
        if (data.success && (data.zak || data.start_url)) {
          const displayName = surname || teacherName || '講師';
          const webUrl = data.start_url || `https://zoom.us/s/${confno}?zak=${encodeURIComponent(data.zak)}&uname=${encodeURIComponent(displayName)}`;
          const appUrl = data.app_start_url || (data.zak ? `zoommtg://zoom.us/start?confno=${confno}&zak=${encodeURIComponent(data.zak)}` : '');
          launchWebUrl(webUrl || appUrl, popup);
        } else {
          if (popup && !popup.closed) popup.close();
          console.error("API Error:", data);
          const joinNormally = await confirm({
            title: 'ホスト権限を取得できませんでした。通常参加で開きますか？',
            message: `理由: ${data.error}${data.detail ? `／詳細: ${data.detail}` : ''}`,
            confirmLabel: '通常参加で開く',
          });
          if (joinNormally) {
             launchWebUrl(info.url || `https://zoom.us/j/${confno}`);
          }
        }
      } catch (err) {
        if (popup && !popup.closed) popup.close();
        console.error(err);
        toast.error('通信エラーが発生しました。もう一度お試しください。');
      } finally {
        setLoading(false);
      }
    } else {
      // 通常参加
      let targetUrl = info.url || `zoommtg://zoom.us/join?confno=${confno}`;
      if (info.url) {
        try {
          const urlObj = new URL(info.url);
          const pwd = urlObj.searchParams.get('pwd');
          // 通常参加でも名前を指定してあげる
          const zoomDisplayName = surname ? `講師：${surname}` : '講師';
          targetUrl = `https://zoom.us/j/${confno}?pwd=${pwd || ''}&uname=${encodeURIComponent(zoomDisplayName)}`;
        } catch (e) {}
      }
      launchWebUrl(targetUrl);
    }
  };
  
  return (
    <div 
      className={`w-[180px] bg-white border ${theme.border} rounded-xl shadow-sm flex flex-col overflow-hidden relative group hover:shadow-md transition-all shrink-0
        ${isTarget ? `${theme.activeRing} scale-[1.02] z-10` : ''}
      `}
    >
      {/* ヘッダー (先生画面に合わせてデザイン統一) */}
      <div className={`${theme.headerBg} px-3 py-2 relative`}>
        <div className="flex justify-between items-start mb-1">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${theme.badge} whitespace-nowrap`}>
            {info.grade}/{info.place}
          </span>
          {/* 編集・削除ボタンは管理者のみ */}
          {info.main && (
            <div className="flex gap-1">
              <button type="button" onClick={() => onEdit(info.main)} aria-label="授業を編集" title="授業を編集" className="rounded p-0.5 text-white/80 hover:bg-white/15 hover:text-white transition-colors"><Settings size={14} aria-hidden /></button>
              <button type="button" onClick={() => onDelete(info.main!.id)} aria-label="主担当の配置を解除" title="主担当の配置を解除" className="rounded p-0.5 text-white/80 hover:bg-white/15 hover:text-white transition-colors"><Trash2 size={14} aria-hidden /></button>
            </div>
          )}
        </div>
        <div className={`text-xs font-bold ${theme.headerText} line-clamp-1`}>
          {info.unit || <span className="opacity-60 font-normal">単元未設定</span>}
        </div>
        
        {/* スタジオ名表示 */}
        {info.studio && (
          <div className="flex items-center gap-0.5 text-[11px] bg-black/20 px-1.5 py-0.5 rounded text-white/90 font-bold whitespace-nowrap mt-1 w-max">
            <MapPin size={9}/> {info.studio}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {/* メイン講師エリア */}
        <div 
          className={`p-2 transition-colors ${isTarget && dragOverZone === 'main' ? 'bg-accent-soft' : 'bg-white'}`}
          onDragOver={(e) => onDragOver(e, info.id, 'main')}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, info.main, 'main')}
        >
          <div className="flex items-start gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${theme.iconBg} text-white shadow-sm`}>
              <User size={14}/>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-400 font-bold mb-0.5">メイン</div>
              <button 
                onClick={(e) => info.main?.user_id && onShowResults(e, info.main.user_id, info.main.teacher_name)}
                className="font-bold text-slate-800 text-xs hover:text-accent hover:underline decoration-accent/40 text-left flex items-center gap-1 group/link w-full"
              >
                <span className="truncate">{info.main?.teacher_name || '未定'}</span>
                {info.main?.teacher_name && <BarChart2 size={10} className="text-slate-300 group-hover/link:text-accent shrink-0"/>}
              </button>
              <button type="button" onClick={() => onSearchAssign('main')} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
                <Search size={9} /> 講師を検索して変更
              </button>
              
              {/* ログインID表示 & ボタン (先生画面のロジックを移植) */}
              {displayLoginId ? (
                <button 
                  type="button"
                  onClick={handleEnterZoom}
                  disabled={loading}
                  className={`flex items-center gap-1 text-[11px] font-mono mt-0.5 border rounded px-1 transition-all cursor-pointer group w-full justify-between min-h-[20px] ${
                    hasHostPermission 
                      ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100' 
                      : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
                  }`}
                  title={`ログインID: ${loginEmail}`}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <KeyRound size={8} className="shrink-0 opacity-70"/>
                    <span className="truncate">{displayLoginId}</span>
                  </div>
                  {loading ? <Loader2 size={6} className="animate-spin"/> : <Zap size={6} className={hasHostPermission ? "text-rose-500" : "text-slate-400"}/>}
                </button>
              ) : (
                <div className="min-h-[20px] text-[11px] text-slate-400 flex items-center pl-1 border border-transparent">ID未登録</div> 
              )}
            </div>
          </div>
        </div>

        {/* サポート講師エリア */}
        <div 
          className={`px-2 py-1.5 border-t border-slate-100 min-h-[50px] transition-colors ${isTarget && dragOverZone === 'sub' ? 'bg-accent-soft' : 'bg-slate-50/50'}`}
          onDragOver={(e) => onDragOver(e, info.id, 'sub')}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, info.main, 'sub')}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-bold">サポート</span>
            <button type="button" onClick={() => onSearchAssign('sub')} className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"><UserPlus size={9} />検索して追加</button>
          </div>
          <div className="space-y-1">
            {info.subs.map((sub: any) => (
              <div key={sub.id} className="flex justify-between items-center text-[11px]">
                <div className="min-w-0 flex flex-col">
                  <button
                    onClick={(e) => onShowResults(e, sub.user_id, sub.teacher_name)} 
                    className="text-slate-600 font-medium flex items-center gap-1 hover:text-accent hover:underline"
                  >
                    <div className="w-1 h-1 rounded-full bg-slate-300 shrink-0"></div> {sub.teacher_name}
                  </button>
                </div>
                <button type="button" onClick={() => onDelete(sub.id)} aria-label={`${sub.teacher_name}先生の配置を解除`} title="配置を解除" className="text-slate-400 hover:text-rose-600 shrink-0 ml-1 p-0.5"><Trash2 size={12} aria-hidden /></button>
              </div>
            ))}
            {info.subs.length === 0 && <div className="text-[11px] text-slate-300 pl-1">-</div>}
          </div>
        </div>

        {/* Zoomボタン */}
        <div className="mt-auto p-2 bg-white border-t border-slate-100">
          {confno ? (
            <button 
              type="button" 
              onClick={handleEnterZoom}
              disabled={loading}
              className={`w-full ${theme.btn} shadow-sm text-[11px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 transition-transform active:scale-95`}
            >
              {loading ? <Loader2 size={10} className="animate-spin"/> : hasHostPermission ? <Zap size={10}/> : <Video size={10}/>}
              {loading ? '準備中...' : (hasHostPermission ? 'ホスト開始' : '入室')}
            </button>
          ) : (
            <div className="w-full bg-slate-100 text-slate-400 text-[11px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 cursor-not-allowed">
              <Video size={12}/> -
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
