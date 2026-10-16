'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import {
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  CameraOff,
  FileUp,
  Download,
  GraduationCap,
  History,
  CalendarDays,
  LayoutList,
  Loader2,
  MessageSquareText,
  LockKeyhole,
  PauseCircle,
  PhoneOff,
  Plus,
  Pencil,
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
import AccountGuidePrintView from '@/app/components/account-guides/AccountGuidePrintView';
import { toGuideAccount } from '@/app/components/account-guides/guide-model';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { describeSyncErrors, syncPrintedPasswords, type PrintedPasswordSkip } from '@/lib/client-printed-password-sync';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { courseOptionMatchesSelection, getCourseOptionCourseKey, getCourseOptionScheduleKey, getCourseOptionStableKey, hasCourseOptionSelection, removeCourseOptionSelections, resolveSelectedCourseOptionIds, summarizeSelectedCourseLabels } from '@/lib/course-registration-selection';
import { buildSchoolCourseRegistrationCsv } from '@/lib/school-course-registration-export';
import { hasAdminAppPermission, isConfigurableAdminRole } from '@/lib/admin-app-permissions';

const STATUSES = [
  { id: 'active', label: '有効', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'suspended', label: '一時停止', icon: PauseCircle, className: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'withdrawn', label: '解除', icon: XCircle, className: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'archived', label: '保管', icon: LockKeyhole, className: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const TRIAL_EVENT_OPTIONS = ['理科体験授業', '社会体験授業', '定期テスト対策体験', '保護者説明会'];
const STUDENT_CSV_HEADERS = ['生涯番号', '氏名', '学年', '所属教室', '中学校', '受講開始月', '兄弟姉妹グループ', '双子フラグ', '体験授業', '継続フラグ', '電話', '曜日', '理科', '社会', '保護者氏名', '保護者電話'];
const STUDENT_CSV_SAMPLE_ROWS = [
  ['100001', '山田 太郎', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '理科体験授業', 'はい', '090-0000-0001', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
  ['100002', '山田 花子', '中1', '本山', '本山中学校', '2026-04', 'YAMADA', '○', '社会体験授業', '', '090-0000-0002', '月', '物理', '地理', '山田 保護者', '078-000-0001'],
];

interface SchoolAccountImportBatch {
  id: string;
  file_name: string;
  user_ids: string[];
  success_count: number;
  error_count: number;
  imported_at: string;
  school: string;
}

const currentMonthValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const initialForm = {
  display_name: '',
  student_name_kana: '',
  login_id: '',
  password: '',
  grade: '中1',
  classroom: '',
  middle_school: '',
  course_start_month: currentMonthValue(),
  sibling_ids: '',
  twin_sibling_ids: '',
  trial_event_ids: [] as string[],
  trial_continued: false,
  member_type: 'enrolled',
  summer_course_status: 'none',
  summer_only: false,
  day_of_week: '',
  subject_science: '',
  subject_social: '',
  phone_number: '',
  camera_off_requested: false,
  absence_call_not_required: false,
};

const WITHDRAWAL_REASONS = [
  { id: 'withdrawal', label: '退学' },
  { id: 'individual_transfer', label: '個別移籍' },
  { id: 'dekitas_transfer', label: 'デキタス移籍' },
  { id: 'course_reduction', label: '5教科→3教科' },
  { id: 'other', label: 'その他' },
];
const CHANGE_REASONS = ['コベカツ', 'クラブチーム', '習い事', '経済的理由', '進路変更', 'その他'];
const SESSION_EXPIRED_MESSAGE = 'ログイン情報が失効しています。再度ログインしてください。';
const isExpiredSessionError = (error: unknown) => {
  const code = String((error as any)?.code || '');
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || error || '').toLowerCase();
  return status === 401 || ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-token-expired', 'auth/user-disabled', 'reauth-required'].includes(code) ||
    message.includes('token has been revoked') || message.includes('ログイン情報が失効');
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
const timeKey = getCourseOptionScheduleKey;
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
  const { profile, logout } = useAuth();
  const sessionRecoveryStartedRef = useRef(false);
  const [students, setStudents] = useState<any[]>([]);
  const [school, setSchool] = useState('');
  const [schoolOptions, setSchoolOptions] = useState<string[]>([]);
  const [status, setStatus] = useState('all');
  const [activeView, setActiveView] = useState<'students' | 'attendance' | 'courses'>('students');
  const [showAllAttendance, setShowAllAttendance] = useState(false);
  const attendanceHistoryRef = useRef(false);
  const studentRequestIdRef = useRef(0);
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
  const [printStudents, setPrintStudents] = useState<any[]>([]);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [qrBaseUrl, setQrBaseUrl] = useState('');
  const [printRequest, setPrintRequest] = useState<{ targets: any[]; skipped: PrintedPasswordSkip[] } | null>(null);
  const [printSyncProgress, setPrintSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [csvEncoding, setCsvEncoding] = useState('Shift_JIS');
  const [csvDefaultStartMonth, setCsvDefaultStartMonth] = useState(currentMonthValue());
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvLog, setCsvLog] = useState<string[]>([]);
  const [csvImportBatches, setCsvImportBatches] = useState<SchoolAccountImportBatch[]>([]);
  const [selectedCsvImportBatchId, setSelectedCsvImportBatchId] = useState('');
  const [csvHistoryLoading, setCsvHistoryLoading] = useState(false);
  const [courseModalStudent, setCourseModalStudent] = useState<any | null>(null);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseSaving, setCourseSaving] = useState(false);
  const [courseSelectedIds, setCourseSelectedIds] = useState<string[]>([]);
  const [courseSelectedKeys, setCourseSelectedKeys] = useState<string[]>([]);
  const [courseYear, setCourseYear] = useState(currentCourseYear());
  const [courseTerm, setCourseTerm] = useState('');
  const [courseOptionCache, setCourseOptionCache] = useState<Record<string, any[]>>({});
  const [editStudent, setEditStudent] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ ...initialForm });
  const [withdrawalStudent, setWithdrawalStudent] = useState<any | null>(null);
  const [withdrawalForm, setWithdrawalForm] = useState({
    month: currentMonthValue(), reasonCode: 'withdrawal', changeReasons: [] as string[], note: '',
  });

  const mySchool = useMemo(() => {
    const ids = Array.isArray(profile?.school_ids) ? profile?.school_ids : [];
    return ids[0] || profile?.school_id || profile?.school || '';
  }, [profile]);

  const filtered = useMemo(() => {
    const selectedBatch = csvImportBatches.find(batch => batch.id === selectedCsvImportBatchId);
    const importedIds = selectedBatch ? new Set(selectedBatch.user_ids) : null;
    return students.filter(student => {
      const statusValue = student.account_status || 'active';
      const haystack = `${student.student_name || ''} ${student.student_name_kana || ''} ${student.grade || ''} ${student.classroom || ''} ${student.lifetime_id || ''}`.toLowerCase();
      if (status !== 'all' && statusValue !== status) return false;
      if (middleSchoolFilter && student.middle_school !== middleSchoolFilter) return false;
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (importedIds && !importedIds.has(student.id)) return false;
      return true;
    });
  }, [students, status, search, middleSchoolFilter, csvImportBatches, selectedCsvImportBatchId]);

  const selectedCsvImportBatch = csvImportBatches.find(batch => batch.id === selectedCsvImportBatchId) || null;

  const middleSchools = useMemo(() => Array.from(new Set(students.map(student => String(student.middle_school || '').trim()).filter(Boolean))).sort(), [students]);
  const isMaster = profile?.role === 'master';
  const canManageStudents = Boolean(profile && (
    profile.role === 'master' ||
    (isConfigurableAdminRole(profile.role) && hasAdminAppPermission(profile.role, profile, 'science_social'))
  ));
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

  const loadStudents = useCallback(async (requestedSchool = '') => {
    const requestId = ++studentRequestIdRef.current;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const selectedSchool = String(requestedSchool).trim();
      const params = new URLSearchParams({ include_pf: 'false' });
      if (selectedSchool) params.set('school', selectedSchool);
      if (attendanceHistoryRef.current) params.set('attendance_history', 'all');
      const res = await fetch(`/api/admin/school-students?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'failed'), { code: data.code || '', status: res.status });
      if (requestId !== studentRequestIdRef.current) return;
      setSchool(data.school || mySchool || '');
      setSchoolOptions(Array.isArray(data.schools) ? data.schools.map(String).filter(Boolean) : []);
      setStudents(data.students || []);
    } catch (e: any) {
      if (isExpiredSessionError(e)) {
        if (!sessionRecoveryStartedRef.current) {
          sessionRecoveryStartedRef.current = true;
          alert(SESSION_EXPIRED_MESSAGE);
          await logout();
        }
        return;
      }
      if (requestId === studentRequestIdRef.current) alert(`生徒一覧の取得に失敗しました: ${e.message || e}`);
    } finally {
      if (requestId === studentRequestIdRef.current) setLoading(false);
    }
  }, [logout, mySchool]);

  const loadCsvImportBatches = useCallback(async (targetSchool: string) => {
    if (!targetSchool) {
      setCsvImportBatches([]);
      return;
    }
    setCsvHistoryLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const params = new URLSearchParams({ school: targetSchool, source: 'school_students' });
      const response = await fetch(`/api/admin/account-import-batches?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '取込履歴を取得できませんでした');
      setCsvImportBatches(Array.isArray(result.batches) ? result.batches : []);
      setSelectedCsvImportBatchId(current => result.batches?.some((batch: SchoolAccountImportBatch) => batch.id === current) ? current : '');
    } catch (error) {
      console.error('School account import history fetch failed:', error);
      setCsvImportBatches([]);
    } finally {
      setCsvHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile) loadStudents(mySchool);
  }, [loadStudents, mySchool, profile]);

  useEffect(() => {
    if (canManageStudents && school) void loadCsvImportBatches(school);
  }, [canManageStudents, loadCsvImportBatches, school]);

  const exportCourseStatusCsv = useCallback(() => {
    const csv = buildSchoolCourseRegistrationCsv(filtered, school);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    const todayJst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    anchor.download = `${String(school || '校舎').replace(/[\\/:*?"<>|]/g, '_')}_受講講座状況_${todayJst}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [filtered, school]);

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
          getToken: forceRefresh => currentUser.getIdToken(forceRefresh),
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
      const scopedOptions = gradeOptions
        .filter((option: any) => (!option.year || Number(option.year) === nextYear) && (!nextTerm || optionTermKey(option) === nextTerm))
      const resolvedInitialIds = resolveSelectedCourseOptionIds(scopedOptions, initialSelectedIds);
      const initialKeys = Array.from(new Set(scopedOptions
        .filter((option: any) => courseOptionMatchesSelection(option, initialSelectedIds))
        .map(courseKey)));

      setCourseSelectedIds(resolvedInitialIds.length > 0 ? resolvedInitialIds : initialSelectedIds);
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
        const targetOptions = visibleCourseOptions.filter((option: any) => targetIds.has(option.id));
        setCourseSelectedIds(current => removeCourseOptionSelections(current, targetOptions));
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
      const targetOptions = visibleCourseOptions.filter((option: any) => cleanIds.includes(option.id));
      const hasSelected = hasCourseOptionSelection(current, targetOptions);
      if (hasSelected) {
        return removeCourseOptionSelections(prev, targetOptions);
      } else {
        const conflictKeys = new Set(targetOptions.map(timeKey));
        const duplicateCourseKeys = new Set(targetOptions.map(getCourseOptionCourseKey));
        visibleCourseOptions
          .filter((option: any) => conflictKeys.has(timeKey(option)) || duplicateCourseKeys.has(getCourseOptionCourseKey(option)))
          .forEach((option: any) => current.delete(option.id));
        cleanIds.forEach(id => current.add(id));
      }
      return Array.from(new Set([...outsideVisible, ...Array.from(current)]));
    });
  };

  const saveCourseRegistration = async () => {
    if (!courseModalStudent) return;
    if (visibleSelectedIds.length === 0 && !confirm('登録済みの講座をすべて解除します。よろしいですか？')) return;
    setCourseSaving(true);
    try {
      const selectedCourseLabels = selectedVisibleGroups.map(formatCourseGroupLabel);
      const summaryLabels = summarizeSelectedCourseLabels(selectedCourseLabels);
      const selectedCourseKeys = visibleCourseOptions
        .filter((option: any) => visibleSelectedIds.includes(option.id))
        .map(getCourseOptionStableKey)
        .filter(Boolean);
      const registrationTokens = visibleCourseOptions
        .filter((option: any) => visibleSelectedIds.includes(option.id))
        .map((option: any) => String(option.registration_token || ''));
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
          selected_course_keys: selectedCourseKeys,
          registration_tokens: registrationTokens,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setStudents(prev => prev.map(student => student.id === courseModalStudent.id ? {
        ...student,
        selected_course_ids: data.selected_course_ids || visibleSelectedIds,
        selected_course_labels: summaryLabels,
        current_course_label: summaryLabels.join(' / '),
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
    if (!form.course_start_month) return alert('利用開始月を選択してください');
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
        role: 'student',
        student_name: form.display_name,
        student_name_kana: form.student_name_kana,
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
        member_type: form.member_type,
        summer_course_status: form.summer_course_status,
        summer_only: form.summer_only,
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
      await loadStudents(school);
      setPrintStudent(createdStudent);
      setPrintStudents([createdStudent]);
      setIsPrintModalOpen(true);
      alert(data.updated ? '生徒アカウントを更新し、案内書面を作成しました' : '生徒アカウントを作成し、案内書面を作成しました');
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
      await loadStudents(school);
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
      await loadStudents(school);
    } catch (e: any) {
      alert(`移籍処理に失敗しました: ${e.message || e}`);
    }
  };

  const withdrawStudent = (student: any) => {
    setWithdrawalStudent(student);
    setWithdrawalForm({ month: currentMonthValue(), reasonCode: 'withdrawal', changeReasons: [], note: '' });
  };

  const saveWithdrawal = async () => {
    if (!withdrawalStudent) return;
    const reasonLabel = WITHDRAWAL_REASONS.find(item => item.id === withdrawalForm.reasonCode)?.label || 'その他';
    if (['individual_transfer', 'dekitas_transfer', 'course_reduction'].includes(withdrawalForm.reasonCode) && withdrawalForm.changeReasons.length === 0) {
      return alert('変更理由を1つ以上選択してください');
    }
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'withdraw', user_id: withdrawalStudent.id,
          enrollment_cancel_month: withdrawalForm.month,
          enrollment_cancel_reason: [reasonLabel, withdrawalForm.changeReasons.join('・'), withdrawalForm.note].filter(Boolean).join(' / '),
          enrollment_cancel_reason_code: withdrawalForm.reasonCode,
          enrollment_change_reasons: withdrawalForm.changeReasons,
          enrollment_cancel_note: withdrawalForm.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setWithdrawalStudent(null);
      await loadStudents(school);
    } catch (e: any) {
      alert(`受講解除に失敗しました: ${e.message || e}`);
    }
  };

  const restoreStudent = async (student: any) => {
    if (!confirm(`${student.student_name || student.id} を受講中へ復帰しますか？`)) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/lifecycle', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'restore', user_id: student.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      await loadStudents(school);
    } catch (e: any) {
      alert(`復帰処理に失敗しました: ${e.message || e}`);
    }
  };

  const openEditStudent = (student: any) => {
    setEditStudent(student);
    setEditForm({
      ...initialForm,
      display_name: student.student_name || '', student_name_kana: student.student_name_kana || '',
      grade: student.grade || '中1', classroom: student.classroom || '', middle_school: student.middle_school || '',
      course_start_month: student.course_start_month || currentMonthValue(), day_of_week: student.day_of_week || '',
      phone_number: student.phone_number || '', camera_off_requested: Boolean(student.camera_off_requested),
      absence_call_not_required: Boolean(student.absence_call_not_required), trial_continued: Boolean(student.trial_continued),
      trial_event_ids: Array.isArray(student.trial_event_ids) ? student.trial_event_ids : [],
      member_type: student.member_type || 'enrolled', summer_course_status: student.summer_course_status || 'none',
      summer_only: Boolean(student.summer_only), sibling_ids: (student.sibling_ids || []).join(','), twin_sibling_ids: (student.twin_sibling_ids || []).join(','),
    });
  };

  const saveStudentProfile = async () => {
    if (!editStudent || !editForm.display_name.trim()) return alert('氏名は必須です');
    setSavingId(editStudent.id);
    try {
      const patch = {
        student_name: editForm.display_name, student_name_kana: editForm.student_name_kana,
        grade: editForm.grade, classroom: editForm.classroom, middle_school: editForm.middle_school,
        course_start_month: editForm.course_start_month, day_of_week: editForm.day_of_week,
        phone_number: editForm.phone_number, camera_off_requested: editForm.camera_off_requested,
        absence_call_not_required: editForm.absence_call_not_required, trial_continued: editForm.trial_continued,
        trial_event_ids: editForm.trial_event_ids, member_type: editForm.member_type,
        summer_course_status: editForm.summer_course_status, summer_only: editForm.summer_only,
        sibling_ids: editForm.sibling_ids.split(',').map(value => value.trim()).filter(Boolean),
        twin_sibling_ids: editForm.twin_sibling_ids.split(',').map(value => value.trim()).filter(Boolean),
      };
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: editStudent.id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setEditStudent(null);
      await loadStudents(school);
    } catch (e: any) {
      alert(`生徒情報の更新に失敗しました: ${e.message || e}`);
    } finally {
      setSavingId('');
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
      await loadStudents(school);
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

  /**
   * 案内書面の印刷準備。生徒と保護者のパスワードを分割して同期し、ログイン済みの人は
   * パスワードを変えずに除外する（mode=reissue のときだけ再発行する）。
   */
  const preparePrintStudents = async (targets: any[], busyKey: string, mode: 'issue' | 'reissue' = 'issue') => {
    if (targets.length === 0) return alert('印刷する生徒がいません');
    setPrintingId(busyKey);
    try {
      const userIds = targets.flatMap(student => [student.id, student.parent_uid].filter(Boolean));
      const summary = await syncPrintedPasswords(userIds, { mode, onProgress: (done, total) => setPrintSyncProgress({ done, total }) });
      if (summary.errors.length > 0) {
        throw new Error(`書面とログイン情報を同期できないアカウントがあります。\n${describeSyncErrors(summary.errors)}`);
      }
      const skippedIds = new Set(summary.skipped.map(item => item.user_id));
      const prepared = targets.map(student => {
        const studentResult = summary.resultByUserId.get(student.id);
        const parentResult = student.parent_uid ? summary.resultByUserId.get(student.parent_uid) : undefined;
        return {
          ...student,
          id: studentResult?.user_id || student.id,
          uid: studentResult?.user_id || student.uid,
          email: studentResult?.email || student.email,
          initial_password: studentResult?.initial_password || student.initial_password,
          isFirstLogin: studentResult ? true : student.isFirstLogin,
          parent_uid: parentResult?.user_id || student.parent_uid,
          parent_initial_password: parentResult?.initial_password || '',
          parent_status: student.parent_uid && skippedIds.has(student.parent_uid) ? 'activated' : undefined,
          print_skipped: skippedIds.has(student.id),
        };
      });
      // 一覧の行も同期後のID・パスワードに更新する（prepared[i] は targets[i] に対応）。
      const changed = new Map(prepared.map((item, index) => [targets[index].id, item]));
      setStudents(current => current.map(item => {
        const next = changed.get(item.id);
        return next ? { ...next, print_skipped: undefined, parent_status: undefined } : item;
      }));
      const printable = prepared.filter(item => !item.print_skipped);
      setPrintRequest({ targets: prepared, skipped: summary.skipped });
      if (printable.length === 0) {
        if (confirm(`選んだ${targets.length}名は全員すでにログイン済みです。\n新しい初期パスワードを発行して書面を作成しますか？（本人が設定したパスワードは使えなくなります）`)) {
          await preparePrintStudents(prepared, busyKey, 'reissue');
        }
        return;
      }
      setPrintStudent(printable[0]);
      setPrintStudents(printable);
      setIsPrintModalOpen(true);
    } catch (error: any) {
      alert(`案内書面を作成できませんでした。\n${error?.message || error}`);
    } finally {
      setPrintingId('');
      setPrintSyncProgress(null);
    }
  };

  const printGuide = (student: any) => preparePrintStudents([student], student.id);

  const printSelectedCsvImportBatch = async () => {
    if (!selectedCsvImportBatch) return alert('CSV取込履歴を選択してください');
    if (filtered.length === 0) return alert('現在の絞り込みに該当する生徒がいません');
    await preparePrintStudents(filtered, 'csv-batch');
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
          body: JSON.stringify({
            csv_text: csvText,
            file_name: file.name,
            school_id: school,
            default_course_start_month: csvDefaultStartMonth,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
        addCsvLog(`完了: ${data.count || 0}件を登録しました`);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          addCsvLog(`注意: ${data.errors.length}件は登録できませんでした`);
          data.errors.slice(0, 3).forEach((item: any) => addCsvLog(`行${item.row}: ${item.error}`));
        }
        await loadStudents(school);
        await loadCsvImportBatches(school);
        if (data.import_batch_id) setSelectedCsvImportBatchId(String(data.import_batch_id));
        if (Array.isArray(data.students) && data.students.length > 0) {
          setPrintStudent(data.students[0]);
          setPrintStudents(data.students);
          setIsPrintModalOpen(true);
          addCsvLog(`案内書面: ${data.students.length}名分を作成しました`);
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

  const printSkipped = printRequest?.skipped || [];
  const printNotice = printSkipped.length > 0 ? (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        初回ログイン済みのため、パスワードを変えずに書面から外しました：生徒 {printSkipped.filter(item => item.role === 'student').length}名・保護者 {printSkipped.filter(item => item.role !== 'student').length}名
        <span className="ml-1 text-amber-700">（{printSkipped.slice(0, 4).map(item => item.display_name).join('、')}{printSkipped.length > 4 ? ' ほか' : ''}）</span>
      </p>
      <button
        onClick={() => {
          if (!printRequest || !confirm('ログイン済みの人に新しい初期パスワードを発行して、書面に含めますか？\n本人が設定したパスワードは使えなくなります。')) return;
          setIsPrintModalOpen(false);
          void preparePrintStudents(printRequest.targets, 'reissue', 'reissue');
        }}
        className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-black text-white hover:bg-amber-700"
      >
        パスワードを再発行して含める
      </button>
    </div>
  ) : null;

  return (
    <>
    {canManageStudents && isPrintModalOpen && isMounted && printStudents.length > 0 && (
      <AccountGuidePrintView
        accounts={printStudents.map(student => toGuideAccount(student, attendanceSchoolName(student.school_id || school || mySchool) || student.school_id || school || mySchool))}
        loginUrl={qrBaseUrl || 'https://classbase-app.vercel.app'}
        title={selectedCsvImportBatch?.file_name?.replace(/\.[^.]+$/, '') || `${attendanceSchoolName(school || mySchool) || school || mySchool || '校舎'} 案内書面`}
        notice={printNotice}
        onClose={() => { setIsPrintModalOpen(false); setPrintStudents([]); setPrintRequest(null); }}
      />
    )}
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
                現在表示中: {school || mySchool || '校舎未設定'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void loadStudents(school)} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black hover:bg-slate-700">
              <RefreshCw size={18} /> 更新
            </button>
            {isMaster && (
              <button onClick={toggleBetaMode} className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${betaMode ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                βテスト {betaMode ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        </div>
      </section>

      {!canManageStudents ? <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm font-bold text-sky-900">この画面は閲覧専用です。</div> : null}

      {canManageStudents && (
        <section className="grid gap-4 xl:grid-cols-[0.8fr_1.35fr_1fr]">
          <div className="rounded-[28px] border border-indigo-100 bg-indigo-50 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">STEP 1</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">対象校舎</h2>
            {schoolOptions.length > 1 ? (
              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-black text-slate-500">表示・登録する校舎</span>
                <select
                  value={school}
                  onChange={event => void loadStudents(event.target.value)}
                  disabled={loading}
                  className="w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
                >
                  {schoolOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            ) : (
              <div className="mt-4 rounded-2xl bg-white px-4 py-4 ring-1 ring-indigo-100">
                <p className="text-xs font-bold text-slate-400">表示校舎</p>
                <p className="mt-1 text-lg font-black text-indigo-700">{school || mySchool || '未設定'}</p>
              </div>
            )}
            <p className="mt-3 text-xs font-bold leading-5 text-slate-500">一覧表示・新規登録・CSV取込は、この校舎だけが対象です。</p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">STEP 2</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">生徒を簡単追加</h2>
                <p className="mt-1 text-xs font-bold text-slate-400">開始月まで選んで登録します。パスワードと保護者IDは自動発行し、案内書面も作成します。</p>
              </div>
              <UserPlus className="shrink-0 text-indigo-500" size={24} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input value={form.display_name} onChange={event => setForm(prev => ({ ...prev, display_name: event.target.value }))} placeholder="生徒氏名（必須）" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
              <input value={form.login_id} onChange={event => setForm(prev => ({ ...prev, login_id: event.target.value }))} placeholder="生涯番号／ログインID（必須）" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
              <select value={form.grade} onChange={event => setForm(prev => ({ ...prev, grade: event.target.value }))} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
                {['中1', '中2', '中3'].map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <input value={form.middle_school} onChange={event => setForm(prev => ({ ...prev, middle_school: event.target.value }))} placeholder="中学校名" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs font-black text-slate-500">何月スタート（利用開始月）</span>
                <input type="month" value={form.course_start_month} onChange={event => setForm(prev => ({ ...prev, course_start_month: event.target.value }))} className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-800 outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={createStudent} disabled={saving || !school} className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} この内容で登録
              </button>
              <button onClick={() => setModalOpen(true)} className="min-h-[44px] rounded-2xl border border-slate-200 px-4 text-xs font-black text-slate-600 hover:bg-slate-50">詳細も入力</button>
            </div>
          </div>

          <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600">STEP 3</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">CSVで一括追加</h2>
              </div>
              <FileUp className="shrink-0 text-emerald-600" size={24} />
            </div>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">見本をダウンロードして入力し、そのままアップロードしてください。</p>
            <div className="mt-4 flex flex-col gap-2">
              <label className="rounded-2xl bg-white px-4 py-3 ring-1 ring-emerald-100">
                <span className="mb-2 block text-xs font-black text-slate-500">CSVの既定開始月</span>
                <input type="month" value={csvDefaultStartMonth} onChange={event => setCsvDefaultStartMonth(event.target.value)} className="w-full bg-transparent text-sm font-black text-emerald-700 outline-none" />
                <span className="mt-1 block text-[10px] font-bold text-slate-400">CSVの「受講開始月」が空欄の行に適用します。</span>
              </label>
              <CsvSampleDownload filename="校舎別_生徒CSV追加例.csv" headers={STUDENT_CSV_HEADERS} rows={STUDENT_CSV_SAMPLE_ROWS} label="CSV見本をダウンロード" className="justify-center border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100" />
              <label className="relative flex min-h-[44px] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700">
                {csvImporting ? <Loader2 className="animate-spin" size={18} /> : <FileUp size={18} />} CSVを選んで追加
                <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} disabled={csvImporting || !school} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <label className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-xs font-black text-slate-500 ring-1 ring-emerald-100">
                文字コード
                <select value={csvEncoding} onChange={event => setCsvEncoding(event.target.value)} className="bg-transparent text-sm font-black text-emerald-700 outline-none">
                  <option value="Shift_JIS">Shift_JIS</option>
                  <option value="UTF-8">UTF-8</option>
                </select>
              </label>
              <div className="mt-2 rounded-2xl border border-emerald-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs font-black text-emerald-800"><History size={15} /> CSV取込履歴から再印刷</p>
                  <button type="button" onClick={() => void loadCsvImportBatches(school)} disabled={csvHistoryLoading} className="text-[10px] font-black text-emerald-700 disabled:opacity-50">{csvHistoryLoading ? '更新中' : '更新'}</button>
                </div>
                <select
                  value={selectedCsvImportBatchId}
                  onChange={event => {
                    setSelectedCsvImportBatchId(event.target.value);
                    setSearch('');
                    setStatus('all');
                    setMiddleSchoolFilter('');
                  }}
                  className="mt-2 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-slate-700 outline-none"
                >
                  <option value="">取込履歴を選択</option>
                  {csvImportBatches.map(batch => (
                    <option key={batch.id} value={batch.id}>
                      {batch.imported_at ? new Date(batch.imported_at).toLocaleString('ja-JP') : '日時不明'} ｜ {batch.file_name} ｜ {batch.success_count}名
                    </option>
                  ))}
                </select>
                {selectedCsvImportBatch && (
                  <div className="mt-2">
                    <p className="mb-2 text-[10px] font-bold text-slate-500">{filtered.length}名を表示中{selectedCsvImportBatch.error_count > 0 ? ` ／ ${selectedCsvImportBatch.error_count}件は取込失敗` : ''}</p>
                    <button type="button" onClick={() => void printSelectedCsvImportBatch()} disabled={printingId === 'csv-batch' || filtered.length === 0} className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                      {printingId === 'csv-batch' ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {printingId === 'csv-batch' && printSyncProgress ? `パスワード確認中 ${printSyncProgress.done}/${printSyncProgress.total}` : `この履歴の${filtered.length}名を一括印刷`}
                    </button>
                  </div>
                )}
                {csvImportBatches.length === 0 && !csvHistoryLoading && <p className="mt-2 text-[10px] font-bold leading-4 text-slate-400">履歴保存機能の追加後に取り込んだCSVが表示されます。</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {canManageStudents && <section className="grid gap-4 lg:grid-cols-2">
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

        {isMaster && <div className="rounded-[28px] bg-white p-5 shadow-sm">
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
        </div>}
      </section>}

      {canManageStudents && <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">CSV取込結果</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">登録結果と、修正が必要な行をここに表示します。</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-slate-950 p-4 font-mono text-xs text-emerald-300">
          {csvLog.length === 0 ? '> CSV追加の結果がここに表示されます' : csvLog.map((line, index) => <div key={index}>{line}</div>)}
        </div>
        {printStudent && (
          <div className="mt-3 flex justify-end">
            <button onClick={() => void printGuide(printStudent)} disabled={printingId === printStudent.id} className="rounded-2xl border border-indigo-100 px-4 py-3 text-xs font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
              {printingId === printStudent.id ? <Loader2 size={14} className="inline animate-spin" /> : <Printer size={14} className="inline" />} 最後に作成した案内書面を再表示
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
        <div className="mb-4 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1.5">
          {[
            { id: 'students', label: '受講者リスト', icon: LayoutList },
            { id: 'attendance', label: '出席状況（週1回）', icon: CalendarDays },
            { id: 'courses', label: '受講登録状況', icon: BookOpen },
          ].map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setActiveView(item.id as typeof activeView)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${activeView === item.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </div>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前・フリガナ・学年・IDで検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-black text-slate-400">{filtered.length}件表示</p>
            {activeView === 'courses' && <button onClick={exportCourseStatusCsv} disabled={loading || filtered.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-500 disabled:opacity-50"><Download size={16} /> 表示中の受講登録状況をCSV出力</button>}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-12 text-center text-sm font-bold text-slate-400">表示できる生徒がいません</div>
        ) : activeView === 'attendance' ? (
          <AttendanceOverview students={filtered} showAll={showAllAttendance} onHistoryChange={all => {
            attendanceHistoryRef.current = all;
            setShowAllAttendance(all);
            void loadStudents(school);
          }} onSaved={() => loadStudents(school)} />
        ) : activeView === 'courses' ? (
          <CourseRegistrationOverview students={filtered} />
        ) : (
          <div className="overflow-x-auto [scrollbar-gutter:stable]">
            <table className={`w-full ${canManageStudents ? 'min-w-[1720px]' : 'min-w-[1100px]'} whitespace-nowrap text-left text-sm`}>
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
                  {canManageStudents && <th className="px-4 py-3">個別設定</th>}
                  {canManageStudents && <th className="px-4 py-3">体験/連携</th>}
                  <th className="px-4 py-3">状態</th>
                  {canManageStudents && <th className="px-4 py-3 text-right">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(student => (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-800">{student.student_name || '名称未設定'}</p>
                      {student.student_name_kana && <p className="text-[11px] font-bold text-slate-400">{student.student_name_kana}</p>}
                      <p className="text-xs font-bold text-slate-400">{student.school_id || school}</p>
                      <div className="mt-1 flex gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{student.member_type === 'general' ? '一般' : '在籍'}</span>
                        {student.summer_course_status === 'attending' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">夏期受講</span>}
                        {student.summer_only && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">夏期のみ</span>}
                      </div>
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
                    {canManageStudents && <td className="px-4 py-4">
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
                    </td>}
                    {canManageStudents && <td className="px-4 py-4">
                      <div className="flex flex-col gap-2 text-[11px] font-black text-slate-500">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={Boolean(student.trial_continued)} onChange={e => updateStudentPatch(student, { trial_continued: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                          継続通塾
                        </label>
                        <p>体験: {Array.isArray(student.trial_event_ids) && student.trial_event_ids.length > 0 ? student.trial_event_ids.join(' / ') : '-'}</p>
                        {isMaster && <button onClick={() => editRelations(student)} className="w-fit rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-50">
                          兄弟姉妹編集
                        </button>}
                      </div>
                    </td>}
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{STATUSES.find(s => s.id === student.account_status)?.label || student.account_status}</span>
                      {student.account_status === 'withdrawn' && student.enrollment_cancel_month && (
                        <p className="mt-2 text-[11px] font-bold text-rose-500">{student.enrollment_cancel_month}解除</p>
                      )}
                    </td>
                    {canManageStudents && <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditStudent(student)} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-50">
                          <Pencil size={13} className="inline" /> 編集
                        </button>
                        <button onClick={() => void printGuide(student)} disabled={printingId === student.id} className="shrink-0 rounded-xl border border-indigo-100 px-3 py-2 text-[11px] font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                          {printingId === student.id ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} className="inline" />} 案内書面
                        </button>
                        <button onClick={() => openCourseRegistrationModal(student)} className="shrink-0 rounded-xl border border-emerald-100 px-3 py-2 text-[11px] font-black text-emerald-600 hover:bg-emerald-50">
                          <BookOpen size={13} className="inline" /> 講座登録
                        </button>
                        {isMaster && <button onClick={() => transferStudent(student)} className="shrink-0 rounded-xl border border-sky-100 px-3 py-2 text-[11px] font-black text-sky-600 hover:bg-sky-50">
                          移籍
                        </button>}
                        {student.account_status === 'withdrawn' ? (
                          <button onClick={() => restoreStudent(student)} className="shrink-0 rounded-xl border border-emerald-100 px-3 py-2 text-[11px] font-black text-emerald-600 hover:bg-emerald-50">受講中へ復帰</button>
                        ) : (
                          <button onClick={() => withdrawStudent(student)} className="shrink-0 rounded-xl border border-rose-100 px-3 py-2 text-[11px] font-black text-rose-600 hover:bg-rose-50">受講解除</button>
                        )}
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
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div><p className="text-xs font-black text-indigo-500">STUDENT PROFILE</p><h2 className="text-lg font-black text-slate-900">生徒情報を編集</h2></div>
              <button onClick={() => setEditStudent(null)} className="rounded-xl bg-slate-100 p-2 text-slate-400"><X size={18} /></button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="氏名" value={editForm.display_name} onChange={value => setEditForm(prev => ({ ...prev, display_name: value }))} />
              <Field label="フリガナ" value={editForm.student_name_kana} onChange={value => setEditForm(prev => ({ ...prev, student_name_kana: value }))} />
              <SelectField label="学年" value={editForm.grade} options={['中1', '中2', '中3']} onChange={value => setEditForm(prev => ({ ...prev, grade: value }))} />
              <Field label="教室/クラス" value={editForm.classroom} onChange={value => setEditForm(prev => ({ ...prev, classroom: value }))} />
              <Field label="中学校名" value={editForm.middle_school} onChange={value => setEditForm(prev => ({ ...prev, middle_school: value }))} />
              <MonthField label="受講開始月" value={editForm.course_start_month} onChange={value => setEditForm(prev => ({ ...prev, course_start_month: value }))} />
              <SelectField label="曜日" value={editForm.day_of_week} options={['', '月', '火', '水', '木', '金', '土']} onChange={value => setEditForm(prev => ({ ...prev, day_of_week: value }))} />
              <Field label="電話番号" value={editForm.phone_number} onChange={value => setEditForm(prev => ({ ...prev, phone_number: value }))} />
              <SelectField label="会員区分" value={editForm.member_type} options={['enrolled', 'general']} optionLabels={{ enrolled: '在籍', general: '一般' }} onChange={value => setEditForm(prev => ({ ...prev, member_type: value }))} />
              <SelectField label="夏期講習" value={editForm.summer_course_status} options={['none', 'attending']} optionLabels={{ none: '受講無', attending: '夏期受講' }} onChange={value => setEditForm(prev => ({ ...prev, summer_course_status: value }))} />
              <Field label="兄弟姉妹UID（カンマ区切り）" value={editForm.sibling_ids} onChange={value => setEditForm(prev => ({ ...prev, sibling_ids: value }))} />
              <Field label="双子UID（カンマ区切り）" value={editForm.twin_sibling_ids} onChange={value => setEditForm(prev => ({ ...prev, twin_sibling_ids: value }))} />
              <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
                {[['camera_off_requested', 'カメラオフ希望'], ['absence_call_not_required', '欠席電話不要'], ['trial_continued', '残留特典体験生'], ['summer_only', '夏期講習のみ受講生']].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                    <input type="checkbox" checked={Boolean((editForm as any)[key])} onChange={event => setEditForm(prev => ({ ...prev, [key]: event.target.checked }))} className="h-5 w-5 accent-indigo-600" /> {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5">
              <button onClick={() => setEditStudent(null)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-500">キャンセル</button>
              <button onClick={saveStudentProfile} disabled={savingId === editStudent.id} className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">保存する</button>
            </div>
          </div>
        </div>
      )}

      {withdrawalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div><p className="text-xs font-black text-rose-500">RELEASE</p><h2 className="text-lg font-black text-slate-900">{withdrawalStudent.student_name} の受講解除</h2></div>
              <button onClick={() => setWithdrawalStudent(null)} className="rounded-xl bg-slate-100 p-2 text-slate-400"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <MonthField label="解除月" value={withdrawalForm.month} onChange={value => setWithdrawalForm(prev => ({ ...prev, month: value }))} />
              <SelectField label="解除理由" value={withdrawalForm.reasonCode} options={WITHDRAWAL_REASONS.map(item => item.id)} optionLabels={Object.fromEntries(WITHDRAWAL_REASONS.map(item => [item.id, item.label]))} onChange={value => setWithdrawalForm(prev => ({ ...prev, reasonCode: value, changeReasons: [] }))} />
              {['individual_transfer', 'dekitas_transfer', 'course_reduction'].includes(withdrawalForm.reasonCode) && (
                <div><p className="mb-2 text-xs font-black text-slate-500">変更理由（1つ以上）</p><div className="grid gap-2 sm:grid-cols-2">{CHANGE_REASONS.map(reason => (
                  <label key={reason} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><input type="checkbox" checked={withdrawalForm.changeReasons.includes(reason)} onChange={event => setWithdrawalForm(prev => ({ ...prev, changeReasons: event.target.checked ? [...prev.changeReasons, reason] : prev.changeReasons.filter(item => item !== reason) }))} />{reason}</label>
                ))}</div></div>
              )}
              <label><span className="mb-2 block text-xs font-black text-slate-500">備考</span><textarea value={withdrawalForm.note} onChange={event => setWithdrawalForm(prev => ({ ...prev, note: event.target.value }))} className="min-h-[90px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" /></label>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5"><button onClick={() => setWithdrawalStudent(null)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-500">キャンセル</button><button onClick={saveWithdrawal} className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-black text-white">解除を確定</button></div>
          </div>
        </div>
      )}

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
                            同じ曜日・時限は1講座のみ、同じ講座は曜日・時限を問わず1つだけ登録できます。
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
                <button onClick={saveCourseRegistration} disabled={courseSaving || courseLoading || visibleSelectedIds.length > 0} className="rounded-2xl border-2 border-rose-200 bg-white px-5 py-3 text-sm font-black text-rose-600 hover:bg-rose-50 disabled:opacity-30">
                  すべて解除する
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
              <Field label="フリガナ" value={form.student_name_kana} onChange={value => setForm(prev => ({ ...prev, student_name_kana: value }))} />
              <Field label="初期ID" value={form.login_id} onChange={value => setForm(prev => ({ ...prev, login_id: value }))} />
              <Field label="初期パスワード（空欄なら自動発行）" value={form.password} onChange={value => setForm(prev => ({ ...prev, password: value }))} />
              <Field label="電話番号" value={form.phone_number} onChange={value => setForm(prev => ({ ...prev, phone_number: value }))} />
              <Field label="教室/クラス" value={form.classroom} onChange={value => setForm(prev => ({ ...prev, classroom: value }))} />
              <Field label="中学校名" value={form.middle_school} onChange={value => setForm(prev => ({ ...prev, middle_school: value }))} />
              <MonthField label="受講開始月" value={form.course_start_month} onChange={value => setForm(prev => ({ ...prev, course_start_month: value }))} />
              <SelectField label="学年" value={form.grade} options={['中1', '中2', '中3']} onChange={value => setForm(prev => ({ ...prev, grade: value }))} />
              <SelectField label="会員区分" value={form.member_type} options={['enrolled', 'general']} optionLabels={{ enrolled: '在籍', general: '一般' }} onChange={value => setForm(prev => ({ ...prev, member_type: value }))} />
              <SelectField label="夏期講習" value={form.summer_course_status} options={['none', 'attending']} optionLabels={{ none: '受講無', attending: '夏期受講' }} onChange={value => setForm(prev => ({ ...prev, summer_course_status: value }))} />
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
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.summer_only} onChange={e => setForm(prev => ({ ...prev, summer_only: e.target.checked }))} className="h-5 w-5 accent-sky-600" />
                夏期講習のみ受講生
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

function SelectField({ label, value, options, optionLabels, onChange }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
        {options.map(option => <option key={option || 'none'} value={option}>{optionLabels?.[option] || option || '未設定'}</option>)}
      </select>
    </label>
  );
}

function AttendanceOverview({ students, showAll, onHistoryChange, onSaved }: { students: any[]; showAll: boolean; onHistoryChange: (all: boolean) => void; onSaved: () => Promise<void> }) {
  const [target, setTarget] = useState<any | null>(null);
  const [followUpStatus, setFollowUpStatus] = useState('contacted');
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const attendanceScrollRef = useRef<HTMLDivElement | null>(null);
  const weeks = useMemo(() => (
    [...(students.find(student => Array.isArray(student.weekly_participation))?.weekly_participation || [])].reverse()
  ) as any[], [students]);
  const warningCount = useMemo(() => students.filter(student => student.attendance_warning).length, [students]);
  const attendanceTableWidth = 400 + (weeks.length * 190);
  const currentWeek = weeks.find(week => week.is_current);
  const attendedThisWeek = students.filter(student => student.weekly_participation?.some((week: any) => week.is_current && week.attended)).length;
  const sortedStudents = useMemo(() => [...students].sort((a, b) => (
    Number(Boolean(b.attendance_warning)) - Number(Boolean(a.attendance_warning)) ||
    String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ja')
  )), [students]);
  const formatDates = (dates: string[]) => dates.map(value => {
    const [, month, day] = String(value).split('-');
    return month && day ? `${Number(month)}/${Number(day)}` : value;
  }).join('・');
  const followUpLabel = (status: string) => status === 'resolved' ? '対応完了' : status === 'monitoring' ? '継続確認中' : '声掛け済み';
  const saveFollowUp = async () => {
    if (!target || !followUpNote.trim()) return alert('対応内容を入力してください');
    setFollowUpSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const latestCompletedWeek = [...(target.weekly_participation || [])].reverse().find((week: any) => !week.is_current);
      const response = await fetch('/api/admin/school-students/attendance-follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: target.id,
          status: followUpStatus,
          note: followUpNote.trim(),
          week_start: latestCompletedWeek?.start_date || '',
          week_end: latestCompletedWeek?.end_date || '',
          consecutive_missed_weeks: target.consecutive_missed_weeks || 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
      await onSaved();
      setTarget(null);
      setFollowUpNote('');
    } catch (error: any) {
      alert(`対応記録の保存に失敗しました: ${error.message || error}`);
    } finally {
      setFollowUpSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-black text-indigo-600">今週の出席 {currentWeek?.label || ''}</p><p className="mt-1 text-2xl font-black text-indigo-900">{attendedThisWeek} / {students.length}名</p><p className="mt-1 text-[11px] font-bold text-indigo-600">月〜日の間に1回以上。2回以上の参加も表示します</p></div>
        <div className={`rounded-2xl p-4 ${warningCount ? 'bg-rose-50' : 'bg-emerald-50'}`}><p className={`text-xs font-black ${warningCount ? 'text-rose-500' : 'text-emerald-500'}`}>2週以上連続未参加</p><p className={`mt-1 text-2xl font-black ${warningCount ? 'text-rose-800' : 'text-emerald-800'}`}>{warningCount}名</p></div>
        <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-black text-slate-500">表示期間</p><p className="mt-1 font-black text-slate-800">{weeks.length ? `${weeks[weeks.length - 1].label} 〜 ${weeks[0].label}` : '-'}</p><button type="button" onClick={() => onHistoryChange(!showAll)} className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">{showAll ? '直近9週間に戻す' : '全期間の出席を見る'}</button></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50/50">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-500">
          <span>科目数が多い場合は「科目別の詳細」を押すと確認できます</span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden text-indigo-600 sm:inline">横にスライド</span>
            <button type="button" aria-label="出席表を左へスクロール" onClick={() => attendanceScrollRef.current?.scrollBy({ left: -570, behavior: 'smooth' })} className="rounded-lg bg-white px-2.5 py-1.5 font-black text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">← 前へ</button>
            <button type="button" aria-label="出席表を右へスクロール" onClick={() => attendanceScrollRef.current?.scrollBy({ left: 570, behavior: 'smooth' })} className="rounded-lg bg-white px-2.5 py-1.5 font-black text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">次へ →</button>
          </div>
        </div>
        <div ref={attendanceScrollRef} className="max-h-[72vh] overflow-auto overscroll-contain [scrollbar-gutter:stable_both-edges] [touch-action:pan-x_pan-y]">
        <table className="table-fixed text-left text-xs" style={{ width: `max(100%, ${attendanceTableWidth}px)` }}>
          <colgroup><col className="w-[210px]" /><col className="w-[190px]" />{weeks.map(week => <col key={week.key} className="w-[190px]" />)}</colgroup>
          <thead className="sticky top-0 z-20 bg-white shadow-sm"><tr className="border-b border-slate-100 font-black text-slate-400"><th className="sticky left-0 z-30 w-[210px] bg-white px-4 py-3">生徒</th><th className="w-[190px] px-3 py-3">警告・対応</th>{weeks.map(week => <th key={week.key} className={`w-[190px] px-3 py-3 ${week.is_current ? 'bg-indigo-50 text-indigo-600' : ''}`}><span className="block">{week.label}</span>{week.is_current && <span className="text-[10px]">今週</span>}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-50">{sortedStudents.map(student => {
            const latestFollowUp = student.attendance_follow_ups?.[0];
            return <tr key={student.id} className={student.attendance_warning ? 'bg-rose-50/40' : 'hover:bg-slate-50'}>
              <td className={`sticky left-0 z-10 w-[210px] max-w-[210px] overflow-hidden px-4 py-3 align-top ${student.attendance_warning ? 'bg-rose-50' : 'bg-white'}`}><p className="truncate font-black text-slate-800" title={student.student_name}>{student.student_name}</p><p className="truncate text-[10px] font-bold text-slate-400" title={`${student.grade || '-'} / ${student.current_course_label || '今期未登録'}`}>{student.grade || '-'} / {student.current_course_label || '今期未登録'}</p></td>
              <td className="w-[190px] max-w-[190px] overflow-hidden px-3 py-3 align-top">{student.attendance_warning ? <div className="space-y-2"><span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-1 font-black text-white"><AlertTriangle size={12} />{student.consecutive_missed_weeks}週連続</span><button onClick={() => { setTarget(student); setFollowUpStatus('contacted'); setFollowUpNote(''); }} className="block rounded-lg bg-slate-900 px-2.5 py-1.5 font-black text-white"><MessageSquareText size={12} className="mr-1 inline" />対応を記録</button></div> : <span className="font-black text-emerald-600">正常</span>}{latestFollowUp && <div className="mt-2 max-w-[166px] rounded-lg bg-white p-2 ring-1 ring-slate-200"><p className="font-black text-slate-700">{followUpLabel(latestFollowUp.status)}</p><p className="mt-1 line-clamp-2 text-[10px] font-bold text-slate-500">{latestFollowUp.note}</p></div>}</td>
              {[...(student.weekly_participation || [])].reverse().map((week: any) => <td key={week.key} className={`w-[190px] max-w-[190px] overflow-hidden px-3 py-3 align-top ${week.attended ? 'bg-emerald-50/60' : week.is_current ? 'bg-indigo-50/50' : week.expected ? 'bg-rose-50/50' : 'bg-slate-50'}`}><AttendanceWeekSummary week={week} formatDates={formatDates} /></td>)}
            </tr>;
          })}</tbody>
        </table>
        </div>
      </div>
      {target && <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.currentTarget === event.target) setTarget(null); }}><div role="dialog" aria-modal="true" aria-labelledby="attendance-follow-up-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black text-rose-500">未参加フォロー</p><h3 id="attendance-follow-up-title" className="mt-1 text-xl font-black text-slate-900">{target.student_name}</h3><p className="mt-1 text-xs font-bold text-slate-500">{target.consecutive_missed_weeks}週連続で未参加</p></div><button type="button" aria-label="閉じる" onClick={() => setTarget(null)} className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={18} /></button></div><label className="mt-5 block text-xs font-black text-slate-500">対応状況<select value={followUpStatus} onChange={event => setFollowUpStatus(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black"><option value="contacted">声掛け済み</option><option value="monitoring">継続確認中</option><option value="resolved">対応完了</option></select></label><label className="mt-4 block text-xs font-black text-slate-500">対応内容<textarea value={followUpNote} onChange={event => setFollowUpNote(event.target.value)} placeholder="例：保護者へ電話。次週から参加予定と確認。" className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTarget(null)} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-500">キャンセル</button><button type="button" onClick={saveFollowUp} disabled={followUpSaving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{followUpSaving ? '保存中...' : '対応を記録'}</button></div></div></div>}
    </div>
  );
}

function AttendanceWeekSummary({ week, formatDates }: { week: any; formatDates: (dates: string[]) => string }) {
  if (!week.attended) {
    return <span className={`font-black ${week.is_current ? 'text-indigo-400' : week.expected ? 'text-rose-400' : 'text-slate-300'}`}>{week.is_current ? '今週未参加' : week.expected ? '未参加' : '対象外'}</span>;
  }

  const subjects = Array.isArray(week.subjects) ? week.subjects : [];
  const dates = Array.from(new Set(subjects.flatMap((item: any) => Array.isArray(item.dates) ? item.dates : []))) as string[];
  const subjectLabel = subjects.length === 1 ? String(subjects[0]?.subject || '参加') : `${subjects.length}科目に参加`;

  return (
    <div className="w-[166px]">
      <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-black text-white" title={subjects.map((item: any) => item.subject).join(' / ')}>
        <CheckCircle2 size={12} className="shrink-0" />
        <span className="truncate">{subjectLabel}</span>
      </span>
      {dates.length > 0 && <p className="mt-1 truncate font-bold text-emerald-700" title={formatDates(dates)}>{formatDates(dates)}</p>}
      {subjects.length > 1 && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer select-none text-[10px] font-black text-emerald-700 hover:text-emerald-900">科目別の詳細</summary>
          <div className="mt-2 space-y-1.5 rounded-lg bg-white p-2 ring-1 ring-emerald-100">
            {subjects.map((item: any, index: number) => <div key={`${item.subject || 'subject'}-${index}`}><p className="break-words font-black text-slate-700">{item.subject || '科目未設定'}</p><p className="font-bold text-emerald-700">{formatDates(Array.isArray(item.dates) ? item.dates : [])}</p></div>)}
          </div>
        </details>
      )}
    </div>
  );
}

function CourseRegistrationOverview({ students }: { students: any[] }) {
  return (
    <div className="overflow-x-auto [scrollbar-gutter:stable]">
      <table className="w-full min-w-[1080px] text-left text-xs">
        <thead><tr className="border-b border-slate-100 font-black text-slate-400"><th className="px-4 py-3">生徒</th><th className="min-w-[300px] px-4 py-3">通常講座</th><th className="px-4 py-3">通常登録期</th><th className="min-w-[300px] px-4 py-3">対策講座</th><th className="px-4 py-3">対策受付期</th><th className="px-4 py-3">更新日</th></tr></thead>
        <tbody className="divide-y divide-slate-50">{students.map(student => { const prepLabels = student.selected_test_prep_course_labels?.length ? student.selected_test_prep_course_labels : student.selected_test_prep_course_ids || []; return <tr key={student.id} className="align-top hover:bg-slate-50"><td className="px-4 py-4"><p className="font-black text-slate-800">{student.student_name}</p><p className="text-[10px] font-bold text-slate-400">{student.grade || '-'}</p></td><td className="px-4 py-4">{student.selected_course_labels?.length ? <div className="flex flex-wrap gap-1.5">{student.selected_course_labels.map((label: string) => <span key={label} className="inline-block rounded-xl bg-emerald-50 px-3 py-2 font-black text-emerald-700 ring-1 ring-emerald-100">{label}</span>)}</div> : <span className="font-bold text-slate-300">今期未登録</span>}</td><td className="px-4 py-4 font-black text-slate-600">{[student.course_registration_year ? `${student.course_registration_year}年度` : '', student.course_registration_term_label || student.course_registration_term || ''].filter(Boolean).join(' / ') || '-'}</td><td className="px-4 py-4">{prepLabels.length ? <div className="flex flex-wrap gap-1.5">{prepLabels.map((label: string) => <span key={label} className="inline-block rounded-xl bg-amber-50 px-3 py-2 font-black text-amber-800 ring-1 ring-amber-100">{label}</span>)}</div> : <span className="font-bold text-slate-300">未登録</span>}</td><td className="px-4 py-4 font-black text-slate-600">{[student.test_prep_course_registration_year ? `${student.test_prep_course_registration_year}年度` : '', student.test_prep_course_registration_term || ''].filter(Boolean).join(' / ') || '-'}</td><td className="px-4 py-4 font-bold text-slate-400"><p>通常 {String(student.course_registration_updated_at || '').slice(0, 10) || '-'}</p><p className="mt-1 text-amber-700">対策 {String(student.test_prep_course_registration_updated_at || '').slice(0, 10) || '-'}</p></td></tr>; })}</tbody>
      </table>
    </div>
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
  const visibleLabels = labels;
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
            <div className="flex flex-wrap gap-1" title={labels.join(' / ')}>{visibleLabels.map(label => <span key={label} className="max-w-[260px] truncate rounded-xl bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">{label}</span>)}</div>
          </>
        ) : (
          <span className="rounded-xl bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100" title={ids[0]}>
            登録済み
          </span>
        )}
      </div>
      {(year || term) && (
        <p className="text-[10px] font-black text-slate-400">{[year, term].filter(Boolean).join(' / ')}</p>
      )}
    </div>
  );
}
