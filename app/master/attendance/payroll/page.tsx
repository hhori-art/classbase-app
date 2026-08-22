'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowDown, ArrowLeft, Calculator, CheckCircle2, Download, FileUp, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { storage } from '@/lib/firebase';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { buildOriginalPayrollHtml } from '@/lib/attendance-original-export';
import type { PayrollPersonSummary } from '@/lib/attendance-payroll';

type CategoryKey = 'lesson' | 'office' | 'interview' | 'other';
type PayrollRow = PayrollPersonSummary;

type PayrollAlert = {
  code: string;
  severity: 'warning' | 'danger';
  person_code: string;
  person_name: string;
  date?: string;
  work_record_id?: string;
  detail: string;
};

type PayrollResponse = {
  ok: boolean;
  month: string;
  scope: 'breakthrough' | 'all';
  rows: PayrollRow[];
  alerts: PayrollAlert[];
  totals: { people: number; total_minutes: number; total_payment: number; transportation_amount: number; gross_payment: number; danger: number; warning: number };
  imports: { rate_master_rows: number; regular_attendance_rows: number };
  error?: string;
};

const CATEGORY_LABELS: Record<CategoryKey, string> = { lesson: '授業', office: '事務', interview: 'サブ', other: 'その他' };
const PAYROLL_MAPPING_RULES = [
  { attendance: '授業', payroll: '授業', rate: 'EDIC授業_TANKA', tone: 'border-indigo-200 bg-indigo-50 text-indigo-900' },
  { attendance: '事務', payroll: '事務', rate: '事務_TANKA', tone: 'border-orange-200 bg-orange-50 text-orange-900' },
  { attendance: 'サブ（面接）', payroll: 'サブ', rate: 'サブスタッフ_TANKA', tone: 'border-violet-200 bg-violet-50 text-violet-900' },
  { attendance: 'その他', payroll: 'その他', rate: '事務_TANKA', tone: 'border-slate-200 bg-slate-50 text-slate-900' },
] as const;
const ALERT_LABELS: Record<string, string> = {
  rate_missing: '単価未登録',
  rate_ambiguous: '単価の重複',
  time_overlap: '勤務時間の重複',
  invalid_segment: '勤務時間エラー',
  other_note_required: '業務内容未入力',
};
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function downloadCsv(filename: string, rows: unknown[][]) {
  const content = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadExcelHtml(filename: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readCsvText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasKnownHeader = (text: string) => /個人コード|職員コード|支給年月|適用開始日|勤務日|実働開始|日付/.test(text.slice(0, 4000));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (hasKnownHeader(utf8)) return utf8;
  try {
    const shiftJis = new TextDecoder('shift_jis').decode(bytes);
    if (hasKnownHeader(shiftJis)) return shiftJis;
  } catch {
    // The browser may not expose Shift-JIS on some runtimes; the UTF-8 result remains the fallback.
  }
  return utf8;
}

function downloadTemplate(type: 'rates' | 'regular') {
  if (type === 'rates') {
    downloadCsv('単価マスター_テンプレート.csv', [[
      '個人コード', '氏名', '適用開始日', '授業時給', '事務時給', 'サブスタッフ時給', 'その他時給',
      '事業手当', '事務手当', 'サブスタッフ手当', 'その他手当',
    ], ['0001', '山田 太郎', '2026-04-01', 2500, 1200, 1500, 1200, 500, 0, 0, 0]]);
  } else {
    downloadCsv('通常勤怠_テンプレート.csv', [
      ['個人コード', '氏名', '日付', '開始', '終了', '勤務区分'],
      ['0001', '山田 太郎', '2026-08-01', '09:00', '17:00', '通常勤務'],
    ]);
  }
}

export default function AttendancePayrollPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [scope, setScope] = useState<'breakthrough' | 'all'>('breakthrough');
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<'rates' | 'regular' | ''>('');
  const [error, setError] = useState('');
  const [alertFilter, setAlertFilter] = useState<'all' | 'danger' | 'warning'>('all');
  const requestSequence = useRef(0);
  const viewData = data?.month === month && data.scope === scope ? data : null;

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/attendance-payroll?month=${month}&scope=${scope}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (requestId !== requestSequence.current) return;
      if (!response.ok || body.ok === false) throw new Error(body.error || '給与集計を取得できませんでした。');
      if (body.month !== month || body.scope !== scope) throw new Error('選択月と異なる集計結果を受信しました。再読み込みしてください。');
      setData(body);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(loadError instanceof Error ? loadError.message : '給与集計を取得できませんでした。');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [month, scope, user]);

  useEffect(() => { load(); }, [load]);

  const importCsv = async (kind: 'rates' | 'regular', file: File) => {
    if (!user) return;
    const extension = file.name.toLowerCase().split('.').pop();
    const valid = kind === 'regular' ? extension === 'csv' || extension === 'xlsx' : extension === 'csv' || extension === 'xls';
    if (!valid) {
      setError(kind === 'regular' ? '通常勤怠はCSVまたは.xlsx形式を選択してください。' : '単価マスターはCSVまたは原本.xlsを選択してください。');
      return;
    }
    setImporting(kind);
    setError('');
    let temporaryStoragePath = '';
    try {
      const token = await user.getIdToken();
      const isXlsx = extension === 'xlsx';
      const isLegacyRateXls = kind === 'rates' && extension === 'xls';
      if (isLegacyRateXls) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.xls$/i, '.xls');
        temporaryStoragePath = `attendance_imports/${user.uid}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
        await uploadBytes(ref(storage, temporaryStoragePath), file, { contentType: 'application/vnd.ms-excel' });
      }
      const requestBody = isXlsx ? new FormData() : null;
      if (requestBody) {
        requestBody.append('action', 'import_regular_attendance');
        requestBody.append('source_name', file.name);
        requestBody.append('replace_month', 'true');
        requestBody.append('file', file);
      }
      const response = await fetch('/api/attendance-payroll', {
        method: 'POST',
        headers: isXlsx ? { Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: requestBody || JSON.stringify(isLegacyRateXls ? {
          action: 'import_rate_master', source_name: file.name, storage_path: temporaryStoragePath,
        } : {
          action: kind === 'rates' ? 'import_rate_master' : 'import_regular_attendance',
          csv_text: await readCsvText(file), source_name: file.name, replace_month: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        const details = Array.isArray(body.errors) ? `\n${body.errors.slice(0, 8).join('\n')}` : '';
        throw new Error(`${body.error || '取込に失敗しました。'}${details}`);
      }
      alert(`${body.imported}件を取り込みました。`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '取込に失敗しました。');
    } finally {
      if (temporaryStoragePath) await deleteObject(ref(storage, temporaryStoragePath)).catch(() => undefined);
      setImporting('');
    }
  };

  const exportSummary = () => {
    if (!viewData?.rows.length) return;
    const header = [
      '個人コード', '氏名', '勤務日数', '総時間',
      ...Object.values(CATEGORY_LABELS).flatMap(label => [`${label}時間`, `${label}単価`, `${label}手当回数`, `${label}支給額`]),
      '交通費', '支給額計', 'グロス', 'アラート数', '単価適用日',
    ];
    const rows = viewData.rows.map(row => [
      row.person_code, row.person_name, row.work_days, hours(row.total_minutes),
      ...Object.keys(CATEGORY_LABELS).flatMap(key => {
        const category = row.categories[key as CategoryKey];
        return [hours(category.minutes), category.hourly_rate, category.allowance_count, category.amount];
      }),
      row.transportation_amount, row.total_payment, row.gross_payment, row.alert_count, row.rate_effective_from || '',
    ]);
    downloadCsv(`勤怠給与集計_${viewData.month}_${viewData.scope}.csv`, [header, ...rows]);
  };

  const exportAlerts = () => {
    if (!viewData?.alerts.length) return;
    downloadCsv(`勤怠不整合_${viewData.month}.csv`, [
      ['重要度', 'コード', '個人コード', '氏名', '日付', '勤怠ID', '内容'],
      ...viewData.alerts.filter(alert => !alert.date || alert.date.startsWith(viewData.month)).map(alert => [alert.severity, alert.code, alert.person_code, alert.person_name, alert.date || '', alert.work_record_id || '', alert.detail]),
    ]);
  };

  const exportOriginalWorkbook = () => {
    if (!viewData?.rows.length) return;
    downloadExcelHtml(`突破ゼミ給与_${viewData.month}_原本形式.xls`, buildOriginalPayrollHtml(viewData.month, viewData.rows));
  };

  const monthAlerts = useMemo(() => (viewData?.alerts || []).filter(alert => !alert.date || alert.date.startsWith(month)), [month, viewData?.alerts]);
  const sortedAlerts = useMemo(() => [...monthAlerts].sort((a, b) => (a.severity === b.severity ? String(b.date || '').localeCompare(String(a.date || '')) : a.severity === 'danger' ? -1 : 1)), [monthAlerts]);
  const visibleAlerts = useMemo(() => alertFilter === 'all' ? sortedAlerts : sortedAlerts.filter(alert => alert.severity === alertFilter), [alertFilter, sortedAlerts]);
  const affectedPeople = useMemo(() => new Set(monthAlerts.map(alert => alert.person_code || alert.person_name)).size, [monthAlerts]);
  const dangerCount = monthAlerts.filter(alert => alert.severity === 'danger').length;
  const warningCount = monthAlerts.filter(alert => alert.severity === 'warning').length;
  const scrollToAlerts = () => document.getElementById('payroll-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <Link href="/master/attendance" className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm"><ArrowLeft size={19} /></Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-black"><Calculator className="text-indigo-600" /> 準専任・給与自動計算</h1>
              <p className="mt-1 text-sm font-bold text-slate-500">実績、最新単価、通常勤怠を照合し、支給額と不整合を算出します。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" value={month} onChange={event => setMonth(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black" />
            <select value={scope} onChange={event => setScope(event.target.value as 'breakthrough' | 'all')} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black">
              <option value="breakthrough">突破ゼミのみ</option>
              <option value="all">全勤怠</option>
            </select>
            <button onClick={load} disabled={loading} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </header>

        {error && <div className="mb-5 whitespace-pre-wrap rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}

        <details className="group mb-6 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-indigo-50 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
            <div className="min-w-0 flex-1">
              <h2 className="whitespace-normal break-words text-base font-black leading-snug text-indigo-950">給与集計ルール</h2>
              <p className="mt-1 whitespace-normal break-words text-xs font-bold leading-relaxed text-indigo-700">勤怠で選んだ業務区分を、次の給与区分と単価で自動集計します。</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-black text-indigo-800"><span className="group-open:hidden">表示する</span><span className="hidden group-open:inline">閉じる</span><ArrowDown size={16} className="transition-transform group-open:rotate-180" /></span>
          </summary>
          <div className="flex justify-end border-t border-indigo-100 px-4 pt-4">
            <Link href="/master/attendance" className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 whitespace-normal break-words rounded-xl bg-indigo-700 px-4 py-2.5 text-center text-xs font-black leading-snug text-white shadow-sm hover:bg-indigo-800">
              <Wallet size={15} className="shrink-0" /> <span>勤怠区分を確認・編集</span>
            </Link>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {PAYROLL_MAPPING_RULES.map(rule => (
              <div key={rule.attendance} className={`rounded-xl border p-4 ${rule.tone}`}>
                <p className="text-[10px] font-black opacity-60">勤怠で選択</p>
                <p className="mt-1 text-base font-black">{rule.attendance}</p>
                <p className="my-2 text-center text-xs font-black opacity-50">↓ 給与集計</p>
                <div className="rounded-lg bg-white/80 p-3">
                  <p className="font-black">{rule.payroll}</p>
                  <p className="mt-1 break-all font-mono text-[10px] font-bold opacity-70">単価：{rule.rate}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="whitespace-normal break-words border-t border-slate-100 px-5 py-3 text-xs font-bold leading-relaxed text-slate-500">「面接」は勤怠で「サブ（面接）」を選択してください。給与明細・集計表では「サブ」として表示されます。</p>
        </details>

        <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black text-slate-400">実績対象者</p><p className="mt-2 text-3xl font-black">{viewData?.totals.people || 0}<span className="ml-1 text-sm text-slate-400">名</span></p></div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 shadow-sm"><p className="text-xs font-black text-indigo-500">支給額計</p><p className="mt-2 text-3xl font-black text-indigo-800">{yen.format(viewData?.totals.total_payment || 0)}</p></div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 shadow-sm"><p className="text-xs font-black text-emerald-600">グロス（交通費込）</p><p className="mt-2 text-3xl font-black text-emerald-800">{yen.format(viewData?.totals.gross_payment || 0)}</p></div>
          <button type="button" onClick={scrollToAlerts} className={`group rounded-2xl border p-5 text-left shadow-sm transition ${monthAlerts.length > 0 ? 'border-rose-400 bg-gradient-to-br from-rose-50 to-white ring-2 ring-rose-100 hover:border-rose-500 hover:shadow-md' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className={`text-xs font-black ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-slate-400'}`}>要確認（{month}）</p><p className={`mt-2 text-3xl font-black ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{monthAlerts.length}<span className="ml-1 text-sm">件</span></p></div>{monthAlerts.length > 0 ? <span className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 text-white shadow-sm"><AlertTriangle size={22} /></span> : <CheckCircle2 className="text-emerald-500" />}</div>
            {monthAlerts.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black"><span className="rounded-full bg-rose-600 px-2.5 py-1 text-white">要修正 {dangerCount}</span><span className="rounded-full bg-amber-200 px-2.5 py-1 text-amber-900">確認推奨 {warningCount}</span><span className="ml-auto inline-flex items-center gap-1 text-rose-700 group-hover:underline">一覧を見る <ArrowDown size={13} /></span></div>}
          </button>
        </section>

        <section className="mb-6 grid gap-4 lg:grid-cols-2">
          <ImportCard title="単価マスター" description={`登録済み ${viewData?.imports.rate_master_rows || 0}件。授業はEDIC授業_TANKA、事務は事務_TANKA、サブ（面接）はサブスタッフ_TANKAを使用します。`} kind="rates" busy={importing === 'rates'} onImport={importCsv} />
          <ImportCard title="通常勤怠データ" description={`選択月 ${viewData?.imports.regular_attendance_rows || 0}件。.xlsxは「勤務日・職員番号・職員氏名・実働開始・実働終了」を自動認識し、休憩行を除外します。同じ月を再取込すると既存データを置換します。`} kind="regular" busy={importing === 'regular'} onImport={importCsv} />
        </section>

        <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <div><h2 className="flex items-center gap-2 text-lg font-black"><Wallet size={19} className="text-indigo-600" /> 月次支給グロス</h2><p className="mt-1 text-xs font-bold text-slate-400">勤務時間が0分の対象者は除外されています。</p></div>
            <div className="flex flex-wrap gap-2"><button onClick={exportOriginalWorkbook} disabled={!viewData?.rows.length} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40"><Download size={15} /> 原本形式Excel</button><button onClick={exportSummary} disabled={!viewData?.rows.length} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40"><Download size={15} /> CSV出力</button></div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600"><tr>{['個人コード / 氏名', '日数 / 総時間', '授業', '事務', 'サブ', 'その他', '交通費', '支給額計', 'グロス', '状態'].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 font-black">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {viewData?.rows.map(row => <tr key={row.teacher_id || `${row.person_code}_${row.person_name}`} className={row.alert_count ? 'bg-rose-50/70' : ''}>
                  <td className={`px-3 py-3 ${row.alert_count ? 'border-l-4 border-l-rose-500' : ''}`}><p className="font-mono text-[10px] text-slate-400">{row.person_code || 'コード未設定'}</p><p className="mt-1 font-black">{row.person_name}</p><p className="mt-1 text-[10px] text-slate-400">単価: {row.rate_effective_from || '未登録'}</p></td>
                  <td className="px-3 py-3 font-black">{row.work_days}日<br /><span className="font-mono text-indigo-600">{hours(row.total_minutes)}</span></td>
                  {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map(key => <td key={key} className="px-3 py-3"><p className="font-mono font-black">{hours(row.categories[key].minutes)}</p><p className="mt-1 text-[10px] text-slate-400">@{row.categories[key].hourly_rate.toLocaleString()} / 手当{row.categories[key].allowance_count}回</p><p className="mt-1 font-black text-slate-700">{yen.format(row.categories[key].amount)}</p></td>)}
                  <td className="px-3 py-3 font-black">{yen.format(row.transportation_amount)}</td>
                  <td className="px-3 py-3 font-black text-indigo-700">{yen.format(row.total_payment)}</td>
                  <td className="px-3 py-3 text-sm font-black text-emerald-700">{yen.format(row.gross_payment)}</td>
                  <td className="px-3 py-3">{row.alert_count ? <button type="button" onClick={scrollToAlerts} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 font-black text-white shadow-sm hover:bg-rose-700"><AlertCircle size={14} /> 要確認 {row.alert_count}件</button> : <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={14} /> OK</span>}</td>
                </tr>)}
                {!loading && !viewData?.rows.length && <tr><td colSpan={10} className="p-10 text-center font-bold text-slate-400">対象月の勤務実績がありません。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="payroll-alerts" className={`scroll-mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm ${monthAlerts.length > 0 ? 'border-rose-300 ring-2 ring-rose-100' : 'border-emerald-200'}`}>
          <div className={`border-b p-5 ${monthAlerts.length > 0 ? 'border-rose-200 bg-gradient-to-r from-rose-100 via-rose-50 to-white' : 'border-emerald-100 bg-emerald-50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${monthAlerts.length > 0 ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>{monthAlerts.length > 0 ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}</span><div><h2 className={`text-xl font-black ${monthAlerts.length > 0 ? 'text-rose-950' : 'text-emerald-900'}`}>{month} 不整合・重複アラート</h2><p className={`mt-1 text-sm font-bold ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{monthAlerts.length > 0 ? `${affectedPeople}名に${monthAlerts.length}件の確認事項があります。` : '選択月に確認が必要な項目はありません。'}</p></div></div><button onClick={exportAlerts} disabled={!monthAlerts.length} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white shadow-sm disabled:opacity-40"><Download size={15} /> アラートCSV</button></div>
            {monthAlerts.length > 0 && <div className="mt-5 flex flex-wrap gap-2"><AlertFilterButton active={alertFilter === 'all'} onClick={() => setAlertFilter('all')} label="すべて" count={monthAlerts.length} tone="slate" /><AlertFilterButton active={alertFilter === 'danger'} onClick={() => setAlertFilter('danger')} label="要修正" count={dangerCount} tone="rose" /><AlertFilterButton active={alertFilter === 'warning'} onClick={() => setAlertFilter('warning')} label="確認推奨" count={warningCount} tone="amber" /></div>}
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {visibleAlerts.map((alert, index) => <div key={`${alert.code}_${alert.work_record_id || index}`} className={`flex gap-3 rounded-xl border-l-4 p-4 shadow-sm ${alert.severity === 'danger' ? 'border border-rose-200 border-l-rose-600 bg-rose-50' : 'border border-amber-200 border-l-amber-500 bg-amber-50'}`}><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${alert.severity === 'danger' ? 'bg-rose-600 text-white' : 'bg-amber-400 text-amber-950'}`}><AlertCircle size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${alert.severity === 'danger' ? 'bg-rose-600 text-white' : 'bg-amber-300 text-amber-950'}`}>{alert.severity === 'danger' ? '要修正' : '確認推奨'}</span><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">{ALERT_LABELS[alert.code] || alert.code}</span>{alert.date && <span className="text-xs font-bold text-slate-500">{alert.date}</span>}</div><div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="text-base font-black text-slate-950">{alert.person_name || '氏名未設定'}</p><span className="font-mono text-xs font-bold text-slate-500">{alert.person_code || '個人コード未設定'}</span></div><p className="mt-2 text-sm font-bold leading-6 text-slate-800">{alert.detail}</p></div></div>)}
            {!loading && !sortedAlerts.length && <div className="flex items-center justify-center gap-2 p-8 font-black text-emerald-700"><CheckCircle2 /> 不整合はありません。</div>}
            {!loading && sortedAlerts.length > 0 && !visibleAlerts.length && <div className="p-8 text-center font-bold text-slate-500">この重要度の確認事項はありません。</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

function AlertFilterButton({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: 'slate' | 'rose' | 'amber' }) {
  const colors = {
    slate: active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700',
    rose: active ? 'border-rose-600 bg-rose-600 text-white' : 'border-rose-200 bg-white text-rose-700',
    amber: active ? 'border-amber-400 bg-amber-400 text-amber-950' : 'border-amber-200 bg-white text-amber-800',
  };
  return <button type="button" onClick={onClick} className={`rounded-full border px-3.5 py-2 text-xs font-black shadow-sm transition hover:-translate-y-0.5 ${colors[tone]}`}>{label}<span className={`ml-2 rounded-full px-2 py-0.5 ${active ? 'bg-white/20' : 'bg-slate-100'}`}>{count}</span></button>;
}

function ImportCard({ title, description, kind, busy, onImport }: { title: string; description: string; kind: 'rates' | 'regular'; busy: boolean; onImport: (kind: 'rates' | 'regular', file: File) => void }) {
  const acceptsExcel = kind === 'regular';
  const accept = acceptsExcel ? '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' : '.xls,.csv,application/vnd.ms-excel,text/csv';
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-black">{title}</h2><p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{description}</p></div><FileUp className="shrink-0 text-indigo-500" /></div><div className="mt-4 flex flex-wrap gap-2"><label className={`flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white ${busy ? 'pointer-events-none opacity-50' : ''}`}>{busy ? <Loader2 className="animate-spin" size={14} /> : <FileUp size={14} />} Excel / CSV取込<input type="file" accept={accept} className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(kind, file); event.currentTarget.value = ''; }} /></label><button onClick={() => downloadTemplate(kind)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">テンプレート</button></div><p className="mt-3 text-[10px] font-bold text-amber-600">{acceptsExcel ? '通常勤怠はマクロなしの.xlsx（6MB以下）またはCSVに対応しています。' : '原本.xls（12MB以下）の「単価」シート、またはCSV UTF-8に対応しています。'}</p></div>;
}
