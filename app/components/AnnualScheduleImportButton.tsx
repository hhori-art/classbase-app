'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, Link2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';
import { clearCourseRegistrationOptionsCache } from '@/lib/client-course-options';

type ImportType = 'lesson_schedule' | 'curriculum';

type Props = {
  type: ImportType;
  label: string;
  sample: string;
  sampleFilename?: string;
  sampleRows?: (string | number | boolean | null | undefined)[][];
};

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);

  const [headers = [], ...body] = rows;
  return {
    matrix: rows,
    objects: body.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] || '']))),
  };
};

export default function AnnualScheduleImportButton({ type, label, sample, sampleFilename, sampleRows = [] }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [sheetUrl, setSheetUrl] = useState('');

  const importPayload = async (payload: Record<string, unknown>) => {
    setLoading(true);
    setResult('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。マスター管理者でログインし直してください。');
      const res = await fetch('/api/annual-schedule-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, year: Number(year), ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'インポートに失敗しました');
      clearCourseRegistrationOptionsCache();
      setResult(
        `${data.imported || 0}件を上書き取り込みしました` +
        `${data.deleted_annual || data.deleted_related ? `（旧データ削除 ${Number(data.deleted_annual || 0) + Number(data.deleted_related || 0)}件）` : ''}` +
        `${data.skipped ? `（スキップ ${data.skipped}件）` : ''}`
      );
    } catch (error: any) {
      setResult(`失敗: ${error.message || error}`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text.replace(/^\uFEFF/, ''));
      if (parsed.matrix.length === 0) throw new Error('CSVにデータ行がありません');
      await importPayload({ rows: parsed.objects, matrix: parsed.matrix });
    } catch (error: any) {
      setResult(`失敗: ${error.message || error}`);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSheetUrl = async () => {
    if (!sheetUrl.trim()) {
      setResult('失敗: GoogleシートURLを入力してください');
      return;
    }
    await importPayload({ sheet_url: sheetUrl.trim() });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <CsvSampleDownload
          filename={sampleFilename || `${label}例.csv`}
          headers={sample.split(',').map(value => value.trim())}
          rows={sampleRows.length > 0 ? sampleRows : [sample.split(',').map((_, index) => index === 0 ? '2026/4/1' : '')]}
          label="CSV例"
        />
        <input
          value={year}
          onChange={e => setYear(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-teal-100 sm:w-28"
          inputMode="numeric"
        />
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files?.[0])} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          {label}
        </button>
      </div>
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
        <p className="mb-2 text-[11px] font-black text-slate-500">GoogleシートURLから取り込む</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100"
          />
          <button
            type="button"
            onClick={handleSheetUrl}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2 text-xs font-black text-teal-700 hover:bg-teal-50 disabled:opacity-60"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
            URL読込
          </button>
        </div>
        <p className="mt-2 text-[10px] font-bold text-slate-400">同じ年度の旧データは上書きされます。非公開シートは直接取得できません。共有設定を「リンクを知っている全員が閲覧可」にするか、CSVで保存して取り込んでください。</p>
      </div>
      <p className="rounded-xl bg-gray-50 px-3 py-2 font-mono text-[11px] font-bold text-gray-500">{sample}</p>
      {result && (
        <p className={`flex items-center gap-2 text-xs font-bold ${result.startsWith('失敗') ? 'text-rose-600' : 'text-emerald-600'}`}>
          {!result.startsWith('失敗') && <CheckCircle2 size={14} />}
          {result}
        </p>
      )}
    </div>
  );
}
