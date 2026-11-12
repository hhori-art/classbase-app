import assert from 'node:assert/strict';
import test from 'node:test';
import { stripCourseUnitName, summarizeSelectedCourseLabels } from '../lib/course-registration-selection.ts';

test('受講講座の名前から単元名（植物の分類など）を外す', () => {
  assert.deepEqual(
    summarizeSelectedCourseLabels(['中1 理科 植物の分類 / 木曜 2限 / 植物の分類', '中3 社会 公民① / 木曜 2限', '中2 社会 地理B / 火曜 1限', '中2 理科 化学 / 木曜 1限']),
    ['中1 理科 / 木曜 2限', '中3 社会 公民① / 木曜 2限', '中2 社会 地理B / 火曜 1限', '中2 理科 化学 / 木曜 1限'],
  );
});

test('外すと何も残らない名前はそのまま', () => {
  assert.equal(stripCourseUnitName('特別講座'), '特別講座');
  assert.equal(stripCourseUnitName('中１ 理科 光の性質'), '中１ 理科');
});
