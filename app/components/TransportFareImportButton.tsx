'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { auth } from '@/lib/firebase';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';

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
  return body.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] || ''])));
};

export default function TransportFareImportButton() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [result, setResult] = useState('');

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (replaceAll && !confirm('現在の交通費マスタを全削除してから取り込みます。よろしいですか？')) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setLoading(true);
    setResult('');
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error('CSVにデータ行がありません。');

      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。');

      const res = await fetch('/api/admin/transport-fares/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows, replace_all: replaceAll }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '交通費マスタの取り込みに失敗しました。');

      setResult(`${data.imported || 0}件を登録しました${data.deleted ? `（旧データ削除 ${data.deleted}件）` : ''}${data.skipped ? `（スキップ ${data.skipped}件）` : ''}`);
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
        <CsvSampleDownload
          filename="交通費マスタCSV例.csv"
          headers={['交通機関', '出発', '到着', '金額', '参照元', '備考']}
          rows={[
            ['JR', '三ノ宮', '元町', 140, '手入力マスタ', '例'],
            ['阪急', '神戸三宮', '岡本', 240, '手入力マスタ', '例'],
            ['阪神', '元町', '魚崎', 250, '手入力マスタ', '例'],
            ['山陽電車', '明石', '姫路', 700, '手入力マスタ', '例'],
            ['神戸市営地下鉄', '三宮', '西神南', 410, '手入力マスタ', '例'],
            ['神戸電鉄', '鈴蘭台', '谷上', 280, '手入力マスタ', '例'],
            ['神姫バス', '姫路駅', '姫路市役所前', 220, '手入力マスタ', '例'],
            ['神戸市営バス', '三宮', '元町', 230, '手入力マスタ', '普通区の例'],
          ]}
          label="CSV例"
        />
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files?.[0])} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          運賃マスタCSV取込
        </button>
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
        <input
          type="checkbox"
          checked={replaceAll}
          onChange={e => setReplaceAll(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        既存の交通費マスタを全て削除してから取り込む
      </label>
      <p className="rounded-xl bg-gray-50 px-3 py-2 font-mono text-[11px] font-bold text-gray-500">
        交通機関,出発,到着,金額,参照元,備考
      </p>
      {result && (
        <p className={`flex items-center gap-2 text-xs font-bold ${result.startsWith('失敗') ? 'text-rose-600' : 'text-emerald-600'}`}>
          {!result.startsWith('失敗') && <CheckCircle2 size={14} />}
          {result}
        </p>
      )}
    </div>
  );
}
