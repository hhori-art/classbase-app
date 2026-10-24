'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { AUDIT_ACTION_LABELS, auditActionLabel } from '@/app/components/master/audit-log-actions';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, StatusPill } from '@/app/components/ui';
import { formatDateTime, jstDateKey } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

type AuditLog = {
  id: string;
  action: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  school_id: string | null;
  details: Record<string, unknown>;
  reported_by_client: boolean;
  created_at: string | null;
};

type Filters = { action: string; actorId: string; actorName: string; from: string; to: string };

const ROLE_LABELS: Record<string, string> = {
  master: 'マスター', admin: '管理者', school_admin: '校舎管理者', attendance_admin: '勤怠管理者', teacher: '講師',
};

const TARGET_LABELS: Record<string, string> = {
  user: 'アカウント', user_bulk: 'アカウント（一括）', request: '申請', parent_inquiry: '教室への連絡', safety_alert: '安全アラート',
  announcement: 'お知らせ', work_record: '勤務記録', shift_assignment: 'シフト配置', registration_request: '受講登録の依頼',
  survey_template: 'アンケート', community_topic: '掲示板の投稿', community_comment: '掲示板のコメント',
  teacher_substitution_post: '代行依頼', class_recording: '録画',
};

const DETAIL_LABELS: Record<string, string> = {
  status: '状態', previous_status: '変更前', target_role: '対象の種類', bulk: '一括', count: '件数', permissions: '権限',
  previous_permissions: '変更前の権限', request_type: '申請の種類', refunded: '返金コイン', reward_name: '景品', memo_changed: 'メモ変更',
  response_length: '返信の文字数', lifecycle_action: '操作', school_id: '校舎', previous_school_id: '変更前の校舎', date: '日付',
  target_date: '日付', teacher_id: '講師ID', segment_id: '勤務区分', reason: '理由', period: '時限', amount: 'コイン', first_login_completed: '初回ログイン済み',
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  if (Array.isArray(value)) return value.map(formatValue).join('、');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join(' / ');
  }
  return String(value);
};

const EMPTY_FILTERS: Filters = { action: '', actorId: '', actorName: '', from: '', to: '' };

