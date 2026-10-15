import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchoolCourseRegistrationCsv } from '../lib/school-course-registration-export.ts';

test('今期の受講講座を生徒ごと・講座ごとの列で出力し、未登録も残す', () => {
  const csv = buildSchoolCourseRegistrationCsv([
    {
      school_id: '本山', lifetime_id: '100001', student_name: '山田 太郎', grade: '中2',
      selected_course_labels: ['中2 理科 生物 / 金曜 1限', '中2 社会 地理Ｄ / 金曜 2限'],
      course_registration_year: 2026, course_registration_term_label: '第III期',
      account_status: 'active',
    },
    {
      school_id: '本山', lifetime_id: '100002', student_name: '山田 花子', grade: '中2',
      selected_course_labels: [], course_registration_year: 2026, course_registration_term_label: '第III期',
    },
  ], '本山');
  const rows = csv.slice(1).split('\r\n');
  assert.equal(rows.length, 3);
  assert.match(rows[0], /"今期登録","登録講座数","受講講座1","受講講座2"/);
  assert.match(rows[1], /"登録済み","2","中2 理科 生物 \/ 金曜 1限","中2 社会 地理Ｄ \/ 金曜 2限"/);
  assert.match(rows[2], /"今期未登録","0","",""/);
});

test('CSVに含まれる入力値を式として実行させない', () => {
  const csv = buildSchoolCourseRegistrationCsv([{ student_name: '=HYPERLINK("unsafe")', selected_course_labels: ['+SUM(1,2)'] }], '本山');
  assert.match(csv, /"'=HYPERLINK\(""unsafe""\)"/);
  assert.match(csv, /"'\+SUM\(1,2\)"/);
});
