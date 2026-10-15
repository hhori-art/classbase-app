import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDedicatedScienceSocialProfile,
  isPublicAuthPath,
  isRoleScopedPath,
  roleMatchesPath,
  scienceSocialPathForProfile,
  targetPathByRole,
  targetPathForProfile,
  type AuthRole,
} from '../lib/auth-navigation.ts';
import { passwordChangePathForRole, shouldRedirectToPasswordChange } from '../lib/first-login-guard.ts';

const roleHomes: Array<[AuthRole, string]> = [
  ['student', '/student'],
  ['teacher', '/teacher'],
  ['attendance_admin', '/master/attendance'],
  ['parent', '/parent'],
  ['admin', '/master'],
  ['master', '/master'],
];

test('each account can render only its own role-scoped screen', () => {
  for (const [role, ownPath] of roleHomes) {
    assert.equal(roleMatchesPath(role, ownPath), true, `${role} should access ${ownPath}`);
  }

  assert.equal(roleMatchesPath('student', '/teacher'), false);
  assert.equal(roleMatchesPath('student', '/master'), false);
  assert.equal(roleMatchesPath('teacher', '/student'), false);
  assert.equal(roleMatchesPath('teacher', '/master'), false);
  assert.equal(roleMatchesPath('attendance_admin', '/teacher/attendance'), false);
  assert.equal(roleMatchesPath('attendance_admin', '/student'), false);
  assert.equal(roleMatchesPath('parent', '/student'), false);
  assert.equal(roleMatchesPath('parent', '/master'), false);
});

test('shared app selector remains available to every account', () => {
  for (const [role] of roleHomes) {
    assert.equal(roleMatchesPath(role, '/apps'), true);
    assert.equal(targetPathByRole(role), '/apps');
  }
});

test('role-scoped paths are distinguished from shared screens', () => {
  for (const [, path] of roleHomes) assert.equal(isRoleScopedPath(path), true);
  assert.equal(isRoleScopedPath('/apps'), false);
  assert.equal(isRoleScopedPath('/zoom-meeting'), false);
});

test('password recovery and manuals remain accessible before login', () => {
  for (const path of ['/manual', '/manual/student', '/password-reset', '/password-reset/confirm']) {
    assert.equal(isPublicAuthPath(path), true, `${path} should be public`);
  }
  for (const path of ['/student', '/teacher', '/master', '/account/password-change']) {
    assert.equal(isPublicAuthPath(path), false, `${path} should require authentication`);
  }
});

test('dedicated science-social teachers enter their own school management screen', () => {
  const profile = {
    role: 'teacher',
    employment_category: 'dedicated',
    enabled_programs: ['science_social'],
    school_id: 'Q042',
  };
  assert.equal(isDedicatedScienceSocialProfile(profile), true);
  assert.equal(targetPathForProfile(profile), '/teacher/school-students');
  assert.equal(scienceSocialPathForProfile(profile), '/teacher/school-students');
});

test('semi-dedicated and unassigned teachers keep the teacher/app entrances', () => {
  const semiDedicated = {
    role: 'teacher', employment_category: 'semi_dedicated', enabled_programs: ['science_social'],
  };
  const dedicatedAttendanceOnly = {
    role: 'teacher', employment_category: 'dedicated', enabled_programs: [],
  };
  assert.equal(targetPathForProfile(semiDedicated), '/apps');
  assert.equal(scienceSocialPathForProfile(semiDedicated), '/teacher');
  assert.equal(targetPathForProfile(dedicatedAttendanceOnly), '/apps');
});

test('first-login teachers are forced to the shared password-change screen until the password is changed', () => {
  assert.equal(shouldRedirectToPasswordChange({ role: 'teacher', isFirstLogin: true }, '/teacher'), true);
  assert.equal(shouldRedirectToPasswordChange({ role: 'teacher', isFirstLogin: true }, '/account/password-change'), false);
  assert.equal(shouldRedirectToPasswordChange({ role: 'teacher', isFirstLogin: false }, '/teacher'), false);
  assert.equal(passwordChangePathForRole('teacher'), '/account/password-change?first_login=1');
});

test('every role is forced to the layout-independent password-change screen on first login', () => {
  const cases: Array<[string, string, string]> = [
    ['student', '/student', '/account/password-change?first_login=1'],
    ['parent', '/parent', '/account/password-change?first_login=1'],
    ['admin', '/master', '/account/password-change?first_login=1'],
    ['master', '/master', '/account/password-change?first_login=1'],
    ['attendance_admin', '/master/attendance', '/account/password-change?first_login=1'],
  ];
  for (const [role, currentPath, expectedPath] of cases) {
    assert.equal(shouldRedirectToPasswordChange({ role, isFirstLogin: true }, currentPath), true);
    assert.equal(passwordChangePathForRole(role), expectedPath);
    assert.equal(shouldRedirectToPasswordChange({ role, isFirstLogin: true }, expectedPath.split('?')[0]), false);
  }
});
