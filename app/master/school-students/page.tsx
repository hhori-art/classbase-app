'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { auth } from '@/lib/firebase';
import {
  BookOpen,
  CheckCircle2,
  CameraOff,
  FileUp,
  GraduationCap,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PhoneOff,
  Plus,
  Printer,
  RefreshCw,
  Search,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';
import CourseRegistrationCalendar, { getCourseDay, getCourseSlot, getCourseSubject } from '@/app/components/CourseRegistrationCalendar';
import LastLoginCell from '@/app/components/LastLoginCell';
import AccountGuideSheet, { ACCOUNT_GUIDE_PRINT_CSS } from '@/app/components/AccountGuideSheet';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';

const STATUSES = [
  { id: 'active', label: '有効', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'suspended', label: '一時停止', icon: PauseCircle, className: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'withdrawn', label: '解除', icon: XCircle, className: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'archived', label: '保管', icon: LockKeyhole, className: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const TRIAL_EVENT_OPTIONS = ['理科体験授業', '社会体験授業', '定期テスト対策体験', '保護者説明会'];

const initialForm = {
  display_name: '',
  login_id: '',
  password: '',
  grade: '中1',
  classroom: '',
  middle_school: '',
  course_start_month: '',
  sibling_ids: '',
  twin_sibling_ids: '',
  trial_event_ids: [] as string[],
  trial_continued: false,
  day_of_week: '',
  subject_science: '',
  subject_social: '',
  phone_number: '',
  camera_off_requested: false,
  absence_call_not_required: false,
};

const currentCourseYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

const normalizeGradeLabel = (value: any) => {
  const raw = String(value || '').normalize('NFKC');
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const normalizeCourseLabelText = (value: any) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .trim();

const compactCourseParts = (...values: any[]) => {
  const parts: string[] = [];
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    const normalized = normalizeCourseLabelText(text);
    if (!normalized || normalized === '講座') return;
    if (parts.some(part => normalizeCourseLabelText(part) === normalized)) return;
    parts.push(text);
  });
  return parts;
};

const optionTermKey = (option: any) => String(option.term || option.term_id || option.term_label || '').trim();
const optionTermLabel = (term: string, options: any[]) => {
  const option = options.find(item => optionTermKey(item) === term);
  return String(option?.term_label || option?.term || term || '期未設定');
};
const courseKey = (option: any) => [
  ...compactCourseParts(
    option.grade,
    getCourseSubject(option),
    option.course_name || option.title || getCourseSubject(option) || '講座',
  ),
].join('__') || String(option.id || '講座');
const timeKey = (option: any) => [
  getCourseDay(option) || '曜日未設定',
  getCourseSlot(option) || '時間未設定',
].join('__');
const courseDisplayName = (option: any) => compactCourseParts(
  getCourseSubject(option),
  option.course_name || option.title || getCourseSubject(option) || '講座',
).join(' ') || '講座';
const courseFullDisplayName = (option: any) => compactCourseParts(
  option.grade,
  getCourseSubject(option),
  option.course_name || option.title || getCourseSubject(option) || '講座',
).join(' ') || '講座';

const formatCourseGroupLabel = (group: any) => {
  const option = group.option || group;
  const name = courseDisplayName(option);
  const schedule = [
    getCourseDay(option) && `${getCourseDay(option)}曜`,
    String(getCourseSlot(option) || '').replace('時間目', '限'),
  ].filter(Boolean).join(' ');
  const units = Array.isArray(group.units)
    ? group.units.map((unit: any) => String(unit || '').trim()).filter(Boolean)
    : [
      option.resolved_unit,
      option.unit,
      ...(Array.isArray(option.matched_units) ? option.matched_units : []),
      ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
    ].map((unit: any) => String(unit || '').trim()).filter(Boolean);
  return [name || '講座', schedule, Array.from(new Set(units)).slice(0, 2).join(' / ')].filter(Boolean).join(' / ');
};

export default function SchoolStudentsPage() {
  const { profile } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [school, setSchool] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [middleSchoolFilter, setMiddleSchoolFilter] = useState('');
  const [bulkAbsenceDate, setBulkAbsenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [betaMode, setBetaMode] = useState(false);
  const [testPrepForm, setTestPrepForm] = useState({
    title: '',
    middle_school: '',
    event_date: new Date().toISOString().slice(0, 10),
    description: '',
  });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [printStudent, setPrintStudent] = useState<any | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [qrBaseUrl, setQrBaseUrl] = useState('');
  const [csvEncoding, setCsvEncoding] = useState('Shift_JIS');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvLog, setCsvLog] = useState<string[]>([]);
  const [courseModalStudent, setCourseModalStudent] = useState<any | null>(null);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseSaving, setCourseSaving] = useState(false);
  const [courseSelectedIds, setCourseSelectedIds] = useState<string[]>([]);
  const [courseSelectedKeys, setCourseSelectedKeys] = useState<string[]>([]);
  const [courseYear, setCourseYear] = useState(currentCourseYear());
  const [courseTerm, setCourseTerm] = useState('');
  const [courseOptionCache, setCourseOptionCache] = useState<Record<string, any[]>>({});

  const mySchool = useMemo(() => {
    const ids = Array.isArray(profile?.school_ids) ? profile?.school_ids : [];
    return ids[0] || profile?.school_id || profile?.school || '';
  }, [profile]);

  const filtered = useMemo(() => {
    return students.filter(student => {
      const statusValue = student.account_status || 'active';
      const haystack = `${student.student_name || ''} ${student.grade || ''} ${student.classroom || ''} ${student.lifetime_id || ''}`.toLowerCase();
      if (status !== 'all' && statusValue !== status) return false;
      if (middleSchoolFilter && student.middle_school !== middleSchoolFilter) return false;
      if (search && !haystack.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [students, status, search, middleSchoolFilter]);

  const middleSchools = useMemo(() => Array.from(new Set(students.map(student => String(student.middle_school || '').trim()).filter(Boolean))).sort(), [students]);
  const isMaster = profile?.role === 'master';
  const courseYearChoices = useMemo(() => {
    const values = Array.from(new Set(courseOptions.map(option => Number(option.year || courseYear)).filter(Boolean)));
    if (!values.includes(courseYear)) values.push(courseYear);
    return values.sort((a, b) => b - a);
  }, [courseOptions, courseYear]);
  const courseTermChoices = useMemo(() => {
    const values = Array.from(new Set(courseOptions
      .filter(option => !option.year || Number(option.year) === courseYear)
      .map(optionTermKey)
      .filter(Boolean)));
    return values.sort((a, b) => optionTermLabel(a, courseOptions).localeCompare(optionTermLabel(b, courseOptions), 'ja', { numeric: true }));
  }, [courseOptions, courseYear]);
  const visibleCourseOptions = useMemo(() => (
    courseOptions
      .filter(option => !option.year || Number(option.year) === courseYear)
      .filter(option => !courseTerm || optionTermKey(option) === courseTerm)
  ), [courseOptions, courseTerm, courseYear]);
  const courseChoices = useMemo(() => (Object.values(visibleCourseOptions.reduce((acc, option: any) => {
    const key = courseKey(option);
    if (!acc[key]) acc[key] = { key, option, daySlots: new Set<string>(), units: new Set<string>() };
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
  }, {} as Record<string, { key: string; option: any; daySlots: Set<string>; units: Set<string> }>)) as {
    key: string;
    option: any;
    daySlots: Set<string>;
    units: Set<string>;
  }[]).sort((a, b) => courseFullDisplayName(a.option).localeCompare(courseFullDisplayName(b.option), 'ja', { numeric: true })), [visibleCourseOptions]);
  const stepCourseOptions = useMemo(() => (
    courseSelectedKeys.length > 0
      ? visibleCourseOptions.filter((option: any) => courseSelectedKeys.includes(courseKey(option)))
      : []
  ), [courseSelectedKeys, visibleCourseOptions]);
  const visibleOptionIds = useMemo(() => new Set(visibleCourseOptions.map((option: any) => option.id)), [visibleCourseOptions]);
  const stepOptionIds = useMemo(() => new Set(stepCourseOptions.map((option: any) => option.id)), [stepCourseOptions]);
  const visibleSelectedIds = useMemo(() => courseSelectedIds.filter(id => visibleOptionIds.has(id)), [courseSelectedIds, visibleOptionIds]);
  const stepSelectedIds = useMemo(() => courseSelectedIds.filter(id => stepOptionIds.has(id)), [courseSelectedIds, stepOptionIds]);
  const selectedVisibleGroups = useMemo(() => Object.values(visibleCourseOptions
    .filter((option: any) => visibleSelectedIds.includes(option.id))
    .reduce((acc, option: any) => {
      const key = [
        option.grade || '',
        getCourseSubject(option) || '',
        option.course_name || option.title || '',
        getCourseDay(option) || '',
        getCourseSlot(option) || '',
      ].join('__');
      if (!acc[key]) acc[key] = { option, units: [] as string[] };
      [
        option.resolved_unit,
        option.unit,
        ...(Array.isArray(option.matched_units) ? option.matched_units : []),
        ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
      ].forEach((unit: any) => {
        const value = String(unit || '').trim();
        if (value && !acc[key].units.includes(value)) acc[key].units.push(value);
      });
      return acc;
    }, {} as Record<string, { option: any; units: string[] }>)), [visibleCourseOptions, visibleSelectedIds]);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined') {
      setQrBaseUrl(window.location.origin);
    }
  }, []);

  const counts = useMemo(() => {
    return STATUSES.reduce((acc, item) => {
      acc[item.id] = students.filter(student => (student.account_status || 'active') === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [students]);

  const loadStudents = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setSchool(data.school || mySchool || '');
      setStudents(data.students || []);
    } catch (e: any) {
      alert(`生徒一覧の取得に失敗しました: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile) loadStudents();
  }, [profile]);

  useEffect(() => {
    if (!courseModalStudent || courseTermChoices.length === 0) return;
    if (!courseTerm || !courseTermChoices.includes(courseTerm)) {
      setCourseTerm(courseTermChoices[0]);
    }
  }, [courseModalStudent, courseTerm, courseTermChoices]);

  useEffect(() => {
    if (!courseModalStudent) return;
    const validKeys = new Set(courseChoices.map(choice => choice.key));
    const keysFromSelected = visibleCourseOptions
      .filter((option: any) => courseSelectedIds.includes(option.id))
      .map(courseKey);
    setCourseSelectedKeys(prev => Array.from(new Set([
      ...prev.filter(key => validKeys.has(key)),
      ...keysFromSelected,
    ])));
  }, [courseChoices, courseModalStudent, courseSelectedIds, visibleCourseOptions]);

  const openCourseRegistrationModal = async (student: any) => {
    setCourseModalStudent(student);
    setCourseLoading(true);
    setCourseSelectedIds([]);
    setCourseSelectedKeys([]);
    setCourseYear(currentCourseYear());
    setCourseTerm('');
    try {
      const studentGrade = normalizeGradeLabel(student.grade);
      const initialYear = Number(student.course_registration_year || currentCourseYear());
      const cacheKey = `${studentGrade || 'all'}__${initialYear}`;
      let gradeOptions = courseOptionCache[cacheKey] || [];
      if (gradeOptions.length === 0) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('ログイン情報を確認できませんでした');
        const data = await loadCourseRegistrationOptions({
          grade: studentGrade,
          year: initialYear,
          getToken: () => currentUser.getIdToken(),
        });
        gradeOptions = Array.isArray(data.options) ? data.options : [];
        setCourseOptionCache(prev => ({ ...prev, [cacheKey]: gradeOptions }));
      }
      setCourseOptions(gradeOptions);

      const activeRegistration = {
        selected_course_ids: student.selected_course_ids,
        year: student.course_registration_year,
        term: student.course_registration_term,
        updated_at: student.course_registration_updated_at,
      };
      const initialSelectedIds = Array.isArray(activeRegistration?.selected_course_ids)
        ? activeRegistration.selected_course_ids.map(String).filter(Boolean)
        : Array.isArray(student.selected_course_ids)
          ? student.selected_course_ids.map(String).filter(Boolean)
          : [];
      const nextYear = Number(activeRegistration?.year || initialYear);
      const termChoices = Array.from(new Set(gradeOptions
        .filter((option: any) => !option.year || Number(option.year) === nextYear)
        .map(optionTermKey)
        .filter(Boolean)));
      const selectedTerm = String(activeRegistration?.term || '').trim();
      const nextTerm = selectedTerm && termChoices.includes(selectedTerm) ? selectedTerm : termChoices[0] || selectedTerm || '';
      const initialKeys = Array.from(new Set(gradeOptions
        .filter((option: any) => (!option.year || Number(option.year) === nextYear) && (!nextTerm || optionTermKey(option) === nextTerm))
        .filter((option: any) => initialSelectedIds.includes(option.id))
        .map(courseKey)));

      setCourseSelectedIds(initialSelectedIds);
      setCourseSelectedKeys(initialKeys);
      setCourseYear(nextYear);
      setCourseTerm(nextTerm);
    } catch (e: any) {
      alert(`受講講座の読み込みに失敗しました: ${e.message || e}`);
    } finally {
      setCourseLoading(false);
    }
  };

  const toggleCourse = (id: string) => {
    toggleCourseGroup([id]);
  };

  const toggleCourseKey = (key: string) => {
    const targetIds = new Set(visibleCourseOptions
      .filter((option: any) => courseKey(option) === key)
      .map((option: any) => option.id));
    setCourseSelectedKeys(prev => {
      const selected = prev.includes(key);
      if (selected) {
        setCourseSelectedIds(current => current.filter(id => !targetIds.has(id)));
        return prev.filter(item => item !== key);
      }
      return [...prev, key];
    });
  };

  const toggleCourseGroup = (ids: string[]) => {
    const cleanIds = Array.from(new Set(ids.filter(Boolean)));
    if (cleanIds.length === 0) return;
    setCourseSelectedIds(prev => {
      const activeIds = new Set(visibleCourseOptions.map((option: any) => option.id));
      const outsideVisible = prev.filter(id => !activeIds.has(id));
      const current = new Set(prev.filter(id => activeIds.has(id)));
      const allSelected = cleanIds.every(id => current.has(id));
      if (allSelected) {
        cleanIds.forEach(id => current.delete(id));
      } else {
        const selectedOptions = visibleCourseOptions.filter((option: any) => cleanIds.includes(option.id));
        const conflictKeys = new Set(selectedOptions.map(timeKey));
        visibleCourseOptions
          .filter((option: any) => conflictKeys.has(timeKey(option)))
          .forEach((option: any) => current.delete(option.id));
        cleanIds.forEach(id => current.add(id));
      }
      return Array.from(new Set([...outsideVisible, ...Array.from(current)]));
    });
  };

  const saveCourseRegistration = async () => {
    if (!courseModalStudent) return;
    if (visibleSelectedIds.length === 0) return alert('登録する講座を1つ以上選択してください');
    setCourseSaving(true);
    try {
      const selectedCourseLabels = selectedVisibleGroups.map(formatCourseGroupLabel);
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/course-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: courseModalStudent.id,
          year: courseYear,
          term: courseTerm || 'manual',
          selected_course_ids: visibleSelectedIds,
          selected_course_labels: selectedCourseLabels,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setStudents(prev => prev.map(student => student.id === courseModalStudent.id ? {
        ...student,
        selected_course_ids: data.selected_course_ids || visibleSelectedIds,
        selected_course_labels: selectedCourseLabels,
        active_course_registration_id: data.registration_id,
        course_registration_status: 'active',
        course_registration_year: courseYear,
        course_registration_term: courseTerm,
        course_registration_term_label: optionTermLabel(courseTerm, courseOptions),
        course_registration_updated_at: new Date().toISOString(),
      } : student));
      setCourseModalStudent(null);
      alert('受講講座を登録しました');
    } catch (e: any) {
      alert(`受講講座の登録に失敗しました: ${e.message || e}`);
    } finally {
      setCourseSaving(false);
    }
  };

  const updateStatus = async (target: any, nextStatus: string) => {
    if (!confirm(`${target.student_name || target.id} を「${STATUSES.find(s => s.id === nextStatus)?.label}」に変更しますか？`)) return;
    setSavingId(target.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: target.id, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setStudents(prev => prev.map(student => student.id === target.id ? { ...student, account_status: nextStatus } : student));
    } catch (e: any) {
      alert(`状態変更に失敗しました: ${e.message || e}`);
    } finally {
      setSavingId('');
    }
  };

  const createStudent = async () => {
    if (!form.display_name.trim()) return alert('氏名は必須です');
    if (!form.login_id.trim()) return alert('初期IDは必須です');
    if (!school) return alert('校舎が設定されていません。管理者アカウントの school_ids を確認してください。');
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...form,
            password: form.password.trim() || undefined,
            role: 'student',
          school_id: school,
          account_status: 'active',
          auto_create_parent: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      const createdStudent = {
        id: data.uid,
        uid: data.uid,
        student_name: form.display_name,
        lifetime_id: form.login_id,
        initial_password: data.initial_password || form.password,
        grade: form.grade,
        classroom: form.classroom,
        middle_school: form.middle_school,
        course_start_month: form.course_start_month,
        sibling_ids: form.sibling_ids.split(',').map(value => value.trim()).filter(Boolean),
        twin_sibling_ids: form.twin_sibling_ids.split(',').map(value => value.trim()).filter(Boolean),
        trial_event_ids: form.trial_event_ids,
        trial_continued: form.trial_continued,
        day_of_week: form.day_of_week,
        subject_science: form.subject_science,
        subject_social: form.subject_social,
        phone_number: form.phone_number,
        school_id: school,
        camera_off_requested: form.camera_off_requested,
        absence_call_not_required: form.absence_call_not_required,
        account_status: 'active',
        parent_uid: data.parent?.uid || '',
        parent_name: data.parent?.parent_name || `${form.display_name} 保護者`,
        parent_login_id: data.parent?.login_id || `${form.login_id}P`,
        parent_initial_password: data.parent?.initial_password || '',
        isFirstLogin: data.isFirstLogin,
        parent_isFirstLogin: data.parent?.isFirstLogin,
      };
      setModalOpen(false);
      setForm(initialForm);
      await loadStudents();
      setPrintStudent(createdStudent);
      alert(data.updated ? '生徒アカウントを更新しました' : '生徒アカウントを作成しました');
    } catch (e: any) {
      alert(`作成に失敗しました: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const updateStudentOptions = async (student: any, key: 'camera_off_requested' | 'absence_call_not_required', value: boolean) => {
    setStudents(prev => prev.map(item => item.id === student.id ? { ...item, [key]: value } : item));
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_id: student.id,
          camera_off_requested: key === 'camera_off_requested' ? value : Boolean(student.camera_off_requested),
          absence_call_not_required: key === 'absence_call_not_required' ? value : Boolean(student.absence_call_not_required),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
    } catch (e: any) {
      setStudents(prev => prev.map(item => item.id === student.id ? { ...item, [key]: !value } : item));
      alert(`設定変更に失敗しました: ${e.message || e}`);
    }
  };

  const updateStudentPatch = async (student: any, patch: Record<string, unknown>) => {
    setStudents(prev => prev.map(item => item.id === student.id ? { ...item, ...patch } : item));
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_id: student.id,
          camera_off_requested: Boolean(student.camera_off_requested),
          absence_call_not_required: Boolean(student.absence_call_not_required),
          ...patch,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      if (betaMode) await writeBetaLog('student_option_updated', { student_id: student.id, keys: Object.keys(patch) });
    } catch (e: any) {
      await loadStudents();
      alert(`更新に失敗しました: ${e.message || e}`);
    }
  };

  const transferStudent = async (student: any) => {
    const nextSchool = prompt('移籍先の校舎IDを入力してください', student.school_id || school || '');
    if (!nextSchool) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'transfer', user_id: student.id, school_id: nextSchool }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      await loadStudents();
    } catch (e: any) {
      alert(`移籍処理に失敗しました: ${e.message || e}`);
    }
  };

  const withdrawStudent = async (student: any) => {
    const month = prompt('解除月をYYYY-MMで入力してください', new Date().toISOString().slice(0, 7));
    if (!month) return;
    const reason = prompt('解除理由を入力してください');
    if (!reason) return alert('解除理由は必須です');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'withdraw', user_id: student.id, enrollment_cancel_month: month, enrollment_cancel_reason: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      await loadStudents();
    } catch (e: any) {
      alert(`受講解除に失敗しました: ${e.message || e}`);
    }
  };

  const editRelations = async (student: any) => {
    const siblingIds = prompt('兄弟姉妹の生徒UIDをカンマ区切りで入力してください', (student.sibling_ids || []).join(','));
    if (siblingIds === null) return;
    const twinIds = prompt('双子として連動する生徒UIDをカンマ区切りで入力してください', (student.twin_sibling_ids || []).join(','));
    if (twinIds === null) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'relations',
          user_id: student.id,
          sibling_ids: siblingIds.split(',').map(value => value.trim()).filter(Boolean),
          twin_sibling_ids: twinIds.split(',').map(value => value.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      await loadStudents();
      if (betaMode) await writeBetaLog('student_relations_updated', { student_id: student.id });
    } catch (e: any) {
      alert(`兄弟姉妹連携の更新に失敗しました: ${e.message || e}`);
    }
  };

  const writeBetaLog = async (event: string, metadata: Record<string, unknown> = {}) => {
    const token = await auth.currentUser?.getIdToken();
    await fetch('/api/admin/beta-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event, enabled: betaMode, school_id: school, path: window.location.pathname, metadata }),
    }).catch(() => {});
  };

  const toggleBetaMode = async () => {
    if (!isMaster) {
      alert('βテストモードはマスター管理者のみ変更できます。');
      return;
    }
    const next = !betaMode;
    setBetaMode(next);
    const token = await auth.currentUser?.getIdToken();
    await fetch('/api/admin/beta-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event: next ? 'beta_mode_enabled' : 'beta_mode_disabled', enabled: next, school_id: school, path: window.location.pathname }),
    }).catch(() => {});
  };

  const registerBulkAbsence = async () => {
    if (!middleSchoolFilter) return alert('中学校名で絞り込んでから実行してください');
    if (!confirm(`${middleSchoolFilter} の表示対象生徒を ${bulkAbsenceDate} に一括欠席登録しますか？`)) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/bulk-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ school_id: school, middle_school: middleSchoolFilter, target_date: bulkAbsenceDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      alert(`${data.count || 0}名を一括欠席登録しました`);
      if (betaMode) await writeBetaLog('bulk_absence_registered', { middle_school: middleSchoolFilter, target_date: bulkAbsenceDate, count: data.count || 0 });
    } catch (e: any) {
      alert(`一括欠席登録に失敗しました: ${e.message || e}`);
    }
  };

  const createTestPrepEvent = async () => {
    if (!testPrepForm.title.trim()) return alert('テスト対策名を入力してください');
    if (!testPrepForm.middle_school.trim()) return alert('対象中学校を選択してください');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/test-prep-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...testPrepForm, school_id: school, message: `${testPrepForm.title}を登録しました。対象の方はアプリで確認してください。` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      alert(`${data.target_count || 0}名へテスト対策通知を作成しました`);
      setTestPrepForm(prev => ({ ...prev, title: '', description: '' }));
      if (betaMode) await writeBetaLog('test_prep_event_created', { id: data.id, middle_school: testPrepForm.middle_school });
    } catch (e: any) {
      alert(`テスト対策登録に失敗しました: ${e.message || e}`);
    }
  };

  const printGuide = async (student: any) => {
    setPrintingId(student.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
      const userIds = [student.id, student.parent_uid].filter(Boolean);
      const res = await fetch('/api/admin/accounts/sync-printed-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: userIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'パスワード同期に失敗しました');
      if (data.error_count > 0) {
        const details = (data.errors || []).map((item: any) => `${item.login_id || item.user_id}: ${item.error}`).join('\n');
        throw new Error(`書面とログイン情報を同期できませんでした。\n${details}`);
      }

      const resultByOldId = new Map((data.results || []).map((item: any) => [String(item.old_user_id || ''), item]));
      const studentResult: any = resultByOldId.get(student.id);
      const parentResult: any = student.parent_uid ? resultByOldId.get(student.parent_uid) : null;
      const guideStudent = {
        ...student,
        id: studentResult?.user_id || student.id,
        uid: studentResult?.user_id || student.uid,
        email: studentResult?.email || student.email,
        initial_password: studentResult?.initial_password || student.initial_password,
        isFirstLogin: true,
        parent_uid: parentResult?.user_id || student.parent_uid,
        parent_login_id: student.parent_login_id || '',
        parent_initial_password: parentResult?.initial_password || student.parent_initial_password || '',
        parent_email: parentResult?.email || student.parent_email || '',
      };
      setStudents(current => current.map(item => item.id === student.id ? guideStudent : item));
      setPrintStudent(guideStudent);
      setIsPrintModalOpen(true);
    } catch (error: any) {
      alert(`案内書面を作成できませんでした。\n${error?.message || error}`);
    } finally {
      setPrintingId('');
    }
  };

  const addCsvLog = (message: string) => {
    setCsvLog(prev => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 12));
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!school) {
      alert('校舎が設定されていません。管理者アカウントの school_ids を確認してください。');
      event.target.value = '';
      return;
    }
    if (!confirm(`生徒CSVを「${school}」の生徒として取り込みますか？\n保護者アカウントも自動作成します。`)) {
      event.target.value = '';
      return;
    }
    setCsvImporting(true);
    setCsvLog([]);
    addCsvLog(`読み込み開始: ${file.name} (${csvEncoding})`);
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const csvText = String(e.target?.result || '');
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/school-students/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ csv_text: csvText, school_id: school }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
        addCsvLog(`完了: ${data.count || 0}件を登録しました`);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          addCsvLog(`注意: ${data.errors.length}件は登録できませんでした`);
          data.errors.slice(0, 3).forEach((item: any) => addCsvLog(`行${item.row}: ${item.error}`));
        }
        await loadStudents();
        if (Array.isArray(data.students) && data.students.length > 0) {
          setPrintStudent(data.students[0]);
        }
      } catch (e: any) {
        addCsvLog(`エラー: ${e.message || e}`);
        alert(`CSV取り込みに失敗しました: ${e.message || e}`);
      } finally {
        setCsvImporting(false);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setCsvImporting(false);
      addCsvLog('ファイル読み込みに失敗しました');
      event.target.value = '';
    };
    reader.readAsText(file, csvEncoding);
  };

  const PrintGuideModal = () => {
    if (!isMounted || !printStudent || typeof document === 'undefined') return null;

    return createPortal(
      <div id="school-student-print-root" className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-200 print:static print:overflow-visible print:bg-white">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body > *:not(#school-student-print-root) { display: none !important; }
          }
          ${ACCOUNT_GUIDE_PRINT_CSS}
        ` }} />
        <div className="account-guide-print-hide sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-800">
            <Printer size={20} className="text-indigo-600" /> 案内書面プレビュー
          </h2>
          <div className="flex gap-3">
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2 text-sm font-black text-white hover:bg-indigo-700">
              <Printer size={18} /> 印刷する
            </button>
            <button onClick={() => setIsPrintModalOpen(false)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">
              <X size={18} /> 閉じる
            </button>
          </div>
        </div>
        <div className="flex min-w-max justify-center py-8 print:block print:min-w-0 print:p-0">
          <AccountGuideSheet account={printStudent} school={school || mySchool} loginUrl={qrBaseUrl || 'https://classbase-app.vercel.app'} />
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
    {isMaster && isPrintModalOpen && <PrintGuideModal />}
    <div className="space-y-6 print:hidden">
      <section className="rounded-[28px] bg-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-950">
              <GraduationCap size={24} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">School Students</p>
              <h1 className="text-2xl font-black">校舎別 生徒管理</h1>
              <div className="mt-2 inline-flex rounded-2xl bg-white/10 px-4 py-2 text-sm font-black text-indigo-100 ring-1 ring-white/10">
                現在ログイン中の校舎: {school || mySchool || '未設定'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadStudents} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black hover:bg-slate-700">
              <RefreshCw size={18} /> 更新
            </button>
            {isMaster && (
              <button onClick={toggleBetaMode} className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${betaMode ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                βテスト {betaMode ? 'ON' : 'OFF'}
              </button>
            )}
            {isMaster && (
              <>
                <CsvSampleDownload
                  filename="校舎別_生徒CSV追加例.csv"
                  headers={['生涯番号', '氏名', '学年', '所属教室', '中学校', '受講開始月', '兄弟姉妹グループ', '双子フラグ', '体験授業', '継続フラグ', '電話', '曜日', '理科', '社会', '保護者氏名', '保護者電話']}
                  rows={[
                    ['100001', '山田 太郎', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '理科体験授業', 'はい', '090-0000-0001', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
                    ['100002', '山田 花子', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '社会体験授業', '', '090-0000-0002', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
                  ]}
                  label="生徒CSV例"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                />
                <label className="relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300">
                  {csvImporting ? <Loader2 className="animate-spin" size={18} /> : <FileUp size={18} />} 生徒CSV追加
                  <input type="file" accept=".csv" onChange={handleCsvImport} disabled={csvImporting} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-indigo-50">
                  <UserPlus size={18} /> 新規生徒登録
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[28px] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">中学校絞り込み / 一括欠席</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <select value={middleSchoolFilter} onChange={e => setMiddleSchoolFilter(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
              <option value="">中学校を選択</option>
              {middleSchools.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <input type="date" value={bulkAbsenceDate} onChange={e => setBulkAbsenceDate(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
            <button onClick={registerBulkAbsence} disabled={!middleSchoolFilter} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white hover:bg-rose-700 disabled:bg-slate-300">
              一括欠席登録
            </button>
          </div>
          <p className="mt-3 text-xs font-bold text-slate-400">現在の絞り込み対象: {middleSchoolFilter || '未選択'} / {filtered.length}名</p>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">テスト対策登録＆連絡</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input value={testPrepForm.title} onChange={e => setTestPrepForm(prev => ({ ...prev, title: e.target.value }))} placeholder="例: 期末テスト対策" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
            <select value={testPrepForm.middle_school} onChange={e => setTestPrepForm(prev => ({ ...prev, middle_school: e.target.value }))} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
              <option value="">対象中学校</option>
              {middleSchools.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <input type="date" value={testPrepForm.event_date} onChange={e => setTestPrepForm(prev => ({ ...prev, event_date: e.target.value }))} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
            <button onClick={createTestPrepEvent} className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700">登録して通知</button>
          </div>
          <textarea value={testPrepForm.description} onChange={e => setTestPrepForm(prev => ({ ...prev, description: e.target.value }))} placeholder="補足内容" className="mt-3 min-h-[72px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
        </div>
      </section>

      {isMaster && <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">CSV一括追加</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">`生涯番号`、`氏名`または`氏`・`名`、`学年`、`所属教室`などの列を自動判定します。保護者IDは「生徒ID + P」で作成します。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CsvSampleDownload
              filename="校舎別_生徒CSV追加例.csv"
              headers={['生涯番号', '氏名', '学年', '所属教室', '中学校', '受講開始月', '兄弟姉妹グループ', '双子フラグ', '体験授業', '継続フラグ', '電話', '曜日', '理科', '社会', '保護者氏名', '保護者電話']}
              rows={[
                ['100001', '山田 太郎', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '理科体験授業', 'はい', '090-0000-0001', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
                ['100002', '山田 花子', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '社会体験授業', '', '090-0000-0002', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
              ]}
              label="登録CSV例"
            />
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3">
              <span className="text-xs font-black text-slate-500">文字コード</span>
              <select value={csvEncoding} onChange={e => setCsvEncoding(e.target.value)} className="bg-transparent text-sm font-black text-amber-700 outline-none">
                <option value="Shift_JIS">Shift_JIS</option>
                <option value="UTF-8">UTF-8</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-slate-950 p-4 font-mono text-xs text-emerald-300">
          {csvLog.length === 0 ? '> CSV追加の結果がここに表示されます' : csvLog.map((line, index) => <div key={index}>{line}</div>)}
        </div>
        {printStudent && (
          <div className="mt-3 flex justify-end">
            <button onClick={() => void printGuide(printStudent)} disabled={printingId === printStudent.id} className="rounded-2xl border border-indigo-100 px-4 py-3 text-xs font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
              {printingId === printStudent.id ? <Loader2 size={14} className="inline animate-spin" /> : <Printer size={14} className="inline" />} 最後に作成した案内書面を印刷
            </button>
          </div>
        )}
      </section>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setStatus('all')} className={`rounded-2xl border bg-white p-4 text-left shadow-sm ${status === 'all' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-white'}`}>
          <p className="text-xs font-black text-slate-400">全件</p>
          <p className="mt-1 text-3xl font-black text-slate-900">{students.length}</p>
        </button>
        {STATUSES.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} onClick={() => setStatus(item.id)} className={`rounded-2xl border p-4 text-left shadow-sm ${item.className} ${status === item.id ? 'ring-2 ring-indigo-100' : ''}`}>
              <Icon className="mb-2" size={20} />
              <p className="text-xs font-black">{item.label}</p>
              <p className="mt-1 text-2xl font-black">{counts[item.id] || 0}</p>
            </button>
          );
        })}
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前・学年・IDで検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
          <p className="text-xs font-black text-slate-400">{filtered.length}件表示</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-12 text-center text-sm font-bold text-slate-400">表示できる生徒がいません</div>
        ) : (
          <div className="overflow-x-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1720px] whitespace-nowrap text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-black text-slate-400">
                  <th className="px-4 py-3">生徒</th>
                  <th className="px-4 py-3">初期ID</th>
                  <th className="px-4 py-3">学年</th>
                  <th className="px-4 py-3">所属</th>
                  <th className="px-4 py-3">曜日</th>
                  <th className="px-4 py-3">科目</th>
                  <th className="px-4 py-3">受講講座</th>
                  <th className="px-4 py-3">初回ログイン</th>
                  <th className="px-4 py-3">最終ログイン</th>
                  <th className="px-4 py-3">個別設定</th>
                  <th className="px-4 py-3">体験/連携</th>
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(student => (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-800">{student.student_name || '名称未設定'}</p>
                      <p className="text-xs font-bold text-slate-400">{student.school_id || school}</p>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-bold text-slate-500">{student.lifetime_id || '-'}</td>
                    <td className="px-4 py-4 font-bold text-slate-600">{student.grade || '-'}</td>
                    <td className="px-4 py-4 text-xs font-bold text-slate-500">
                      <p>中学: {student.middle_school || '-'}</p>
                      <p>開始: {student.course_start_month || '-'}</p>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-600">{student.day_of_week || '-'}</td>
                    <td className="px-4 py-4 text-xs font-bold text-slate-500">
                      理: {student.subject_science || '-'} / 社: {student.subject_social || '-'}
                    </td>
                    <td className="px-4 py-4">
                      <CourseSummaryCell student={student} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        <FirstLoginBadge label="生徒" value={student.isFirstLogin} />
                        <FirstLoginBadge label="保護者" value={student.parent_isFirstLogin} />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <LastLoginCell value={student.last_login_at || student.last_login} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-[11px] font-black text-slate-500">
                          <input type="checkbox" checked={Boolean(student.camera_off_requested)} onChange={e => updateStudentOptions(student, 'camera_off_requested', e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                          <CameraOff size={13} /> カメラオフ希望
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-black text-slate-500">
                          <input type="checkbox" checked={Boolean(student.absence_call_not_required)} onChange={e => updateStudentOptions(student, 'absence_call_not_required', e.target.checked)} className="h-4 w-4 accent-rose-600" />
                          <PhoneOff size={13} /> 欠席電話不要
                        </label>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2 text-[11px] font-black text-slate-500">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={Boolean(student.trial_continued)} onChange={e => updateStudentPatch(student, { trial_continued: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                          継続通塾
                        </label>
                        <p>体験: {Array.isArray(student.trial_event_ids) && student.trial_event_ids.length > 0 ? student.trial_event_ids.join(' / ') : '-'}</p>
                        <button onClick={() => editRelations(student)} className="w-fit rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-50">
                          兄弟姉妹編集
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{STATUSES.find(s => s.id === student.account_status)?.label || student.account_status}</span>
                      {student.enrollment_cancel_month && (
                        <p className="mt-2 text-[11px] font-bold text-rose-500">{student.enrollment_cancel_month}解除</p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {isMaster && (
                          <button onClick={() => void printGuide(student)} disabled={printingId === student.id} className="shrink-0 rounded-xl border border-indigo-100 px-3 py-2 text-[11px] font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                            {printingId === student.id ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} className="inline" />} 案内書面
                          </button>
                        )}
                        <button onClick={() => openCourseRegistrationModal(student)} className="shrink-0 rounded-xl border border-emerald-100 px-3 py-2 text-[11px] font-black text-emerald-600 hover:bg-emerald-50">
                          <BookOpen size={13} className="inline" /> 講座登録
                        </button>
                        <button onClick={() => transferStudent(student)} className="shrink-0 rounded-xl border border-sky-100 px-3 py-2 text-[11px] font-black text-sky-600 hover:bg-sky-50">
                          移籍
                        </button>
                        <button onClick={() => withdrawStudent(student)} className="shrink-0 rounded-xl border border-rose-100 px-3 py-2 text-[11px] font-black text-rose-600 hover:bg-rose-50">
                          受講解除
                        </button>
                        <select
                          aria-label={`${student.student_name || '生徒'}のアカウント状態`}
                          value={student.account_status || 'active'}
                          onChange={e => updateStatus(student, e.target.value)}
                          disabled={savingId === student.id}
                          className="min-w-[104px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 outline-none disabled:cursor-wait disabled:opacity-50"
                        >
                          {STATUSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {courseModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-[28px] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">Course Registration</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">受講講座の手動登録</h2>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  {courseModalStudent.student_name || '名称未設定'} / {courseModalStudent.grade || '学年未設定'}
                  <span className="ml-2 text-slate-300">複数曜日・1科目のみの登録にも対応しています</span>
                </p>
              </div>
              <button onClick={() => setCourseModalStudent(null)} className="rounded-xl bg-slate-100 p-2 text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 border-b border-slate-100 bg-slate-50 p-5 lg:grid-cols-[160px_1fr_auto] lg:items-end">
              <label>
                <span className="mb-2 block text-xs font-black text-slate-500">年度</span>
                <select value={courseYear} onChange={e => setCourseYear(Number(e.target.value))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none">
                  {courseYearChoices.map(year => <option key={year} value={year}>{year}年度</option>)}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-black text-slate-500">期</span>
                <select value={courseTerm} onChange={e => setCourseTerm(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none">
                  {courseTermChoices.length === 0 && <option value="">期未設定</option>}
                  {courseTerm && !courseTermChoices.includes(courseTerm) && <option value={courseTerm}>{optionTermLabel(courseTerm, courseOptions)}</option>}
                  {courseTermChoices.map(term => <option key={term} value={term}>{optionTermLabel(term, courseOptions)}</option>)}
                </select>
              </label>
              <div className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-indigo-700 ring-1 ring-indigo-100">
                選択中 {visibleSelectedIds.length}件
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {courseLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="animate-spin text-emerald-500" />
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-5">
                    <section className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-black text-emerald-600">Step 1</p>
                          <h3 className="text-base font-black text-slate-900">受講したい単元・科目を選択</h3>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            選んだ単元・科目に対応する開講曜日だけを次に表示します。
                          </p>
                        </div>
                        <span className="w-fit rounded-full bg-white px-3 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
                          {courseSelectedKeys.length}件選択中
                        </span>
                      </div>

                      {courseChoices.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-emerald-100 bg-white/80 p-6 text-center text-sm font-black text-slate-400">
                          この学年・期で登録できる講座がありません
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {courseChoices.map(choice => {
                            const active = courseSelectedKeys.includes(choice.key);
                            const option = choice.option;
                            const units = Array.from(choice.units);
                            const daySlots = Array.from(choice.daySlots);
                            return (
                              <button
                                key={choice.key}
                                type="button"
                                onClick={() => toggleCourseKey(choice.key)}
                                className={`rounded-2xl border-2 p-4 text-left transition ${
                                  active
                                    ? 'border-emerald-500 bg-white text-emerald-800 shadow-sm'
                                    : 'border-white bg-white/85 text-slate-700 hover:border-emerald-200'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-black">{courseFullDisplayName(option)}</p>
                                    <p className="mt-1 text-[11px] font-bold text-slate-400">
                                      {daySlots.slice(0, 4).join(' / ') || '曜日・時間未設定'}
                                      {daySlots.length > 4 ? ` ほか${daySlots.length - 4}件` : ''}
                                    </p>
                                    {units.length > 0 && (
                                      <p className="mt-1 line-clamp-2 text-[11px] font-bold text-emerald-600">
                                        単元: {units.slice(0, 3).join(' / ')}{units.length > 3 ? ` ほか${units.length - 3}件` : ''}
                                      </p>
                                    )}
                                  </div>
                                  {active && <CheckCircle2 size={18} className="shrink-0 text-emerald-600" strokeWidth={3} />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    <section className="rounded-3xl border border-slate-100 bg-white p-4">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-black text-slate-500">Step 2</p>
                          <h3 className="text-base font-black text-slate-900">開講曜日・時間を選択</h3>
                          <p className="mt-1 text-xs font-bold text-slate-400">
                            別曜日は複数登録できます。同じ曜日・同じ時限は1つだけ登録されます。
                          </p>
                        </div>
                        <span className="w-fit rounded-2xl bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700">
                          {stepSelectedIds.length}件選択中
                        </span>
                      </div>
                      {courseSelectedKeys.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm font-black text-slate-400">
                          先に受講したい単元・科目を選択してください
                        </div>
                      ) : (
                        <CourseRegistrationCalendar
                          options={stepCourseOptions}
                          selectedIds={stepSelectedIds}
                          onToggle={toggleCourse}
                          onToggleGroup={toggleCourseGroup}
                          compact
                          showMeta
                          emptyMessage="選択した単元・科目に開講曜日がありません"
                        />
                      )}
                    </section>
                  </div>

                  <aside className="rounded-3xl border border-indigo-100 bg-indigo-50 p-4 lg:sticky lg:top-4 lg:self-start">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-indigo-900">保存される講座</p>
                        <p className="mt-1 text-xs font-bold text-indigo-500">{optionTermLabel(courseTerm, courseOptions)}の選択内容</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-indigo-700">{visibleSelectedIds.length}件</span>
                    </div>
                    <div className="mt-4 max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                      {selectedVisibleGroups.length > 0 ? selectedVisibleGroups.map((group: any) => {
                        const option = group.option;
                        return (
                          <div key={`${option.id}_${getCourseDay(option)}_${getCourseSlot(option)}`} className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-indigo-100">
                            <p className="text-sm font-black text-indigo-800">
                              {courseDisplayName(option)}
                            </p>
                            <p className="mt-1 text-xs font-bold text-indigo-500">
                              {[getCourseDay(option) && `${getCourseDay(option)}曜`, getCourseSlot(option), group.units.length ? `${group.units.length}単元` : ''].filter(Boolean).join(' / ')}
                            </p>
                            {group.units.length > 0 && (
                              <p className="mt-1 line-clamp-2 text-[11px] font-bold text-indigo-400">
                                {group.units.slice(0, 4).join(' / ')}{group.units.length > 4 ? ` ほか${group.units.length - 4}件` : ''}
                              </p>
                            )}
                          </div>
                        );
                      }) : (
                        <div className="rounded-2xl border-2 border-dashed border-indigo-100 bg-white/70 px-4 py-6 text-center text-xs font-black text-indigo-300">
                          まだ講座が選択されていません
                        </div>
                      )}
                    </div>
                  </aside>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-400">
                保存するとこの生徒の現在の受講講座として即時反映されます。過去の登録履歴は残ります。
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setCourseModalStudent(null)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-500 hover:bg-slate-200">
                  キャンセル
                </button>
                <button onClick={saveCourseRegistration} disabled={courseSaving || courseLoading || visibleSelectedIds.length === 0} className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-slate-300">
                  {courseSaving ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  登録する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h2 className="text-lg font-black text-slate-900">新規生徒登録</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="氏名" value={form.display_name} onChange={value => setForm(prev => ({ ...prev, display_name: value }))} />
              <Field label="初期ID" value={form.login_id} onChange={value => setForm(prev => ({ ...prev, login_id: value }))} />
              <Field label="初期パスワード（空欄なら自動発行）" value={form.password} onChange={value => setForm(prev => ({ ...prev, password: value }))} />
              <Field label="電話番号" value={form.phone_number} onChange={value => setForm(prev => ({ ...prev, phone_number: value }))} />
              <Field label="教室/クラス" value={form.classroom} onChange={value => setForm(prev => ({ ...prev, classroom: value }))} />
              <Field label="中学校名" value={form.middle_school} onChange={value => setForm(prev => ({ ...prev, middle_school: value }))} />
              <MonthField label="受講開始月" value={form.course_start_month} onChange={value => setForm(prev => ({ ...prev, course_start_month: value }))} />
              <SelectField label="学年" value={form.grade} options={['中1', '中2', '中3']} onChange={value => setForm(prev => ({ ...prev, grade: value }))} />
              <SelectField label="曜日" value={form.day_of_week} options={['', '月', '火', '水', '木', '金', '土']} onChange={value => setForm(prev => ({ ...prev, day_of_week: value }))} />
              <SelectField label="理科" value={form.subject_science} options={['', '物理', '化学', '生物', '地学']} onChange={value => setForm(prev => ({ ...prev, subject_science: value }))} />
              <SelectField label="社会" value={form.subject_social} options={['', '地理', '歴史', '公民']} onChange={value => setForm(prev => ({ ...prev, subject_social: value }))} />
              <Field label="兄弟姉妹UID（カンマ区切り）" value={form.sibling_ids} onChange={value => setForm(prev => ({ ...prev, sibling_ids: value }))} />
              <Field label="双子UID（カンマ区切り）" value={form.twin_sibling_ids} onChange={value => setForm(prev => ({ ...prev, twin_sibling_ids: value }))} />
              <div className="rounded-2xl bg-slate-50 px-4 py-3 md:col-span-2">
                <p className="mb-3 text-xs font-black text-slate-500">体験授業/イベント</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {TRIAL_EVENT_OPTIONS.map(option => (
                    <label key={option} className="flex items-center gap-3 text-sm font-black text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.trial_event_ids.includes(option)}
                        onChange={e => setForm(prev => ({
                          ...prev,
                          trial_event_ids: e.target.checked
                            ? [...prev.trial_event_ids, option]
                            : prev.trial_event_ids.filter(item => item !== option),
                        }))}
                        className="h-5 w-5 accent-indigo-600"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.trial_continued} onChange={e => setForm(prev => ({ ...prev, trial_continued: e.target.checked }))} className="h-5 w-5 accent-emerald-600" />
                継続通塾
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.camera_off_requested} onChange={e => setForm(prev => ({ ...prev, camera_off_requested: e.target.checked }))} className="h-5 w-5 accent-indigo-600" />
                カメラオフ希望
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.absence_call_not_required} onChange={e => setForm(prev => ({ ...prev, absence_call_not_required: e.target.checked }))} className="h-5 w-5 accent-rose-600" />
                欠席電話不要
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5">
              <button onClick={() => setModalOpen(false)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-500 hover:bg-slate-200">キャンセル</button>
              <button onClick={createStudent} disabled={saving} className="flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />} 登録する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}

function MonthField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <input type="month" value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
        {options.map(option => <option key={option || 'none'} value={option}>{option || '未設定'}</option>)}
      </select>
    </label>
  );
}

function FirstLoginBadge({ label, value }: { label: string; value: unknown }) {
  const completed = value === false;
  return (
    <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-black ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {label}: {completed ? '済' : '未'}
    </span>
  );
}

function CourseSummaryCell({ student }: { student: any }) {
  const labels: string[] = Array.isArray(student.selected_course_labels)
    ? student.selected_course_labels.map((label: any) => String(label || '').trim()).filter(Boolean)
    : [];
  const ids: string[] = Array.isArray(student.selected_course_ids)
    ? student.selected_course_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];
  const visibleLabels = labels.slice(0, 3);
  const term = String(student.course_registration_term_label || student.course_registration_term || '').trim();
  const year = student.course_registration_year ? `${student.course_registration_year}年度` : '';

  if (labels.length === 0 && ids.length === 0) {
    return (
      <div className="w-[260px] rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-400">
        未登録
      </div>
    );
  }

  return (
    <div className="w-[280px] space-y-1.5">
      <div className="flex items-center gap-1.5">
        {visibleLabels.length > 0 ? (
          <>
            <span className="max-w-[210px] truncate rounded-xl bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100" title={labels.join(' / ')}>
              {visibleLabels[0]}
            </span>
            {labels.length > 1 && (
              <span className="shrink-0 rounded-xl bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500" title={labels.slice(1).join(' / ')}>
                +{labels.length - 1}件
              </span>
            )}
          </>
        ) : (
          <span className="rounded-xl bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">
            登録済み {ids.length}件
          </span>
        )}
      </div>
      {(year || term) && (
        <p className="text-[10px] font-black text-slate-400">{[year, term].filter(Boolean).join(' / ')}</p>
      )}
    </div>
  );
}
