'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckSquare, Filter, Search, Square, User, Users } from 'lucide-react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, EmptyState, ErrorState, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';

type ManagedUser = { id: string; role?: string; name?: string; student_name?: string; lifetime_id?: string; grade?: string; account_status?: string; status?: string };

export default function AccountArchivePage() {
  const toast = useToast();
  const confirm = useConfirm();
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
      console.error('Archive target fetch failed:', error);
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
    if (ids.length > 100) return toast.error('一度にアーカイブできるのは100件までです。');
    const names = users.filter(user => selectedIds.has(user.id)).map(user => user.student_name || user.name || user.lifetime_id || user.id);
    const targetLabel = names.length === 1 ? `「${names[0]}」` : `「${names.slice(0, 3).join('」「')}」${names.length > 3 ? `ほか${names.length - 3}名` : ''}`;
    if (!(await confirm({
      title: `${targetLabel}を利用停止しますか？`,
      message: `選択した ${ids.length} 名を利用停止し、アーカイブします。ログインとデータアクセスは即時に拒否されます。データは削除されず、管理者が復旧できます。`,
      confirmLabel: `${ids.length}名を停止する`,
      tone: 'danger',
    }))) return;
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
      toast.success(`${result.count || ids.length}件をアーカイブしました。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'アーカイブできませんでした。');
    } finally { setIsProcessing(false); }
  };

  const visibleAllSelected = filteredUsers.length > 0 && filteredUsers.every(user => selectedIds.has(user.id));

  return <div className="text-slate-800"><div>
    <AdminPageHeader description="退塾・退職者を利用停止します。誤操作時はアカウント管理から復旧できます。" />
    <div className="mb-4 flex gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950"><AlertTriangle className="mt-0.5 shrink-0" size={20} aria-hidden /><p>この画面ではデータを物理削除しません。法定保存期間後の完全削除は、対象データと承認記録を確認する別の運用手順で行ってください。</p></div>
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-sm"><div className="space-y-4 border-b border-line bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><AdminTabs ariaLabel="対象の種類" value={role} onChange={setRole} tabs={[{ id: 'student', label: '生徒', icon: User }, { id: 'teacher', label: '講師', icon: Users }]} />
        <div className="flex flex-wrap gap-2">{role === 'student' && <label className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-white px-3"><Filter size={16} aria-hidden /><select aria-label="学年" value={filterGrade} onChange={event => setFilterGrade(event.target.value)} className="bg-transparent py-2 text-sm"><option value="">全学年</option>{['中1','中2','中3','高1','高2','高3','卒業'].map(value => <option key={value}>{value}</option>)}</select></label>}<label className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-white px-3"><Search size={16} aria-hidden /><input aria-label="名前・IDで検索" value={searchName} onChange={event => setSearchName(event.target.value)} placeholder="名前・IDで検索" className="w-52 py-2 text-sm outline-none" /></label></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={toggleAll} disabled={filteredUsers.length === 0} className="flex items-center gap-2 text-sm font-bold text-slate-600 disabled:opacity-50">{visibleAllSelected ? <CheckSquare className="text-accent" aria-hidden /> : <Square aria-hidden />} 表示中{filteredUsers.length}件を選択</button><Button variant="danger" onClick={handleArchive} disabled={selectedIds.size === 0} loading={isProcessing} icon={<Archive size={16} aria-hidden />}>{selectedIds.size}件をアーカイブ</Button></div>
    </div>
    {loadError && <ErrorState className="m-4" message={loadError} onRetry={() => void fetchUsers()} />}
    {loading ? <div className="p-4"><ListSkeleton rows={5} /></div> : <div className="divide-y divide-slate-100">{filteredUsers.map(user => <label key={user.id} className="flex cursor-pointer items-center gap-4 p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} className="h-4 w-4 accent-accent" /><div className="min-w-0"><p className="font-bold">{user.student_name || user.name || '名前未登録'}</p><p className="text-xs text-slate-500">ID: {user.lifetime_id || user.id}{user.grade ? ` / ${user.grade}` : ''}</p></div></label>)}{!loadError && filteredUsers.length === 0 && <EmptyState className="m-4" title="対象アカウントはありません" description={searchName || filterGrade ? '検索語や学年の絞り込みを変えてください。' : '利用中のアカウントがここに表示されます。'} />}</div>}
    </div>
  </div></div>;
}
