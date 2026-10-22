import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReplyTemplate, normalizeReplyTemplateInput } from '../lib/reply-templates';
import { buildCsv, csvCell } from '../lib/csv-export';
import { compareSortValues, sortRows } from '../lib/table-sort';

test('返信のひな形：{保護者名}{生徒名} をすべて差し込む', () => {
  assert.equal(
    applyReplyTemplate('{保護者名}様\n{生徒名}さんの件、{生徒名}さんに伝えます。', { parentName: ' 山田花子 ', studentName: '山田太郎' }),
    '山田花子様\n山田太郎さんの件、山田太郎さんに伝えます。',
  );
});

test('返信のひな形：名前が無いときは既定の呼び方にする', () => {
  assert.equal(applyReplyTemplate('{保護者名}様 {生徒名}', { parentName: '', studentName: null }), '保護者様 お子さま');
  assert.equal(applyReplyTemplate('置き換えなし', {}), '置き換えなし');
});

test('返信のひな形：入力チェック', () => {
  assert.deepEqual(normalizeReplyTemplateInput({ title: ' お礼 ', body: 'a\r\nb ' }), { ok: true, title: 'お礼', body: 'a\nb' });
  assert.equal(normalizeReplyTemplateInput({ title: '', body: 'x' }).ok, false);
  assert.equal(normalizeReplyTemplateInput({ title: 'x', body: '   ' }).ok, false);
  assert.equal(normalizeReplyTemplateInput({ title: 'x'.repeat(61), body: 'x' }).ok, false);
  assert.equal(normalizeReplyTemplateInput({ title: 'x', body: 'x'.repeat(5001) }).ok, false);
  assert.equal(normalizeReplyTemplateInput(null).ok, false);
});

test('CSV：BOM付き・CRLF、引用符・カンマ・改行をエスケープする', () => {
  const csv = buildCsv(['氏名', 'メモ'], [['山田 "太郎"', 'a,b'], ['改行\nあり', null]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv, '﻿"氏名","メモ"\r\n"山田 ""太郎""","a,b"\r\n"改行\nあり",""');
});

test('CSV：数式として実行されそうな値は先頭に \' を付ける', () => {
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(csvCell('@cmd'), `"'@cmd"`);
  assert.equal(csvCell(12), '"12"');
});

test('並べ替え：日本語・数・日付、空の値は常に最後、同じ値は元の順', () => {
  assert.deepEqual(sortRows(['い', '', 'あ', null, 'う'], value => value, 'asc'), ['あ', 'い', 'う', '', null]);
  assert.deepEqual(sortRows(['い', '', 'あ', 'う'], value => value, 'desc'), ['う', 'い', 'あ', '']);
  assert.deepEqual(sortRows(['10', '9', '100'], value => value, 'asc'), ['9', '10', '100']);
  assert.deepEqual(sortRows([3, 1, 2], value => value, 'desc'), [3, 2, 1]);
  const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 0 }, { id: 'c', v: 1 }];
  assert.deepEqual(sortRows(rows, row => row.v, 'asc').map(row => row.id), ['b', 'a', 'c']);
  assert.ok(compareSortValues(new Date('2026-01-01'), new Date('2026-02-01')) < 0);
  assert.equal(compareSortValues(null, undefined), 0);
});
