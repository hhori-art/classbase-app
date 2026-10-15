'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Archive, ArrowLeft, CheckSquare, Filter, Loader2, Search, Square, User, Users } from 'lucide-react';
import { auth } from '@/lib/firebase';

type ManagedUser = { id: string; role?: string; name?: string; student_name?: string; lifetime_id?: string; grade?: string; account_status?: string; status?: string };

export default function AccountArchivePage() {
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchName, setSearchName] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const response = await fetch(`/api/admin/users?role=${role}&limit=500`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'アカウントを取得できませんでした。');
      setUsers((Array.isArray(result.users) ? result.users : []).filter((item: ManagedUser) => !['archived', 'withdrawn'].includes(String(item.account_status || item.status || '').toLowerCase())));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'アカウントを取得できませんでした。');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    setSelectedIds(new Set());
    setFilterGrade('');
    setSearchName('');
    void fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => users.filter(user => {
    const needle = searchName.trim().toLowerCase();
    const searchable = [user.student_name, user.name, user.lifetime_id].map(value => String(value || '').toLowerCase());
    return (!needle || searchable.some(value => value.includes(needle))) && (!filterGrade || user.grade === filterGrade);
  }), [filterGrade, searchName, users]);

  const toggleSelect = (id: string) => setSelectedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelectedIds(current => {
    const visibleIds = filteredUsers.map(user => user.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => current.has(id));
    const next = new Set(current);
    visibleIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
    return next;
  });

  const handleArchive = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || isProcessing) return;
    if (ids.length > 100) return alert('一度にアーカイブできるのは100件までです。');
    if (!confirm(`選択した ${ids.length} 名を利用停止し、アーカイブします。\n\nログインとデータアクセスは即時に拒否されます。データは削除されず、管理者が復旧できます。`)) return;
    setIsProcessing(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error('ログイン情報を確認できません。');
      const response = await fetch('/api/admin/accounts/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: ids, status: 'archived' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'アーカイブできませんでした。');
      setUsers(current => current.filter(user => !selectedIds.has(user.id)));
      setSelectedIds(new Set());
      alert(`${result.count || ids.length}件をアーカイブしました。`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'アーカイブできませんでした。');
    } finally { setIsProcessing(false); }
  };

  const visibleAllSelected = filteredUsers.length > 0 && filteredUsers.every(user => selectedIds.has(user.id));

  return <div className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-8"><div className="mx-auto max-w-6xl">
    <div className="mb-6 flex items-center gap-4"><Link href="/master/accounts" className="rounded-full bg-white p-2 shadow hover:bg-slate-100" aria-label="アカウント管理へ戻る"><ArrowLeft size={24} /></Link><div><h1 className="flex items-center gap-2 text-2xl font-black sm:text-3xl"><Archive className="text-amber-600" /> 利用停止・アーカイブ</h1><p className="mt-1 text-sm text-slate-500">退塾・退職者を利用停止します。誤操作時はアカウント管理から復旧できます。</p></div></div>
    <div className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950"><AlertTriangle className="mt-0.5 shrink-0" size={20} /><p>この画面ではデータを物理削除しません。法定保存期間後の完全削除は、対象データと承認記録を確認する別の運用手順で行ってください。</p></div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="space-y-4 border-b bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-lg border bg-white p-1"><button onClick={() => setRole('student')} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold ${role === 'student' ? 'bg-green-100 text-green-800' : 'text-slate-500'}`}><User size={16} />生徒</button><button onClick={() => setRole('teacher')} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold ${role === 'teacher' ? 'bg-violet-100 text-violet-800' : 'text-slate-500'}`}><Users size={16} />講師</button></div>
        <div className="flex flex-wrap gap-2">{role === 'student' && <label className="flex items-center gap-2 rounded-lg border bg-white px-3"><Filter size={16} /><select value={filterGrade} onChange={event => setFilterGrade(event.target.value)} className="bg-transparent py-2 text-sm"><option value="">全学年</option>{['中1','中2','中3','高1','高2','高3','卒業'].map(value => <option key={value}>{value}</option>)}</select></label>}<label className="flex items-center gap-2 rounded-lg border bg-white px-3"><Search size={16} /><input value={searchName} onChange={event => setSearchName(event.target.value)} placeholder="名前・IDで検索" className="w-52 py-2 text-sm outline-none" /></label></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={toggleAll} disabled={filteredUsers.length === 0} className="flex items-center gap-2 text-sm font-bold text-slate-600 disabled:opacity-50">{visibleAllSelected ? <CheckSquare className="text-blue-600" /> : <Square />} 表示中{filteredUsers.length}件を選択</button><button onClick={handleArchive} disabled={isProcessing || selectedIds.size === 0} className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Archive size={18} />}{selectedIds.size}件をアーカイブ</button></div>
    </div>
    {loadError && <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"><p>{loadError}</p><button onClick={() => void fetchUsers()} className="mt-3 rounded bg-red-700 px-4 py-2 text-white">再読込</button></div>}
    {loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : <div className="divide-y">{filteredUsers.map(user => <label key={user.id} className="flex cursor-pointer items-center gap-4 p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} className="h-4 w-4" /><div className="min-w-0"><p className="font-bold">{user.student_name || user.name || '名前未登録'}</p><p className="text-xs text-slate-500">ID: {user.lifetime_id || user.id}{user.grade ? ` / ${user.grade}` : ''}</p></div></label>)}{!loadError && filteredUsers.length === 0 && <p className="p-12 text-center text-sm font-bold text-slate-400">対象アカウントはありません。</p>}</div>}
    </div>
  </div></div>;
}
