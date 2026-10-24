'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { AlertCircle, AlertTriangle, ArrowDown, CheckCircle2, Download, FileUp, Loader2, PlusCircle, RefreshCw, Save, Settings2, Trash2, Wallet, X } from 'lucide-react';
import { Button, ButtonLink, IconButton, buttonClass, useConfirm, useToast } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { buildOriginalPayrollHtml } from '@/lib/attendance-original-export';
import type { PayrollPersonSummary } from '@/lib/attendance-payroll';
import { decodeCsvBytes } from '@/lib/csv-text';
import type { IndividualRateMapping, IntegratedPayrollRow, IntegratedPayrollScope, PayrollAdjustment, PremiumCalculationRule, PremiumRuleKey } from '@/lib/attendance-integrated-payroll';
import { buildQ141PayrollWorkbook } from '@/lib/payroll-q141-xlsx';
import type { ScienceSocialWorkSummary } from '@/lib/science-social-work-summary';
import { jstDateKey } from '@/lib/date-key';
import { userErrorMessage } from '@/lib/user-error';

type CategoryKey = 'lesson' | 'office' | 'interview' | 'other';
type PayrollRow = PayrollPersonSummary & IntegratedPayrollRow;

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
  scope: IntegratedPayrollScope;
  program: AttendanceProgramFilter;
  rows: PayrollRow[];
  alerts: PayrollAlert[];
  totals: { people: number; total_minutes: number; total_payment: number; transportation_amount: number; gross_payment: number; danger: number; warning: number; excluded_without_rate: number };
  imports: { rate_master_rows: number; regular_attendance_rows: number; school_distribution_rows: number; allowance_query_rows: number };
  adjustments: PayrollAdjustment[];
  premium_rules: PremiumCalculationRule[];
  individual_rate_mappings: IndividualRateMapping[];
  science_social_work_summary: ScienceSocialWorkSummary[];
  error?: string;
};

type AttendanceProgramFilter = 'all' | 'normal' | 'science_social' | 'breakthrough';
const PROGRAM_LABELS: Record<AttendanceProgramFilter, string> = { all: '全部', normal: '通常', science_social: '理社講座', breakthrough: '突破ゼミ' };

