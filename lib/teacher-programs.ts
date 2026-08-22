export const TEACHER_PROGRAMS = ['science_social'] as const;
export type TeacherProgram = typeof TEACHER_PROGRAMS[number];

export function teacherPrograms(profile: Record<string, unknown> | null | undefined): TeacherProgram[] {
  const values = Array.isArray(profile?.enabled_programs) ? profile.enabled_programs.map(String) : [];
  return TEACHER_PROGRAMS.filter(program => values.includes(program));
}

export const hasScienceSocialProgram = (profile: Record<string, unknown> | null | undefined) =>
  teacherPrograms(profile).includes('science_social');
