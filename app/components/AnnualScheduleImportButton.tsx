'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { auth } from '@/lib/firebase';

type ImportType = 'lesson_schedule' | 'curriculum';

type Props = {
  type: ImportType;
  label: string;
  sample: string;
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

export default function AnnualScheduleImportButton({ type, label, sample }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    setResult('');
    try {
      const text = await file.text();
      const parsed = parseCsv(text.replace(/^\uFEFF/, ''));
      if (parsed.matrix.length === 0) throw new Error('CSVにデータ行がありません');
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。マスター管理者でログインし直してください。');
      const res = await fetch('/api/annual-schedule-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, year: Number(year), rows: parsed.objects, matrix: parsed.matrix }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'インポートに失敗しました');
      setResult(`${data.imported || 0}件を取り込みました${data.skipped ? `（スキップ ${data.skipped}件）` : ''}`);
    } catch (error: any) {
      setResult(`失敗: ${error.message || error}`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
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
