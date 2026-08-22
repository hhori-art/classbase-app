import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import {
  canReadEikenStudent,
  canManageEikenCourse,
  listLinkedStudentIds,
  listStudentEikenEnrollments,
  listTeacherEikenAssignments,
} from '@/lib/eiken/access';
import type { ServerUser } from '@/lib/server-auth';

export const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toISOString();
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const serializeFirestore = (value: any): any => {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestore);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeFirestore(nested)]),
    );
  }
  return value;
};

const documentsByIds = async (collectionName: string, ids: string[]): Promise<Record<string, any>[]> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const refs = uniqueIds.map(id => adminDb().collection(collectionName).doc(id));
  const snapshots = await adminDb().getAll(...refs);
  return snapshots
    .filter(snapshot => snapshot.exists)
    .map(snapshot => ({ id: snapshot.id, ...serializeFirestore(snapshot.data()) }));
};

const queryByCourseIds = async (collectionName: string, courseIds: string[]): Promise<Record<string, any>[]> => {
  const groups = await Promise.all(
    Array.from(new Set(courseIds.filter(Boolean))).map(courseId =>
      adminDb().collection(collectionName).where('course_id', '==', courseId).get(),
    ),
  );
  const map = new Map<string, Record<string, any>>();
  groups.flatMap(group => group.docs).forEach(doc => {
    map.set(doc.id, { id: doc.id, ...serializeFirestore(doc.data()) });
  });
  return Array.from(map.values());
};

const safeLesson = (lesson: Record<string, any>) => {
  const {
    meeting_id: _meetingId,
    passcode: _passcode,
    password: _password,
    join_url: _joinUrl,
    host_url: _hostUrl,
    start_url: _startUrl,
    ...safe
  } = lesson;
  return safe;
};

const lessonTimeMillis = (value: unknown) => {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
};

const withStudentJoinState = (
  lesson: Record<string, any>,
  now: number,
): Record<string, any> & {
  can_join: boolean;
  join_available_at: string | null;
  join_closes_at: string | null;
} => {
  const start = lessonTimeMillis(lesson.start_at);
  const end = lessonTimeMillis(lesson.end_at);
  const openBefore = Math.max(0, Number(lesson.join_open_before_minutes ?? 15)) * 60_000;
  const closeAfter = Math.max(0, Number(lesson.join_close_after_minutes ?? 30)) * 60_000;
  const availableAt = start === null ? null : start - openBefore;
  const closesAt = end === null ? null : end + closeAfter;

  return {
    ...lesson,
    can_join: availableAt !== null &&
      now >= availableAt &&
      (closesAt === null || now <= closesAt),
    join_available_at: availableAt === null ? null : new Date(availableAt).toISOString(),
    join_closes_at: closesAt === null ? null : new Date(closesAt).toISOString(),
  };
};

const mondayStart = (base: Date) => {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
};

