import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchText, searchStudentEntries, toStudentSearchEntry } from '../lib/server/student-search.ts';

const entries = [
  toStudentSearchEntry('a', { student_name: '山田 太郎', student_name_kana: 'ヤマダ タロウ', lifetime_id: 'S1001', school_id: '112', grade: '中２' }),
  toStudentSearchEntry('b', { name: '山本 花子', furigana: 'やまもと はなこ', lifetime_id: 'S2002', school_id: '999' }),
  toStudentSearchEntry('c', { student_name: '佐藤 次郎', lifetime_id: 'S1001X', school_id: '112', account_status: 'withdrawn' }),
];

test('normalization ignores width, katakana/hiragana, case and spaces', () => {
  assert.equal(normalizeSearchText('ヤマダ　タロウ'), 'やまだたろう');
  assert.equal(normalizeSearchText('ＳＡ１'), 'sa1');
  assert.equal(entries[0].grade, '中2');
});

test('search matches kana and IDs, ranks exact ID first and respects the visibility filter', () => {
  assert.deepEqual(searchStudentEntries(entries, 'やまだ', () => true).map(item => item.id), ['a']);
  assert.deepEqual(searchStudentEntries(entries, 'ヤマ', () => true).map(item => item.id).sort(), ['a', 'b']);
  assert.deepEqual(searchStudentEntries(entries, 's1001', () => true).map(item => item.id), ['a', 'c']);
  assert.deepEqual(searchStudentEntries(entries, 'ヤマ', item => item.school === '112').map(item => item.id), ['a']);
  assert.deepEqual(searchStudentEntries(entries, '   ', () => true), []);
  assert.equal(searchStudentEntries(Array.from({ length: 50 }, (_, index) => toStudentSearchEntry(`s${index}`, { name: `生徒${index}` })), '生徒', () => true, 100).length, 20);
});
