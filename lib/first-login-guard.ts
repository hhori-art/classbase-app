export const shouldRedirectToPasswordChange = (
  profile: { isFirstLogin?: boolean; role?: string } | null | undefined,
  pathname: string,
) => {
  void profile;
  void pathname;
  return false;
};

export const passwordChangePathForRole = (role?: string) => {
  if (role === 'teacher') return '/teacher';
  if (role === 'attendance_admin' || role === 'attendance_only' || role === 'attendance_manager') return '/teacher';
  if (role === 'master' || role === 'admin') return '/master';
  if (role === 'parent') return '/parent';
  return '/student';
};
