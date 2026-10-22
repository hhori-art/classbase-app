'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { AlertCircle, Bell, Calendar, CheckCircle, Database, Download, Plug, RefreshCw, Search } from 'lucide-react';
import { Button, ButtonLink, EmptyState, ErrorState, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/app/context/AuthContext';
import { jstDateKey } from '@/lib/date-key';

type WarningItem = {
  code: string;
  label: string;
  severity: 'info' | 'warning' | 'danger';
  detail: string;
};

type DiagnosticItem = {
  type: string;
  date: string;
  teacher_id: string;
  teacher_name: string;
  work_record_id?: string;
  shift_assignment_id?: string;
  related_work_record_ids?: string[];
  warnings: WarningItem[];
  shift_summary?: Array<{
    id: string;
    teacher_name: string;
    user_id: string;
    target_date: string;
    role_type: string;
    note: string;
    school: string;
  }>;
  record_summary?: Array<{
    id: string;
    start_time?: string | null;
    end_time?: string | null;
    status?: string;
    work_segments_count?: number;
    transportation_count?: number;
  }>;
  external_record_summary?: Array<{
    id: string;
    person_code: string;
    person_name: string;
    start_time: string;
    end_time: string;
    work_type: string;
    source_name: string;
  }>;
};

type FilterKind = 'all' | 'danger' | 'missing' | 'duplicate' | 'overlap';

type IntegrationStatus = {
  config: { enabled: boolean; configured: boolean; missing: string[]; endpoint_host: string; source_name: string };
  state: null | {
    status?: string;
    last_successful_at?: string;
    stored_count?: number;
    invalid_count?: number;
    last_error?: string;
  };
  selected_month_record_count: number;
};

const currentMonth = () => jstDateKey().slice(0, 7);

const formatTime = (value?: string | null) => {
  if (!value) return '-';
  return formatDateTime(value) || '-';
};

const typeLabel = (type: string) => {
  if (type === 'duplicate_work_record') return '同日二重打刻';
  if (type === 'missing_work_record') return '勤務記録なし';
  if (type === 'external_attendance_overlap') return '通常勤怠との重複';
  return '勤怠要確認';
};

const integrationErrorLabel = (value: string) => {
  if (value.includes('not-configured')) return '接続情報が未設定です。情報システムから受領後、環境変数を設定してください。';
  if (value.includes('http-401') || value.includes('http-403')) return '認証に失敗しました。トークンまたは接続元IP制限を確認してください。';
  if (value.includes('abort')) return '接続がタイムアウトしました。接続先URLまたはネットワーク制限を確認してください。';
  if (value.includes('invalid-response')) return 'API応答形式が想定と異なります。項目マッピングを確認してください。';
  return value;
};

export default function AttendanceDiagnosticsPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationSending, setNotificationSending] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState<'test' | 'sync' | ''>('');
  const [integrationMessage, setIntegrationMessage] = useState('');
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const fetchDiagnostics = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [diagnosticsRes, integrationRes] = await Promise.all([
        fetch(`/api/attendance-diagnostics?scope=admin&month=${month}`, { headers }),
        fetch(`/api/admin/attendance-integration?month=${month}`, { headers }),
      ]);
      const data = await diagnosticsRes.json().catch(() => ({}));
      if (!diagnosticsRes.ok || data.ok === false) throw new Error(data.error || 'failed');
      setDiagnostics(data.diagnostics || []);
      const integrationData = await integrationRes.json().catch(() => ({}));
      setIntegration(integrationRes.ok && integrationData.ok !== false ? integrationData : null);
    } catch (e: any) {
      console.error('Attendance diagnostics fetch error:', e);
      setDiagnostics([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [month, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialMonth = params.get('month');
    if (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)) setMonth(initialMonth);
  }, []);

  useEffect(() => {
    if (user) fetchDiagnostics();
  }, [user, fetchDiagnostics]);

  const filteredDiagnostics = useMemo(() => {
    const byKind = diagnostics.filter(item => {
      if (filterKind === 'all') return true;
      if (filterKind === 'danger') return item.warnings?.some(w => w.severity === 'danger');
      if (filterKind === 'missing') return item.type === 'missing_work_record';
      if (filterKind === 'duplicate') return item.type === 'duplicate_work_record';
      if (filterKind === 'overlap') return item.type === 'external_attendance_overlap';
      return true;
    });
    const text = keyword.trim().toLowerCase();
    if (!text) return byKind;
    return byKind.filter(item => [
      item.teacher_name,
      item.date,
      typeLabel(item.type),
      ...(item.warnings || []).map(w => `${w.label} ${w.detail}`),
    ].join(' ').toLowerCase().includes(text));
  }, [diagnostics, keyword, filterKind]);

  const summary = useMemo(() => ({
    total: diagnostics.length,
    duplicate: diagnostics.filter(item => item.type === 'duplicate_work_record').length,
    overlap: diagnostics.filter(item => item.type === 'external_attendance_overlap').length,
    missing: diagnostics.filter(item => item.type === 'missing_work_record').length,
    danger: diagnostics.filter(item => item.warnings?.some(w => w.severity === 'danger')).length,
    missingInput: diagnostics.filter(item => item.warnings?.some(w => w.code.startsWith('missing_') && w.code !== 'missing_transportation')).length,
  }), [diagnostics]);

  const hasNonTransportationMissing = (item: DiagnosticItem) =>
    item.warnings?.some(w => w.code.startsWith('missing_') && w.code !== 'missing_transportation');

  const notificationTargets = useMemo(() => {
    const targetMap = new Map<string, DiagnosticItem[]>();
    filteredDiagnostics
      .filter(item => item.teacher_id && hasNonTransportationMissing(item))
      .forEach(item => targetMap.set(item.teacher_id, [...(targetMap.get(item.teacher_id) || []), item]));
    return [...targetMap.entries()].map(([teacherId, items]) => ({ teacherId, items }));
  }, [filteredDiagnostics]);

  const sendMissingInputNotification = async (items: DiagnosticItem[]) => {
    if (!user || items.length === 0) return;
    const targetIds = [...new Set(items.map(item => item.teacher_id).filter(Boolean))];
    if (targetIds.length === 0) return toast.error('通知対象の講師が見つかりません。');
    const lines = items.slice(0, 8).map(item => {
      const labels = item.warnings
        .filter(w => w.code.startsWith('missing_') && w.code !== 'missing_transportation')
        .map(w => w.label)
        .join('、');
      return `・${item.date} ${labels}`;
    });
    const omitted = items.length > 8 ? `\nほか${items.length - 8}件` : '';
    const message = [
      '勤怠の入力内容に未入力項目があります。',
      '',
      ...lines,
      omitted,
      '',
      '勤怠画面から内容を確認し、必要な入力または打刻忘れ申請をお願いします。',
      '※交通費未入力のみの項目はこの通知対象から除外しています。',
    ].filter(Boolean).join('\n');

    if (!(await confirm({
      title: `${targetIds.length}名の講師へ未入力通知を送信しますか？`,
      message: 'アプリ内とLINEで「勤怠入力の確認依頼」を送ります。',
      confirmLabel: '送信する',
    }))) return;

    setNotificationSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: '勤怠入力の確認依頼',
          message,
          kind: 'attendance',
          channels: ['in_app', 'line'],
          selected_user_ids: targetIds,
          include_name: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      toast.success(`通知を送信しました（アプリ内: ${data.in_app_count || 0}件 / LINE: ${data.line_sent_count || 0}件）`);
    } catch (e: any) {
      console.error(e);
      toast.error(`通知を送信できませんでした。${e?.message || ''}`);
    } finally {
      setNotificationSending(false);
    }
  };

  const runIntegrationAction = async (action: 'test_connection' | 'sync') => {
    if (!user) return;
    setIntegrationBusy(action === 'sync' ? 'sync' : 'test');
    setIntegrationMessage('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/attendance-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, month, force_full: action === 'sync' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '処理に失敗しました。');
      if (action === 'test_connection') {
        setIntegrationMessage(data.result?.sample_valid === false
          ? `接続できましたが、項目確認が必要です: ${data.result.sample_error}`
          : '接続とAPI応答を確認できました。');
      } else {
        setIntegrationMessage(`同期完了: ${data.result?.stored_count || 0}件更新 / ${data.result?.invalid_count || 0}件要確認`);
      }
      await fetchDiagnostics();
    } catch (error: any) {
      setIntegrationMessage(integrationErrorLabel(String(error?.message || error)));
    } finally {
      setIntegrationBusy('');
    }
  };

  const summaryCards: Array<{ key: FilterKind; label: string; count: number; color: string; border: string }> = [
    { key: 'all', label: 'すべて', count: summary.total, color: 'text-slate-900', border: 'border-slate-200' },
    { key: 'danger', label: '要対応', count: summary.danger, color: 'text-rose-600', border: 'border-rose-200' },
    { key: 'missing', label: '勤務記録なし', count: summary.missing, color: 'text-amber-600', border: 'border-amber-200' },
    { key: 'duplicate', label: '同日二重打刻', count: summary.duplicate, color: 'text-accent', border: 'border-accent/30' },
    { key: 'overlap', label: '通常勤怠と重複', count: summary.overlap, color: 'text-rose-600', border: 'border-rose-200' },
  ];

  return (
    <div className="font-sans">
      <div>
        <AdminPageHeader
          description="講師配置・勤務記録・打刻状態を照らし合わせて確認します。"
          backHref="/master/attendance"
          actions={
            <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={fetchDiagnostics} loading={loading}>
              再読み込み
            </Button>
          }
        />

        <section className="mb-6 rounded-card border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><Database size={18} className="text-accent" /> 外部勤怠データ連携</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                <span className={`rounded-full px-3 py-1 ${integration?.config.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {integration?.config.configured ? '接続情報設定済み' : '接続情報待ち'}
                </span>
                <span className={`rounded-full px-3 py-1 ${integration?.config.enabled ? 'bg-accent-soft text-accent' : 'bg-slate-100 text-slate-500'}`}>
                  自動同期 {integration?.config.enabled ? 'ON' : 'OFF'}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">選択月 {integration?.selected_month_record_count || 0}件</span>
              </div>
              <p className="mt-2 text-xs font-bold text-slate-500">
                接続先: {integration?.config.endpoint_host || '未設定'} / 最終成功: {integration?.state?.last_successful_at ? formatDateTime(integration.state.last_successful_at, { withYear: true }) : '未実行'}
              </p>
              {integration?.config.missing?.length ? <p className="mt-1 break-words text-xs font-bold text-amber-700">未設定: {integration.config.missing.join('、')}</p> : null}
              {integrationMessage ? <p className="mt-2 rounded-btn bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{integrationMessage}</p> : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => runIntegrationAction('test_connection')}
                disabled={Boolean(integrationBusy) || !integration?.config.configured}
                loading={integrationBusy === 'test'}
                icon={<Plug size={16} aria-hidden />}
              >
                接続テスト
              </Button>
              <Button
                onClick={() => runIntegrationAction('sync')}
                disabled={Boolean(integrationBusy) || !integration?.config.configured}
                loading={integrationBusy === 'sync'}
                icon={<Download size={16} aria-hidden />}
              >
                選択月を同期
              </Button>
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-3 sm:grid-cols-5">
          {summaryCards.map(card => (
            <button
              key={card.key}
              onClick={() => setFilterKind(card.key)}
              className={`rounded-card border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${card.border} ${filterKind === card.key ? 'ring-2 ring-accent' : ''}`}
            >
              <p className="text-xs font-bold text-slate-400">{card.label}</p>
              <p className={`mt-1 text-2xl font-black ${card.color}`}>{card.count}</p>
            </button>
          ))}
        </section>

        <div className="sticky top-4 z-10 mb-6 flex flex-col gap-3 rounded-card border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur md:flex-row md:items-center">
          <label className="flex min-h-[44px] items-center gap-2 rounded-btn border border-slate-200 bg-slate-50 px-3">
            <Calendar size={16} className="text-slate-400" />
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none" />
          </label>
          <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-btn border border-slate-200 bg-slate-50 px-3">
            <Search size={16} className="text-slate-400" />
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="講師名・日付・警告内容で検索" className="w-full bg-transparent text-sm font-bold outline-none" />
          </label>
          <Button
            onClick={() => sendMissingInputNotification(filteredDiagnostics.filter(hasNonTransportationMissing))}
            disabled={notificationTargets.length === 0}
            loading={notificationSending}
            icon={<Bell size={16} aria-hidden />}
            title="交通費未入力のみの項目は除外して通知します"
          >
            未入力通知 {notificationTargets.length > 0 ? `${notificationTargets.length}名` : ''}
          </Button>
        </div>
        {filterKind !== 'all' && (
          <div className="mb-4 flex items-center justify-between rounded-card border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
            <span>{summaryCards.find(card => card.key === filterKind)?.label} で絞り込み中</span>
            <Button variant="secondary" size="sm" onClick={() => setFilterKind('all')}>解除</Button>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={3} />
        ) : loadError ? (
          <ErrorState title="勤怠ミス候補を読み込めませんでした" onRetry={fetchDiagnostics} />
        ) : filteredDiagnostics.length === 0 ? (
          <EmptyState icon={CheckCircle} title="勤怠ミス候補はありません" description="選択中の月では確認対象が見つかりませんでした。" />
        ) : (
          <div className="space-y-4">
            {filteredDiagnostics.map((item, index) => (
              <article key={`${item.type}_${item.date}_${item.work_record_id || item.shift_assignment_id || index}`} className="rounded-card border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900">{item.teacher_name || '講師未設定'}</h2>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.warnings?.some(w => w.severity === 'danger') ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {typeLabel(item.type)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-400">{item.date} / 講師ID: {item.teacher_id || '-'}</p>
                  </div>
                  {item.work_record_id && (
                    <ButtonLink href={`/master/attendance?date=${item.date}`} variant="secondary" size="sm">
                      勤怠一覧で確認
                    </ButtonLink>
                  )}
                  {hasNonTransportationMissing(item) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => sendMissingInputNotification([item])}
                      disabled={notificationSending}
                      icon={<Bell size={14} aria-hidden />}
                    >
                      通知
                    </Button>
                  )}
                </div>

                <div className="mb-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-card border border-slate-100 bg-slate-50 p-4">
                    <p className="mb-3 text-xs font-bold text-slate-500">勤務記録</p>
                    {item.record_summary && item.record_summary.length > 0 ? (
                      <div className="space-y-2">
                        {item.record_summary.map(record => (
                          <div key={record.id} className="rounded-btn bg-white p-3 text-xs font-bold text-slate-600">
                            <p className="font-bold text-slate-800">ID: {record.id?.slice(0, 10)}</p>
                            <p className="mt-1">出勤: {formatTime(record.start_time)} / 退勤: {formatTime(record.end_time)}</p>
                            <p className="mt-1">状態: {record.status || '-'} / 詳細: {record.work_segments_count ?? '-'} / 交通費: {record.transportation_count ?? '-'}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-btn bg-white p-3 text-xs font-bold text-rose-600">該当日の勤務記録がありません。</p>
                    )}
                  </div>

                  <div className="rounded-card border border-slate-100 bg-slate-50 p-4">
                    <p className="mb-3 text-xs font-bold text-slate-500">{item.type === 'external_attendance_overlap' ? '照合先の通常勤怠' : '講師配置'}</p>
                    {item.type === 'external_attendance_overlap' && item.external_record_summary?.length ? (
                      <div className="space-y-2">
                        {item.external_record_summary.map(record => (
                          <div key={record.id} className="rounded-btn bg-white p-3 text-xs font-bold text-slate-600">
                            <p className="font-bold text-slate-800">{record.source_name || '通常勤怠'} / {record.work_type || '勤務'}</p>
                            <p className="mt-1">時間: {record.start_time}〜{record.end_time}</p>
                            <p className="mt-1 text-slate-400">職員コード: {record.person_code || '-'} / {record.person_name || '-'}</p>
                          </div>
                        ))}
                      </div>
                    ) : item.shift_summary && item.shift_summary.length > 0 ? (
                      <div className="space-y-2">
                        {item.shift_summary.map(shift => (
                          <div key={shift.id} className="rounded-btn bg-white p-3 text-xs font-bold text-slate-600">
                            <p className="font-bold text-slate-800">{shift.teacher_name || '講師名未設定'}</p>
                            <p className="mt-1">日付: {shift.target_date || '-'} / 役割: {shift.role_type || '-'}</p>
                            <p className="mt-1">勤務地: {shift.school || '-'} / メモ: {shift.note || '-'}</p>
                            <p className="mt-1 text-slate-400">配置ID: {shift.id?.slice(0, 10)} / UID: {shift.user_id || '-'}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-btn bg-white p-3 text-xs font-bold text-amber-700">{item.type === 'external_attendance_overlap' ? '照合先データを表示できません。' : '一致する講師配置が見つかりません。'}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {(item.warnings || []).map(warning => (
                    <div key={`${warning.code}_${warning.label}`} className={`rounded-card p-4 text-sm font-bold leading-relaxed ${warning.severity === 'danger' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                      <div className="flex items-center gap-2 font-bold">
                        <AlertCircle size={16} /> {warning.label}
                      </div>
                      <p className="mt-1">{warning.detail}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
