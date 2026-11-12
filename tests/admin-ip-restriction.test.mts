import assert from 'node:assert/strict';
import test from 'node:test';
import { isIpRestrictedPath } from '../lib/admin-ip-restriction.ts';

test('管理者・教室管理の画面とAPIは社外から使えない', () => {
  for (const path of [
    '/master', '/master/', '/master/school-students', '/master/accounts',
    '/teacher/students', '/teacher/pf', '/teacher/contacts', '/teacher/homework', '/teacher/online-school', '/teacher/risk-monitor', '/teacher/school-students',
    '/api/admin/school-students', '/api/admin/accounts/sync-printed-password', '/api/admin/accounts/login-lock',
    // 管理者のログインAPIも社内の回線からだけ（画面 /admin/login は開けるが、ログインは通らない）。
    '/api/admin/login', '/api/teacher/contacts', '/api/teacher/students', '/api/online-school/admin', '/api/curriculum-admin',
  ]) assert.equal(isIpRestrictedPath(path), true, path);
});

test('勤怠・生徒・保護者・ログイン・サーバー間の呼び出しは社外からも使える', () => {
  for (const path of [
    '/', '/student', '/parent', '/admin/login', '/password-reset', '/403',
    '/teacher', '/teacher/work', '/teacher/attendance', '/teacher/attendance-approvals/dedicated', '/teacher/shifts', '/teacher/chat', '/teacher/slides',
    '/master/attendance', '/master/attendance/dedicated', '/master/attendance-approvals', '/master/shifts', '/master/substitutions',
    '/api/admin/dedicated-attendance', '/api/admin/shifts', '/api/admin/transport-fares/import',
    '/api/teacher/attendance-clock', '/api/teacher/shifts', '/api/homework', '/api/auth/login', '/api/auth/logout', '/api/cron/beta-report', '/api/internal/mail-outbox',
    '/mastery', '/api/administrator',
  ]) assert.equal(isIpRestrictedPath(path), false, path);
});
