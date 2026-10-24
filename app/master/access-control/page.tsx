'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, History, Loader2, LockKeyhole, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import {
  ADMIN_APP_IDS,
  ADMIN_APP_LABELS,
  isConfigurableAdminRole,
  type AdminAppId,
  type AdminAppPermissions,
} from '@/lib/admin-app-permissions';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

type AdminAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  school_ids: string[];
  permissions: AdminAppPermissions;
  explicitly_configured: boolean;
  permissions_updated_at?: string | null;
};

type PermissionHistory = {
  id: string;
  target_user_id: string;
  target_name: string;
  actor_uid: string;
  actor_email: string;
  permissions: AdminAppPermissions;
  created_at: string | null;
};

const PERMISSION_PRESETS: Array<{ label: string; permissions: AdminAppPermissions }> = [
  { label: '理社講座のみ', permissions: { science_social: true, eiken: false, attendance: false, online_school: false } },
  { label: 'Boosterのみ', permissions: { science_social: false, eiken: true, attendance: false, online_school: false } },
  { label: '勤怠のみ', permissions: { science_social: false, eiken: false, attendance: true, online_school: false } },
  { label: 'オンライン校のみ', permissions: { science_social: false, eiken: false, attendance: false, online_school: true } },
  { label: 'すべて', permissions: { science_social: true, eiken: true, attendance: true, online_school: true } },
  { label: 'すべて停止', permissions: { science_social: false, eiken: false, attendance: false, online_school: false } },
];

