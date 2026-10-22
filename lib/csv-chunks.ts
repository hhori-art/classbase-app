// 生徒CSVを、サーバーの実行時間（60秒）に収まる人数ずつに分ける。
// 各チャンクには見出し行（とその前の行）を付け、兄弟姉妹グループの行は同じチャンクにまとめる
// （兄弟姉妹の紐づけは1回の取込の中で行うため）。

/** CSV を行単位の生テキストに分ける（ダブルクォート内の改行は行の区切りにしない）。 */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') inQuotes = !inQuotes;
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      records.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  records.push(current);
  return records.filter(record => record.replace(/[,\s"]/g, '') !== '');
}

const splitCells = (record: string) => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < record.length; index++) {
    const char = record[index];
    if (char === '"' && inQuotes && record[index + 1] === '"') { current += '"'; index++; }
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
};

const isHeaderRecord = (record: string) =>
  splitCells(record).some(cell => cell.includes('生涯番号') || cell.includes('ログインID') || cell === 'ID');

export type StudentCsvChunk = {
  text: string;
  /** このチャンクの1件目が、元のCSVで何行目の直前か（エラー行番号の補正用）。 */
  rowOffset: number;
  rowCount: number;
};

export function chunkStudentCsv(source: string, size = 20): { chunks: StudentCsvChunk[]; total: number } {
  const text = source.replace(/^﻿/, '');
  const records = splitCsvRecords(text);
  const headerIndex = records.findIndex((record, index) => index < 25 && isHeaderRecord(record));
  // 見出しが見つからない場合はそのまま送り、サーバーのエラー（読み取った1行目の表示）に任せる。
  if (headerIndex === -1) return { chunks: [{ text, rowOffset: 0, rowCount: 0 }], total: 0 };

  const prelude = records.slice(0, headerIndex + 1);
  const header = splitCells(records[headerIndex]);
  const siblingColumn = header.findIndex(cell => ['兄弟姉妹グループ', '兄弟グループ', '兄弟姉妹ID'].some(name => cell.includes(name)));

  // 兄弟姉妹グループごとにまとめる（グループ無しの行は1行で1グループ）。順番は最初に出た行の位置。
  const groups: { originalIndex: number; record: string }[][] = [];
  const groupByKey = new Map<string, { originalIndex: number; record: string }[]>();
  records.slice(headerIndex + 1).forEach((record, offset) => {
    const entry = { originalIndex: headerIndex + 1 + offset, record };
    const key = siblingColumn >= 0 ? splitCells(record)[siblingColumn] || '' : '';
    if (key) {
      const existing = groupByKey.get(key);
      if (existing) { existing.push(entry); return; }
      const group = [entry];
      groupByKey.set(key, group);
      groups.push(group);
      return;
    }
    groups.push([entry]);
  });

  const chunks: StudentCsvChunk[] = [];
  let pending: { originalIndex: number; record: string }[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    // サーバーは見出しを含めた行番号で報告するので、元の行番号との差分を渡す。
    const firstOriginal = Math.min(...pending.map(entry => entry.originalIndex));
    chunks.push({
      text: [...prelude, ...pending.map(entry => entry.record)].join('\n'),
      rowOffset: Math.max(0, firstOriginal - prelude.length),
      rowCount: pending.length,
    });
    pending = [];
  };
  groups.forEach(group => {
    if (pending.length > 0 && pending.length + group.length > size) flush();
    pending.push(...group);
  });
  flush();
  const total = chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0);
  return { chunks, total };
}
