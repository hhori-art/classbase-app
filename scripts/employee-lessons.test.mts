import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeLessonMinutes, validateEmployeeLesson } from '../lib/employee-lessons.ts';

test('employee lesson minutes are calculated from start and end', () => {
  assert.equal(employeeLessonMinutes('13:00', '14:30'), 90);
  assert.equal(employeeLessonMinutes('23:30', '00:30'), 60);
  assert.equal(employeeLessonMinutes('13:00', '13:00'), null);
  assert.equal(employeeLessonMinutes('bad', '14:30'), null);
});

test('employee lesson requires school, employee and valid time', () => {
  assert.deepEqual(validateEmployeeLesson({
    school_name: '元町校', lesson_date: '2026-08-19', employee_name: '山田 太郎',
    start_time: '13:00', end_time: '14:30',
  }), []);
  assert.equal(validateEmployeeLesson({
    school_name: '', lesson_date: '', employee_name: '', start_time: '', end_time: '',
  }).length, 4);
});
