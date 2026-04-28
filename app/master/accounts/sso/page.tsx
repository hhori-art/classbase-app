'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import {
  Building2,
  CheckCircle2,
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
  password: 'class1234',
  email: '',
  school_id: '',
  school_ids: '',
  account_status: 'active',
  grade: '中1',
  classroom: '',
  day_of_week: '',
  subject_science: '',
  subject_social: '',
  student_ids: '',
};

export default function SsoAccountConsolePage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState('all');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [savingAccount, setSavingAccount] = useState(false);

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
      if (role !== 'all' && (u.role || 'student') !== role) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [users, school, status, role, search]);

  const stats = useMemo(() => {
    return STATUSES.reduce((acc, item) => {
      acc[item.id] = users.filter(u => (u.account_status || u.status || 'active') === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [users]);

  const roleStats = useMemo(() => {
    return ROLES.reduce((acc, item) => {
      acc[item.id] = users.filter(u => (u.role || 'student') === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [users]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('created_at', 'desc')));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {
      const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher', 'parent', 'admin', 'master'])));
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
    setModalOpen(true);
  };

  const openEditModal = (target: any) => {
    setForm({
      role: target.role || 'student',
      display_name: target.student_name || target.parent_name || target.name || '',
      login_id: target.lifetime_id || target.initial_login_id || '',
      password: target.initial_password || target.raw_password || 'class1234',
      email: target.email || '',
      school_id: target.school_id || target.school || '',
      school_ids: Array.isArray(target.school_ids) ? target.school_ids.join(',') : '',
      account_status: target.account_status || target.status || 'active',
      grade: target.grade || '中1',
      classroom: target.classroom || '',
      day_of_week: target.day_of_week || '',
      subject_science: target.subject_science || target.science_subject || '',
      subject_social: target.subject_social || target.social_subject || '',
      student_ids: Array.isArray(target.student_ids) ? target.student_ids.join(',') : '',
    });
    setModalOpen(true);
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
    if (!form.password.trim() || form.password.length < 6) return alert('パスワードは6文字以上で入力してください');
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

        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_180px]">
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
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
            <option value="all">すべての状態</option>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-700"><UsersRound size={18} /> アカウント一覧</h2>
          <span className="text-xs font-black text-slate-400">{filteredUsers.length}件</span>
        </div>
        {loading ? (
          <div className="flex justify-center p-10"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-400">
                <tr>
                  <th className="px-5 py-3">ユーザー</th>
                  <th className="px-5 py-3">権限</th>
                  <th className="px-5 py-3">校舎</th>
                  <th className="px-5 py-3">初期ID</th>
                  <th className="px-5 py-3">紐づけ</th>
                  <th className="px-5 py-3">状態</th>
                  <th className="px-5 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(u => {
                  const currentStatus = u.account_status || u.status || 'active';
                  const displayName = u.student_name || u.parent_name || u.name || u.teacher_name || '名称未設定';
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <button onClick={() => openEditModal(u)} className="text-left hover:text-indigo-600">
                          <p className="font-black text-slate-800">{displayName}</p>
                          <p className="text-xs font-bold text-slate-400">{u.email || u.id}</p>
                        </button>
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-500">{roleLabel(u.role || 'student')}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
                          <Building2 size={12} /> {u.school || u.school_id || u.classroom || '未設定'}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-500">{u.lifetime_id || u.initial_login_id || '-'}</td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-500">
                        {u.role === 'parent' ? `${Array.isArray(u.student_ids) ? u.student_ids.length : 0}名の生徒` : Array.isArray(u.school_ids) && u.school_ids.length ? `${u.school_ids.length}校舎` : '-'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                          {STATUSES.find(s => s.id === currentStatus)?.label || currentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => openEditModal(u)} className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-black text-indigo-600 hover:bg-indigo-50">編集</button>
                          {STATUSES.map(s => (
                            <button key={s.id} onClick={() => updateStatus(u, s.id)} disabled={savingId === u.id || currentStatus === s.id} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-black text-slate-600 hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                    {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">状態</span>
                  <select value={form.account_status} onChange={e => setForm(prev => ({ ...prev, account_status: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                    {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
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
                  <input value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none" />
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
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-black text-slate-500">紐づく生徒ID</span>
                    <input value={form.student_ids} onChange={e => setForm(prev => ({ ...prev, student_ids: e.target.value }))} placeholder="Firestore UIDをカンマ区切りで入力" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm font-bold outline-none" />
                    <span className="block text-[11px] font-bold text-slate-400">
                      生徒候補: {students.slice(0, 5).map(s => `${s.student_name || s.name || '生徒'}=${s.id}`).join(' / ')}
                    </span>
                  </label>
                )}

                {(form.role === 'admin' || form.role === 'master') && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-black text-slate-500">管理できる校舎</span>
                    <input value={form.school_ids} onChange={e => setForm(prev => ({ ...prev, school_ids: e.target.value }))} placeholder="校舎IDをカンマ区切りで入力" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
                  </label>
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

