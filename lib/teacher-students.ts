export type SafeTeacherStudent = {
  id: string;
  uid: string;
  role?: string;
  student_name?: string;
  name?: string;
  lifetime_id?: string | number;
  grade?: string;
  classroom?: string;
  school?: string;
  school_id?: string;
  day_of_week?: string;
  subjects?: string[];
  subject_1?: string;
  subject_2?: string;
  subject_3?: string;
  subject_4?: string;
  subject_5?: string;
  subject_science?: string;
  subject_social?: string;
  science_subject?: string;
  social_subject?: string;
  last_login?: string | number | null;
  coins?: number;
  email?: string;
  phone_number?: string;
  absence_call_not_required?: boolean;
  camera_off_requested?: boolean;
  churn_risk?: number;
  risk_reason?: string;
  risk_action?: string;
  risk_analyzed_at?: string | number | null;
};

const SAFE_STUDENT_FIELDS = [
  'role',
  'student_name',
  'name',
  'lifetime_id',
  'grade',
  'classroom',
  'school',
  'school_id',
  'day_of_week',
  'subjects',
  'subject_1',
  'subject_2',
  'subject_3',
  'subject_4',
  'subject_5',
  'subject_science',
  'subject_social',
  'science_subject',
  'social_subject',
  'last_login',
  'coins',
  'email',
  'phone_number',
  'absence_call_not_required',
  'camera_off_requested',
  'churn_risk',
  'risk_reason',
  'risk_action',
  'risk_analyzed_at',
] as const;

function normalizeFirestoreValue(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === 'function') {
    return maybeTimestamp.toDate().toISOString();
  }
  return value;
}

export function toSafeTeacherStudent(
  id: string,
  data: Record<string, any>,
): SafeTeacherStudent {
  const student: Record<string, unknown> = { id, uid: data.uid || id };

  SAFE_STUDENT_FIELDS.forEach((field) => {
    if (data[field] !== undefined) {
      student[field] = normalizeFirestoreValue(data[field]);
    }
  });

  return student as SafeTeacherStudent;
}