export async function buildStudentEikenDashboard(studentId: string) {
  const enrollments = await listStudentEikenEnrollments(studentId);
  const courseIds = enrollments.map(item => String(item.course_id || '')).filter(Boolean);
  const [courses, tasks, lessons, progressSnapshot, quizResultsSnapshot, writingSnapshot, announcements] = await Promise.all([
    documentsByIds('eiken_courses', courseIds),
    queryByCourseIds('eiken_tasks', courseIds),
    queryByCourseIds('eiken_lessons', courseIds),
    adminDb().collection('eiken_task_progress').where('student_id', '==', studentId).get(),
    adminDb().collection('eiken_quiz_results').where('student_id', '==', studentId).get(),
    adminDb().collection('eiken_writing_submissions').where('student_id', '==', studentId).get(),
    queryByCourseIds('eiken_announcements', courseIds),
  ]);

  const progress = progressSnapshot.docs.map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }));
  const progressMap = new Map(progress.map(item => [String(item.task_id), item]));
  const completedIds = new Set(
    progress.filter(item => item.status === 'completed').map(item => String(item.task_id)),
  );
  const now = Date.now();
  const availableTasks: Record<string, any>[] = tasks
    .filter(task => task.status === 'published')
    .filter(task => !task.available_from || new Date(task.available_from).getTime() <= now)
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map(task => {
      const prerequisites = Array.isArray(task.prerequisites) ? task.prerequisites.map(String) : [];
      const locked = prerequisites.some((id: string) => !completedIds.has(id));
      return {
        ...task,
        progress: progressMap.get(task.id) || null,
        locked,
      } as Record<string, any>;
    });
  const incomplete = availableTasks.filter(task => task.progress?.status !== 'completed');
  const nextTask = incomplete.find(task => !task.locked) || null;
  const priorityTasks = incomplete
    .filter(task => !task.locked)
    .sort((a, b) => {
      const rank = { required: 0, recommended: 1, optional: 2 };
      return (rank[a.priority as keyof typeof rank] ?? 1) - (rank[b.priority as keyof typeof rank] ?? 1)
        || Number(a.sequence || 0) - Number(b.sequence || 0);
    })
    .slice(0, 3);

  const publishedLessons = lessons
    .filter(lesson => lesson.status !== 'draft' && lesson.status !== 'cancelled')
    .map(lesson => withStudentJoinState(safeLesson(lesson), now))
    .sort((a, b) => String(a.start_at || a.lesson_date || '').localeCompare(String(b.start_at || b.lesson_date || '')));
  const upcomingLessons = publishedLessons.filter(lesson => {
    const end = lesson.join_closes_at
      ? new Date(lesson.join_closes_at).getTime()
      : new Date(`${lesson.lesson_date || ''}T23:59:59+09:00`).getTime();
    return Number.isNaN(end) || end >= now;
  });
  const completedCount = availableTasks.filter(task => task.progress?.status === 'completed').length;
  const totalRequired = availableTasks.filter(task => task.is_required !== false).length;
  const completedRequired = availableTasks.filter(task => task.is_required !== false && task.progress?.status === 'completed').length;
  const quizResults = quizResultsSnapshot.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
  const weekStart = mondayStart(new Date()).getTime();
  const previousWeekStart = weekStart - 7 * 86_400_000;
  const completedLearningDates = progress
    .filter(item => item.status === 'completed')
    .map(item => item.completed_at || item.updated_at)
    .filter(Boolean)
    .map(value => new Date(value));
  const thisWeekCompleted = completedLearningDates.filter(date => date.getTime() >= weekStart);
  const previousWeekCompleted = completedLearningDates.filter(date =>
    date.getTime() >= previousWeekStart && date.getTime() < weekStart
  );
  const thisWeekStudyDays = new Set(thisWeekCompleted.map(date => date.toISOString().slice(0, 10))).size;
  const totalStudyDays = new Set(completedLearningDates.map(date => date.toISOString().slice(0, 10))).size;
  const latestSkills = quizResults[0]?.skill_scores || {};
  const previousSkills = quizResults[1]?.skill_scores || {};
  const skillChanges = Object.keys(latestSkills).map(skill => ({
    skill,
    previous: typeof previousSkills[skill] === 'number' ? previousSkills[skill] : null,
    current: Number(latestSkills[skill] || 0),
    change: typeof previousSkills[skill] === 'number'
      ? Number(latestSkills[skill] || 0) - Number(previousSkills[skill])
      : null,
  }));
  const improvedSkill = skillChanges
    .filter(item => item.change !== null && item.change > 0)
    .sort((a, b) => Number(b.change) - Number(a.change))[0] || null;
  const nextSkill = [...skillChanges].sort((a, b) => a.current - b.current)[0] || null;

  return {
    student: null,
    enrollments: enrollments.map(serializeFirestore),
    courses,
    next_task: nextTask,
    today_tasks: priorityTasks,
    tasks: availableTasks,
    progress_summary: {
      completed_count: completedCount,
      total_count: availableTasks.length,
      required_completed: completedRequired,
      required_total: totalRequired,
      completion_rate: totalRequired ? Math.round((completedRequired / totalRequired) * 100) : 0,
    },
    upcoming_lessons: upcomingLessons.slice(0, 8),
    calendar_events: [
      ...publishedLessons.map(lesson => ({
        id: lesson.id,
        type: 'live_lesson',
        title: lesson.title || 'Booster LIVE授業',
        start_at: lesson.start_at || lesson.lesson_date,
        end_at: lesson.end_at || null,
        course_id: lesson.course_id,
      })),
      ...availableTasks
        .filter(task => task.due_at)
        .map(task => ({
          id: task.id,
          type: 'task_due',
          title: `${task.title} 締切`,
          start_at: task.due_at,
          end_at: null,
          course_id: task.course_id,
        })),
    ],
    quiz_results: quizResults.slice(0, 10),
    growth_summary: {
      this_week_study_days: thisWeekStudyDays,
      total_study_days: totalStudyDays,
      this_week_completed: thisWeekCompleted.length,
      previous_week_completed: previousWeekCompleted.length,
      week_over_week_change: thisWeekCompleted.length - previousWeekCompleted.length,
      skill_changes: skillChanges,
      message: improvedSkill
        ? `${improvedSkill.skill}が前回より${improvedSkill.change}ポイント伸びています。`
        : thisWeekCompleted.length
          ? '今週も学習を積み重ねられています。次の1つから続けましょう。'
          : '今日は取り組みやすい1つから再開しましょう。',
      next_focus: nextSkill
        ? `次は${nextSkill.skill}を意識すると、さらに力を伸ばせます。`
        : '確認テストを受けると、次に伸ばすポイントが分かります。',
    },
    writing_submissions: writingSnapshot.docs
      .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
      .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
      .slice(0, 10),
    announcements: announcements
      .filter(item => item.status === 'published')
      .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
      .slice(0, 5),
  };
}

