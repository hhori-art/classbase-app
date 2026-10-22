import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAttendanceSegmentCoverage, type AttendanceWorkSegment } from '../lib/attendance-work-detail.ts';

const segment = (start: string, end: string, type = 'office'): AttendanceWorkSegment => ({ start, end, type });

test('打刻の5分丸め範囲を連続して覆う明細を許可する', () => {
  assert.equal(validateAttendanceSegmentCoverage([
    segment('16:45', '16:50'), segment('16:50', '18:00', 'lesson'), segment('18:00', '18:10', 'break'), segment('18:10', '19:20', 'lesson'),
  ], '2026-10-02T07:42:00.000Z', '2026-10-02T10:23:00.000Z'), '');
});

test('打刻範囲外、空白、5分単位外を拒否する', () => {
  const start = '2026-10-02T07:40:00.000Z';
  const end = '2026-10-02T10:20:00.000Z';
  assert.match(validateAttendanceSegmentCoverage([segment('16:35', '19:20')], start, end), /範囲内/);
  assert.match(validateAttendanceSegmentCoverage([segment('16:40', '17:00'), segment('17:05', '19:20')], start, end), /空白/);
  assert.match(validateAttendanceSegmentCoverage([segment('16:40', '19:19')], start, end), /5分単位/);
});

test('長時間勤務の休憩不足と最後の休憩を拒否する', () => {
  const start = '2026-10-02T00:00:00.000Z'; // 09:00 JST
  const end = '2026-10-02T09:00:00.000Z'; // 18:00 JST
  assert.match(validateAttendanceSegmentCoverage([segment('09:00', '18:00')], start, end), /60分/);
  assert.match(validateAttendanceSegmentCoverage([segment('09:00', '17:00'), segment('17:00', '18:00', 'break')], start, end), /最初または最後/);
});

test('個別のウイングネットは個別チューター単価、タブレット学習はメンター単価の区分になり、人数は不要', async () => {
  const { payrollTierForSegment, validateAttendanceSegment } = await import('../lib/attendance-work-detail.ts');
  const wingnet = { start: '16:00', end: '17:00', type: 'individual', lesson_format: 'individual' as const, individual_level: 'wingnet' as const, school_id: '270' };
  const tablet = { ...wingnet, individual_level: 'tablet' as const };
  assert.equal(payrollTierForSegment(wingnet), 'private_tutor');
  assert.equal(payrollTierForSegment(tablet), 'mentor');
  assert.equal(validateAttendanceSegment(wingnet), '');
  assert.match(validateAttendanceSegment({ ...wingnet, individual_level: 'standard' }), /人数/);
});

test('勤務校舎が創学の授業は創学単価、創学アカデミーは通常の集団授業', async () => {
  const { payrollTierForSegment } = await import('../lib/attendance-work-detail.ts');
  const lesson = { start: '17:00', end: '18:00', type: 'lesson', grade: '中1' };
  assert.equal(payrollTierForSegment({ ...lesson, school_id: '694' }), 'sogaku_lesson');
  assert.equal(payrollTierForSegment({ ...lesson, school_id: '321' }), 'group_lesson');
  assert.equal(payrollTierForSegment({ ...lesson, school_id: '170' }), 'group_lesson');
  // 創学でも事務・サブは通常の単価
  assert.equal(payrollTierForSegment({ start: '18:00', end: '19:00', type: 'office', office_task: 'grading', school_id: '694' }), 'office');
});

test('旧勤怠の創学の教室番号・校舎名を創学として読み取り、創学アカデミーと区別する', async () => {
  const { isSogakuAttendanceSchool, resolveAttendanceSchool } = await import('../lib/attendance-schools.ts');
  assert.equal(resolveAttendanceSchool('0694'), '創学ゼミ 垂水校');
  assert.equal(resolveAttendanceSchool('創学ｾﾞﾐ垂水'), '創学ゼミ 垂水校');
  assert.equal(resolveAttendanceSchool('創学ｵﾝﾗｲﾝ'), '創学ゼミ オンライン校');
  assert.equal(resolveAttendanceSchool('創学個別姫路'), '創学個別 姫路校');
  assert.equal(resolveAttendanceSchool('創学アカデミー姫路'), '創学アカデミー 姫路校');
  assert.equal(isSogakuAttendanceSchool('0696'), true);
  assert.equal(isSogakuAttendanceSchool('349'), false);
  assert.equal(isSogakuAttendanceSchool('創学アカデミー 明石校'), false);
});
