export const shouldRedirectToPasswordChange = (
  profile: { isFirstLogin?: boolean; role?: string } | null | undefined,
  pathname: string,
) => {
  if (profile?.isFirstLogin !== true) return false;
  const passwordPath = passwordChangePathForRole(profile.role);
  return pathname !== passwordPath.split('?')[0];
};

export const passwordChangePathForRole = (role?: string) => {
  void role;
  return '/account/password-change?first_login=1';
};
