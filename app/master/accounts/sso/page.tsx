'use client';

import { useEffect, useMemo, useState } from 'react';
import { minPasswordLength, passwordPolicyError } from '@/lib/password-policy';
import { auth, db } from '@/lib/firebase';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  LockKeyhole,
  KeyRound,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  UserCog,
  UserPlus,
  UsersRound,
  XCircle,
} from 'lucide-react';
import LastLoginCell, { lastLoginToDate } from '@/app/components/LastLoginCell';
import { SortableHeader, useTableSort } from '@/app/components/master/SortableHeader';
import { downloadCsv } from '@/lib/csv-export';
import { formatDateTime, jstDateKey } from '@/lib/format';
import { ADMIN_APP_IDS, ADMIN_APP_LABELS, normalizeAdminAppPermissions } from '@/lib/admin-app-permissions';
import { EMPLOYMENT_CATEGORY_LABELS, isAttendanceUserRole, normalizeEmploymentCategory } from '@/lib/employment-category';
import { useAuth } from '@/app/context/AuthContext';
import {
  ATTENDANCE_SCHOOL_OPTION_GROUPS,
  attendanceSchoolName,
  resolveAttendanceSchoolCode,
} from '@/lib/attendance-schools';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, useConfirm, useToast } from '@/app/components/ui';
import { userErrorMessage } from '@/lib/user-error';

const STATUSES = [
  { id: 'active', label: '有効', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'suspended', label: '一時停止', icon: PauseCircle, className: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'withdrawn', label: '解除', icon: XCircle, className: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'archived', label: '保管', icon: LockKeyhole, className: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const ROLES = [
  { id: 'student', label: '生徒' },
  { id: 'teacher', label: '講師' },
  { id: 'parent', label: '保護者' },
  { id: 'admin', label: '校舎管理者' },
  { id: 'master', label: 'マスター' },
];

const initialForm = {
  user_id: '',
  role: 'student',
  display_name: '',
  login_id: '',
  password: '',
  email: '',
  school_id: '',
  school_ids: '',
  account_status: 'active',
  employment_category: 'semi_dedicated',
  attendance_school_manager: false,
  prescribed_work_start: '09:00',
  prescribed_work_end: '18:00',
  prescribed_break_minutes: 60,
  prescribed_work_days: [1, 2, 3, 4, 5] as number[],
  enabled_programs: [] as string[],
  grade: '中1',
  classroom: '',
  day_of_week: '',
  subject_science: '',
  subject_social: '',
  student_ids: '',
  admin_permissions: {
    science_social: true,
    eiken: false,
    attendance: false,
    online_school: false,
  },
};

const ACCOUNT_PAGE_SIZE = 50;
const SESSION_EXPIRED_MESSAGE = 'ログイン情報が失効しています。再度ログインしてください。';
const isExpiredSessionError = (error: unknown) => {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || error || '').toLowerCase();
  return ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-token-expired', 'auth/user-disabled', 'reauth-required'].includes(code) ||
    message.includes('token has been revoked') || message.includes('token is expired') || message.includes('ログイン情報が失効');
};
const freshAdminToken = async () => {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error(SESSION_EXPIRED_MESSAGE), { code: 'reauth-required' });
  try {
    return await user.getIdToken(true);
  } catch (error) {
    if (isExpiredSessionError(error)) throw Object.assign(new Error(SESSION_EXPIRED_MESSAGE), { code: 'reauth-required' });
    throw error;
  }
};
const accountRole = (value: unknown) => ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(value || '').toLowerCase()) ? 'teacher' : String(value || 'student');
const schoolCodeOf = (profile: any) => resolveAttendanceSchoolCode(
  profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || profile?.classroom
);
const schoolNameOf = (profile: any) => attendanceSchoolName(
  profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || profile?.classroom
) || '校舎未設定';
const roleLabel = (value: string) => ROLES.find(r => r.id === value)?.label || value;
const accountDisplayName = (u: any) => u.student_name || u.parent_name || u.name || u.teacher_name || '名称未設定';
const accountStatusOf = (u: any) => u.account_status || u.status || 'active';
const accountStatusLabel = (u: any) => STATUSES.find(s => s.id === accountStatusOf(u))?.label || accountStatusOf(u);
const accountLoginId = (u: any) => u.lifetime_id || u.initial_login_id || '';
const accountLastLogin = (u: any) => lastLoginToDate(u.last_login_at || u.last_login);
const ACCOUNT_SORT_ACCESSORS = {
  name: (u: any) => accountDisplayName(u),
  role: (u: any) => roleLabel(accountRole(u.role)),
  school: (u: any) => schoolNameOf(u),
  loginId: (u: any) => accountLoginId(u),
  firstLogin: (u: any) => u.isFirstLogin === false ? 1 : 0,
  lastLogin: (u: any) => accountLastLogin(u),
  status: (u: any) => accountStatusLabel(u),
};
const schoolOptions = () => ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => (
  <optgroup key={group.label} label={group.label}>
    {group.schools.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
  </optgroup>
));

