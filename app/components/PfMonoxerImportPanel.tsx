'use client';

import { useRef, useState } from 'react';
import { Download, FileUp, UploadCloud } from 'lucide-react';
import { Button } from '@/app/components/ui';
import { auth } from '@/lib/firebase';
import { readCsvFileText, type CsvEncoding } from '@/lib/csv-file-text';
import { jstTodayKey } from '@/lib/lesson-deadline';

type Props = { onImported: () => void };

export default function PfMonoxerImportPanel({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'auto' | 'homework' | 'quiz'>('auto');
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [targetDate, setTargetDate] = useState(() => jstTodayKey());
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);

  const downloadTemplate = () => {
    // Monoxer の「宿題回数ログ」と同じ列。出力したファイルはそのまま取り込める。
    const csv = '\uFEFFスクールID,スクール名,クラスID,クラス名,生徒番号,表示名,Book ID,Book名,学習回数\n74503,【26年度】理社講座,1358655,中1,12345678,山田 太郎,1674964,理科1年　02　花のつくりとはたらき,4\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Monoxer_宿題回数ログ_見本.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    const currentUser = auth.currentUser;
    if (!file || !currentUser) return;
    setUploading(true);
    setResult('');
    setWarnings([]);
    try {
      const csvText = await readCsvFileText(file, encoding);
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/pf/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv_text: csvText, file_name: file.name, kind, target_date: targetDate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'CSV取込に失敗しました');
      setResult(data.mode === 'study_counts'
        ? `宿題回数ログ（${data.snapshot_date}時点）：CSVの生徒 ${data.csv_students}名のうち ${data.imported}名を更新 / アプリ未登録 ${data.unmatched}名${data.duplicated ? ` / 生涯番号の重複 ${data.duplicated}名` : ''}${data.forbidden_school ? ` / 担当外の校舎 ${data.forbidden_school}名` : ''}`
        : `取込 ${data.imported}件 / 未照合 ${data.unmatched}件${data.forbidden_school ? ` / 権限対象外 ${data.forbidden_school}件` : ''}`);
      setWarnings(Array.isArray(data.warnings) ? data.warnings.map(String) : []);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported();
    } catch (error) {
      console.error(error);
      setResult(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-card border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-accent"><UploadCloud size={18} aria-hidden /> Monoxer CSV取込</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">Monoxer の「宿題回数ログ」をそのまま取り込めます。生徒番号（生涯番号）で照合し、前回取り込んだ累計との差を、その期間の宿題の回数として数えます。</p>
          <p className="mt-1 text-xs font-bold text-slate-400">日付は「CSVを出力した日」を選んでください。週に1回など、定期的に取り込むと週ごとの回数が出ます。</p>
        </div>
        <Button variant="secondary" size="sm" onClick={downloadTemplate} icon={<Download size={15} aria-hidden />}>
          テンプレート
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_130px_130px_150px_auto]">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-input border border-dashed border-line bg-white px-3 text-xs font-bold text-slate-600 hover:border-accent">
          <FileUp size={16} className="text-accent" aria-hidden />
          <span className="truncate">{file?.name || 'CSVファイルを選択'}</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => setFile(event.target.files?.[0] || null)} />
        </label>
        <select value={kind} onChange={event => setKind(event.target.value as typeof kind)} aria-label="種別" className="min-h-11 rounded-input border border-line bg-white px-3 py-2 text-xs font-bold">
          <option value="auto">種別：自動（回数ログは不要）</option><option value="homework">宿題</option><option value="quiz">小テスト</option>
        </select>
        <select value={encoding} onChange={event => setEncoding(event.target.value as typeof encoding)} aria-label="文字コード" className="min-h-11 rounded-input border border-line bg-white px-3 py-2 text-xs font-bold">
          <option value="auto">文字コード自動</option><option value="UTF-8">UTF-8</option><option value="Shift_JIS">Shift_JIS</option>
        </select>
        <label className="flex flex-col text-xs font-bold text-slate-400">CSVを出力した日
          <input type="date" value={targetDate} max={jstTodayKey()} onChange={event => setTargetDate(event.target.value)} className="min-h-10 rounded-input border border-line bg-white px-3 py-2 text-xs font-bold text-slate-700" />
        </label>
        <Button disabled={!file} loading={uploading} onClick={upload} icon={<FileUp size={16} aria-hidden />}>
          取り込む
        </Button>
      </div>
      {result && <p role="status" className={`mt-3 rounded-btn px-3 py-2 text-xs font-bold ${result.startsWith('エラー') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>{result}</p>}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-btn bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {warnings.map(warning => <li key={warning}>・{warning}</li>)}
        </ul>
      )}
    </section>
  );
}

