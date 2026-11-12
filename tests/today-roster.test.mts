import test from 'node:test';
import assert from 'node:assert/strict';
import { activeAbsencesByStudent, classifyRosterStudent, summarizeRoster, zoomCheckedForLessons } from '../lib/today-roster';

const base = { zoomChecked: true, inZoom: false };

test('Zoom で見つかった生徒は入室済み、電話はいらない', () => {
  const result = classifyRosterStudent({ ...base, inZoom: true });
  assert.equal(result.status, 'joined');
  assert.equal(result.needsCall, false);
});

test('授業ボタンを押しただけでは入室に数えない', () => {
  const result = classifyRosterStudent({ ...base, classButtonClicked: true });
  assert.equal(result.status, 'no_contact');
  assert.equal(result.needsCall, true);
  assert.match(result.notes.join(), /授業ボタンは押しています/);
});

test('Zoom を確かめていないときは、推測で未入室にせず未確認にする', () => {
  const result = classifyRosterStudent({ zoomChecked: false, inZoom: false });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.needsCall, false);
});

test('欠席・遅刻の連絡がある生徒は、入室していなくても電話の対象にしない', () => {
  assert.equal(classifyRosterStudent({ ...base, absence: { kind: 'absent' } }).status, 'absence_notified');
  const late = classifyRosterStudent({ ...base, absence: { kind: 'late' } });
  assert.equal(late.status, 'absence_notified');
  assert.equal(late.needsCall, false);
  assert.match(late.notes[0], /遅刻/);
  // 欠席連絡のあとで入室したら入室済み
  assert.equal(classifyRosterStudent({ ...base, inZoom: true, absence: { kind: 'absent' } }).status, 'joined');
});

test('講師の出欠記録を使う（出・遅は入室済み、欠は欠席記録）', () => {
  assert.equal(classifyRosterStudent({ zoomChecked: false, inZoom: false, manualAttendance: '出' }).status, 'joined');
  assert.equal(classifyRosterStudent({ zoomChecked: false, inZoom: false, manualAttendance: '遅' }).status, 'joined');
  assert.equal(classifyRosterStudent({ ...base, manualAttendance: '欠' }).status, 'absent_recorded');
});

test('電話不要の設定の生徒は、未入室でも電話の対象にしない', () => {
  const result = classifyRosterStudent({ ...base, callNotRequired: true });
  assert.equal(result.status, 'no_contact');
  assert.equal(result.needsCall, false);
});

test('取り消し・却下の連絡は数えず、同じ日の欠席は遅刻より優先する', () => {
  const map = activeAbsencesByStudent([
    { type: 'absence', student_id: 'a', absence_type: 'late', status: 'pending' },
    { type: 'absence', student_id: 'a', absence_type: 'absent', status: 'pending' },
    { type: 'absence', student_id: 'b', status: 'cancelled' },
    { type: 'absence', user_id: 'c', status: 'canceled' },
    { type: 'transfer', student_id: 'd' },
    { type: 'absence', student_id: 'e', absence_type: 'late' },
  ]);
  assert.equal(map.get('a')?.kind, 'absent');
  assert.equal(map.has('b'), false);
  assert.equal(map.has('c'), false);
  assert.equal(map.has('d'), false);
  assert.equal(map.get('e')?.kind, 'late');
});

test('集計：電話が必要な人数と区分ごとの人数', () => {
  const summary = summarizeRoster([
    classifyRosterStudent({ ...base, inZoom: true }),
    classifyRosterStudent({ ...base }),
    classifyRosterStudent({ ...base, absence: { kind: 'absent' } }),
    classifyRosterStudent({ zoomChecked: false, inZoom: false }),
  ]);
  assert.deepEqual(summary.counts, { joined: 1, absence_notified: 1, absent_recorded: 0, no_contact: 1, unconfirmed: 1, no_lesson: 0 });
  assert.equal(summary.needsCall, 1);
});

test('今日の授業がない生徒は電話の対象にしない（欠席連絡があればそちらを出す）', () => {
  assert.equal(classifyRosterStudent({ ...base, hasLessonToday: false }).status, 'no_lesson');
  assert.equal(classifyRosterStudent({ ...base, hasLessonToday: false }).needsCall, false);
  assert.equal(classifyRosterStudent({ ...base, hasLessonToday: false, absence: { kind: 'absent' } }).status, 'absence_notified');
});

test('Zoom は、その生徒の時限の授業で確かめたときだけ「確かめた」とする', () => {
  // 1限だけ確かめた時点で、2限の生徒は未確認のまま（未入室にしない）
  assert.equal(zoomCheckedForLessons([2], new Set([1])), false);
  assert.equal(zoomCheckedForLessons([1], new Set([1])), true);
  assert.equal(zoomCheckedForLessons([1, 2], new Set([2])), true);
  // 今日の授業が分からない・ない生徒は確かめていない扱い
  assert.equal(zoomCheckedForLessons(null, new Set([1, 2])), false);
  assert.equal(zoomCheckedForLessons([], new Set([1, 2])), false);
});