export default function SsoAccountConsolePage() {
  const { profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [school, setSchool] = useState('all');
  const [status, setStatus] = useState('all');
  const [firstLoginFilter, setFirstLoginFilter] = useState('all');
  const [role, setRole] = useState('all');
  const [employmentCategory, setEmploymentCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [savingAccount, setSavingAccount] = useState(false);
  const [initializingCategories, setInitializingCategories] = useState(false);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set());
  const [updatingTeacherPrograms, setUpdatingTeacherPrograms] = useState(false);
  const [page, setPage] = useState(1);
  const [studentSearch, setStudentSearch] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const students = useMemo(() => users.filter(u => u.role === 'student'), [users]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const schoolValue = schoolCodeOf(u);
      const statusValue = u.account_status || u.status || 'active';
      const name = `${u.student_name || ''} ${u.parent_name || ''} ${u.name || ''} ${u.email || ''} ${u.lifetime_id || ''}`;
      if (school !== 'all' && schoolValue !== school) return false;
      if (status !== 'all' && statusValue !== status) return false;
      if (role !== 'all' && accountRole(u.role) !== role) return false;
      if (employmentCategory !== 'all' && normalizeEmploymentCategory(u.employment_category || u.employment_type || u.worker_type, u.role) !== employmentCategory) return false;
      if (firstLoginFilter === 'pending' && u.isFirstLogin === false) return false;
      if (firstLoginFilter === 'completed' && u.isFirstLogin !== false) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [users, school, status, role, employmentCategory, search, firstLoginFilter]);

  const { sorted: sortedUsers, sort: accountSort, headerProps: accountSortProps } = useTableSort(filteredUsers, ACCOUNT_SORT_ACCESSORS);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ACCOUNT_PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * ACCOUNT_PAGE_SIZE;
    return sortedUsers.slice(start, start + ACCOUNT_PAGE_SIZE);
  }, [sortedUsers, page]);

  // 絞り込み・並べ替え後の一覧をそのまま書き出す（パスワードは含めない）。
  const exportAccountsCsv = () => {
    downloadCsv(`アカウント一覧_${jstDateKey()}.csv`, ['種別', '氏名', 'ログインID', '校舎', '状態', '最終ログイン'], sortedUsers.map(u => {
      const lastLogin = accountLastLogin(u);
      return [roleLabel(accountRole(u.role)), accountDisplayName(u), accountLoginId(u), schoolNameOf(u), accountStatusLabel(u), lastLogin ? formatDateTime(lastLogin, { withYear: true }) : ''];
    }));
    toast.success(`${sortedUsers.length}件をCSVに書き出しました`);
  };

  const visibleTeacherIds = useMemo(
    () => paginatedUsers.filter(user => accountRole(user.role) === 'teacher').map(user => user.id),
    [paginatedUsers],
  );
  const allVisibleTeachersSelected = visibleTeacherIds.length > 0 && visibleTeacherIds.every(id => selectedTeacherIds.has(id));

  useEffect(() => {
    setPage(1);
  }, [school, status, role, employmentCategory, search, firstLoginFilter, accountSort]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const stats = useMemo(() => {
    return STATUSES.reduce((acc, item) => {
      acc[item.id] = users.filter(u => (u.account_status || u.status || 'active') === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [users]);

  const roleStats = useMemo(() => {
    return ROLES.reduce((acc, item) => {
      acc[item.id] = users.filter(u => accountRole(u.role) === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [users]);

  const firstLoginStats = useMemo(() => {
    const pending = users.filter(u => u.isFirstLogin !== false).length;
    const completed = users.length - pending;
    return { pending, completed };
  }, [users]);

  const fetchUsers = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      try {
        const snap = await getDocs(query(collection(db, 'users'), orderBy('created_at', 'desc')));
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch {
        const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher', 'parent', 'admin', 'master', 'attendance_admin'])));
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (error) {
      console.error('Failed to load accounts', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openCreateModal = (nextRole = 'student') => {
    setForm({ ...initialForm, role: nextRole, school_id: school !== 'all' ? school : '' });
    setStudentSearch('');
    setModalOpen(true);
  };

  const openEditModal = (target: any) => {
    setForm({
      user_id: target.id,
      role: accountRole(target.role),
      display_name: target.student_name || target.parent_name || target.name || '',
      login_id: target.lifetime_id || target.initial_login_id || '',
      // 通常の情報更新で既存PWを再送しない。入力した場合だけPWを変更する。
      password: '',
      email: target.email || '',
      school_id: schoolCodeOf(target),
      school_ids: Array.isArray(target.school_ids) ? target.school_ids.map(resolveAttendanceSchoolCode).filter(Boolean).join(',') : '',
      account_status: target.account_status || target.status || 'active',
      employment_category: normalizeEmploymentCategory(target.employment_category || target.employment_type || target.worker_type, target.role) || 'semi_dedicated',
      attendance_school_manager: target.attendance_school_manager === true,
      prescribed_work_start: target.prescribed_work_start || '09:00',
      prescribed_work_end: target.prescribed_work_end || '18:00',
      prescribed_break_minutes: Number(target.prescribed_break_minutes ?? 60),
      prescribed_work_days: Array.isArray(target.prescribed_work_days) ? target.prescribed_work_days.map(Number).filter((value: number) => value >= 0 && value <= 6) : [1, 2, 3, 4, 5],
      enabled_programs: Array.isArray(target.enabled_programs) ? target.enabled_programs.filter((value: unknown) => ['science_social', 'online_school'].includes(String(value))) : [],
      grade: target.grade || '中1',
      classroom: target.classroom || '',
      day_of_week: target.day_of_week || '',
      subject_science: target.subject_science || target.science_subject || '',
      subject_social: target.subject_social || target.social_subject || '',
      student_ids: Array.isArray(target.student_ids) ? target.student_ids.join(',') : '',
      admin_permissions: normalizeAdminAppPermissions(target.role, target),
    });
    setStudentSearch('');
    setModalOpen(true);
  };

  const selectedStudentIds = useMemo(() => form.student_ids.split(',').map(value => value.trim()).filter(Boolean), [form.student_ids]);
  const parentStudentCandidates = useMemo(() => {
    const keyword = studentSearch.trim().toLowerCase();
    return students
      .filter(student => {
        if (!keyword) return selectedStudentIds.includes(student.id);
        const haystack = `${student.student_name || student.name || ''} ${student.lifetime_id || student.initial_login_id || ''} ${schoolNameOf(student)}`.toLowerCase();
        return haystack.includes(keyword) || selectedStudentIds.includes(student.id);
      })
      .slice(0, 20);
  }, [selectedStudentIds, studentSearch, students]);

  const toggleParentStudent = (studentId: string) => {
    const next = selectedStudentIds.includes(studentId)
      ? selectedStudentIds.filter(id => id !== studentId)
      : [...selectedStudentIds, studentId];
    setForm(prev => ({ ...prev, student_ids: next.join(',') }));
  };

  const toggleManagedSchool = (schoolCode: string) => {
    const selected = form.school_ids.split(',').map(value => value.trim()).filter(Boolean);
    const next = selected.includes(schoolCode)
      ? selected.filter(value => value !== schoolCode)
      : [...selected, schoolCode];
    setForm(prev => ({ ...prev, school_ids: next.join(',') }));
  };

  const [releasingLock, setReleasingLock] = useState(false);
  const openPasswordModal = (target: any) => {
    setPasswordTarget(target);
    setNewPassword('');
    setNewPasswordConfirmation('');
  };

  const closePasswordModal = () => {
    if (savingPassword) return;
    setPasswordTarget(null);
    setNewPassword('');
    setNewPasswordConfirmation('');
  };

  // ログインのロックを解く（KDL診断 A.1.2。校舎とサポートセンターが解ける）。
  const releaseLoginLock = async () => {
    if (!passwordTarget) return;
    setReleasingLock(true);
    try {
      const token = await freshAdminToken();
      const response = await fetch('/api/admin/accounts/login-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: passwordTarget.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || 'ロックを解けませんでした。');
      toast.success(body.removed ? 'ログインのロックを解きました。' : 'ロックはかかっていませんでした。');
    } catch (error: any) {
      toast.error(error?.message || 'ロックを解けませんでした。');
    } finally {
      setReleasingLock(false);
    }
  };

  const changePassword = async () => {
    if (!passwordTarget) return;
    const targetPolicyError = passwordPolicyError(newPassword, passwordTarget.role, [passwordTarget.lifetime_id, passwordTarget.email]);
    if (targetPolicyError) return toast.error(targetPolicyError);
    if (newPassword !== newPasswordConfirmation) return toast.error('確認用パスワードが一致しません。');
    const targetName = passwordTarget.student_name || passwordTarget.parent_name || passwordTarget.name || passwordTarget.email || passwordTarget.id;
    if (!(await confirm({
      title: `「${targetName}」のパスワードを変更しますか？`,
      message: '変更後、対象者は新しいパスワードで再ログインが必要です。',
      confirmLabel: '変更する',
      tone: 'danger',
    }))) return;
    setSavingPassword(true);
    try {
      const token = await freshAdminToken();
      const response = await fetch('/api/admin/accounts/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: passwordTarget.id, password: newPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw Object.assign(new Error(body.error || 'パスワードを変更できませんでした。'), { code: body.code || '', status: response.status });
      setPasswordTarget(null);
      setNewPassword('');
      setNewPasswordConfirmation('');
      if (body.reauth_required) {
        toast.success('パスワードを変更しました。新しいパスワードで再度ログインしてください。');
        await firebaseSignOut(auth).catch(() => undefined);
        window.location.replace('/admin/login?reason=credentials-changed');
        return;
      }
      toast.success(`${targetName} のパスワードを変更しました。`);
    } catch (error: any) {
      if (isExpiredSessionError(error)) {
        toast.error(SESSION_EXPIRED_MESSAGE);
        await firebaseSignOut(auth).catch(() => undefined);
        window.location.replace('/admin/login?reason=session-expired');
        return;
      }
      toast.error(`パスワード変更に失敗しました: ${userErrorMessage(error, '')}`);
    } finally {
      setSavingPassword(false);
    }
  };

  const updateStatus = async (target: any, nextStatus: string) => {
    const targetName = target.student_name || target.parent_name || target.name || target.email || target.id;
    const nextLabel = STATUSES.find(s => s.id === nextStatus)?.label;
    const destructive = nextStatus !== 'active';
    if (!(await confirm({
      title: `「${targetName}」を「${nextLabel}」に変更しますか？`,
      confirmLabel: destructive ? `${nextLabel}にする` : '変更する',
      tone: destructive ? 'danger' : 'default',
    }))) return;
    setSavingId(target.id);
    try {
      const token = await freshAdminToken();
      const res = await fetch('/api/admin/accounts/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: target.id, status: nextStatus }),
      });
      if (!res.ok) throw new Error('failed');
      setUsers(prev => prev.map(u => u.id === target.id ? { ...u, account_status: nextStatus, status: nextStatus } : u));
    } catch (error) {
      if (isExpiredSessionError(error)) {
        toast.error(SESSION_EXPIRED_MESSAGE);
        await firebaseSignOut(auth).catch(() => undefined);
        window.location.replace('/admin/login?reason=session-expired');
        return;
      }
      toast.error('状態変更に失敗しました。権限または校舎設定を確認してください。');
    } finally {
      setSavingId('');
    }
  };

  const saveAccount = async () => {
    if (!form.display_name.trim()) return toast.error('氏名は必須です');
    if (!form.login_id.trim()) return toast.error('初期IDは必須です');
    const formPolicyError = form.password.trim() ? passwordPolicyError(form.password.trim(), form.role, [form.login_id]) : '';
    if (formPolicyError) return toast.error(formPolicyError);
    if (!form.user_id && form.role !== 'student' && !form.password.trim()) return toast.error('生徒以外はパスワードを入力してください');
    if (form.role !== 'master' && !resolveAttendanceSchoolCode(form.school_id)) return toast.error('所属校舎を選択してください');
    if ((form.role === 'admin' || form.role === 'master') && !form.school_ids.trim() && form.role === 'admin') {
      return toast.error('校舎管理者には管理できる校舎を入力してください');
    }
    if (form.role === 'teacher' && form.attendance_school_manager && !form.school_ids.trim()) {
      return toast.error('勤怠承認者には承認できる校舎を選択してください');
    }
    if (form.role === 'parent' && !form.student_ids.trim()) {
      return toast.error('保護者には紐づく生徒IDを入力してください');
    }

    setSavingAccount(true);
    try {
      const token = await freshAdminToken();
      const res = await fetch('/api/admin/accounts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'failed'), { code: data.code || '' });
      setModalOpen(false);
      await fetchUsers();
      if (data.reauth_required) {
        toast.success('アカウントを更新しました。認証情報を変更したため、再度ログインしてください。');
        await firebaseSignOut(auth).catch(() => undefined);
        window.location.replace('/admin/login?reason=credentials-changed');
        return;
      }
      toast.success(data.updated ? 'アカウントを更新しました' : 'アカウントを作成しました');
    } catch (error: any) {
      if (isExpiredSessionError(error)) {
        toast.error(SESSION_EXPIRED_MESSAGE);
        await firebaseSignOut(auth).catch(() => undefined);
        window.location.replace('/admin/login?reason=session-expired');
        return;
      }
      toast.error(`保存に失敗しました: ${userErrorMessage(error, '')}`);
    } finally {
      setSavingAccount(false);
    }
  };

  const initializeEmploymentCategories = async () => {
    const targets = users.filter(item => isAttendanceUserRole(item.role) && (!item.employment_category || accountRole(item.role) !== item.role)).length;
    if (!targets) return toast.info('移行が必要な講師アカウントはありません。');
    if (!(await confirm({
      title: `${targets}アカウントを一括移行しますか？`,
      message: '旧勤怠管理者を講師へ統合し、区分未設定を「準専任」に設定します。',
      confirmLabel: '一括移行する',
      tone: 'danger',
    }))) return;
    setInitializingCategories(true);
    try {
      const token = await freshAdminToken();
      const response = await fetch('/api/admin/accounts/employment-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'initialize_missing' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '一括設定に失敗しました。');
      await fetchUsers();
      toast.success(`${body.updated || 0}アカウントを更新しました（講師へ統合: ${body.migrated_roles || 0}件）。`);
    } catch (error: any) {
      toast.error(`一括設定に失敗しました: ${userErrorMessage(error, '')}`);
    } finally {
      setInitializingCategories(false);
    }
  };

  const toggleVisibleTeachers = (checked: boolean) => {
    setSelectedTeacherIds(current => {
      const next = new Set(current);
      visibleTeacherIds.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const bulkUpdateScienceSocial = async (enabled: boolean) => {
    const userIds = Array.from(selectedTeacherIds);
    if (!userIds.length) return toast.error('対象の講師を選択してください。');
    const actionLabel = enabled ? 'ON' : 'OFF';
    if (!(await confirm({
      title: `選択した${userIds.length}名の理社講座を一括${actionLabel}にしますか？`,
      confirmLabel: `一括${actionLabel}にする`,
      tone: enabled ? 'default' : 'danger',
    }))) return;
    setUpdatingTeacherPrograms(true);
    try {
      const token = await freshAdminToken();
      const response = await fetch('/api/admin/accounts/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: userIds, program: 'science_social', enabled }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '一括更新に失敗しました。');
      await fetchUsers();
      setSelectedTeacherIds(new Set());
      toast.success(`${body.updated || 0}名の理社講座を${actionLabel}にしました。`);
    } catch (error: any) {
      toast.error(`一括更新に失敗しました: ${userErrorMessage(error, '')}`);
    } finally {
      setUpdatingTeacherPrograms(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        actions={<>
          <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={fetchUsers} loading={loading}>再読み込み</Button>
          <Button variant="secondary" icon={<UsersRound size={16} aria-hidden />} onClick={() => openCreateModal('parent')}>保護者作成</Button>
          <Button variant="secondary" icon={<UserCog size={16} aria-hidden />} onClick={() => openCreateModal('admin')}>校舎管理者</Button>
          <Button icon={<UserPlus size={16} aria-hidden />} onClick={() => openCreateModal('student')}>新規作成</Button>
        </>}
      />

      <section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {STATUSES.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setStatus(item.id)} className={`rounded-card border p-4 text-left ${item.className}`}>
                <Icon size={20} />
                <p className="mt-3 text-xs font-bold">{item.label}</p>
                <p className="text-3xl font-black">{stats[item.id] || 0}</p>
              </button>
            );
          })}
          <button onClick={() => setFirstLoginFilter('pending')} className={`rounded-card border p-4 text-left ${firstLoginFilter === 'pending' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-amber-100 bg-amber-50/70 text-amber-700'}`}>
            <LockKeyhole size={20} />
            <p className="mt-3 text-xs font-bold">初回変更待ち</p>
            <p className="text-3xl font-black">{firstLoginStats.pending}</p>
          </button>
          <button onClick={() => setFirstLoginFilter('completed')} className={`rounded-card border p-4 text-left ${firstLoginFilter === 'completed' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-emerald-100 bg-emerald-50/70 text-emerald-700'}`}>
            <CheckCircle2 size={20} />
            <p className="mt-3 text-xs font-bold">初回ログイン済み</p>
            <p className="text-3xl font-black">{firstLoginStats.completed}</p>
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ROLES.map(item => (
          <button
            key={item.id}
            onClick={() => setRole(item.id)}
            className={`rounded-card border p-4 text-left shadow-sm transition ${role === item.id ? 'border-accent bg-accent-soft text-accent' : 'border-white bg-white text-slate-600 hover:border-slate-200'}`}
          >
            <p className="text-xs font-bold">{item.label}</p>
            <p className="mt-1 text-2xl font-black">{roleStats[item.id] || 0}</p>
          </button>
        ))}
      </section>

      <section className="rounded-card bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_190px_160px_150px_160px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="氏名・ID・メールで検索" className="w-full rounded-input border border-line bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <select value={school} onChange={e => setSchool(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="all">すべての校舎</option>
            {schoolOptions()}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="all">すべての権限</option>
            {ROLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={employmentCategory} onChange={e => setEmploymentCategory(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="all">専任区分すべて</option>
            <option value="dedicated">専任</option>
            <option value="semi_dedicated">準専任</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="all">すべての状態</option>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={firstLoginFilter} onChange={e => setFirstLoginFilter(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="all">初回状態すべて</option>
            <option value="pending">初回変更待ち</option>
            <option value="completed">初回ログイン済み</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-btn bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold text-slate-500">旧勤怠管理者は講師・職員アカウントへ統合します。理社講座を利用しない職員は、ログイン後に勤怠画面を直接開きます。</p>
          <Button variant="secondary" size="sm" onClick={initializeEmploymentCategories} loading={initializingCategories}>旧権限・未設定区分を一括移行</Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-card bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700"><UsersRound size={18} /> アカウント一覧</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">{filteredUsers.length}件 / 講師{selectedTeacherIds.size}名を選択中</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Download size={14} aria-hidden />} onClick={exportAccountsCsv} disabled={loading || loadError || !filteredUsers.length}>CSV出力</Button>
            <Button size="sm" onClick={() => bulkUpdateScienceSocial(true)} disabled={!selectedTeacherIds.size} loading={updatingTeacherPrograms}>理社講座 一括ON</Button>
            <Button variant="secondary" size="sm" onClick={() => bulkUpdateScienceSocial(false)} disabled={!selectedTeacherIds.size || updatingTeacherPrograms}>理社講座 一括OFF</Button>
          </div>
        </div>
        {loading ? (
          <div className="p-5"><ListSkeleton rows={5} /></div>
        ) : loadError ? (
          <ErrorState className="m-5" onRetry={fetchUsers} />
        ) : filteredUsers.length === 0 ? (
          <EmptyState className="m-5" title={users.length ? '条件に合うアカウントはありません' : 'アカウントがまだありません'} description={users.length ? '検索語や絞り込み条件を変えてください。' : '「新規作成」からアカウントを登録できます。'} />
        ) : (
          <div className="overflow-x-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1380px] whitespace-nowrap text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                <tr>
                  <th className="px-5 py-3">
                    <input type="checkbox" aria-label="このページの講師をすべて選択" checked={allVisibleTeachersSelected} disabled={!visibleTeacherIds.length} onChange={event => toggleVisibleTeachers(event.target.checked)} className="h-4 w-4 accent-accent disabled:opacity-30" />
                  </th>
                  <SortableHeader {...accountSortProps('name')} className="px-5 py-1">ユーザー</SortableHeader>
                  <SortableHeader {...accountSortProps('role')} className="px-5 py-1">権限</SortableHeader>
                  <th className="px-5 py-3">専任区分</th>
                  <SortableHeader {...accountSortProps('school')} className="px-5 py-1">校舎</SortableHeader>
                  <SortableHeader {...accountSortProps('loginId')} className="px-5 py-1">初期ID</SortableHeader>
                  <SortableHeader {...accountSortProps('firstLogin')} className="px-5 py-1">初回ログイン</SortableHeader>
                  <SortableHeader {...accountSortProps('lastLogin')} className="px-5 py-1">最終ログイン</SortableHeader>
                  <th className="px-5 py-3">紐づけ</th>
                  <SortableHeader {...accountSortProps('status')} className="px-5 py-1">状態</SortableHeader>
                  <th className="px-5 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedUsers.map(u => {
                  const currentStatus = u.account_status || u.status || 'active';
                  const displayName = u.student_name || u.parent_name || u.name || u.teacher_name || '名称未設定';
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        {accountRole(u.role) === 'teacher' ? (
                          <input type="checkbox" aria-label={`${displayName}を選択`} checked={selectedTeacherIds.has(u.id)} onChange={event => setSelectedTeacherIds(current => { const next = new Set(current); event.target.checked ? next.add(u.id) : next.delete(u.id); return next; })} className="h-4 w-4 accent-accent" />
                        ) : <span className="text-slate-200">―</span>}
                      </td>
                      <td className="px-5 py-4">
                        <button onClick={() => openEditModal(u)} className="max-w-[240px] text-left hover:text-accent" title={`${displayName} / ${u.email || u.id}`}>
                          <p className="truncate font-bold text-slate-800">{displayName}</p>
                          <p className="truncate text-xs font-bold text-slate-400">{u.email || u.id}</p>
                        </button>
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-500">{roleLabel(accountRole(u.role))}</td>
                      <td className="px-5 py-4">
                        {isAttendanceUserRole(u.role) ? (() => {
                          const category = normalizeEmploymentCategory(u.employment_category || u.employment_type || u.worker_type, u.role) || 'semi_dedicated';
                          return <div className="flex flex-wrap gap-1"><span className={`rounded-full px-3 py-1 text-xs font-bold ${category === 'dedicated' ? 'bg-accent-soft text-accent' : 'bg-amber-100 text-amber-800'}`}>{EMPLOYMENT_CATEGORY_LABELS[category]}</span>{u.attendance_school_manager === true && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">勤怠責任者</span>}</div>;
                        })() : <span className="text-slate-300">―</span>}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                          <Building2 size={12} /> {schoolNameOf(u)}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-500">{u.lifetime_id || u.initial_login_id || '-'}</td>
                      <td className="px-5 py-4">
                        <FirstLoginBadge value={u.isFirstLogin} />
                      </td>
                      <td className="px-5 py-4">
                        <LastLoginCell value={u.last_login_at || u.last_login} />
                      </td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-500">
                        {accountRole(u.role) === 'teacher'
                          ? (Array.isArray(u.enabled_programs) && u.enabled_programs.includes('science_social') ? '理社講座あり' : '理社講座なし')
                          : accountRole(u.role) === 'student'
                            ? (Array.isArray(u.enabled_programs) && u.enabled_programs.includes('online_school') ? 'オンライン校 ON' : 'オンライン校 OFF')
                          : u.role === 'parent'
                            ? `${Array.isArray(u.student_ids) ? u.student_ids.length : 0}名の生徒`
                            : Array.isArray(u.school_ids) && u.school_ids.length ? `${u.school_ids.length}校舎` : '-'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                          {STATUSES.find(s => s.id === currentStatus)?.label || currentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => openEditModal(u)}>編集</Button>
                          {profile?.role === 'master' && <Button variant="secondary" size="sm" className="shrink-0" icon={<KeyRound size={14} aria-hidden />} onClick={() => openPasswordModal(u)}>PW変更</Button>}
                          <select
                            aria-label={`${displayName}のアカウント状態`}
                            value={currentStatus}
                            onChange={e => updateStatus(u, e.target.value)}
                            disabled={savingId === u.id}
                            className="min-w-[112px] rounded-input border border-line bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none hover:border-slate-300 disabled:cursor-wait disabled:opacity-50"
                          >
                            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !loadError && filteredUsers.length > ACCOUNT_PAGE_SIZE && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-400">
              {(page - 1) * ACCOUNT_PAGE_SIZE + 1}〜{Math.min(page * ACCOUNT_PAGE_SIZE, filteredUsers.length)}件を表示 / 全{filteredUsers.length}件
            </p>
            <div className="flex items-center gap-2">
              <IconButton label="前のページ" variant="secondary" size="sm" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1}>
                <ChevronLeft size={18} aria-hidden />
              </IconButton>
              <span className="min-w-20 text-center text-xs font-bold text-slate-600">{page} / {totalPages}</span>
              <IconButton label="次のページ" variant="secondary" size="sm" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
                <ChevronRight size={18} aria-hidden />
              </IconButton>
            </div>
          </div>
        )}
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="lg"
        title={form.user_id ? 'アカウントを編集' : 'アカウントを作成'}
        footer={(
          <Button fullWidth onClick={saveAccount} loading={savingAccount} icon={<Plus size={16} aria-hidden />}>
            アカウントを保存
          </Button>
        )}
      >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">権限</span>
                  <select value={form.role} onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                    {ROLES
                      .filter(r => profile?.role === 'master' || !['admin', 'master'].includes(r.id))
                      .map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">状態</span>
                  <select value={form.account_status} onChange={e => setForm(prev => ({ ...prev, account_status: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                    {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                {form.role === 'teacher' && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">専任区分</span>
                    <select value={form.employment_category} onChange={e => setForm(prev => ({ ...prev, employment_category: e.target.value }))} className="w-full rounded-input border border-line bg-accent-soft px-4 py-3 text-sm font-bold text-fg outline-none">
                      <option value="dedicated">専任</option>
                      <option value="semi_dedicated">準専任</option>
                    </select>
                    <span className="block text-xs font-bold text-slate-400">勤怠画面・給与集計・授業実績の対象をこの区分で分離します。</span>
                  </label>
                )}
                {form.role === 'teacher' && form.employment_category === 'dedicated' && (
                  <fieldset className="rounded-card border border-line bg-accent-soft p-4 sm:col-span-2">
                    <legend className="px-2 text-xs font-bold text-accent">専任の規定勤務時間</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-bold text-slate-600">開始<input required type="time" value={form.prescribed_work_start} onChange={event => setForm(prev => ({ ...prev, prescribed_work_start: event.target.value }))} className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5" /></label>
                      <label className="text-xs font-bold text-slate-600">終了<input required type="time" value={form.prescribed_work_end} onChange={event => setForm(prev => ({ ...prev, prescribed_work_end: event.target.value }))} className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5" /></label>
                      <label className="text-xs font-bold text-slate-600">休憩（分）<input required type="number" min="0" max="240" step="5" value={form.prescribed_break_minutes} onChange={event => setForm(prev => ({ ...prev, prescribed_break_minutes: Number(event.target.value) }))} className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5" /></label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['日', '月', '火', '水', '木', '金', '土'].map((label, day) => <label key={day} className={`cursor-pointer rounded-btn border px-3 py-2 text-xs font-bold ${form.prescribed_work_days.includes(day) ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-white text-slate-500'}`}><input type="checkbox" className="sr-only" checked={form.prescribed_work_days.includes(day)} onChange={event => setForm(prev => ({ ...prev, prescribed_work_days: event.target.checked ? [...prev.prescribed_work_days, day].sort() : prev.prescribed_work_days.filter(value => value !== day) }))} />{label}</label>)}
                    </div>
                    <p className="mt-2 text-xs font-bold text-accent">この時間より前・後の打刻実績を時間外候補として自動抽出します。</p>
                  </fieldset>
                )}
                {form.role === 'teacher' && form.employment_category === 'dedicated' && (
                  <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-card border border-emerald-200 bg-emerald-50 p-4">
                    <input type="checkbox" checked={form.attendance_school_manager} onChange={event => setForm(prev => ({
                      ...prev,
                      attendance_school_manager: event.target.checked,
                      school_ids: event.target.checked && !prev.school_ids && prev.school_id ? prev.school_id : prev.school_ids,
                    }))} className="mt-0.5 h-5 w-5 accent-emerald-600" />
                    <span><span className="block text-sm font-bold text-emerald-950">勤怠承認者</span><span className="mt-1 block text-xs font-bold leading-relaxed text-emerald-700">下で登録した校舎の打刻修正依頼と勤務詳細を確認・承認できます。他校舎や給与設定は表示されません。</span></span>
                  </label>
                )}
                {form.role === 'teacher' && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">利用する講座</span>
                    <span className="flex min-h-14 cursor-pointer items-center gap-3 rounded-input border border-line bg-slate-50 px-4">
                      <input type="checkbox" checked={form.enabled_programs.includes('science_social')} onChange={event => setForm(prev => ({ ...prev, enabled_programs: event.target.checked ? ['science_social'] : [] }))} className="h-5 w-5 accent-accent" />
                      <span><span className="block text-sm font-bold text-slate-800">理社講座</span><span className="block text-xs font-bold text-slate-400">ONの場合は理社講座画面内から勤怠も利用できます。OFFの場合はログイン後に勤怠画面を直接開きます。</span></span>
                    </span>
                  </label>
                )}
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">氏名</span>
                  <input value={form.display_name} onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">初期ID</span>
                  <input value={form.login_id} onChange={e => setForm(prev => ({ ...prev, login_id: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none" />
                </label>
                {!form.user_id ? <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">初期パスワード</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder={form.role === 'student' ? '空欄なら自動発行' : `${minPasswordLength(form.role)}文字以上で入力`}
                    className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none"
                  />
                </label> : <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">パスワードは一覧の「PW変更」から個別に変更できます。</div>}
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">メール</span>
                  <input value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="空欄なら 初期ID@classbase.local" className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">所属校舎</span>
                  <select required={form.role !== 'master'} value={form.school_id} onChange={e => setForm(prev => ({ ...prev, school_id: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                    <option value="">校舎を選択</option>
                    {schoolOptions()}
                  </select>
                </label>

                {form.role === 'student' && (
                  <>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-500">学年</span>
                      <select value={form.grade} onChange={e => setForm(prev => ({ ...prev, grade: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                        {['中1', '中2', '中3', 'その他'].map(g => <option key={g}>{g}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-500">教室</span>
                      <input value={form.classroom} onChange={e => setForm(prev => ({ ...prev, classroom: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-500">理科科目</span>
                      <input value={form.subject_science} onChange={e => setForm(prev => ({ ...prev, subject_science: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-500">社会科目</span>
                      <input value={form.subject_social} onChange={e => setForm(prev => ({ ...prev, subject_social: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-card border border-line bg-accent-soft p-4 sm:col-span-2">
                      <input type="checkbox" checked={form.enabled_programs.includes('online_school')} onChange={event => setForm(prev => ({ ...prev, enabled_programs: event.target.checked ? ['online_school'] : [] }))} className="h-5 w-5 accent-accent" />
                      <span><span className="block text-sm font-bold text-slate-900">オンライン校を利用する</span><span className="block text-xs font-bold text-slate-500">ONにすると、生徒のアプリ選択画面に10分学習が表示されます。</span></span>
                    </label>
                  </>
                )}

                {form.role === 'parent' && (
                  <div className="space-y-3 sm:col-span-2">
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-500">紐づく生徒</span>
                      <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="生徒名・ログインID・校舎で検索" className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent" />
                    </label>
                    {selectedStudentIds.length > 0 && (
                      <p className="text-xs font-bold text-accent">{selectedStudentIds.length}名を選択中</p>
                    )}
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-input border border-line bg-slate-50 p-2">
                      {parentStudentCandidates.length > 0 ? parentStudentCandidates.map(student => {
                        const checked = selectedStudentIds.includes(student.id);
                        return (
                          <label key={student.id} className="flex cursor-pointer items-center gap-3 rounded-btn bg-white px-3 py-3 shadow-sm">
                            <input type="checkbox" checked={checked} onChange={() => toggleParentStudent(student.id)} className="h-5 w-5 accent-accent" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-slate-800">{student.student_name || student.name || '氏名未設定'}</span>
                              <span className="block truncate text-xs font-bold text-slate-400">{student.lifetime_id || student.initial_login_id || 'ID未設定'} / {schoolNameOf(student)}</span>
                            </span>
                          </label>
                        );
                      }) : (
                        <p className="px-3 py-5 text-center text-xs font-bold text-slate-400">生徒名またはログインIDを入力してください</p>
                      )}
                    </div>
                  </div>
                )}

                {(form.role === 'admin' || (form.role === 'teacher' && form.attendance_school_manager)) && (
                  <>
                    <fieldset className="space-y-3 rounded-input border border-line bg-slate-50 p-4 sm:col-span-2">
                      <legend className="px-2 text-xs font-bold text-slate-600">{form.role === 'admin' ? '管理できる校舎' : '勤怠を承認できる校舎'}</legend>
                      <div className="max-h-64 space-y-4 overflow-y-auto pr-1">
                        {ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => <div key={group.label}><p className="mb-2 text-xs font-bold text-slate-400">{group.label}</p><div className="grid gap-2 sm:grid-cols-2">{group.schools.map(item => {
                          const checked = form.school_ids.split(',').includes(item.code);
                          return <label key={item.code} className={`flex cursor-pointer items-center gap-2 rounded-btn border px-3 py-2 text-xs font-bold ${checked ? 'border-accent bg-accent-soft text-accent' : 'border-slate-200 bg-white text-slate-600'}`}><input type="checkbox" checked={checked} onChange={() => toggleManagedSchool(item.code)} className="h-4 w-4 accent-accent" /><span>{item.name}</span></label>;
                        })}</div></div>)}
                      </div>
                    </fieldset>
                    {profile?.role === 'master' && form.role === 'admin' && (
                      <fieldset className="space-y-3 rounded-input border border-line bg-slate-50 p-4 sm:col-span-2">
                        <legend className="px-2 text-xs font-bold text-slate-600">利用できる管理画面</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {ADMIN_APP_IDS.map(key => [key, ADMIN_APP_LABELS[key]] as const).map(([key, label]) => (
                            <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-btn border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
                              <input
                                type="checkbox"
                                checked={form.admin_permissions[key as keyof typeof form.admin_permissions]}
                                onChange={event => setForm(prev => ({
                                  ...prev,
                                  admin_permissions: {
                                    ...prev.admin_permissions,
                                    [key]: event.target.checked,
                                  },
                                }))}
                                className="h-5 w-5 accent-accent"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </>
                )}
              </div>
      </Modal>

      <Modal
        open={Boolean(passwordTarget)}
        onClose={closePasswordModal}
        dismissible={!savingPassword}
        title="パスワード変更"
        description={passwordTarget ? (passwordTarget.student_name || passwordTarget.parent_name || passwordTarget.name || passwordTarget.email || passwordTarget.id) : undefined}
        footer={(
          <Button variant="danger" fullWidth onClick={changePassword} loading={savingPassword} disabled={newPassword.length < minPasswordLength(passwordTarget?.role) || newPassword !== newPasswordConfirmation} icon={<KeyRound size={16} aria-hidden />}>
            パスワードを変更
          </Button>
        )}
      >
            <div className="space-y-4">
              <div className="rounded-btn border border-amber-200 bg-amber-50 p-4 text-xs font-bold leading-6 text-amber-800">
                初回ログイン済みのアカウントも変更できます。変更後は現在のログイン状態が失効し、新しいパスワードでの再ログインが必要です。
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line bg-white p-3 text-xs font-bold text-slate-600">
                <span>ログインに続けて失敗してロックされたときは、ここで解けます。</span>
                <Button variant="secondary" size="sm" onClick={releaseLoginLock} loading={releasingLock}>ロックを解く</Button>
              </div>
              <label className="block space-y-1"><span className="text-xs font-bold text-slate-600">新しいパスワード</span><input type="password" autoComplete="new-password" minLength={minPasswordLength(passwordTarget?.role)} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder={`${minPasswordLength(passwordTarget?.role)}文字以上`} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 font-mono outline-none focus:border-accent" /></label>
              <label className="block space-y-1"><span className="text-xs font-bold text-slate-600">新しいパスワード（確認）</span><input type="password" autoComplete="new-password" minLength={minPasswordLength(passwordTarget?.role)} maxLength={128} value={newPasswordConfirmation} onChange={event => setNewPasswordConfirmation(event.target.value)} placeholder="同じパスワードを再入力" className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 font-mono outline-none focus:border-accent" /></label>
            </div>
      </Modal>
    </div>
  );
}

function FirstLoginBadge({ value }: { value: unknown }) {
  const completed = value === false;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {completed ? '初回ログイン済み' : '初回変更待ち'}
    </span>
  );
}
