// 管理画面の一覧をCSVで書き出す共通処理。Excel で文字化けしないよう UTF-8（BOM付き）・CRLF にする。

export type CsvValue = string | number | boolean | null | undefined;

/** 1マス分。引用符で囲み、" は "" にする。=,+,-,@ で始まる値は数式として実行されないよう ' を付ける。 */
export function csvCell(value: CsvValue) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** 見出し行と本文の行から、BOM付きのCSV文字列を作る。 */
export function buildCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  return `﻿${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}

/** ブラウザでCSVファイルを保存させる（画面側だけで使う）。 */
export function downloadCsv(fileName: string, headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  const blob = new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
