import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDisplayShiftAssignments } from '../lib/shift-assignment-display.ts';

test('同期配置を優先して旧取込の同一講座を二重表示しない', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'legacy', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民③', teacher_name: '亀田', note: '【1限】' },
    { id: 'sheet', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民③', teacher_name: '亀田', note: '【2限】', source_spreadsheet_id: 'sheet-id' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'sheet');
  assert.equal((result[0] as any).period, 1);
  assert.match(result[0].note, /^【1限】/);
});

test('旧メインに紐づく手動補助は同期メインへ付け替えて残す', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'legacy', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民④', note: '【1限】' },
    { id: 'sheet', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民④', note: '【2限】', source_spreadsheet_id: 'sheet-id' },
    { id: 'manual-sub', parent_id: 'legacy', target_date: '2026-09-11', role_type: 'sub', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民④', teacher_name: '【遠】中村', user_id: 'teacher-1', note: '【1限】' },
  ]);
  assert.equal(result.find(item => item.id === 'manual-sub')?.parent_id, 'sheet');
});

test('同期表で教室番号を全体サポートと誤認した行を表示しない', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'room', target_date: '2026-09-11', role_type: 'general', teacher_name: '202A 最難関', user_id: '', note: '【1限】' },
    { id: 'teacher', target_date: '2026-09-11', role_type: 'general', teacher_name: '小西', user_id: 'teacher-1', note: '【2限】' },
  ]);
  assert.deepEqual(result.map(item => item.id), ['teacher']);
});

test('講師欄の「公民③へ」は統合先の担当講師として表示する', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'destination', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民③', teacher_name: '亀田', user_id: 'teacher-1', note: '【1限】' },
    { id: 'redirect', target_date: '2026-09-11', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民④', teacher_name: '公民③へ', user_id: '', note: '【1限】' },
  ]);
  const redirected = result.find(item => item.id === 'redirect');
  assert.equal(redirected?.teacher_name, '亀田');
  assert.equal(redirected?.user_id, 'teacher-1');
});

test('本日の中1社会がGASで2限にも複製されても正規の1限の1件にまとめる', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'wrong-period', target_date: '2026-09-11', role_type: 'main', target_grade: '中1', target_subject: '社会', target_detail_subject: '地理B', teacher_name: '五郎丸', note: '【1限】' },
    { id: 'correct-period', target_date: '2026-09-11', role_type: 'main', target_grade: '中1', target_subject: '社会', target_detail_subject: '地理B', teacher_name: '五郎丸', note: '【2限】' },
    { id: 'wrong-sub', parent_id: 'wrong-period', target_date: '2026-09-11', role_type: 'sub', target_grade: '中1', target_subject: '社会', target_detail_subject: '地理B', teacher_name: '藤原', user_id: 'teacher-1', note: '【1限】' },
    { id: 'correct-sub', parent_id: 'correct-period', target_date: '2026-09-11', role_type: 'sub', target_grade: '中1', target_subject: '社会', target_detail_subject: '地理B', teacher_name: '藤原', user_id: 'teacher-1', note: '【2限】' },
  ]);
  assert.equal(result.filter(item => item.role_type === 'main').length, 1);
  assert.equal(result.filter(item => item.role_type === 'sub').length, 1);
  assert.ok(result.every(item => (item as any).period === 1 && item.note.startsWith('【1限】')));
});

test('本日の同一授業に旧・新の補助講師が混在したらGAS同期側を優先する', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'old', target_date: '2026-09-11', role_type: 'sub', target_grade: '中2', target_subject: '社会', target_detail_subject: '歴史C', teacher_name: '中尾', user_id: 'old-user', note: '【2限】' },
    { id: 'new', target_date: '2026-09-11', role_type: 'sub', target_grade: '中2', target_subject: '社会', target_detail_subject: '歴史C', teacher_name: '中村', user_id: 'new-user', note: '【2限】', source_spreadsheet_id: 'sheet-id' },
  ]);
  assert.deepEqual(result.map(item => item.id), ['new']);
});

test('対策表記が違っても同じ会議IDの旧配置を除きGAS配置だけを表示する', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'legacy-main', target_date: '2026-09-25', role_type: 'main', target_grade: '中3', target_subject: '理科', target_detail_subject: '対策物理', teacher_name: '持丸', target_meeting_id: '452 101 3411', note: '【1限】' },
    { id: 'sheet-main', target_date: '2026-09-25', role_type: 'main', target_grade: '中3', target_subject: '理科', target_detail_subject: '【対策】物理', teacher_name: '持丸', target_meeting_id: '452 101 3411', period: 1, source_spreadsheet_id: 'sheet-id' },
    { id: 'legacy-sub', target_date: '2026-09-25', role_type: 'sub', target_grade: '中3', target_subject: '理科', target_detail_subject: '対策物理', teacher_name: '三宅', user_id: 'teacher-1', note: '【1限】' },
    { id: 'sheet-sub', target_date: '2026-09-25', role_type: 'sub', target_grade: '中3', target_subject: '理科', target_detail_subject: '【対策】物理', teacher_name: '三宅', user_id: 'teacher-1', period: 1, source_spreadsheet_id: 'sheet-id' },
  ]);
  assert.deepEqual(result.map(item => item.id).sort(), ['sheet-main', 'sheet-sub']);
});

test('同じ会議IDでも時限が違う正規配置は両方表示する', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'period-1', target_date: '2026-09-25', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民', teacher_name: '亀田', target_meeting_id: '883 036 1170', period: 1, source_spreadsheet_id: 'sheet-id' },
    { id: 'period-2', target_date: '2026-09-25', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民', teacher_name: '亀田', target_meeting_id: '883 036 1170', period: 2, source_spreadsheet_id: 'sheet-id' },
  ]);
  assert.deepEqual(result.map(item => item.id), ['period-1', 'period-2']);
});

test('同期元の明示時限は通常カリキュラムの固定時限より優先する', () => {
  const result = selectDisplayShiftAssignments([
    { id: 'civics-p1', sync_source: 'google_sheet', target_date: '2026-09-25', period: 1, note: '【1限】', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民(2)', target_meeting_id: '6484520907', teacher_name: '山田', user_id: 'teacher-yamada' },
    { id: 'civics-p2', sync_source: 'google_sheet', target_date: '2026-09-25', period: 2, note: '【2限】', role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民(2)', target_meeting_id: '6484520907', teacher_name: '山田', user_id: 'teacher-yamada' },
  ]);
  assert.deepEqual(result.map(shift => [shift.id, shift.period]), [['civics-p1', 1], ['civics-p2', 2]]);
});
