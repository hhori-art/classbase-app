export const EIKEN_LEVELS = [
  '5kyu',
  '4kyu',
  '3kyu',
  'pre2plus',
  'pre2kyu',
  '2kyu',
  'pre1kyu',
  '1kyu',
] as const;

export type EikenLevel = (typeof EIKEN_LEVELS)[number];

export const EIKEN_LEVEL_LABELS: Record<EikenLevel, string> = {
  '5kyu': '5級',
  '4kyu': '4級',
  '3kyu': '3級',
  'pre2plus': '準2級プラス',
  'pre2kyu': '準2級',
  '2kyu': '2級',
  'pre1kyu': '準1級',
  '1kyu': '1級',
};

export const EIKEN_TASK_TYPES = [
  'video',
  'textbook',
  'live_lesson',
  'quiz',
  'ai_writing',
  'reflection',
  'announcement',
] as const;

export type EikenTaskType = (typeof EIKEN_TASK_TYPES)[number];
export type EikenTaskStatus = 'draft' | 'published' | 'archived';
export type EikenProgressStatus = 'available' | 'in_progress' | 'completed' | 'skipped';
export type EikenUnderstanding = 'good' | 'uncertain' | 'difficult';
export type EikenTaskPriority = 'required' | 'recommended' | 'optional';

export type EikenCourse = {
  id: string;
  name: string;
  level: EikenLevel;
  school_id?: string;
  academic_year: number;
  status: 'draft' | 'active' | 'archived';
  description?: string;
};

export type EikenEnrollment = {
  id: string;
  user_id: string;
  program_id: 'eiken';
  course_id: string;
  school_id?: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
};

export type EikenTask = {
  id: string;
  course_id: string;
  unit_id?: string;
  title: string;
  description?: string;
  task_type: EikenTaskType;
  sequence: number;
  is_required: boolean;
  priority: EikenTaskPriority;
  estimated_minutes?: number;
  available_from?: unknown;
  due_at?: unknown;
  status: EikenTaskStatus;
  prerequisites?: string[];
  details?: Record<string, unknown>;
};

export const ACTIVE_ENROLLMENT_STATUSES = ['active'] as const;
export const ACTIVE_TEACHER_ASSIGNMENT_STATUSES = ['active'] as const;

export const isEikenLevel = (value: unknown): value is EikenLevel =>
  EIKEN_LEVELS.includes(String(value || '') as EikenLevel);

export const isEikenTaskType = (value: unknown): value is EikenTaskType =>
  EIKEN_TASK_TYPES.includes(String(value || '') as EikenTaskType);

