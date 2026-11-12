import assert from 'node:assert/strict';
import test from 'node:test';
import { maskEmail, normalizeRecoveryGrade, recoveryInfoMatches, schoolMatches } from '../lib/password-recovery-match.ts';

test('学年の表記ゆれをそろえる', () => {
  assert.equal(normalizeRecoveryGrade('中学２年'), '中2');
  assert.equal(normalizeRecoveryGrade('中2'), '中2');
  assert.equal(normalizeRecoveryGrade('高校1年生'), '高1');
  assert.equal(normalizeRecoveryGrade('小学6年'), '小6');
  assert.equal(normalizeRecoveryGrade('中5'), '');
  assert.equal(normalizeRecoveryGrade(''), '');
});

test('校舎は「校」「エディック」などの違いを無視して完全一致で比べる', () => {
  assert.equal(schoolMatches('西明石', ['エディック 西明石校']), true);
  assert.equal(schoolMatches('西明石校', ['西明石']), true);
  assert.equal(schoolMatches('オンライン校', ['創造学園 オンライン校']), true);
  assert.equal(schoolMatches('明石', ['西明石']), false);
  assert.equal(schoolMatches('西', ['西明石']), false);
});

const student = { grade: '中2', school_id: '西明石', phone_number: '090-1234-5678' };

test('生徒：校舎・学年・電話の下4桁がそろって一致したときだけ', () => {
  const ctx = { role: 'student' as const, students: [student], phones: ['5678', '4321'] };
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中2', phoneLast4: '5678' }, ctx), true);
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中2', phoneLast4: '4321' }, ctx), true, '保護者の電話でも可');
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中3', phoneLast4: '5678' }, ctx), false);
  assert.equal(recoveryInfoMatches({ school: '須磨海浜', grade: '中2', phoneLast4: '5678' }, ctx), false);
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中2', phoneLast4: '0000' }, ctx), false);
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中2', phoneLast4: '' }, ctx), false);
});

test('保護者：お子さまのどれかの校舎・学年と、保護者本人の電話', () => {
  const ctx = { role: 'parent' as const, students: [student, { grade: '小6', school_id: 'オンライン校' }], phones: ['4321'] };
  assert.equal(recoveryInfoMatches({ school: 'オンライン校', grade: '小6', phoneLast4: '4321' }, ctx), true);
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '中2', phoneLast4: '5678' }, ctx), false, 'お子さまの電話では不可');
  assert.equal(recoveryInfoMatches({ school: '西明石', grade: '小6', phoneLast4: '4321' }, { ...ctx }), false, '校舎と学年は同じお子さまで一致');
});

test('通知に載せるメールは一部だけ', () => {
  assert.equal(maskEmail('hanako@example.com'), 'ha***@example.com');
});
