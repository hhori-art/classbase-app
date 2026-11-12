import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonoxerCourseCsv, monoxerCoursePairs, monoxerFieldName, termNumeral } from '../lib/monoxer-course-export.ts';

test('期の表記をローマ数字にそろえる', () => {
  assert.equal(termNumeral('第III期'), 'Ⅲ');
  assert.equal(termNumeral('第Ⅳ期'), 'Ⅳ');
  assert.equal(termNumeral('3期'), 'Ⅲ');
  assert.equal(termNumeral('', 'term3'), 'Ⅲ');
  assert.equal(termNumeral('', 'term_custom_1'), '');
});

test('分野名はシートと同じきまりで作る', () => {
  const t = { term_label: '第III期' };
  assert.equal(monoxerFieldName({ ...t, day: '木', grade: '中1', subject: '理科', course: '化学' }), '中1化学Ⅲ');
  assert.equal(monoxerFieldName({ ...t, day: '土', grade: '中1', subject: '社会', course: '地理B' }), '地理BⅢ');
  assert.equal(monoxerFieldName({ ...t, day: '金', grade: '中2', subject: '社会', course: '通常歴史C' }), '歴史CⅢ');
  assert.equal(monoxerFieldName({ day: '月', grade: '中3', subject: '社会', course: '公民①', term_label: '第IV期' }), '中3公民①Ⅳ');
  assert.equal(monoxerFieldName({ day: '月', grade: '中3', subject: '理科', course: '物理', term_label: '第IV期' }), '中3物理Ⅳ');
  assert.equal(monoxerFieldName({ ...t, day: '水', grade: '中1', subject: '理科', course: '【対策】中1地学' }), '中1地学Ⅲ');
});

test('前の期のままの登録は今の期、次の期を先に登録していればその期', () => {
  assert.equal(monoxerFieldName({ day: '水', grade: '中2', subject: '理科', course: '化学', term_label: '第II期', current_term_label: '第III期' }), '中2化学Ⅲ');
  assert.equal(monoxerFieldName({ day: '月', grade: '中3', subject: '社会', course: '公民', term_label: '第Ⅳ期', current_term_label: '第III期' }), '中3公民Ⅳ');
});

test('中3公民は時限と校舎で①〜④を付ける（シートの割り振りと同じ）', () => {
  const civics = (slot: string, school: string) => monoxerFieldName({ day: '月', slot, grade: '中3', subject: '社会', course: '公民', term_label: '第Ⅳ期' }, school);
  assert.equal(civics('2限', '名谷本部校'), '中3公民①Ⅳ');
  assert.equal(civics('2限', 'エディック 明石本部校'), '中3公民②Ⅳ');
  assert.equal(civics('1限', '創造学園 本山本部校'), '中3公民③Ⅳ');
  assert.equal(civics('1限', '須磨海浜校'), '中3公民④Ⅳ');
  assert.equal(civics('1限', '霞ケ丘校'), '中3公民④Ⅳ');
  assert.equal(civics('', '名谷本部校'), '中3公民Ⅳ');
  assert.equal(monoxerFieldName({ day: '月', slot: '2限', grade: '中3', subject: '理科', course: '物理', term_label: '第Ⅳ期' }, '明石本部校'), '中3物理Ⅳ');
  const csv = buildMonoxerCourseCsv([{ lifetime_id: '1', student_name: 'テスト', school_id: '西明石校', grade: '中3', selected_course_slots: [
    { day: '月', slot: '1限', grade: '中3', subject: '社会', course: '公民', term_label: '第Ⅳ期' },
    { day: '月', slot: '2限', grade: '中3', subject: '理科', course: '物理', term_label: '第Ⅳ期' },
  ] }], '西明石校');
  assert.match(csv, /"月曜","中3公民④Ⅳ","月曜","中3物理Ⅳ"/);
});

test('曜日→時限の順に並べ、同じ組は1つにする', () => {
  const pairs = monoxerCoursePairs([
    { day: '土', slot: '2限', grade: '中1', subject: '理科', course: '物理', term_label: '第III期' },
    { day: '木曜', slot: '1限', grade: '中1', subject: '理科', course: '化学', term_label: '第III期' },
    { day: '木', slot: '2限', grade: '中1', subject: '社会', course: '地理A', term_label: '第III期' },
    { day: '木', slot: '1限', grade: '中1', subject: '理科', course: '化学', term_label: '第III期' },
  ]);
  assert.deepEqual(pairs, [
    { day: '木曜', field: '中1化学Ⅲ' },
    { day: '木曜', field: '地理AⅢ' },
    { day: '土曜', field: '中1物理Ⅲ' },
  ]);
});

test('CSVは理社_曜日①〜④・理社_科目①〜④の列を必ず持つ', () => {
  const csv = buildMonoxerCourseCsv([
    { lifetime_id: '20003111', student_name: '山田　彩華', school_id: '本山本部校', grade: '中1', selected_course_slots: [
      { day: '水', slot: '1限', grade: '中1', subject: '理科', course: '化学', term_label: '第III期' },
      { day: '水', slot: '2限', grade: '中1', subject: '社会', course: '地理A', term_label: '第III期' },
    ] },
    { lifetime_id: '20005871', student_name: '未登録の生徒', grade: '中1' },
  ], '本山本部校');
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines[0], '"生徒番号","表示名","校舎","学年","理社_曜日①","理社_科目①","理社_曜日②","理社_科目②","理社_曜日③","理社_科目③","理社_曜日④","理社_科目④"');
  assert.equal(lines[1], '"20003111","山田　彩華","本山本部校","中1","水曜","中1化学Ⅲ","水曜","地理AⅢ","","","",""');
  assert.equal(lines[2], '"20005871","未登録の生徒","本山本部校","中1","","","","","","","",""');
});
