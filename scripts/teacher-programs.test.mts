import test from 'node:test';
import assert from 'node:assert/strict';
import { hasScienceSocialProgram, teacherPrograms } from '../lib/teacher-programs.ts';

test('teacher programs expose science/social only when explicitly enabled', () => {
  assert.equal(hasScienceSocialProgram({ role: 'teacher' }), false);
  assert.equal(hasScienceSocialProgram({ role: 'teacher', enabled_programs: [] }), false);
  assert.equal(hasScienceSocialProgram({ role: 'teacher', enabled_programs: ['science_social'] }), true);
  assert.deepEqual(teacherPrograms({ enabled_programs: ['unknown', 'science_social'] }), ['science_social']);
});