/** 操作ログ（マスター専用）。管理者の重要な操作を新しい順に表示する。 */
export default function AuditLogsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = useCallback(async (current: Filters, after: string | null) => {
    const params = new URLSearchParams();
    if (current.action) params.set('action', current.action);
    if (current.actorId) params.set('actor_id', current.actorId);
    if (current.from) params.set('from', current.from);
    if (current.to) params.set('to', current.to);
    if (after) params.set('cursor', after);
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`/api/admin/audit-log?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '操作ログを読み込めませんでした。');
    return { logs: (body.logs || []) as AuditLog[], next: (body.next_cursor || null) as string | null };
  }, []);

  const load = useCallback(async (current: Filters) => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchPage(current, null);
      setLogs(page.logs);
      setCursor(page.next);
    } catch (loadError) {
      setLogs([]);
      setCursor(null);
      setError(userErrorMessage(loadError, '操作ログを読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { void load(filters); }, [filters, load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(filters, cursor);
      setLogs(current => [...current, ...page.logs.filter(log => !current.some(existing => existing.id === log.id))]);
      setCursor(page.next);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '続きを読み込めませんでした。'));
    } finally {
      setLoadingMore(false);
    }
  };

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('期間の開始日は終了日より前にしてください。');
      return;
    }
    setFilters({ ...draft });
  };
  const filterByActor = (log: AuditLog) => {
    const next = { ...filters, actorId: log.actor_id, actorName: log.actor_name || log.actor_id };
    setDraft(next);
    setFilters(next);
  };
  const clearActor = () => {
    const next = { ...filters, actorId: '', actorName: '' };
    setDraft(next);
    setFilters(next);
  };
  const filtered = Boolean(filters.action || filters.actorId || filters.from || filters.to);
  const inputClass = 'min-h-11 w-full rounded-input border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div>
      <AdminPageHeader
        icon={History}
        description="アカウントの状態・パスワード・権限の変更、申請の承認や却下、削除などの重要な操作を記録しています。記録はサーバーだけが書き込み、画面からは変更できません。"
      />

      <Card className="mb-5">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="block text-sm font-bold text-fg">
            操作の種類
            <select value={draft.action} onChange={event => setDraft(current => ({ ...current, action: event.target.value }))} className={`${inputClass} mt-1`}>
              <option value="">すべての操作</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-fg">
            開始日
            <input type="date" value={draft.from} max={draft.to || jstDateKey()} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm font-bold text-fg">
            終了日
            <input type="date" value={draft.to} min={draft.from || undefined} max={jstDateKey()} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" icon={<Search size={16} aria-hidden />} loading={loading}>絞り込む</Button>
            {filtered && <Button variant="ghost" onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); }}>解除</Button>}
          </div>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {filters.actorId ? (
            <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent-soft pl-3 pr-1 font-bold text-accent">
              操作した人：{filters.actorName}
              <button type="button" onClick={clearActor} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/60" aria-label="操作した人の絞り込みを解除"><X size={14} aria-hidden /></button>
            </span>
          ) : (
            <span>一覧の「操作した人」の名前を押すと、その人の操作だけに絞り込めます。</span>
          )}
        </div>
      </Card>

      {loading ? (
        <ListSkeleton rows={6} />
      ) : error && logs.length === 0 ? (
        <ErrorState message={error} onRetry={() => void load(filters)} />
      ) : logs.length === 0 ? (
        <EmptyState icon={History} title={filtered ? '条件に合う操作ログはありません' : '操作ログはまだありません'} description={filtered ? '期間や操作の種類を変えてお試しください。' : undefined} />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs font-bold text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">日時</th>
                  <th scope="col" className="px-4 py-3">操作した人</th>
                  <th scope="col" className="px-4 py-3">操作</th>
                  <th scope="col" className="px-4 py-3">対象</th>
                  <th scope="col" className="px-4 py-3">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map(log => {
                  const details = Object.entries(log.details || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
                  return (
                    <tr key={log.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-fg-muted">{log.created_at ? formatDateTime(log.created_at, { withYear: true }) : '-'}</td>
                      <td className="px-4 py-3">
                        {log.actor_id ? (
                          <button type="button" onClick={() => filterByActor(log)} className="min-h-9 text-left font-bold text-accent hover:underline" title="この人の操作だけを表示">
                            {log.actor_name || log.actor_id}
                          </button>
                        ) : <span className="text-fg-muted">-</span>}
                        {log.actor_role && <span className="block text-xs text-fg-muted">{ROLE_LABELS[log.actor_role] || log.actor_role}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-fg">{auditActionLabel(log.action)}</span>
                        {log.reported_by_client && <StatusPill className="mt-1" tone="neutral">画面から記録</StatusPill>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-fg">{log.target_label || log.target_id || '-'}</span>
                        <span className="block text-xs text-fg-muted">{[TARGET_LABELS[log.target_type] || log.target_type, log.school_id].filter(Boolean).join('・')}</span>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-xs text-fg-muted">
                        {details.length === 0 ? '-' : (
                          <dl className="space-y-0.5">
                            {details.slice(0, 8).map(([key, value]) => (
                              <div key={key} className="flex gap-1">
                                <dt className="shrink-0 font-bold">{DETAIL_LABELS[key] || key}:</dt>
                                <dd className="min-w-0 break-words">{formatValue(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(cursor || error) && (
            <div className="flex flex-col items-center gap-2 border-t border-line p-4">
              {error && <p role="alert" className="text-sm font-bold text-danger">{error}</p>}
              {cursor && <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>さらに50件を表示</Button>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
