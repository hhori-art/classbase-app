import assert from 'node:assert/strict';
import test from 'node:test';
import { anonymousParentName, anonymousStudentName, isNoPersonalInfoSchool, isNumberOnlyName } from '../lib/no-personal-info-schools.ts';

const during = new Date('2026-11-30T14:59:00Z'); // 11/30 23:59 JST
const after = new Date('2026-11-30T15:00:00Z'); // 12/1 0:00 JST

test('test schools use student numbers instead of names', () => {
  assert.equal(isNoPersonalInfoSchool('147', during), true);
  assert.equal(isNoPersonalInfoSchool('147', after), false);
  assert.equal(isNoPersonalInfoSchool('エディック 須磨海浜校', during), true);
  assert.equal(isNoPersonalInfoSchool('132', during), true);
  assert.equal(isNoPersonalInfoSchool('112', during), true);
  assert.equal(isNoPersonalInfoSchool('142'), false);
  assert.equal(isNoPersonalInfoSchool(''), false);
  assert.equal(anonymousStudentName('12098761'), '12098761');
  assert.equal(anonymousParentName('12098761P'), '12098761 保護者');
  assert.equal(anonymousParentName('12098761'), '12098761 保護者');
});

test('the security notice shows only for number names', () => {
  assert.equal(isNumberOnlyName('12098761', during), true);
  assert.equal(isNumberOnlyName('12098761', after), false);
  assert.equal(isNumberOnlyName('12098761 保護者', during), true);
  assert.equal(isNumberOnlyName('T1001', during), true);
  assert.equal(isNumberOnlyName('山田 太郎'), false);
  assert.equal(isNumberOnlyName('テスト2'), false);
  assert.equal(isNumberOnlyName(''), false);
});