export default function AdminAccessControlPage() {
  const { user, profile } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [history, setHistory] = useState<PermissionHistory[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState('');

  const loadAccounts = useCallback(async () => {
    if (!user || profile?.role !== 'master') return;
    setLoading(true);
    setError('');
    setLoadFailed('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/app-permissions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || '権限情報を取得できませんでした。');
      setAccounts((data.accounts || []).filter((account: AdminAccount) =>
        isConfigurableAdminRole(account.role)
      ));
      setHistory(data.history || []);
    } catch (loadError) {
      console.error('Admin app permissions fetch failed:', loadError);
      setLoadFailed(loadError instanceof Error ? loadError.message : '権限情報を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [profile?.role, user]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(account =>
      `${account.name} ${account.email} ${account.school_ids.join(' ')}`
        .toLowerCase()
        .includes(needle),
    );
  }, [accounts, search]);

  const legacyCount = useMemo(
    () => accounts.filter(account => !account.explicitly_configured).length,
    [accounts],
  );

  const savePermissions = async (account: AdminAccount, permissions: AdminAppPermissions) => {
    setSavingId(account.id);
    setError('');
    try {
      const token = await user?.getIdToken();
      const response = await fetch('/api/admin/app-permissions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: account.id, permissions }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || '権限を保存できませんでした。');
      setAccounts(current => current.map(item =>
        item.id === account.id
          ? {
              ...item,
              permissions: data.permissions,
              explicitly_configured: true,
              permissions_updated_at: data.audit?.created_at || new Date().toISOString(),
            }
          : item,
      ));
      if (data.audit) setHistory(current => [data.audit, ...current].slice(0, 30));
      toast.success(`${account.name || '管理者'}の権限を保存しました。`);
    } catch (saveError) {
      setError(userErrorMessage(saveError, '権限を保存できませんでした。'));
    } finally {
      setSavingId('');
    }
  };

  const togglePermission = async (account: AdminAccount, app: AdminAppId) => {
    // 権限を外すと、その人は次に画面を移ったときにメニューを失うので、外すときだけ確かめる。
    if (account.permissions[app] && !(await confirm({ title: `${account.name || 'この管理者'}の「${ADMIN_APP_LABELS[app]}」を外しますか？`, message: '外すと、その画面を開けなくなります。', tone: 'danger', confirmLabel: '外す' }))) return;
    await savePermissions(account, {
      ...account.permissions,
      [app]: !account.permissions[app],
    });
  };

  const initializeExisting = async () => {
    if (!user || legacyCount === 0) return;
    if (!(await confirm({
      title: `既存の管理アカウント${legacyCount}件の権限を確定しますか？`,
      message: '現在の利用状態を、正式な権限設定として一括で保存します。',
      confirmLabel: `${legacyCount}件を確定する`,
      tone: 'danger',
    }))) return;
    setMigrating(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/app-permissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'initialize_existing' }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || '既存権限を確定できませんでした。');
      await loadAccounts();
    } catch (migrationError) {
      setError(userErrorMessage(migrationError, '既存権限を確定できませんでした。'));
    } finally {
      setMigrating(false);
    }
  };

  if (profile && profile.role !== 'master') {
    return (
      <div className="mx-auto max-w-xl rounded-card border border-rose-200 bg-rose-50 p-8 text-center text-rose-800">
        <LockKeyhole className="mx-auto mb-3" aria-hidden />
        <p className="font-bold">この設定はマスター管理者のみ利用できます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        description="管理者ごとに利用できる管理画面を設定します。"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void loadAccounts()} loading={loading}>再読み込み</Button>}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
          <input
            aria-label="氏名・メール・校舎で検索"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="氏名・メール・校舎で検索"
            className="h-11 w-full rounded-input border border-line bg-white pl-10 pr-4 text-sm font-bold outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {legacyCount > 0 && (
          <Button onClick={initializeExisting} loading={migrating} icon={<Check size={16} aria-hidden />}>
            既存設定を確定（{legacyCount}件）
          </Button>
        )}
      </div>

      {error && <div role="alert" className="rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}

      {loading ? (
        <ListSkeleton rows={4} />
      ) : loadFailed ? (
        <ErrorState message={loadFailed} onRetry={() => void loadAccounts()} />
      ) : (
        <>
        <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-sm md:block">
          <table className="min-w-[760px] w-full border-collapse text-left">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-5 py-4">アカウント</th>
                {ADMIN_APP_IDS.map(app => <th key={app} className="px-4 py-4 text-center">{ADMIN_APP_LABELS[app]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map(account => (
                <tr key={account.id}>
                  <td className="px-5 py-4">
                    <p className="font-bold text-slate-900">{account.name}</p>
                    <p className="mt-1 text-xs text-slate-500">管理者 · {account.school_ids.join(' / ') || '全校舎'}</p>
                    {account.email && <p className="mt-1 text-xs text-slate-400">{account.email}</p>}
                    <select
                      value=""
                      onChange={event => {
                        const preset = PERMISSION_PRESETS[Number(event.target.value)];
                        if (preset) savePermissions(account, preset.permissions);
                      }}
                      disabled={savingId === account.id}
                      className="mt-3 h-9 rounded-input border border-line bg-white px-3 text-xs font-bold text-slate-600 outline-none"
                      aria-label={`${account.name}の権限セット`}
                    >
                      <option value="">権限セットを選択</option>
                      {PERMISSION_PRESETS.map((preset, index) => (
                        <option key={preset.label} value={index}>{preset.label}</option>
                      ))}
                    </select>
                  </td>
                  {ADMIN_APP_IDS.map(app => {
                    const enabled = account.permissions[app];
                    return (
                      <td key={app} className="px-4 py-4 text-center">
                        <button
                          type="button"
                          onClick={() => togglePermission(account, app)}
                          disabled={savingId === account.id}
                          className={`inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-btn border px-3 text-xs font-bold transition ${
                            enabled
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-400'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {savingId === account.id ? <Loader2 className="animate-spin" size={16} /> : enabled && <Check size={16} aria-hidden />}
                          {enabled ? '利用可' : '利用不可'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAccounts.length === 0 && (
            <EmptyState className="m-5" title="該当する管理アカウントはありません" description={search ? '検索語を変えてください。' : undefined} />
          )}
        </div>
        <div className="space-y-3 md:hidden">
          {filteredAccounts.map(account => (
            <section key={account.id} className="rounded-card border border-line bg-white p-4 shadow-sm">
              <div className="border-b border-slate-100 pb-3">
                <p className="font-bold text-slate-900">{account.name}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  管理者 · {account.school_ids.join(' / ') || '全校舎'}
                </p>
                {account.email && <p className="mt-1 break-all text-xs text-slate-400">{account.email}</p>}
              </div>

              <select
                value=""
                onChange={event => {
                  const preset = PERMISSION_PRESETS[Number(event.target.value)];
                  if (preset) savePermissions(account, preset.permissions);
                }}
                disabled={savingId === account.id}
                className="mt-3 h-11 w-full rounded-input border border-line bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none"
                aria-label={`${account.name}の権限セット`}
              >
                <option value="">権限セットを選択</option>
                {PERMISSION_PRESETS.map((preset, index) => (
                  <option key={preset.label} value={index}>{preset.label}</option>
                ))}
              </select>

              <div className="mt-3 space-y-2">
                {ADMIN_APP_IDS.map(app => {
                  const enabled = account.permissions[app];
                  return (
                    <div key={app} className="flex min-h-12 items-center justify-between gap-3 rounded-btn bg-slate-50 px-3">
                      <span className="text-sm font-bold text-slate-700">{ADMIN_APP_LABELS[app]}</span>
                      <button
                        type="button"
                        onClick={() => togglePermission(account, app)}
                        disabled={savingId === account.id}
                        className={`inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded-btn border px-3 text-xs font-bold ${
                          enabled
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'
                        } disabled:cursor-not-allowed disabled:opacity-70`}
                      >
                        {savingId === account.id ? <Loader2 className="animate-spin" size={15} /> : enabled && <Check size={15} aria-hidden />}
                        {enabled ? '利用可' : '利用不可'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {filteredAccounts.length === 0 && (
            <EmptyState title="該当する管理アカウントはありません" description={search ? '検索語を変えてください。' : undefined} />
          )}
        </div>
        </>
      )}

      {!loading && !loadFailed && (
        <section className="overflow-hidden rounded-card border border-line bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-line bg-slate-50 px-5 py-4">
            <History size={18} className="text-slate-500" aria-hidden />
            <h2 className="font-bold text-slate-900">最近の権限変更</h2>
          </div>
          {history.length === 0 ? (
            <p className="p-6 text-sm font-bold text-slate-500">権限変更履歴はまだありません。</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.slice(0, 12).map(item => (
                <div key={item.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.target_name}</p>
                    <p className="mt-1 text-xs text-slate-500">変更者: {item.actor_email || item.actor_uid || '不明'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ADMIN_APP_IDS.map(app => (
                      <span
                        key={app}
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          item.permissions[app] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {ADMIN_APP_LABELS[app]} {item.permissions[app] ? '可' : '不可'}
                      </span>
                    ))}
                    <time className="ml-1 text-xs font-bold text-slate-400">
                      {item.created_at ? (formatDateTime(item.created_at, { withYear: true }) || '日時不明') : '日時不明'}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