export async function buildParentEikenDashboard(user: ServerUser, requestedStudentId?: string) {
  const linkedIds = await listLinkedStudentIds(user);
  const selectedId = requestedStudentId && linkedIds.includes(requestedStudentId)
    ? requestedStudentId
    : linkedIds[0];
  if (!selectedId) return { students: [], selected_student_id: null, dashboard: null };

  const studentRefs = linkedIds.map(id => adminDb().collection('users').doc(id));
  const studentDocs = studentRefs.length ? await adminDb().getAll(...studentRefs) : [];
  const students = studentDocs
    .filter(doc => doc.exists)
    .map(doc => ({
      id: doc.id,
      name: doc.data()?.student_name || doc.data()?.name || '生徒',
      grade: doc.data()?.grade || '',
    }));
  const dashboard = await buildStudentEikenDashboard(selectedId);
  const selectedStudent = students.find(student => student.id === selectedId) || null;
  return {
    students,
    selected_student_id: selectedId,
    dashboard: {
      ...dashboard,
      student: selectedStudent,
      tasks: undefined,
      writing_submissions: dashboard.writing_submissions.map(item => ({
        id: item.id,
        task_id: item.task_id,
        evaluation_status: item.evaluation_status,
        scores: item.scores || null,
        submitted_at: item.submitted_at,
      })),
    },
  };
}

