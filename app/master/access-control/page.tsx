'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, History, Loader2, LockKeyhole, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import {
  ADMIN_APP_IDS,
  ADMIN_APP_LABELS,
  isConfigurableAdminRole,
  type AdminAppId,
  type AdminAppPermissions,
} from '@/lib/admin-app-permissions';

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
  { label: '理社講座のみ', permissions: { science_social: true, eiken: false, attendance: false } },
  { label: 'Boosterのみ', permissions: { science_social: false, eiken: true, attendance: false } },
  { label: '勤怠のみ', permissions: { science_social: false, eiken: false, attendance: true } },
  { label: 'すべて', permissions: { science_social: true, eiken: true, attendance: true } },
  { label: 'すべて停止', permissions: { science_social: false, eiken: false, attendance: false } },
];

export default function AdminAccessControlPage() {
  const { user, profile } = useAuth();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [history, setHistory] = useState<PermissionHistory[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    if (!user || profile?.role !== 'master') return;
    setLoading(true);
    setError('');
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
      setError(loadError instanceof Error ? loadError.message : '権限情報を取得できませんでした。');
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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '権限を保存できませんでした。');
    } finally {
      setSavingId('');
    }
  };

  const togglePermission = (account: AdminAccount, app: AdminAppId) => {
    return savePermissions(account, {
      ...account.permissions,
      [app]: !account.permissions[app],
    });
  };

  const initializeExisting = async () => {
    if (!user || legacyCount === 0) return;
    if (!confirm(`既存の管理アカウント${legacyCount}件について、現在の利用状態を正式な権限設定として保存します。実行しますか？`)) return;
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
      setError(migrationError instanceof Error ? migrationError.message : '既存権限を確定できませんでした。');
    } finally {
      setMigrating(false);
    }
  };

  if (profile && profile.role !== 'master') {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 p-8 text-center text-red-800">
        <LockKeyhole className="mx-auto mb-3" />
        <p className="font-black">この設定はマスター管理者のみ利用できます。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b border-slate-200 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-950 text-white">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-950">管理アプリ権限</h1>
            <p className="mt-1 text-sm text-slate-500">管理者ごとに利用できる管理画面を設定します。</p>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="氏名・メール・校舎で検索"
            className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-sm font-bold outline-none focus:border-slate-600"
          />
        </div>
        {legacyCount > 0 && (
          <button
            type="button"
            onClick={initializeExisting}
            disabled={migrating}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-60"
          >
            {migrating ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}
            既存設定を確定（{legacyCount}件）
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {loading ? (
        <div className="flex min-h-52 items-center justify-center text-slate-500">
          <Loader2 className="mr-2 animate-spin" size={20} /> 権限情報を読み込んでいます
        </div>
      ) : (
        <>
        <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
          <table className="min-w-[760px] w-full border-collapse text-left">
            <thead className="bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-5 py-4">アカウント</th>
                {ADMIN_APP_IDS.map(app => <th key={app} className="px-4 py-4 text-center">{ADMIN_APP_LABELS[app]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map(account => (
                <tr key={account.id}>
                  <td className="px-5 py-4">
                    <p className="font-black text-slate-900">{account.name}</p>
                    <p className="mt-1 text-xs text-slate-500">管理者 · {account.school_ids.join(' / ') || '全校舎'}</p>
                    {account.email && <p className="mt-1 text-xs text-slate-400">{account.email}</p>}
                    <select
                      value=""
                      onChange={event => {
                        const preset = PERMISSION_PRESETS[Number(event.target.value)];
                        if (preset) savePermissions(account, preset.permissions);
                      }}
                      disabled={savingId === account.id}
                      className="mt-3 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 outline-none"
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
                          className={`inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-black transition ${
                            enabled
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-400'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {savingId === account.id ? <Loader2 className="animate-spin" size={16} /> : enabled && <Check size={16} />}
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
            <p className="p-8 text-center text-sm font-bold text-slate-500">該当する管理アカウントはありません。</p>
          )}
        </div>
        <div className="space-y-3 md:hidden">
          {filteredAccounts.map(account => (
            <section key={account.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="border-b border-slate-100 pb-3">
                <p className="font-black text-slate-900">{account.name}</p>
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
                className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-700 outline-none"
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
                    <div key={app} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3">
                      <span className="text-sm font-black text-slate-700">{ADMIN_APP_LABELS[app]}</span>
                      <button
                        type="button"
                        onClick={() => togglePermission(account, app)}
                        disabled={savingId === account.id}
                        className={`inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-black ${
                          enabled
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'
                        } disabled:cursor-not-allowed disabled:opacity-70`}
                      >
                        {savingId === account.id ? <Loader2 className="animate-spin" size={15} /> : enabled && <Check size={15} />}
                        {enabled ? '利用可' : '利用不可'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {filteredAccounts.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">
              該当する管理アカウントはありません。
            </p>
          )}
        </div>
        </>
      )}

      {!loading && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4">
            <History size={18} className="text-slate-500" />
            <h2 className="font-black text-slate-900">最近の権限変更</h2>
          </div>
          {history.length === 0 ? (
            <p className="p-6 text-sm font-bold text-slate-500">権限変更履歴はまだありません。</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.slice(0, 12).map(item => (
                <div key={item.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-900">{item.target_name}</p>
                    <p className="mt-1 text-xs text-slate-500">変更者: {item.actor_email || item.actor_uid || '不明'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ADMIN_APP_IDS.map(app => (
                      <span
                        key={app}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                          item.permissions[app] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {ADMIN_APP_LABELS[app]} {item.permissions[app] ? '可' : '不可'}
                      </span>
                    ))}
                    <time className="ml-1 text-xs font-bold text-slate-400">
                      {item.created_at ? new Date(item.created_at).toLocaleString('ja-JP') : '日時不明'}
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
