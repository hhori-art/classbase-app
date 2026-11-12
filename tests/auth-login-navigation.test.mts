import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { passwordChangePathForRole, shouldRedirectToPasswordChange } from '../lib/first-login-guard';
import { profileMatchesPath, roleMatchesPath, targetPathForProfile } from '../lib/auth-navigation';

test('all first-login roles use the layout-independent password change page', () => {
  for (const role of ['student', 'teacher', 'parent', 'admin', 'master', 'attendance_admin']) {
    assert.equal(passwordChangePathForRole(role), '/account/password-change?first_login=1');
    assert.equal(shouldRedirectToPasswordChange({ role, isFirstLogin: true }, '/apps'), true);
    assert.equal(shouldRedirectToPasswordChange({ role, isFirstLogin: true }, '/account/password-change'), false);
  }
});

test('attendance administrators retain their role and enter the attendance manager app', () => {
  assert.equal(targetPathForProfile({ role: 'attendance_admin' }), '/master/attendance');
  assert.equal(roleMatchesPath('attendance_admin', '/master/attendance'), true);
  assert.equal(roleMatchesPath('attendance_admin', '/teacher/attendance'), false);
});

test('teacher shift management stays in the teacher surface', () => {
  assert.equal(profileMatchesPath({
    role: 'teacher',
    employment_category: 'dedicated',
    attendance_school_manager: true,
  }, '/teacher/shift-management'), true);
  assert.equal(profileMatchesPath({
    role: 'teacher',
    employment_category: 'dedicated',
    attendance_school_manager: true,
  }, '/master/shifts'), false);
  assert.equal(profileMatchesPath({
    role: 'teacher',
    employment_category: 'semi_dedicated',
    attendance_school_manager: true,
  }, '/master/shifts'), false);
  assert.equal(profileMatchesPath({ role: 'attendance_admin' }, '/master/shifts'), false);
  assert.equal(profileMatchesPath({ role: 'master' }, '/master/shifts'), true);

  const teacherNav = fs.readFileSync('app/components/TeacherBottomNav.tsx', 'utf8');
  const teacherLayout = fs.readFileSync('app/teacher/layout.tsx', 'utf8');
  const teacherShiftPage = fs.readFileSync('app/teacher/shift-management/page.tsx', 'utf8');
  assert.match(teacherNav, /path: '\/teacher\/shift-management'/);
  assert.doesNotMatch(teacherNav, /path: '\/master\/shifts'/);
  assert.match(teacherLayout, /isShiftManagementPath[\s\S]*canOpenShiftManagement/);
  assert.match(teacherShiftPage, /ShiftManagementPage/);
});

test('common and admin login entrypoints preserve attendance administrator routing', () => {
  const commonLogin = fs.readFileSync('app/page.tsx', 'utf8');
  const adminLogin = fs.readFileSync('app/admin/login/page.tsx', 'utf8');
  const authContext = fs.readFileSync('app/context/AuthContext.tsx', 'utf8');
  assert.match(commonLogin, /return 'attendance_admin'/);
  assert.match(adminLogin, /normalizedRole === 'attendance_admin'/);
  assert.match(authContext, /return 'attendance_admin'/);
});

test('login screens send the password only to the server login APIs (KDL A.1.2)', () => {
  const client = fs.readFileSync('lib/client-auth-login.ts', 'utf8');
  assert.match(client, /options\.admin \? '\/api\/admin\/login' : '\/api\/auth\/login'/);
  assert.match(client, /signInWithCustomToken/);
  for (const file of ['lib/client-auth-login.ts', 'app/page.tsx', 'app/admin/login/page.tsx', 'app/context/AuthContext.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    // 画面から Firebase へ直接パスワードを送ると、サーバーのロックを通らない。
    assert.doesNotMatch(source, /signInWithEmailAndPassword|\/api\/first-login|\/api\/admin\/first-login/, file);
  }
  assert.match(fs.readFileSync('app/admin/login/page.tsx', 'utf8'), /loginWithServer\(.*\{ admin: true \}\)/);
  assert.match(fs.readFileSync('app/context/AuthContext.tsx', 'utf8'), /\/api\/auth\/logout/);
});