export async function buildEikenStudentDetail(
  user: ServerUser,
  studentId: string,
  requestedCourseId?: string,
) {
  if (!(await canReadEikenStudent(user, studentId, requestedCourseId))) {
    throw new Error('forbidden');
  }

  const enrollments = await listStudentEikenEnrollments(studentId);
  const enrollment = requestedCourseId
    ? enrollments.find(item => String(item.course_id) === requestedCourseId)
    : enrollments[0];
  if (!enrollment) throw new Error('eiken-enrollment-required');

  const courseId = String(enrollment.course_id || '');
  if (!(await canReadEikenStudent(user, studentId, courseId))) {
    throw new Error('forbidden');
  }

  const [
    studentSnap,
    courseSnap,
    tasks,
    progressSnap,
    lessons,
    attendanceSnap,
    quizResultsSnap,
    writingSnap,
    followUpSnap,
  ] = await Promise.all([
    adminDb().collection('users').doc(studentId).get(),
    adminDb().collection('eiken_courses').doc(courseId).get(),
    queryByCourseIds('eiken_tasks', [courseId]),
    adminDb().collection('eiken_task_progress').where('student_id', '==', studentId).get(),
    queryByCourseIds('eiken_lessons', [courseId]),
    adminDb().collection('eiken_attendance').where('student_id', '==', studentId).get(),
    adminDb().collection('eiken_quiz_results').where('student_id', '==', studentId).get(),
    adminDb().collection('eiken_writing_submissions').where('student_id', '==', studentId).get(),
    adminDb().collection('eiken_follow_up_records').where('student_id', '==', studentId).get(),
  ]);

  if (!studentSnap.exists || !courseSnap.exists) throw new Error('not-found');

  const progress = progressSnap.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => String(item.course_id || courseId) === courseId);
  const progressMap = new Map(progress.map(item => [String(item.task_id), item]));
  const publishedTasks: Record<string, any>[] = tasks
    .filter(task => task.status === 'published')
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map(task => ({ ...task, progress: progressMap.get(task.id) || null } as Record<string, any>));
  const requiredTasks = publishedTasks.filter(task => task.is_required !== false);
  const completedRequired = requiredTasks.filter(task => task.progress?.status === 'completed').length;
  const lastLearningAt = progress
    .flatMap(item => [item.completed_at, item.updated_at, item.started_at])
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const quizResults = quizResultsSnap.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => String(item.course_id || '') === courseId)
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
  const writingSubmissions = writingSnap.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => String(item.course_id || '') === courseId)
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
  const attendance = attendanceSnap.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => String(item.course_id || '') === courseId)
    .sort((a, b) => String(b.lesson_date || b.created_at || '').localeCompare(String(a.lesson_date || a.created_at || '')));
  const followUps = followUpSnap.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => String(item.course_id || '') === courseId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const now = Date.now();
  const overdueTasks = requiredTasks.filter(task =>
    task.progress?.status !== 'completed' &&
    task.due_at &&
    new Date(task.due_at).getTime() < now
  );
  const difficultTasks = publishedTasks.filter(task => task.progress?.understanding === 'difficult');
  const writingFailures = writingSubmissions.filter(item => item.evaluation_status === 'failed');
  const daysSinceLearning = lastLearningAt
    ? Math.floor((now - new Date(lastLearningAt).getTime()) / 86_400_000)
    : null;
  const followUpReasons = [
    daysSinceLearning === null ? '学習記録がまだありません' : '',
    daysSinceLearning !== null && daysSinceLearning >= 3 ? '最終学習から3日以上経過' : '',
    requiredTasks.length > 0 && completedRequired / requiredTasks.length < 0.5 ? '必須タスク完了率が50%未満' : '',
    overdueTasks.length ? `期限超過タスクが${overdueTasks.length}件` : '',
    difficultTasks.length ? '理解度で「よく分からなかった」を選択' : '',
    writingFailures.length ? 'AI添削に失敗した答案があります' : '',
  ].filter(Boolean);
  const student = studentSnap.data() || {};

  return {
    student: {
      id: studentSnap.id,
      name: student.student_name || student.name || '生徒',
      grade: student.grade || '',
      school: student.school_id || student.school || enrollment.school_id || '',
    },
    enrollment: serializeFirestore(enrollment),
    course: { id: courseSnap.id, ...serializeFirestore(courseSnap.data()) },
    summary: {
      completion_rate: requiredTasks.length
        ? Math.round((completedRequired / requiredTasks.length) * 100)
        : 0,
      required_completed: completedRequired,
      required_total: requiredTasks.length,
      last_learning_at: lastLearningAt,
      latest_quiz_percentage: quizResults[0]?.percentage ?? null,
      writing_completed: writingSubmissions.filter(item => item.evaluation_status === 'completed').length,
      follow_up_reasons: followUpReasons,
    },
    tasks: publishedTasks,
    lessons: lessons
      .filter(lesson => lesson.status !== 'draft')
      .map(safeLesson)
      .sort((a, b) => String(b.start_at || '').localeCompare(String(a.start_at || ''))),
    attendance,
    quiz_results: quizResults,
    writing_submissions: writingSubmissions,
    follow_up_records: followUps,
  };
}

export async function listManageableEikenCourses(user: ServerUser) {
  const all = await adminDb().collection('eiken_courses').get();
  const courses = all.docs.map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }));
  if (user.role === 'master') return courses;
  if (user.role === 'teacher') {
    const assignments = await listTeacherEikenAssignments(user.uid);
    const ids = new Set(assignments.map(item => String(item.course_id)));
    return courses.filter(course => ids.has(course.id));
  }
  const checks = await Promise.all(courses.map(course => canManageEikenCourse(user, course.id)));
  return courses.filter((_, index) => checks[index]);
}

