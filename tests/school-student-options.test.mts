import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_SCHOOLS_VALUE, isSameSchool, masterSchoolOptions, schoolOptionLabel } from '../lib/school-student-options.ts';
import { ATTENDANCE_SCHOOL_DIRECTORY } from '../lib/attendance-schools.ts';

test('マスターは生徒がいない校舎も含め、集団の校舎をすべて選べる', () => {
  const options = masterSchoolOptions(['112', '147']);
  const groupCodes = ATTENDANCE_SCHOOL_DIRECTORY.filter(school => school.group === '集団').map(school => school.code);
  assert.equal(options.length, groupCodes.length);
  for (const code of groupCodes) assert.ok(options.includes(code), code);
});

test('校舎名で入っている生徒がいれば、その値を使い同じ校舎を2つ出さない', () => {
  const options = masterSchoolOptions(['エディック 北神本部校', '112']);
  assert.ok(options.includes('エディック 北神本部校'));
  assert.ok(!options.includes('119'));
  assert.equal(options.filter(option => isSameSchool(option, '119')).length, 1);
});

test('集団以外・一覧にない校舎の生徒も選択肢に残す', () => {
  const options = masterSchoolOptions(['212', '謎の校舎']);
  assert.ok(options.includes('212'));
  assert.ok(options.includes('謎の校舎'));
});

test('番号と校舎名のどちらで入っていても同じ校舎とみなす', () => {
  assert.equal(isSameSchool('エディック 北神本部校', '119'), true);
  assert.equal(isSameSchool('119', '119'), true);
  assert.equal(isSameSchool('112', '119'), false);
  assert.equal(schoolOptionLabel('112'), '112 創造学園 オンライン校');
});

test('全校舎の選択肢は名前で表示する', () => {
  assert.equal(schoolOptionLabel(ALL_SCHOOLS_VALUE), '全校舎（すべての生徒）');
  assert.equal(isSameSchool('112', ALL_SCHOOLS_VALUE), false);
});
