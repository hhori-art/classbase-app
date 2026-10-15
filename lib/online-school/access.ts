export const ONLINE_SCHOOL_PROGRAM_ID = 'online_school';

export function hasOnlineSchoolProgram(profile: Record<string, unknown> | null | undefined) {
  return Array.isArray(profile?.enabled_programs)
    && profile.enabled_programs.map(String).includes(ONLINE_SCHOOL_PROGRAM_ID);
}
