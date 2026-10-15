import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountCsv, uniqueImportFileName } from '../lib/account-import-csv.ts';

test('BOM、引用符付きカンマ、改行を含むCSVを解析する', () => {
  const parsed = parseAccountCsv('\uFEFF氏名,ID,備考\r\n"山田, 太郎",1001,"1行目\n2行目"');
  assert.deepEqual(parsed.headers, ['氏名', 'ID', '備考']);
  assert.deepEqual(parsed.rows, [['山田, 太郎', '1001', '1行目\n2行目']]);
});

test('不正な引用符を拒否する', () => {
  assert.throws(() => parseAccountCsv('氏名,ID\n"山田,1001'), /引用符/);
});

test('同姓同名のPDFファイル名を重複させない', () => {
  const used = new Set<string>();
  assert.equal(uniqueImportFileName('山田/太郎', 0, used), '山田_太郎_アカウント案内.pdf');
  assert.equal(uniqueImportFileName('山田/太郎', 1, used), '山田_太郎_2_アカウント案内.pdf');
});

test('同姓同名100件でも全PDFファイル名を一意にする', () => {
  const used = new Set<string>();
  const names = Array.from({ length: 100 }, (_, index) => uniqueImportFileName('監査/同姓同名', index, used));
  assert.equal(new Set(names).size, 100);
  assert.equal(names[0], '監査_同姓同名_アカウント案内.pdf');
  assert.equal(names[99], '監査_同姓同名_100_アカウント案内.pdf');
});
