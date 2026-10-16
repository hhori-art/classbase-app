export const canIssueCourseRegistrationGrant = (
  registrationType: unknown,
  isCurrent: boolean,
  isOpen: boolean,
) => registrationType === 'test_prep' ? isOpen : isCurrent || isOpen;

export const canIssueCourseRegistrationGrantForContext = (
  registrationType: unknown,
  isCurrent: boolean,
  isOpen: boolean,
  isExistingCurrentRegistration: boolean,
  isAuthorizedAdministrator: boolean,
) => {
  if (isAuthorizedAdministrator) return true;
  if (registrationType === 'test_prep') return isOpen;
  return isCurrent || isOpen || isExistingCurrentRegistration;
};