const CATEGORY_LABELS: Record<CategoryKey, string> = { lesson: '授業', office: '事務', interview: 'サブ', other: 'その他' };
const PREMIUM_KEYS: PremiumRuleKey[] = ['training_2', 'training_3', 'office_premium_1', 'office_premium_2', 'incidental_premium_1', 'incidental_premium_2'];
const PAYROLL_MAPPING_RULES = [
  { attendance: '授業', payroll: '授業', rate: 'EDIC授業_TANKA', tone: 'border-indigo-200 bg-indigo-50 text-indigo-900' },
  { attendance: '事務', payroll: '事務', rate: '事務_TANKA', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  { attendance: 'サブ（サポート）', payroll: 'サブ', rate: 'サブスタッフ_TANKA', tone: 'border-violet-200 bg-violet-50 text-violet-900' },
  { attendance: 'その他', payroll: 'その他', rate: '事務_TANKA', tone: 'border-slate-200 bg-slate-50 text-slate-900' },
] as const;
const ALERT_LABELS: Record<string, string> = {
  rate_missing: '単価未登録',
  rate_ambiguous: '単価の重複',
  time_overlap: '勤務時間の重複',
  invalid_segment: '勤務時間エラー',
  other_note_required: '業務内容未入力',
  external_category_missing: '旧システム区分不足',
};
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
// 割増の列（割増事務など）の支給額に、授業など割増の列がない区分の割増分（特別勤務手当4に含む）を足して表示する。
const premiumSummary = (row: PayrollRow) => {
  const columns = PREMIUM_KEYS.reduce((total, key) => ({ minutes: total.minutes + row.q141[key].minutes, amount: total.amount + row.q141[key].amount }), { minutes: 0, amount: 0 });
  return row.premiums
    ? { minutes: row.premiums.night_minutes + row.premiums.overtime_minutes, amount: columns.amount + row.premiums.surcharge_amount, night: row.premiums.night_minutes, overtime: row.premiums.overtime_minutes }
    : { ...columns, night: 0, overtime: 0 };
};
const lessonBreakdown = (row: PayrollRow) => ({
  group: {
    minutes: row.q141.group_lesson.minutes + row.q141.sogaku_lesson.minutes,
    amount: row.q141.group_lesson.amount + row.q141.sogaku_lesson.amount,
  },
  individual: {
    minutes: row.q141.individual_1.minutes + row.q141.individual_2.minutes + row.q141.individual_3.minutes + row.q141.individual_4.minutes + row.q141.individual_5.minutes + row.q141.individual_6.minutes,
    amount: row.q141.individual_1.amount + row.q141.individual_2.amount + row.q141.individual_3.amount + row.q141.individual_4.amount + row.q141.individual_5.amount + row.q141.individual_6.amount,
  },
});
const officeBreakdown = (row: PayrollRow) => {
  const normal = row.q141.office;
  const premium1 = row.q141.office_premium_1;
  const premium2 = row.q141.office_premium_2;
  const categorizedMinutes = normal.minutes + premium1.minutes + premium2.minutes;
  const categorizedAmount = normal.amount + premium1.amount + premium2.amount;
  return {
    normal,
    premium1,
    premium2,
    other: {
      minutes: Math.max(0, row.categories.office.minutes - categorizedMinutes),
      amount: Math.max(0, row.categories.office.amount - categorizedAmount),
    },
  };
};
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const MAX_DIRECT_XLS_BYTES = 4 * 1024 * 1024;
const LEGACY_XLS_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_XLS_BYTES = 12 * 1024 * 1024;
const MAX_XLSX_BYTES = 6 * 1024 * 1024;

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

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readCsvText(file: File) {
  return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
}

function downloadTemplate(type: 'rates' | 'regular') {
  if (type === 'rates') {
    downloadCsv('単価マスター_テンプレート.csv', [[
      '個人コード', '氏名', '適用開始日', '授業時給', '事務時給', 'サブスタッフ時給', 'その他時給',
      '事業手当', '事務手当', 'サブスタッフ手当', 'その他手当',
    ], ['0001', '山田 太郎', '2026-04-01', 2500, 1200, 1500, 1200, 500, 0, 0, 0]]);
  } else {
    downloadCsv('旧システム勤怠_テンプレート.csv', [
      ['個人コード', '氏名', '日付', '開始', '終了', '勤務区分'],
      ['0001', '山田 太郎', '2026-08-01', '09:00', '17:00', '通常勤務'],
    ]);
  }
}

export default function AttendancePayrollPage() {
  const { user } = useAuth();
  // 勤怠一覧から開いたときは、見ていた月（?month=）を引き継ぐ。
  const [month, setMonth] = useState(() => jstDateKey().slice(0, 7));
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('month') || '';
    if (/^\d{4}-\d{2}$/.test(requested)) setMonth(requested);
  }, []);
  const [scope, setScope] = useState<IntegratedPayrollScope>('combined');
  const [program, setProgram] = useState<AttendanceProgramFilter>('all');
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<'rates' | 'regular' | 'school_distribution' | 'allowances' | ''>('');
  const [outputFormat, setOutputFormat] = useState<'q141' | 'summary' | 'original' | 'science_social_work'>('q141');
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [premiumRules, setPremiumRules] = useState<PremiumCalculationRule[]>([]);
  const [premiumRulesSaving, setPremiumRulesSaving] = useState(false);
  const [individualRateMappings, setIndividualRateMappings] = useState<IndividualRateMapping[]>([]);
  const [individualRateMappingsSaving, setIndividualRateMappingsSaving] = useState(false);
  const [adjustment, setAdjustment] = useState({ person_code: '', person_name: '', label: '', category: 'special_4', amount: '', reason: '' });
  const [error, setError] = useState('');
  const [alertFilter, setAlertFilter] = useState<'all' | 'danger' | 'warning'>('all');
  const [importNotice, setImportNotice] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const requestSequence = useRef(0);
  const viewData = data?.month === month && data.scope === scope && data.program === program ? data : null;

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/attendance-payroll?month=${month}&scope=${scope}&program=${program}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (requestId !== requestSequence.current) return;
      if (!response.ok || body.ok === false) throw new Error(body.error || '給与集計を取得できませんでした。');
      if (body.month !== month || body.scope !== scope || body.program !== program) throw new Error('選択条件と異なる集計結果を受信しました。再読み込みしてください。');
      setData(body);
      setPremiumRules(Array.isArray(body.premium_rules) ? body.premium_rules : []);
      setIndividualRateMappings(Array.isArray(body.individual_rate_mappings) ? body.individual_rate_mappings : []);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(userErrorMessage(loadError, '給与集計を取得できませんでした。'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [month, program, scope, user]);

  useEffect(() => { load(); }, [load]);

  const importCsv = async (kind: 'rates' | 'regular' | 'school_distribution' | 'allowances', file: File) => {
    if (!user) return;
    const extension = file.name.toLowerCase().split('.').pop();
    const valid = kind === 'regular' ? extension === 'csv' || extension === 'xlsx' : kind === 'rates' ? extension === 'csv' || extension === 'xls' : kind === 'allowances' ? extension === 'xls' : extension === 'csv';
    if (!valid) {
      setError(kind === 'regular' ? '旧システム勤怠はCSVまたは.xlsx形式を選択してください。' : kind === 'rates' ? '単価マスターはCSVまたは原本.xlsを選択してください。' : kind === 'allowances' ? 'Q042の.xlsファイルを選択してください。' : '校前配布申請はCSVを選択してください。');
      return;
    }
    // 取込はその月のデータを置き換えるので、ファイル名・種類・対象の月を見せてから始める。
    const kindLabel = kind === 'rates' ? '単価マスター' : kind === 'regular' ? '旧システムの勤怠' : kind === 'allowances' ? '手当（Q042）' : '校前配布申請';
    if (!(await confirm({
      title: `${kindLabel}を取り込みますか？`,
      message: `ファイル：${file.name}\n対象の月：${month.replace('-', '年')}月\n${kind === 'rates' ? '単価マスターを置き換えます。' : 'この月の同じ種類のデータを置き換えます。'}`,
      confirmLabel: '取り込む',
    }))) return;
    setImporting(kind);
    setError('');
    setImportNotice('');
    let legacyChunkUploadId = '';
    let legacyChunkCount = 0;
    try {
      const token = await user.getIdToken();
      const isXlsx = extension === 'xlsx';
      const isLegacyRateXls = (kind === 'rates' || kind === 'allowances') && extension === 'xls';
      if (isXlsx && file.size > MAX_XLSX_BYTES) throw new Error('勤怠Excelは6MB以下にしてください。');
      if (isLegacyRateXls && file.size > MAX_LEGACY_XLS_BYTES) throw new Error('旧Excelファイルは12MB以下にしてください。');
      const directLegacyXls = isLegacyRateXls && file.size <= MAX_DIRECT_XLS_BYTES;
      const chunkedLegacyXls = isLegacyRateXls && !directLegacyXls;
      const usesChunkUpload = isXlsx || chunkedLegacyXls;
      if (usesChunkUpload) {
        legacyChunkUploadId = crypto.randomUUID();
        legacyChunkCount = Math.ceil(file.size / LEGACY_XLS_CHUNK_BYTES);
        for (let index = 0; index < legacyChunkCount; index += 1) {
          const chunkResponse = await fetch('/api/attendance-payroll', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
              'X-Attendance-Upload-Id': legacyChunkUploadId,
              'X-Attendance-Chunk-Index': String(index),
              'X-Attendance-Chunk-Count': String(legacyChunkCount),
            },
            body: file.slice(index * LEGACY_XLS_CHUNK_BYTES, (index + 1) * LEGACY_XLS_CHUNK_BYTES),
          });
          const chunkBody = await chunkResponse.json().catch(() => ({}));
          if (!chunkResponse.ok || chunkBody.ok === false) throw new Error(chunkBody.error || 'Excelファイルの送信に失敗しました。');
        }
      }
      const directForm = directLegacyXls ? new FormData() : null;
      if (directForm) {
        directForm.append('action', kind === 'allowances' ? 'import_allowance_query' : 'import_rate_master');
        directForm.append('source_name', file.name);
        directForm.append('file', file);
      }
      const response = await fetch('/api/attendance-payroll', {
        method: 'POST',
        headers: directForm ? { Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: directForm || JSON.stringify(usesChunkUpload ? {
          action: isXlsx ? 'import_regular_attendance' : kind === 'allowances' ? 'import_allowance_query' : 'import_rate_master',
          source_name: file.name,
          chunk_upload_id: legacyChunkUploadId,
          chunk_count: legacyChunkCount,
          replace_month: true,
        } : {
          action: kind === 'rates' ? 'import_rate_master' : kind === 'school_distribution' ? 'import_school_distribution' : 'import_regular_attendance',
          csv_text: await readCsvText(file), source_name: file.name, replace_month: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        if (response.status === 504) {
          throw new Error('旧システム勤怠の保存が制限時間を超えました。再度実行せず、発生時刻を管理者にお知らせください。');
        }
        const details = Array.isArray(body.errors) ? `\n${body.errors.slice(0, 8).join('\n')}` : '';
        throw new Error(`${body.error || '取込に失敗しました。'}${details}`);
      }
      const importWarnings = Array.isArray(body.warnings) ? body.warnings.map(String).slice(0, 5) : [];
      const importedMonth = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : '';
      toast.success(`${body.imported}件を取り込みました。${body.skipped ? `（注意事項 ${body.skipped}件）` : ''}`);
      setImportNotice(`${body.imported}件を取り込みました。${importedMonth ? ` 対象月: ${importedMonth}` : ''}${body.skipped ? `\n${body.skipped}件の注意事項があります。${importWarnings.length ? `\n${importWarnings.join('\n')}` : ''}` : ''}${importedMonth && importedMonth !== month ? `\n画面を${importedMonth}の集計へ切り替えます。` : ''}`);
      if (importedMonth && importedMonth !== month) {
        setMonth(importedMonth);
      } else {
        await load();
      }
    } catch (importError) {
      setError(userErrorMessage(importError, '取込に失敗しました。'));
    } finally {
      if (legacyChunkUploadId) {
        const token = await user.getIdToken().catch(() => '');
        if (token) await fetch('/api/attendance-payroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'delete_upload_chunks', chunk_upload_id: legacyChunkUploadId, chunk_count: legacyChunkCount }),
        }).catch(() => undefined);
      }
      setImporting('');
    }
  };

  const savePremiumRules = async () => {
    if (!user || !premiumRules.length) return;
    setPremiumRulesSaving(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/attendance-payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'save_premium_rules', csv_text: JSON.stringify(premiumRules) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '割増計算式を保存できませんでした。');
      await load();
    } catch (saveError) { setError(userErrorMessage(saveError, '割増計算式を保存できませんでした。')); }
    finally { setPremiumRulesSaving(false); }
  };

  const saveIndividualRateMappings = async () => {
    if (!user || !individualRateMappings.length) return;
    setIndividualRateMappingsSaving(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/attendance-payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'save_individual_rate_mappings', csv_text: JSON.stringify(individualRateMappings) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '個別指導の単価紐付けを保存できませんでした。');
      await load();
    } catch (saveError) { setError(userErrorMessage(saveError, '個別指導の単価紐付けを保存できませんでした。')); }
    finally { setIndividualRateMappingsSaving(false); }
  };

  const saveAdjustment = async () => {
    if (!user) return;
    setAdjustmentSaving(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/attendance-payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'save_adjustment', csv_text: JSON.stringify({ ...adjustment, month, amount: Number(adjustment.amount) }) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '手当を保存できませんでした。');
      setAdjustment({ person_code: '', person_name: '', label: '', category: 'special_4', amount: '', reason: '' });
      await load();
    } catch (saveError) { setError(userErrorMessage(saveError, '手当を保存できませんでした。')); }
    finally { setAdjustmentSaving(false); }
  };

  const deleteAdjustment = async (id: string) => {
    if (!user) return;
    const target = viewData?.adjustments.find(item => item.id === id);
    const targetLabel = target ? `${target.person_code || target.person_name}・${target.label}` : 'この追加手当';
    if (!(await confirm({ title: `「${targetLabel}」を削除しますか？`, message: '削除すると給与集計から外れます。', confirmLabel: '削除する', tone: 'danger' }))) return;
    const token = await user.getIdToken();
    const response = await fetch('/api/attendance-payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'delete_adjustment', csv_text: JSON.stringify({ id }) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) return setError(body.error || '手当を削除できませんでした。');
    await load();
  };

  const exportSummary = () => {
    if (!viewData?.rows.length) return;
    const header = [
      '個人コード', '氏名', '勤務日数', '総時間',
      '集団授業時間', '集団授業支給額', '個別授業時間', '個別授業支給額',
      ...Object.values(CATEGORY_LABELS).flatMap(label => [`${label}時間`, `${label}単価`, `${label}手当回数`, `${label}支給額`]),
      '交通費', '支給額計', 'グロス', 'アラート数', '単価適用日',
    ];
    const rows = viewData.rows.map(row => [
      row.person_code, row.person_name, row.work_days, hours(row.total_minutes),
      hours(lessonBreakdown(row).group.minutes), lessonBreakdown(row).group.amount,
      hours(lessonBreakdown(row).individual.minutes), lessonBreakdown(row).individual.amount,
      ...Object.keys(CATEGORY_LABELS).flatMap(key => {
        const category = row.categories[key as CategoryKey];
        return [hours(category.minutes), category.hourly_rate, category.allowance_count, category.amount];
      }),
      row.transportation_amount, row.total_payment, row.gross_payment, row.alert_count, row.rate_effective_from || '',
    ]);
    downloadCsv(`職員別給与一覧_${viewData.month.replace('-', '')}_${PROGRAM_LABELS[viewData.program]}_${viewData.scope}.csv`, [header, ...rows]);
  };

  const exportAlerts = () => {
    if (!viewData?.alerts.length) return;
    downloadCsv(`勤怠不整合_${viewData.month}.csv`, [
      ['重要度', 'コード', '個人コード', '氏名', '日付', '勤怠ID', '内容'],
      ...viewData.alerts.filter(alert => !alert.date || alert.date.startsWith(viewData.month)).map(alert => [alert.severity, alert.code, alert.person_code, alert.person_name, alert.date || '', alert.work_record_id || '', alert.detail]),
    ]);
  };

  const exportScienceSocialWorkSummary = () => {
    if (!viewData?.science_social_work_summary?.length) return;
    downloadCsv(`オンライン理社講座_職員別勤務集計_${viewData.month.replace('-', '')}.csv`, [
      [
        '対象月', '個人コード', '氏名', '勤務日数合計（旧勤怠重複除外後）', '勤務日（旧勤怠重複除外後）',
        '勤務時間合計（旧勤怠重複除外後）', '深夜時間（22:00〜5:00・内数）',
        '除外前勤務日数', '旧勤怠重複で除外した日数', '旧勤怠重複で除外した日',
      ],
      ...viewData.science_social_work_summary.map(row => [
        viewData.month,
        row.person_code,
        row.person_name,
        row.work_days,
        row.work_dates.join(' / '),
        hours(row.total_minutes),
        hours(row.late_night_minutes),
        row.before_exclusion_work_days,
        row.excluded_duplicate_days,
        row.excluded_duplicate_dates.join(' / '),
      ]),
    ]);
  };

  const exportOriginalWorkbook = () => {
    if (!viewData?.rows.length) return;
    downloadExcelHtml(`${PROGRAM_LABELS[viewData.program]}給与_${viewData.month}_原本形式.xls`, buildOriginalPayrollHtml(viewData.month, viewData.rows));
  };

  const exportSelected = async () => {
    if (outputFormat === 'science_social_work') return exportScienceSocialWorkSummary();
    if (!viewData?.rows.length) return;
    if (outputFormat === 'summary') return exportSummary();
    if (outputFormat === 'original') return exportOriginalWorkbook();
    const blob = await buildQ141PayrollWorkbook(viewData.month, viewData.rows);
    downloadBlob(`給与計算_TP取込_照合_${viewData.month.replace('-', '')}_${PROGRAM_LABELS[viewData.program]}.xlsx`, blob);
  };

  const monthAlerts = useMemo(() => (viewData?.alerts || []).filter(alert => !alert.date || alert.date.startsWith(month)), [month, viewData?.alerts]);
  const sortedAlerts = useMemo(() => [...monthAlerts].sort((a, b) => (a.severity === b.severity ? String(b.date || '').localeCompare(String(a.date || '')) : a.severity === 'danger' ? -1 : 1)), [monthAlerts]);
  const visibleAlerts = useMemo(() => alertFilter === 'all' ? sortedAlerts : sortedAlerts.filter(alert => alert.severity === alertFilter), [alertFilter, sortedAlerts]);
  const affectedPeople = useMemo(() => new Set(monthAlerts.map(alert => alert.person_code || alert.person_name)).size, [monthAlerts]);
  const dangerCount = monthAlerts.filter(alert => alert.severity === 'danger').length;
  const warningCount = monthAlerts.filter(alert => alert.severity === 'warning').length;
  const scrollToAlerts = () => document.getElementById('payroll-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main className="text-slate-900">
      <div>
        <AdminPageHeader
          description="新システム、旧システム勤怠、校前配布、追加手当を個人コードで合算します。"
          backHref="/master/attendance"
          actions={<>
            <input type="month" value={month} onChange={event => setMonth(event.target.value)} aria-label="対象月" className="min-h-11 rounded-input border border-line bg-white px-4 py-2 text-sm font-bold" />
            <select value={scope} onChange={event => setScope(event.target.value as IntegratedPayrollScope)} aria-label="集計範囲" className="min-h-11 rounded-input border border-line bg-white px-4 py-2 text-sm font-bold">
              <option value="combined">旧＋新を合算</option>
              <option value="external">旧システム勤怠のみ</option>
              <option value="system">新システム勤怠のみ</option>
            </select>
            <select value={program} onChange={event => setProgram(event.target.value as AttendanceProgramFilter)} className="min-h-11 rounded-input border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-bold text-accent" aria-label="勤務区分">
              {(Object.keys(PROGRAM_LABELS) as AttendanceProgramFilter[]).map(value => <option key={value} value={value}>{PROGRAM_LABELS[value]}</option>)}
            </select>
            <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={load} loading={loading}>再読み込み</Button>
          </>}
        />

        {error && <div role="alert" className="mb-5 whitespace-pre-wrap rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        {importNotice && <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><p className="min-w-0 flex-1 whitespace-pre-wrap">{importNotice}</p><IconButton label="閉じる" size="sm" onClick={() => setImportNotice('')}><X size={16} aria-hidden /></IconButton></div>}

        <details className="group mb-6 overflow-hidden rounded-card border border-accent/20 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-accent-soft px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            <div className="min-w-0 flex-1">
              <h2 className="whitespace-normal break-words text-base font-bold leading-snug text-accent">給与集計ルール</h2>
              <p className="mt-1 whitespace-normal break-words text-xs font-bold leading-relaxed text-accent">勤怠で選んだ業務区分を、次の給与区分と単価で自動集計します。</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-accent"><span className="group-open:hidden">表示する</span><span className="hidden group-open:inline">閉じる</span><ArrowDown size={16} className="transition-transform group-open:rotate-180" /></span>
          </summary>
          <div className="flex justify-end border-t border-accent/20 px-4 pt-4">
            <ButtonLink href="/master/attendance" variant="secondary" size="sm" icon={<Wallet size={15} className="shrink-0" aria-hidden />}>
              勤怠区分を確認・編集
            </ButtonLink>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {PAYROLL_MAPPING_RULES.map(rule => (
              <div key={rule.attendance} className={`rounded-btn border p-4 ${rule.tone}`}>
                <p className="text-xs font-bold opacity-60">勤怠で選択</p>
                <p className="mt-1 text-base font-bold">{rule.attendance}</p>
                <p className="my-2 text-center text-xs font-bold opacity-50">↓ 給与集計</p>
                <div className="rounded-lg bg-white/80 p-3">
                  <p className="font-bold">{rule.payroll}</p>
                  <p className="mt-1 break-all font-mono text-xs font-bold opacity-70">単価：{rule.rate}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="whitespace-normal break-words border-t border-slate-100 px-5 py-3 text-xs font-bold leading-relaxed text-slate-500">サポート業務は勤怠で「サブ（サポート）」を選択してください。給与明細・集計表では「サブ」として表示されます。</p>
        </details>

        <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-card border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-400">実績対象者</p><p className="mt-2 text-3xl font-black">{viewData?.totals.people || 0}<span className="ml-1 text-sm text-slate-400">名</span></p></div>
          <div className="rounded-card border border-accent/20 bg-accent-soft p-5 shadow-sm"><p className="text-xs font-bold text-accent">支給額計</p><p className="mt-2 text-3xl font-black text-accent">{yen.format(viewData?.totals.total_payment || 0)}</p></div>
          <div className="rounded-card border border-emerald-100 bg-emerald-50 p-5 shadow-sm"><p className="text-xs font-bold text-emerald-600">グロス（交通費込）</p><p className="mt-2 text-3xl font-black text-emerald-800">{yen.format(viewData?.totals.gross_payment || 0)}</p></div>
          <button type="button" onClick={scrollToAlerts} className={`group rounded-card border p-5 text-left shadow-sm transition ${monthAlerts.length > 0 ? 'border-rose-400 bg-gradient-to-br from-rose-50 to-white ring-2 ring-rose-100 hover:border-rose-500 hover:shadow-md' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className={`text-xs font-bold ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-slate-400'}`}>要確認（{month}）</p><p className={`mt-2 text-3xl font-black ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{monthAlerts.length}<span className="ml-1 text-sm">件</span></p></div>{monthAlerts.length > 0 ? <span className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 text-white shadow-sm"><AlertTriangle size={22} /></span> : <CheckCircle2 className="text-emerald-500" />}</div>
            {monthAlerts.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-rose-600 px-2.5 py-1 text-white">要修正 {dangerCount}</span><span className="rounded-full bg-amber-200 px-2.5 py-1 text-amber-900">確認推奨 {warningCount}</span><span className="ml-auto inline-flex items-center gap-1 text-rose-700 group-hover:underline">一覧を見る <ArrowDown size={13} /></span></div>}
          </button>
        </section>

        <section className="mb-6 overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><FileUp size={19} className="text-accent" /> 給与計算データの取込</h2><p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">上から順に取り込めば計算できます。同じ月を再取込すると、その月のデータを安全に入れ替えます。</p></div>
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <ImportCard step="1・必須" title="単価マスターを更新" description={`登録済み ${viewData?.imports.rate_master_rows || 0}件。ここに存在し、選択月に有効な職員だけを給与集計へ表示します。`} kind="rates" busy={importing === 'rates'} onImport={importCsv} />
            <ImportCard step="2・必須" title="旧システム勤怠を更新" description={`選択月 ${viewData?.imports.regular_attendance_rows || 0}件。講座・作業・実働分から通常給と割増給を自動計算します。`} kind="regular" busy={importing === 'regular'} onImport={importCsv} />
          </div>
          <details className="group border-t border-slate-100">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-5 py-4"><div><p className="font-bold text-slate-800">3・必要な場合だけ　補助手当データ</p><p className="mt-1 text-xs font-bold text-slate-500">校前配布・理社講座・交通費などがある月に使用します。</p></div><ArrowDown size={17} className="transition-transform group-open:rotate-180" /></summary>
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <ImportCard step="3-A・任意" title="校前配布申請" description={`選択月 ${viewData?.imports.school_distribution_rows || 0}件。CSVの手当計と交通費計を個人コードで合算します。`} kind="school_distribution" busy={importing === 'school_distribution'} onImport={importCsv} />
              <ImportCard step="3-B・任意" title="旧資料の補助手当（Q042）" description={`登録済み ${viewData?.imports.allowance_query_rows || 0}名。校前・理社・移動費を更新します。割増給は勤怠時間から自動計算するため取り込みません。`} kind="allowances" busy={importing === 'allowances'} onImport={importCsv} />
            </div>
          </details>
        </section>

        <details className="group mb-6 overflow-hidden rounded-card border border-sky-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-sky-50 px-5 py-4"><div><h2 className="flex items-center gap-2 font-bold text-sky-950"><Settings2 size={18} /> 個別指導の単価紐付け</h2><p className="mt-1 text-xs font-bold text-sky-700">個別指導の勤務区分ごとに、単価マスターのどの列を使用するか設定します。</p></div><span className="inline-flex items-center gap-1 text-xs font-bold text-sky-800"><span className="group-open:hidden">設定する</span><span className="hidden group-open:inline">閉じる</span><ArrowDown size={16} className="transition-transform group-open:rotate-180" /></span></summary>
          <div className="grid gap-3 border-t border-sky-100 p-5 md:grid-cols-2 xl:grid-cols-3">
            {individualRateMappings.map((mapping, index) => <label key={mapping.attendance_key} className="rounded-btn border border-slate-200 bg-slate-50 p-4">
              <span className="block text-xs font-bold text-slate-700">{mapping.attendance_label}</span>
              <span className="my-2 block text-center text-xs font-bold text-slate-300">↓ 使用する単価</span>
              <select value={mapping.rate_item_key} onChange={event => setIndividualRateMappings(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, rate_item_key: event.target.value as IndividualRateMapping['rate_item_key'] } : item))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-sky-800">
                <option value="individual_1">個別授業1_TANKA</option><option value="individual_2">個別授業2_TANKA</option><option value="individual_3">個別授業3_TANKA</option><option value="individual_4">個別授業4_TANKA</option><option value="individual_5">個別授業5_TANKA</option><option value="individual_6">個別授業6_TANKA</option>
              </select>
            </label>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4"><p className="text-xs font-bold leading-relaxed text-slate-500">初期設定：通常1対1〜1対3は単価1〜3、中受・高1対1〜1対3は単価4〜6です。</p><Button size="sm" onClick={() => void saveIndividualRateMappings()} disabled={!individualRateMappings.length} loading={individualRateMappingsSaving} icon={<Save size={15} aria-hidden />}>紐付けを保存して再計算</Button></div>
        </details>

        <details className="group mb-6 overflow-hidden rounded-card border border-violet-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-violet-50 px-5 py-4"><div><h2 className="flex items-center gap-2 font-bold text-violet-950"><Settings2 size={18} /> 割増計算式</h2><p className="mt-1 text-xs font-bold text-violet-700">労働基準法の最低ラインで自動計算します。22:00〜翌5:00だけ、または1日の実働8時間超だけの時間は割増1、深夜かつ8時間超の時間は割増2。授業・個別・創学など割増の列がない区分は、割増事務1・2の計算式で求めた割増分を特別勤務手当4に入れます。</p></div><span className="inline-flex items-center gap-1 text-xs font-bold text-violet-800"><span className="group-open:hidden">設定する</span><span className="hidden group-open:inline">閉じる</span><ArrowDown size={16} className="transition-transform group-open:rotate-180" /></span></summary>
          <div className="overflow-x-auto border-t border-violet-100">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 font-bold">割増区分</th><th className="px-4 py-3 font-bold">基準単価</th><th className="px-4 py-3 font-bold">倍率</th><th className="px-4 py-3 font-bold">固定加算／時</th><th className="px-4 py-3 font-bold">端数処理</th><th className="px-4 py-3 font-bold">使用</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{premiumRules.map((rule, index) => <tr key={rule.key}>
                <td className="px-4 py-3 font-bold">{rule.label}</td>
                <td className="px-4 py-3 font-bold text-slate-500">{rule.base_key === 'training_1' ? '通常研修' : rule.base_key === 'office' ? '通常事務' : '通常付随'}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><input type="number" min="0" max="10" step="0.01" value={rule.multiplier} onChange={event => setPremiumRules(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, multiplier: Number(event.target.value) } : item))} className="w-24 rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold" /><span className="font-bold text-slate-400">倍</span></div></td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><input type="number" min="-100000" max="100000" step="1" value={rule.fixed_hourly_addition} onChange={event => setPremiumRules(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, fixed_hourly_addition: Number(event.target.value) } : item))} className="w-28 rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold" /><span className="font-bold text-slate-400">円</span></div></td>
                <td className="px-4 py-3 font-bold text-slate-700">切り上げ（固定）</td>
                <td className="px-4 py-3"><input type="checkbox" checked={rule.enabled} onChange={event => setPremiumRules(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} className="h-5 w-5 accent-violet-600" /></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4"><p className="text-xs font-bold text-slate-500">例：事務単価1,200円 × 1.25倍 ＋ 0円 ＝ 割増単価1,500円／時</p><Button size="sm" onClick={() => void savePremiumRules()} disabled={!premiumRules.length} loading={premiumRulesSaving} icon={<Save size={15} aria-hidden />}>計算式を保存して再計算</Button></div>
        </details>

        <details className="group mb-6 overflow-hidden rounded-card border border-amber-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-amber-50 px-5 py-4">
            <div><h2 className="font-bold text-amber-950">個別追加手当</h2><p className="mt-1 text-xs font-bold text-amber-700">自動計算できない紹介礼金・特別勤務・交通費だけを入力します。割増給は上の計算式で自動計算されます。</p></div>
            <span className="text-xs font-bold text-amber-800"><span className="group-open:hidden">入力する</span><span className="hidden group-open:inline">閉じる</span></span>
          </summary>
          <div className="grid gap-3 border-t border-amber-100 p-5 md:grid-cols-2 xl:grid-cols-6">
            <input value={adjustment.person_code} onChange={event => setAdjustment(prev => ({ ...prev, person_code: event.target.value }))} placeholder="個人コード" className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold" />
            <input value={adjustment.person_name} onChange={event => setAdjustment(prev => ({ ...prev, person_name: event.target.value }))} placeholder="氏名" className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold" />
            <input value={adjustment.label} onChange={event => setAdjustment(prev => ({ ...prev, label: event.target.value }))} placeholder="手当名（例：紹介礼金）" className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold" />
            <select value={adjustment.category} onChange={event => setAdjustment(prev => ({ ...prev, category: event.target.value }))} className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold"><option value="special_4">その他4（紹介礼金等）</option><option value="special_1">特別勤務1</option><option value="special_2">その他2（校前等）</option><option value="special_3">その他3（理社等）</option><option value="transportation">非課税交通費</option></select>
            <input type="number" value={adjustment.amount} onChange={event => setAdjustment(prev => ({ ...prev, amount: event.target.value }))} placeholder="金額" className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold" />
            <Button onClick={saveAdjustment} loading={adjustmentSaving} icon={<PlusCircle size={16} aria-hidden />}>追加</Button>
            <input value={adjustment.reason} onChange={event => setAdjustment(prev => ({ ...prev, reason: event.target.value }))} placeholder="理由・備考" className="rounded-btn border border-slate-200 px-3 py-2 text-sm font-bold md:col-span-2 xl:col-span-6" />
          </div>
          {!!viewData?.adjustments.length && <div className="border-t border-slate-100 p-4"><div className="flex flex-wrap gap-2">{viewData.adjustments.map(item => <span key={item.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700"><span>{item.person_code || item.person_name}・{item.label}・{yen.format(item.amount)}</span><IconButton label={`${item.label}を削除`} size="sm" onClick={() => item.id && deleteAdjustment(item.id)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={14} aria-hidden /></IconButton></span>)}</div></div>}
        </details>

        <section className="mb-6 overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <div><h2 className="flex items-center gap-2 text-lg font-bold"><Wallet size={19} className="text-accent" /> 月次支給グロス</h2><p className="mt-1 text-xs font-bold text-slate-400">単価マスター登録者のうち、勤務時間または追加支給がある職員だけを表示します。{viewData?.totals.excluded_without_rate ? ` 単価未登録の${viewData.totals.excluded_without_rate}名は対象外です。` : ''}</p></div>
            <div className="flex flex-wrap gap-2"><select value={outputFormat} onChange={event => setOutputFormat(event.target.value as typeof outputFormat)} className="rounded-btn border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option value="q141">給与計算・TP取込・照合（Excel）</option><option value="summary">職員別給与一覧（CSV）</option><option value="science_social_work">オンライン理社講座・職員別勤務集計（CSV）</option><option value="original">突破ゼミ原本形式（Excel）</option></select><Button size="sm" onClick={() => void exportSelected()} disabled={outputFormat === 'science_social_work' ? !viewData?.science_social_work_summary?.length : !viewData?.rows.length} icon={<Download size={15} aria-hidden />}>選択形式で出力</Button></div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600"><tr>{['個人コード / 氏名', '日数 / 総時間', '授業（集団・個別）', '事務', 'サブ', 'その他', '割増（内数）', '交通費', '支給額計', 'グロス', '状態'].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 font-bold">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {viewData?.rows.map(row => <tr key={row.teacher_id || `${row.person_code}_${row.person_name}`} className={row.alert_count ? 'bg-rose-50/70' : ''}>
                  <td className={`px-3 py-3 ${row.alert_count ? 'border-l-4 border-l-rose-500' : ''}`}><p className="font-mono text-xs text-slate-400">{row.person_code || 'コード未設定'}</p><p className="mt-1 font-bold">{row.person_name}</p><p className="mt-1 text-xs text-slate-400">単価: {row.rate_effective_from || '未登録'}</p><p className="mt-1 text-xs font-bold text-accent">新システム {yen.format(row.source_amounts?.system || 0)} / 旧システム {yen.format(row.source_amounts?.external || 0)}</p></td>
                  <td className="px-3 py-3 font-bold">{row.work_days}日<br /><span className="font-mono text-accent">{hours(row.total_minutes)}</span></td>
                  {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map(key => key === 'lesson' ? <LessonBreakdownCell key={key} row={row} /> : key === 'office' ? <OfficeBreakdownCell key={key} row={row} /> : <td key={key} className="px-3 py-3"><p className="font-mono font-bold">{hours(row.categories[key].minutes)}</p><p className="mt-1 text-xs text-slate-400">@{row.categories[key].hourly_rate.toLocaleString()} / 手当{row.categories[key].allowance_count}回</p><p className="mt-1 font-bold text-slate-700">{yen.format(row.categories[key].amount)}</p></td>)}
                  <td className="bg-violet-50/60 px-3 py-3"><p className="font-mono font-bold text-violet-800">{hours(premiumSummary(row).minutes)}</p><p className="mt-1 whitespace-nowrap text-xs font-bold text-violet-500">深夜 {hours(premiumSummary(row).night)} / 8時間超 {hours(premiumSummary(row).overtime)}</p><p className="mt-1 font-bold text-violet-700">{yen.format(premiumSummary(row).amount)}</p></td>
                  <td className="px-3 py-3 font-bold">{yen.format(row.transportation_amount)}</td>
                  <td className="px-3 py-3 font-bold text-accent">{yen.format(row.total_payment)}</td>
                  <td className="px-3 py-3 text-sm font-bold text-emerald-700">{yen.format(row.gross_payment)}</td>
                  <td className="px-3 py-3">{row.alert_count ? <button type="button" onClick={scrollToAlerts} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 font-bold text-white shadow-sm hover:bg-rose-700"><AlertCircle size={14} /> 要確認 {row.alert_count}件</button> : <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={14} /> OK</span>}</td>
                </tr>)}
                {!loading && !viewData?.rows.length && <tr><td colSpan={11} className="p-10 text-center font-bold text-slate-400">単価マスター登録者の対象月勤務実績がありません。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="payroll-alerts" className={`scroll-mt-5 overflow-hidden rounded-card border bg-white shadow-sm ${monthAlerts.length > 0 ? 'border-rose-300 ring-2 ring-rose-100' : 'border-emerald-200'}`}>
          <div className={`border-b p-5 ${monthAlerts.length > 0 ? 'border-rose-200 bg-gradient-to-r from-rose-100 via-rose-50 to-white' : 'border-emerald-100 bg-emerald-50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-btn ${monthAlerts.length > 0 ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>{monthAlerts.length > 0 ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}</span><div><h2 className={`text-xl font-black ${monthAlerts.length > 0 ? 'text-rose-950' : 'text-emerald-900'}`}>{month} 不整合・重複アラート</h2><p className={`mt-1 text-sm font-bold ${monthAlerts.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{monthAlerts.length > 0 ? `${affectedPeople}名に${monthAlerts.length}件の確認事項があります。` : '選択月に確認が必要な項目はありません。'}</p></div></div><button onClick={exportAlerts} disabled={!monthAlerts.length} className="flex items-center gap-2 rounded-btn bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm disabled:opacity-40"><Download size={15} /> アラートCSV</button></div>
            {monthAlerts.length > 0 && <div className="mt-5 flex flex-wrap gap-2"><AlertFilterButton active={alertFilter === 'all'} onClick={() => setAlertFilter('all')} label="すべて" count={monthAlerts.length} tone="slate" /><AlertFilterButton active={alertFilter === 'danger'} onClick={() => setAlertFilter('danger')} label="要修正" count={dangerCount} tone="rose" /><AlertFilterButton active={alertFilter === 'warning'} onClick={() => setAlertFilter('warning')} label="確認推奨" count={warningCount} tone="amber" /></div>}
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {visibleAlerts.map((alert, index) => <div key={`${alert.code}_${alert.work_record_id || index}`} className={`flex gap-3 rounded-btn border-l-4 p-4 shadow-sm ${alert.severity === 'danger' ? 'border border-rose-200 border-l-rose-600 bg-rose-50' : 'border border-amber-200 border-l-amber-500 bg-amber-50'}`}><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${alert.severity === 'danger' ? 'bg-rose-600 text-white' : 'bg-amber-400 text-amber-950'}`}><AlertCircle size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${alert.severity === 'danger' ? 'bg-rose-600 text-white' : 'bg-amber-300 text-amber-950'}`}>{alert.severity === 'danger' ? '要修正' : '確認推奨'}</span><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{ALERT_LABELS[alert.code] || alert.code}</span>{alert.date && <span className="text-xs font-bold text-slate-500">{alert.date}</span>}</div><div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="text-base font-bold text-slate-950">{alert.person_name || '氏名未設定'}</p><span className="font-mono text-xs font-bold text-slate-500">{alert.person_code || '個人コード未設定'}</span></div><p className="mt-2 text-sm font-bold leading-6 text-slate-800">{alert.detail}</p></div></div>)}
            {!loading && !sortedAlerts.length && <div className="flex items-center justify-center gap-2 p-8 font-bold text-emerald-700"><CheckCircle2 /> 不整合はありません。</div>}
            {!loading && sortedAlerts.length > 0 && !visibleAlerts.length && <div className="p-8 text-center font-bold text-slate-500">この重要度の確認事項はありません。</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

function LessonBreakdownCell({ row }: { row: PayrollRow }) {
  const breakdown = lessonBreakdown(row);
  return <td className="min-w-52 px-3 py-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-slate-400">授業合計</span><span className="font-mono font-bold">{hours(row.categories.lesson.minutes)} / {yen.format(row.categories.lesson.amount)}</span></div><div className="mt-2 grid grid-cols-2 gap-2"><div className="rounded-lg bg-accent-soft p-2"><p className="text-xs font-bold text-accent">集団授業</p><p className="mt-1 font-mono font-bold text-accent">{hours(breakdown.group.minutes)}</p><p className="mt-1 font-bold text-accent">{yen.format(breakdown.group.amount)}</p></div><div className="rounded-lg bg-sky-50 p-2"><p className="text-xs font-bold text-sky-600">個別授業</p><p className="mt-1 font-mono font-bold text-sky-950">{hours(breakdown.individual.minutes)}</p><p className="mt-1 font-bold text-sky-700">{yen.format(breakdown.individual.amount)}</p></div></div></td>;
}

function OfficeBreakdownCell({ row }: { row: PayrollRow }) {
  const breakdown = officeBreakdown(row);
  const items = [
    { key: 'normal', label: '通常事務', value: breakdown.normal, tone: 'bg-amber-50 text-amber-900', labelTone: 'text-amber-600' },
    { key: 'premium1', label: '深夜事務', value: breakdown.premium1, tone: 'bg-violet-50 text-violet-950', labelTone: 'text-violet-600' },
    { key: 'premium2', label: '深夜事務2', value: breakdown.premium2, tone: 'bg-fuchsia-50 text-fuchsia-950', labelTone: 'text-fuchsia-600' },
  ].filter(item => item.value.minutes > 0 || item.key === 'normal');
  return <td className="min-w-56 px-3 py-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-slate-400">事務系合計</span><span className="font-mono font-bold">{hours(row.categories.office.minutes)} / {yen.format(row.categories.office.amount)}</span></div><div className="mt-2 space-y-1.5">{items.map(item => <div key={item.key} className={`grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2.5 py-2 ${item.tone}`}><p className={`text-xs font-bold ${item.labelTone}`}>{item.label}</p><p className="text-right font-mono text-xs font-bold">{hours(item.value.minutes)}</p><p className="text-xs font-bold">@{item.value.rate.toLocaleString()}</p><p className="text-right text-xs font-bold">{yen.format(item.value.amount)}</p></div>)}{breakdown.other.minutes > 0 && <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg bg-slate-50 px-2.5 py-2 text-slate-700"><p className="text-xs font-bold">研修・メンター等</p><p className="text-right font-mono text-xs font-bold">{hours(breakdown.other.minutes)}</p><p className="text-xs font-bold">区分別単価</p><p className="text-right text-xs font-bold">{yen.format(breakdown.other.amount)}</p></div>}</div></td>;
}

function AlertFilterButton({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: 'slate' | 'rose' | 'amber' }) {
  const colors = {
    slate: active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700',
    rose: active ? 'border-rose-600 bg-rose-600 text-white' : 'border-rose-200 bg-white text-rose-700',
    amber: active ? 'border-amber-400 bg-amber-400 text-amber-950' : 'border-amber-200 bg-white text-amber-800',
  };
  return <button type="button" onClick={onClick} className={`rounded-full border px-3.5 py-2 text-xs font-bold shadow-sm transition hover:-translate-y-0.5 ${colors[tone]}`}>{label}<span className={`ml-2 rounded-full px-2 py-0.5 ${active ? 'bg-white/20' : 'bg-slate-100'}`}>{count}</span></button>;
}

function ImportCard({ step, title, description, kind, busy, onImport }: { step: string; title: string; description: string; kind: 'rates' | 'regular' | 'school_distribution' | 'allowances'; busy: boolean; onImport: (kind: 'rates' | 'regular' | 'school_distribution' | 'allowances', file: File) => void }) {
  const acceptsExcel = kind === 'regular';
  const accept = acceptsExcel ? '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' : kind === 'rates' ? '.xls,.csv,application/vnd.ms-excel,text/csv' : kind === 'allowances' ? '.xls,application/vnd.ms-excel' : '.csv,text/csv';
  const format = acceptsExcel ? '.xlsx または .csv' : kind === 'rates' ? '原本 .xls または .csv' : kind === 'allowances' ? 'Q042 .xls' : '.csv';
  return <div className="rounded-card border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><span className="inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">{step}</span><h3 className="mt-2 text-base font-bold">{title}</h3><p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{description}</p></div><FileUp className="shrink-0 text-accent" aria-hidden /></div><div className="mt-4 flex flex-wrap items-center gap-2"><label className={buttonClass('secondary', 'sm', `cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`)}>{busy ? <Loader2 className="animate-spin" size={14} /> : <FileUp size={14} />} ファイルを選んで取込<input type="file" accept={accept} className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(kind, file); event.currentTarget.value = ''; }} /></label>{(kind === 'rates' || kind === 'regular') && <Button variant="ghost" size="sm" onClick={() => downloadTemplate(kind)}>CSV見本</Button>}<span className="text-xs font-bold text-slate-400">対応：{format}</span></div><p className="mt-3 text-xs font-bold leading-relaxed text-amber-600">{acceptsExcel ? '「打刻勤怠情報.xlsx」に対応しています。1か月分ずつ取り込み、講座コード・作業コード・実働時間から集団授業、個別授業、事務、サブ、休憩を自動判定します。' : kind === 'rates' ? '原本は「単価」シートを読み取ります。CSVはUTF-8またはShift-JISに対応します。' : kind === 'allowances' ? '割増・紹介礼金の混在列は二重計上防止のため取り込みません。紹介礼金は「個別追加手当」で入力してください。' : '年月、職員コード、手当計、交通費計を自動認識します。'}</p></div>;
}
