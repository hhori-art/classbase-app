'use client';

import { useRef, useState } from 'react';
import { Download, FileUp, Loader2, UploadCloud } from 'lucide-react';
import { auth } from '@/lib/firebase';

type Props = { onImported: () => void };

export default function PfMonoxerImportPanel({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'auto' | 'homework' | 'quiz'>('auto');
  const [encoding, setEncoding] = useState<'utf-8' | 'shift_jis'>('utf-8');
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string>('');

  const downloadTemplate = () => {
    const csv = '\uFEFF生涯番号,氏名,実施日,種別,課題名,ステータス,正答率,校舎\n100001,山田 太郎,2026-08-25,宿題,英語 Unit 1,完了,100,本校\n100001,山田 太郎,2026-08-25,小テスト,確認テスト1,実施済,85,本校\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Monoxer_PF取込テンプレート.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    const currentUser = auth.currentUser;
    if (!file || !currentUser) return;
    setUploading(true);
    setResult('');
    try {
      const csvText = new TextDecoder(encoding).decode(await file.arrayBuffer());
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/pf/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv_text: csvText, file_name: file.name, kind, target_date: targetDate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'CSV取込に失敗しました');
      setResult(`取込 ${data.imported}件 / 未照合 ${data.unmatched}件${data.forbidden_school ? ` / 権限対象外 ${data.forbidden_school}件` : ''}`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported();
    } catch (error) {
      setResult(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-indigo-700"><UploadCloud size={18} /> Monoxer CSV取込</div>
          <p className="mt-1 text-xs font-bold text-slate-500">宿題提出・小テスト実施結果を取り込みます。生涯番号を優先して生徒と照合します。</p>
        </div>
        <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm ring-1 ring-indigo-100 hover:bg-indigo-50">
          <Download size={15} /> テンプレート
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_130px_130px_150px_auto]">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-indigo-400">
          <FileUp size={16} className="text-indigo-500" />
          <span className="truncate">{file?.name || 'CSVファイルを選択'}</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => setFile(event.target.files?.[0] || null)} />
        </label>
        <select value={kind} onChange={event => setKind(event.target.value as typeof kind)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold">
          <option value="auto">種別を自動判定</option><option value="homework">宿題</option><option value="quiz">小テスト</option>
        </select>
        <select value={encoding} onChange={event => setEncoding(event.target.value as typeof encoding)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold">
          <option value="utf-8">UTF-8</option><option value="shift_jis">Shift_JIS</option>
        </select>
        <input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} title="CSVに日付がない場合の実施日" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold" />
        <button type="button" disabled={!file || uploading} onClick={upload} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} 取り込む
        </button>
      </div>
      {result && <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-black ${result.startsWith('エラー') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>{result}</p>}
    </section>
  );
}

