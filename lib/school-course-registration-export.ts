import { summarizeSelectedCourseLabels } from './course-registration-selection';

type CourseStatusStudent = {
  school_id?: string;
  lifetime_id?: string;
  student_name?: string;
  student_name_kana?: string;
  grade?: string;
  middle_school?: string;
  selected_course_labels?: string[];
  course_registration_year?: number | string;
  course_registration_term_label?: string;
  course_registration_term?: string;
  course_registration_updated_at?: string;
  account_status?: string;
  last_login_at?: string;
  last_login?: string;
};

const accountStatusLabel: Record<string, string> = {
  active: '有効',
  suspended: '一時停止',
  withdrawn: '解除',
  archived: '保管',
};

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  // Prevent spreadsheet applications from treating user-entered text as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** One row per student, with one column per registered course in the current term. */
export function buildSchoolCourseRegistrationCsv(students: CourseStatusStudent[], school: string) {
  const labelsByStudent = students.map(student => summarizeSelectedCourseLabels(student.selected_course_labels || []));
  const maxCourses = Math.max(1, ...labelsByStudent.map(labels => labels.length));
  const headers = [
    '校舎', '生涯番号', '氏名', 'フリガナ', '学年', '中学校', '今期登録', '登録講座数',
    ...Array.from({ length: maxCourses }, (_, index) => `受講講座${index + 1}`),
    '登録年度', '登録期', '登録更新日', 'アカウント状態', '最終ログイン',
  ];
  const rows = students.map((student, studentIndex) => {
    const courses = labelsByStudent[studentIndex];
    return [
      student.school_id || school,
      student.lifetime_id || '',
      student.student_name || '',
      student.student_name_kana || '',
      student.grade || '',
      student.middle_school || '',
      courses.length ? '登録済み' : '今期未登録',
      courses.length,
      ...Array.from({ length: maxCourses }, (_, index) => courses[index] || ''),
      student.course_registration_year || '',
      student.course_registration_term_label || student.course_registration_term || '',
      String(student.course_registration_updated_at || '').slice(0, 10),
      accountStatusLabel[student.account_status || 'active'] || student.account_status || '',
      student.last_login_at || student.last_login || '',
    ];
  });
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}
