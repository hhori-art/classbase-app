export type CsvEncoding = 'auto' | 'Shift_JIS' | 'UTF-8';

/**
 * CSV ファイルを文字列にする。auto は UTF-8 として正しく読めればそのまま、
 * 読めなければ Excel で保存した Shift_JIS とみなす（Googleスプレッドシート・Mac は UTF-8）。
 */
export async function readCsvFileText(file: File, encoding: CsvEncoding = 'auto') {
  const buffer = await file.arrayBuffer();
  const decode = (label: string, fatal = false) => new TextDecoder(label, { fatal }).decode(buffer);
  let text: string;
  if (encoding === 'UTF-8') text = decode('utf-8');
  else if (encoding === 'Shift_JIS') text = decode('shift_jis');
  else {
    try {
      text = decode('utf-8', true);
    } catch {
      text = decode('shift_jis');
    }
  }
  return text.replace(/^﻿/, '');
}