export async function buildStaffEikenDashboard(user: ServerUser) {
  const courses = await listManageableEikenCourses(user);
  const courseIds = new Set(courses.map(course => course.id));
  const [
    enrollmentSnapshot,
    units,
    tasks,
    lessons,
    progressSnapshot,
    quizResults,
    writingSubmissions,
    attendanceRecords,
  ] = await Promise.all([
    adminDb().collection('course_enrollments').where('program_id', '==', 'eiken').get(),
    queryByCourseIds('eiken_course_units', Array.from(courseIds)),
    queryByCourseIds('eiken_tasks', Array.from(courseIds)),
    queryByCourseIds('eiken_lessons', Array.from(courseIds)),
    adminDb().collection('eiken_task_progress').get(),
    queryByCourseIds('eiken_quiz_results', Array.from(courseIds)),
    queryByCourseIds('eiken_writing_submissions', Array.from(courseIds)),
    queryByCourseIds('eiken_attendance', Array.from(courseIds)),
  ]);
  const enrollments = enrollmentSnapshot.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => item.status === 'active' && courseIds.has(String(item.course_id)));
  const studentIds = Array.from(new Set(enrollments.map(item => String(item.user_id)).filter(Boolean)));
  const students = await documentsByIds('users', studentIds);
  const studentMap = new Map(students.map(student => [student.id, student]));
  const progress = progressSnapshot.docs
    .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
    .filter(item => studentIds.includes(String(item.student_id)));
  const requiredTasks = tasks.filter(task => task.status === 'published' && task.is_required !== false);
  const now = Date.now();
  const weekStart = mondayStart(new Date()).getTime();
  const weekEnd = weekStart + 7 * 86_400_000;
  const courseMap = new Map(courses.map(course => [course.id, course]));

  const studentRows = enrollments.map(enrollment => {
    const studentProgress = progress.filter(item => item.student_id === enrollment.user_id);
    const completed = new Set(studentProgress.filter(item => item.status === 'completed').map(item => String(item.task_id)));
    const courseRequired = requiredTasks.filter(task => task.course_id === enrollment.course_id);
    const dueThisWeek = courseRequired.filter(task => {
      if (!task.due_at) return false;
      const due = new Date(task.due_at).getTime();
      return due >= weekStart && due < weekEnd;
    });
    const weeklyTasks = dueThisWeek.length ? dueThisWeek : courseRequired;
    const completionRate = courseRequired.length
      ? Math.round((courseRequired.filter(task => completed.has(task.id)).length / courseRequired.length) * 100)
      : 0;
    const weeklyCompletionRate = weeklyTasks.length
      ? Math.round((weeklyTasks.filter(task => completed.has(task.id)).length / weeklyTasks.length) * 100)
      : 0;
    const lastLearning = studentProgress
      .map(item => item.completed_at || item.updated_at || item.started_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    const daysSinceLearning = lastLearning
      ? Math.floor((now - new Date(lastLearning).getTime()) / 86_400_000)
      : null;
    const courseQuizResults = quizResults
      .filter(item => item.student_id === enrollment.user_id && item.course_id === enrollment.course_id)
      .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
    const courseWriting = writingSubmissions
      .filter(item => item.student_id === enrollment.user_id && item.course_id === enrollment.course_id);
    const courseAttendance = attendanceRecords
      .filter(item => item.student_id === enrollment.user_id && item.course_id === enrollment.course_id);
    const overdueTasks = courseRequired.filter(task =>
      !completed.has(task.id) &&
      task.due_at &&
      new Date(task.due_at).getTime() < now
    );
    const hasQuizTask = tasks.some(task =>
      task.course_id === enrollment.course_id &&
      task.status === 'published' &&
      task.task_type === 'quiz'
    );
    const hasWritingTask = tasks.some(task =>
      task.course_id === enrollment.course_id &&
      task.status === 'published' &&
      task.task_type === 'ai_writing'
    );
    const missedLive = courseAttendance.some(item =>
      item.status === 'absent' || item.status === 'missed' || item.attended === false
    );
    const nextLesson = lessons
      .filter(lesson =>
        lesson.course_id === enrollment.course_id &&
        lesson.status !== 'cancelled' &&
        (!lesson.end_at || new Date(lesson.end_at).getTime() >= now)
      )
      .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || '')))[0] || null;
    const followUpReasons = [
      daysSinceLearning === null ? '学習記録がまだありません' : '',
      daysSinceLearning !== null && daysSinceLearning >= 3 ? '最終学習から3日以上経過' : '',
      weeklyCompletionRate < 50 && weeklyTasks.length > 0 ? '今週の必須タスク完了率が50%未満' : '',
      overdueTasks.length ? `期限超過タスクが${overdueTasks.length}件` : '',
      hasQuizTask && !courseQuizResults.length ? '確認テストが未受験' : '',
      missedLive ? 'LIVE授業の欠席記録あり' : '',
      studentProgress.some(item => item.understanding === 'difficult') ? '理解度で「よく分からなかった」を選択' : '',
      hasWritingTask && !courseWriting.length ? 'AI添削課題が未提出' : '',
      courseWriting.some(item => item.evaluation_status === 'failed') ? 'AI添削に失敗した答案あり' : '',
    ].filter(Boolean);
    const student = studentMap.get(String(enrollment.user_id)) || {};
    const course = courseMap.get(String(enrollment.course_id)) || {};
    return {
      student_id: enrollment.user_id,
      name: student.student_name || student.name || '生徒',
      grade: student.grade || '',
      school: student.school_id || student.school || enrollment.school_id || '',
      course_id: enrollment.course_id,
      course_name: course.name || enrollment.course_id,
      level: course.level || '',
      weekly_completion_rate: weeklyCompletionRate,
      completion_rate: completionRate,
      last_learning_at: lastLearning,
      next_lesson_at: nextLesson?.start_at || nextLesson?.lesson_date || null,
      latest_quiz_percentage: courseQuizResults[0]?.percentage ?? null,
      studied_this_week: studentProgress.some(item => {
        const value = item.completed_at || item.updated_at || item.started_at;
        return value && new Date(value).getTime() >= weekStart;
      }),
      quiz_participated: courseQuizResults.length > 0,
      writing_submitted: courseWriting.length > 0,
      follow_up_reasons: followUpReasons,
    };
  });

  const attendedCount = attendanceRecords.filter(item =>
    item.status === 'present' || item.status === 'attended' || item.attended === true
  ).length;
  const absentCount = attendanceRecords.filter(item =>
    item.status === 'absent' || item.status === 'missed' || item.attended === false
  ).length;
  const attendanceTotal = attendedCount + absentCount;
  const quizEligible = studentRows.filter(item =>
    tasks.some(task => task.course_id === item.course_id && task.status === 'published' && task.task_type === 'quiz')
  );
  const writingEligible = studentRows.filter(item =>
    tasks.some(task => task.course_id === item.course_id && task.status === 'published' && task.task_type === 'ai_writing')
  );

  return {
    courses,
    units,
    lessons: lessons.map(safeLesson),
    tasks,
    students: studentRows,
    metrics: {
      active_students: studentRows.length,
      task_completion_rate: studentRows.length
        ? Math.round(studentRows.reduce((sum, item) => sum + item.completion_rate, 0) / studentRows.length)
        : 0,
      weekly_learning_rate: studentRows.length
        ? Math.round((studentRows.filter(item => item.studied_this_week).length / studentRows.length) * 100)
        : 0,
      weekly_task_completion_rate: studentRows.length
        ? Math.round(studentRows.reduce((sum, item) => sum + item.weekly_completion_rate, 0) / studentRows.length)
        : 0,
      live_attendance_rate: attendanceTotal
        ? Math.round((attendedCount / attendanceTotal) * 100)
        : null,
      quiz_participation_rate: quizEligible.length
        ? Math.round((quizEligible.filter(item => item.quiz_participated).length / quizEligible.length) * 100)
        : null,
      writing_submission_rate: writingEligible.length
        ? Math.round((writingEligible.filter(item => item.writing_submitted).length / writingEligible.length) * 100)
        : null,
      follow_up_students: studentRows.filter(item => item.follow_up_reasons.length > 0).length,
      upcoming_lessons: lessons.filter(lesson =>
        lesson.status !== 'cancelled' &&
        (!lesson.end_at || new Date(lesson.end_at).getTime() >= now)
      ).length,
    },
  };
}
