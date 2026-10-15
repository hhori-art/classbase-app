export const canIssueCourseRegistrationGrant = (
  registrationType: unknown,
  isCurrent: boolean,
  isOpen: boolean,
) => registrationType === 'test_prep' ? isOpen : isCurrent || isOpen;
