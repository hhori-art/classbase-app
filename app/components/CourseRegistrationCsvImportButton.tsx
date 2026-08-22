'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2, Search } from 'lucide-react';
import { auth } from '@/lib/firebase';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';

const sampleHeaders = [
  'id',
  '更新フラグ',
  'isFirst',
  '無効',
  'パスワード',
  'name',
  'grade',
  '月',
  '火',
  '水',
  '木',
  '金',
  '土',
  'currentDay',
  '教室ＣＤ',
  '教室',
  '次期月',
  '次期火',
  '次期水',
  '次期木',
  '次期金',
  '次期土',
  'nextDay',
  '2p月',
  '2p火',
  '2p水',
  '2p木',
  '2p金',
  '2p土',
  'period2Day',
];

const sampleRows = [
  [
    '12100001',
    'FALSE',
    '',
    'FALSE',
    '',
    '山田 太郎',
    '中3',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '111',
    '元町',
    '1限:中3生物Ⅱ, 2限:中3公民②Ⅱ',
    '',
    '',
    '1限:中3公民④Ⅱ',
    '',
    '',
    '月, 木',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
];

type ImportResult = {
  ok?: boolean;
  imported?: number;
  cleared?: number;
  matched?: number;
  rows?: number;
  status_counts?: Record<string, number>;
  results?: any[];
  error?: string;
};

export default function CourseRegistrationCsvImportButton() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [encoding, setEncoding] = useState<'utf-8' | 'shift-jis'>('utf-8');
  const [year, setYear] = useState('2026');
  const [term, setTerm] = useState('term2');
  const [result, setResult] = useState<ImportResult | null>(null);

  const importCsv = async (file: File, dryRun = false) => {
    setLoading(true);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const csvText = new TextDecoder(encoding).decode(buffer);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');

      const res = await fetch('/api/admin/course-registrations/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          csv_text: csvText,
          year: Number(year),
          term,
          dry_run: dryRun,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'CSV取り込みに失敗しました');
      setResult(data);
    } catch (error: any) {
      setResult({ ok: false, error: error.message || String(error) });
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleFile = (file?: File | null, dryRun = false) => {
    if (!file) return;
    if (!dryRun && !window.confirm('CSVの内容で現在の受講講座登録を上書きします。CSVで講座欄が空の生徒は受講講座登録がクリアされます。実行しますか？')) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    importCsv(file, dryRun);
  };

  const statusCounts = result?.status_counts || {};
  const problemCount = Number(statusCounts.student_not_found || 0) + Number(statusCounts.no_course_matched || 0) + Number(statusCounts.partial || 0);

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={event => handleFile(event.target.files?.[0], false)}
        disabled={loading}
      />

      <div className="grid gap-2 sm:grid-cols-[1fr_130px_150px]">
        <select
          value={encoding}
          onChange={event => setEncoding(event.target.value as 'utf-8' | 'shift-jis')}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
          disabled={loading}
        >
          <option value="utf-8">UTF-8</option>
          <option value="shift-jis">Shift_JIS</option>
        </select>
        <input
          value={year}
          onChange={event => setYear(event.target.value)}
          inputMode="numeric"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
          disabled={loading}
        />
        <select
          value={term}
          onChange={event => setTerm(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100"
          disabled={loading}
        >
          <option value="term1">第1期</option>
          <option value="term2">第2期</option>
          <option value="term3">第3期</option>
          <option value="term_custom_1777362292242">第4期</option>
        </select>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <CsvSampleDownload
          filename="受講講座登録CSV例_MemberMaster形式.csv"
          headers={sampleHeaders}
          rows={sampleRows}
          label="CSV例"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
          CSVを選択して上書き
        </button>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-[11px] font-bold text-slate-500">
        <p>読み取り対象: id（先頭見出しが空欄のMemberMaster形式も対応）, name, grade, 次期月〜次期土（空の場合は月〜土、2p月〜2p土）</p>
        <p>例: 「1限:中3生物Ⅱ, 2限:中3公民②Ⅱ」を、指定した年度・期の講師配置由来の講座候補に照合します。</p>
        <p className="mt-1 font-black text-indigo-700">上書き仕様: CSVに載っている生徒は現在の受講講座登録をCSV内容に置き換えます。講座欄が空の行は登録をクリアします。</p>
      </div>

      {result && (
        <div className={`rounded-2xl border p-3 text-xs font-bold ${
          result.ok === false ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>
          {result.ok === false ? (
            <p>{result.error || '取り込みに失敗しました'}</p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-black">
                <CheckCircle2 size={16} />
                {result.imported || 0}件をCSV内容で上書きしました
              </p>
              <p>
                CSV行: {result.rows || 0} / 講座登録: {result.matched || 0} / クリア: {result.cleared || 0}
                {problemCount > 0 ? ` / 確認必要: ${problemCount}` : ''}
              </p>
              {problemCount > 0 && (
                <details className="rounded-xl bg-white/70 p-2 text-slate-600">
                  <summary className="flex cursor-pointer items-center gap-1 font-black text-amber-700">
                    <Search size={14} />
                    確認が必要な先頭データ
                  </summary>
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto font-mono text-[10px]">
                    {(result.results || [])
                      .filter(item => item.status !== 'matched')
                      .slice(0, 30)
                      .map((item, index) => (
                        <p key={`${item.id}-${index}`}>
                          {item.row}行目 / {item.id} / {item.status}
                          {item.unmatched?.length ? ` / 未照合: ${item.unmatched.join(' | ')}` : ''}
                        </p>
                      ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
