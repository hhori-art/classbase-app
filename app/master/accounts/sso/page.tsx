'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LockKeyhole,
  PauseCircle,
  Plus,
  Search,
  Shield,
  UserCog,
  UserPlus,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import LastLoginCell from '@/app/components/LastLoginCell';
import { normalizeAdminAppPermissions } from '@/lib/admin-app-permissions';
import { EMPLOYMENT_CATEGORY_LABELS, isAttendanceUserRole, normalizeEmploymentCategory } from '@/lib/employment-category';
import { useAuth } from '@/app/context/AuthContext';

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
  role: 'student',
  display_name: '',
  login_id: '',
  password: '',
  email: '',
  school_id: '',
  school_ids: '',
  account_status: 'active',
  employment_category: 'semi_dedicated',
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
  },
};

const ACCOUNT_PAGE_SIZE = 50;
const accountRole = (value: unknown) => ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(value || '').toLowerCase()) ? 'teacher' : String(value || 'student');

export default function SsoAccountConsolePage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  const schools = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => {
      const value = u.school || u.school_id || u.classroom;
      if (value) set.add(value);
    });
    return Array.from(set).sort();
  }, [users]);

  const students = useMemo(() => users.filter(u => u.role === 'student'), [users]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const schoolValue = u.school || u.school_id || u.classroom || '';
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

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ACCOUNT_PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * ACCOUNT_PAGE_SIZE;
    return filteredUsers.slice(start, start + ACCOUNT_PAGE_SIZE);
  }, [filteredUsers, page]);

  const visibleTeacherIds = useMemo(
    () => paginatedUsers.filter(user => accountRole(user.role) === 'teacher').map(user => user.id),
    [paginatedUsers],
  );
  const allVisibleTeachersSelected = visibleTeacherIds.length > 0 && visibleTeacherIds.every(id => selectedTeacherIds.has(id));

  useEffect(() => {
    setPage(1);
  }, [school, status, role, employmentCategory, search, firstLoginFilter]);

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
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('created_at', 'desc')));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {
      const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher', 'parent', 'admin', 'master', 'attendance_admin'])));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
      role: accountRole(target.role),
      display_name: target.student_name || target.parent_name || target.name || '',
      login_id: target.lifetime_id || target.initial_login_id || '',
      password: target.initial_password || target.raw_password || '',
      email: target.email || '',
      school_id: target.school_id || target.school || '',
      school_ids: Array.isArray(target.school_ids) ? target.school_ids.join(',') : '',
      account_status: target.account_status || target.status || 'active',
      employment_category: normalizeEmploymentCategory(target.employment_category || target.employment_type || target.worker_type, target.role) || 'semi_dedicated',
      prescribed_work_start: target.prescribed_work_start || '09:00',
      prescribed_work_end: target.prescribed_work_end || '18:00',
      prescribed_break_minutes: Number(target.prescribed_break_minutes ?? 60),
      prescribed_work_days: Array.isArray(target.prescribed_work_days) ? target.prescribed_work_days.map(Number).filter((value: number) => value >= 0 && value <= 6) : [1, 2, 3, 4, 5],
      enabled_programs: Array.isArray(target.enabled_programs) ? target.enabled_programs.filter((value: unknown) => value === 'science_social') : [],
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
        const haystack = `${student.student_name || student.name || ''} ${student.lifetime_id || student.initial_login_id || ''} ${student.school || student.school_id || student.classroom || ''}`.toLowerCase();
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

  const updateStatus = async (target: any, nextStatus: string) => {
    if (!confirm(`${target.student_name || target.parent_name || target.name || target.email || target.id} を「${STATUSES.find(s => s.id === nextStatus)?.label}」に変更しますか？`)) return;
    setSavingId(target.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: target.id, status: nextStatus }),
      });
      if (!res.ok) throw new Error('failed');
      setUsers(prev => prev.map(u => u.id === target.id ? { ...u, account_status: nextStatus, status: nextStatus } : u));
    } catch {
      alert('状態変更に失敗しました。権限または校舎設定を確認してください。');
    } finally {
      setSavingId('');
    }
  };

  const saveAccount = async () => {
    if (!form.display_name.trim()) return alert('氏名は必須です');
    if (!form.login_id.trim()) return alert('初期IDは必須です');
    if (form.password.trim() && form.password.length < 6) return alert('パスワードは6文字以上で入力してください');
    if (form.role !== 'student' && !form.password.trim()) return alert('生徒以外はパスワードを入力してください');
    if ((form.role === 'admin' || form.role === 'master') && !form.school_ids.trim() && form.role === 'admin') {
      return alert('校舎管理者には管理できる校舎を入力してください');
    }
    if (form.role === 'parent' && !form.student_ids.trim()) {
      return alert('保護者には紐づく生徒IDを入力してください');
    }

    setSavingAccount(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setModalOpen(false);
      await fetchUsers();
      alert(data.updated ? 'アカウントを更新しました' : 'アカウントを作成しました');
    } catch (error: any) {
      alert(`保存に失敗しました: ${error.message || error}`);
    } finally {
      setSavingAccount(false);
    }
  };

  const initializeEmploymentCategories = async () => {
    const targets = users.filter(item => isAttendanceUserRole(item.role) && (!item.employment_category || accountRole(item.role) !== item.role)).length;
    if (!targets) return alert('移行が必要な講師アカウントはありません。');
    if (!confirm(`対象${targets}アカウントについて、旧勤怠管理者を講師へ統合し、区分未設定を「準専任」に設定しますか？`)) return;
    setInitializingCategories(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/accounts/employment-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'initialize_missing' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '一括設定に失敗しました。');
      await fetchUsers();
      alert(`${body.updated || 0}アカウントを更新しました（講師へ統合: ${body.migrated_roles || 0}件）。`);
    } catch (error: any) {
      alert(`一括設定に失敗しました: ${error.message || error}`);
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
    if (!userIds.length) return alert('対象の講師を選択してください。');
    const actionLabel = enabled ? 'ON' : 'OFF';
    if (!confirm(`選択した${userIds.length}名の理社講座を一括${actionLabel}にしますか？`)) return;
    setUpdatingTeacherPrograms(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/accounts/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: userIds, program: 'science_social', enabled }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '一括更新に失敗しました。');
      await fetchUsers();
      setSelectedTeacherIds(new Set());
      alert(`${body.updated || 0}名の理社講座を${actionLabel}にしました。`);
    } catch (error: any) {
      alert(`一括更新に失敗しました: ${error.message || error}`);
    } finally {
      setUpdatingTeacherPrograms(false);
    }
  };

  const roleLabel = (value: string) => ROLES.find(r => r.id === value)?.label || value;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-950">
                <Shield size={24} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Single Sign-On</p>
                <h1 className="text-2xl font-black">校舎別アカウント管理</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => openCreateModal('student')} className="flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-indigo-50">
                <UserPlus size={18} /> 新規作成
              </button>
              <button onClick={() => openCreateModal('parent')} className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-4 py-3 text-sm font-black text-white hover:bg-indigo-400">
                <UsersRound size={18} /> 保護者作成
              </button>
              <button onClick={() => openCreateModal('admin')} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black text-white ring-1 ring-white/10 hover:bg-slate-700">
                <UserCog size={18} /> 校舎管理者
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-6">
          {STATUSES.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setStatus(item.id)} className={`rounded-2xl border p-4 text-left ${item.className}`}>
                <Icon size={20} />
                <p className="mt-3 text-xs font-black">{item.label}</p>
                <p className="text-3xl font-black">{stats[item.id] || 0}</p>
              </button>
            );
          })}
          <button onClick={() => setFirstLoginFilter('pending')} className={`rounded-2xl border p-4 text-left ${firstLoginFilter === 'pending' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-amber-100 bg-amber-50/70 text-amber-700'}`}>
            <LockKeyhole size={20} />
            <p className="mt-3 text-xs font-black">初回変更待ち</p>
            <p className="text-3xl font-black">{firstLoginStats.pending}</p>
          </button>
          <button onClick={() => setFirstLoginFilter('completed')} className={`rounded-2xl border p-4 text-left ${firstLoginFilter === 'completed' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-emerald-100 bg-emerald-50/70 text-emerald-700'}`}>
            <CheckCircle2 size={20} />
            <p className="mt-3 text-xs font-black">初回ログイン済み</p>
            <p className="text-3xl font-black">{firstLoginStats.completed}</p>
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ROLES.map(item => (
          <button
            key={item.id}
            onClick={() => setRole(item.id)}
            className={`rounded-2xl border p-4 text-left shadow-sm transition ${role === item.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-white bg-white text-slate-600 hover:border-slate-200'}`}
          >
            <p className="text-xs font-black">{item.label}</p>
            <p className="mt-1 text-2xl font-black">{roleStats[item.id] || 0}</p>
          </button>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_190px_160px_150px_160px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="氏名・ID・メールで検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
          <select value={school} onChange={e => setSchool(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">すべての校舎</option>
            {schools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">すべての権限</option>
            {ROLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={employmentCategory} onChange={e => setEmploymentCategory(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">専任区分すべて</option>
            <option value="dedicated">専任</option>
            <option value="semi_dedicated">準専任</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">すべての状態</option>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={firstLoginFilter} onChange={e => setFirstLoginFilter(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">初回状態すべて</option>
            <option value="pending">初回変更待ち</option>
            <option value="completed">初回ログイン済み</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold text-slate-500">旧勤怠管理者は講師へ統合します。理社講座を設定しない講師には勤怠だけが表示されます。</p>
          <button type="button" onClick={initializeEmploymentCategories} disabled={initializingCategories} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{initializingCategories && <Loader2 size={14} className="animate-spin" />} 旧権限・未設定区分を一括移行</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-black text-slate-700"><UsersRound size={18} /> アカウント一覧</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">{filteredUsers.length}件 / 講師{selectedTeacherIds.size}名を選択中</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => bulkUpdateScienceSocial(true)} disabled={!selectedTeacherIds.size || updatingTeacherPrograms} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">{updatingTeacherPrograms && <Loader2 size={14} className="animate-spin" />} 理社講座 一括ON</button>
            <button type="button" onClick={() => bulkUpdateScienceSocial(false)} disabled={!selectedTeacherIds.size || updatingTeacherPrograms} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-40">理社講座 一括OFF</button>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center p-10"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : (
          <div className="overflow-x-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1380px] whitespace-nowrap text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-400">
                <tr>
                  <th className="px-5 py-3">
                    <input type="checkbox" aria-label="このページの講師をすべて選択" checked={allVisibleTeachersSelected} disabled={!visibleTeacherIds.length} onChange={event => toggleVisibleTeachers(event.target.checked)} className="h-4 w-4 accent-indigo-600 disabled:opacity-30" />
                  </th>
                  <th className="px-5 py-3">ユーザー</th>
                  <th className="px-5 py-3">権限</th>
                  <th className="px-5 py-3">専任区分</th>
                  <th className="px-5 py-3">校舎</th>
                  <th className="px-5 py-3">初期ID</th>
                  <th className="px-5 py-3">初回ログイン</th>
                  <th className="px-5 py-3">最終ログイン</th>
                  <th className="px-5 py-3">紐づけ</th>
                  <th className="px-5 py-3">状態</th>
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
                          <input type="checkbox" aria-label={`${displayName}を選択`} checked={selectedTeacherIds.has(u.id)} onChange={event => setSelectedTeacherIds(current => { const next = new Set(current); event.target.checked ? next.add(u.id) : next.delete(u.id); return next; })} className="h-4 w-4 accent-indigo-600" />
                        ) : <span className="text-slate-200">―</span>}
                      </td>
                      <td className="px-5 py-4">
                        <button onClick={() => openEditModal(u)} className="max-w-[240px] text-left hover:text-indigo-600" title={`${displayName} / ${u.email || u.id}`}>
                          <p className="truncate font-black text-slate-800">{displayName}</p>
                          <p className="truncate text-xs font-bold text-slate-400">{u.email || u.id}</p>
                        </button>
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-500">{roleLabel(accountRole(u.role))}</td>
                      <td className="px-5 py-4">
                        {isAttendanceUserRole(u.role) ? (() => {
                          const category = normalizeEmploymentCategory(u.employment_category || u.employment_type || u.worker_type, u.role) || 'semi_dedicated';
                          return <span className={`rounded-full px-3 py-1 text-xs font-black ${category === 'dedicated' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>{EMPLOYMENT_CATEGORY_LABELS[category]}</span>;
                        })() : <span className="text-slate-300">―</span>}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
                          <Building2 size={12} /> {u.school || u.school_id || u.classroom || '未設定'}
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
                          ? (Array.isArray(u.enabled_programs) && u.enabled_programs.includes('science_social') ? '理社講座＋勤怠' : '勤怠のみ')
                          : u.role === 'parent'
                            ? `${Array.isArray(u.student_ids) ? u.student_ids.length : 0}名の生徒`
                            : Array.isArray(u.school_ids) && u.school_ids.length ? `${u.school_ids.length}校舎` : '-'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                          {STATUSES.find(s => s.id === currentStatus)?.label || currentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEditModal(u)} className="shrink-0 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-black text-indigo-600 hover:bg-indigo-50">編集</button>
                          <select
                            aria-label={`${displayName}のアカウント状態`}
                            value={currentStatus}
                            onChange={e => updateStatus(u, e.target.value)}
                            disabled={savingId === u.id}
                            className="min-w-[112px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 outline-none hover:border-slate-300 disabled:cursor-wait disabled:opacity-50"
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
        {!loading && filteredUsers.length > ACCOUNT_PAGE_SIZE && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-400">
              {(page - 1) * ACCOUNT_PAGE_SIZE + 1}〜{Math.min(page * ACCOUNT_PAGE_SIZE, filteredUsers.length)}件を表示 / 全{filteredUsers.length}件
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} aria-label="前のページ" className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-30">
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-20 text-center text-xs font-black text-slate-600">{page} / {totalPages}</span>
              <button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="次のページ" className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-30">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-indigo-400">Account Provisioning</p>
                <h3 className="text-xl font-black text-slate-900">新規・更新アカウント</h3>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">権限</span>
                  <select value={form.role} onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                    {ROLES
                      .filter(r => profile?.role === 'master' || !['admin', 'master'].includes(r.id))
                      .map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">状態</span>
                  <select value={form.account_status} onChange={e => setForm(prev => ({ ...prev, account_status: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                    {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                {form.role === 'teacher' && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-black text-slate-500">専任区分</span>
                    <select value={form.employment_category} onChange={e => setForm(prev => ({ ...prev, employment_category: e.target.value }))} className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-900 outline-none">
                      <option value="dedicated">専任</option>
                      <option value="semi_dedicated">準専任</option>
                    </select>
                    <span className="block text-[11px] font-bold text-slate-400">勤怠画面・給与集計・授業実績の対象をこの区分で分離します。</span>
                  </label>
                )}
                {form.role === 'teacher' && form.employment_category === 'dedicated' && (
                  <fieldset className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:col-span-2">
                    <legend className="px-2 text-xs font-black text-indigo-700">専任の規定勤務時間</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-black text-slate-600">開始<input required type="time" value={form.prescribed_work_start} onChange={event => setForm(prev => ({ ...prev, prescribed_work_start: event.target.value }))} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                      <label className="text-xs font-black text-slate-600">終了<input required type="time" value={form.prescribed_work_end} onChange={event => setForm(prev => ({ ...prev, prescribed_work_end: event.target.value }))} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                      <label className="text-xs font-black text-slate-600">休憩（分）<input required type="number" min="0" max="240" step="5" value={form.prescribed_break_minutes} onChange={event => setForm(prev => ({ ...prev, prescribed_break_minutes: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['日', '月', '火', '水', '木', '金', '土'].map((label, day) => <label key={day} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-black ${form.prescribed_work_days.includes(day) ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-indigo-200 bg-white text-slate-500'}`}><input type="checkbox" className="sr-only" checked={form.prescribed_work_days.includes(day)} onChange={event => setForm(prev => ({ ...prev, prescribed_work_days: event.target.checked ? [...prev.prescribed_work_days, day].sort() : prev.prescribed_work_days.filter(value => value !== day) }))} />{label}</label>)}
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-indigo-600">この時間より前・後の打刻実績を時間外候補として自動抽出します。</p>
                  </fieldset>
                )}
                {form.role === 'teacher' && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-black text-slate-500">利用する講座</span>
                    <span className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4">
                      <input type="checkbox" checked={form.enabled_programs.includes('science_social')} onChange={event => setForm(prev => ({ ...prev, enabled_programs: event.target.checked ? ['science_social'] : [] }))} className="h-5 w-5 accent-indigo-600" />
                      <span><span className="block text-sm font-black text-slate-800">理社講座</span><span className="block text-[11px] font-bold text-slate-400">ONなら理社講座と勤怠、OFFなら勤怠だけを表示</span></span>
                    </span>
                  </label>
                )}
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">氏名</span>
                  <input value={form.display_name} onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">初期ID</span>
                  <input value={form.login_id} onChange={e => setForm(prev => ({ ...prev, login_id: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">初期パスワード</span>
                  <input
                    value={form.password}
                    onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder={form.role === 'student' ? '空欄なら自動発行' : '6文字以上で入力'}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">メール</span>
                  <input value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="空欄なら 初期ID@classbase.local" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">所属校舎</span>
                  <input value={form.school_id} onChange={e => setForm(prev => ({ ...prev, school_id: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                </label>

                {form.role === 'student' && (
                  <>
                    <label className="space-y-1">
                      <span className="text-xs font-black text-slate-500">学年</span>
                      <select value={form.grade} onChange={e => setForm(prev => ({ ...prev, grade: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                        {['中1', '中2', '中3', 'その他'].map(g => <option key={g}>{g}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-black text-slate-500">教室</span>
                      <input value={form.classroom} onChange={e => setForm(prev => ({ ...prev, classroom: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-black text-slate-500">理科科目</span>
                      <input value={form.subject_science} onChange={e => setForm(prev => ({ ...prev, subject_science: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-black text-slate-500">社会科目</span>
                      <input value={form.subject_social} onChange={e => setForm(prev => ({ ...prev, subject_social: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                  </>
                )}

                {form.role === 'parent' && (
                  <div className="space-y-3 sm:col-span-2">
                    <label className="space-y-1">
                      <span className="text-xs font-black text-slate-500">紐づく生徒</span>
                      <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="生徒名・ログインID・校舎で検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300" />
                    </label>
                    {selectedStudentIds.length > 0 && (
                      <p className="text-xs font-black text-indigo-600">{selectedStudentIds.length}名を選択中</p>
                    )}
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2">
                      {parentStudentCandidates.length > 0 ? parentStudentCandidates.map(student => {
                        const checked = selectedStudentIds.includes(student.id);
                        return (
                          <label key={student.id} className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-3 shadow-sm">
                            <input type="checkbox" checked={checked} onChange={() => toggleParentStudent(student.id)} className="h-5 w-5 accent-indigo-600" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-black text-slate-800">{student.student_name || student.name || '氏名未設定'}</span>
                              <span className="block truncate text-[11px] font-bold text-slate-400">{student.lifetime_id || student.initial_login_id || 'ID未設定'} / {student.school || student.school_id || student.classroom || '校舎未設定'}</span>
                            </span>
                          </label>
                        );
                      }) : (
                        <p className="px-3 py-5 text-center text-xs font-bold text-slate-400">生徒名またはログインIDを入力してください</p>
                      )}
                    </div>
                  </div>
                )}

                {(form.role === 'admin' || form.role === 'master') && (
                  <>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-black text-slate-500">管理できる校舎</span>
                      <input value={form.school_ids} onChange={e => setForm(prev => ({ ...prev, school_ids: e.target.value }))} placeholder="校舎IDをカンマ区切りで入力" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                    </label>
                    {profile?.role === 'master' && form.role === 'admin' && (
                      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                        <legend className="px-2 text-xs font-black text-slate-600">利用できる管理画面</legend>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {[
                            ['science_social', '理社講座 管理'],
                            ['eiken', 'Booster 管理'],
                            ['attendance', '勤怠 管理'],
                          ].map(([key, label]) => (
                            <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
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
                                className="h-5 w-5 accent-slate-900"
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
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button onClick={saveAccount} disabled={savingAccount} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
                {savingAccount ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                アカウントを保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FirstLoginBadge({ value }: { value: unknown }) {
  const completed = value === false;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {completed ? '初回ログイン済み' : '初回変更待ち'}
    </span>
  );
}
