import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

if (process.env.EIKEN_ALLOW_SEED !== 'true') {
  throw new Error('EIKEN_ALLOW_SEED=true を設定した開発環境でのみ実行できます。');
}
if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
  throw new Error('本番環境ではBoosterシードを実行できません。');
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
const password = process.env.EIKEN_SEED_PASSWORD;
if (!projectId || !clientEmail || !privateKey || !password || password.length < 8) {
  throw new Error('Firebase Admin環境変数と8文字以上のEIKEN_SEED_PASSWORDが必要です。');
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const auth = getAuth();
const db = getFirestore();
const now = new Date();
const lessonStart = new Date(now.getTime() + 2 * 86_400_000);
lessonStart.setHours(19, 0, 0, 0);
const lessonEnd = new Date(lessonStart.getTime() + 60 * 60_000);

const users = [
  { uid: 'eiken_seed_student', email: 'eiken-seed-student@example.invalid', role: 'student', name: 'Booster確認 生徒', grade: '中3' },
  { uid: 'eiken_seed_followup', email: 'eiken-seed-followup@example.invalid', role: 'student', name: 'Booster要確認 生徒', grade: '中3' },
  { uid: 'eiken_seed_parent', email: 'eiken-seed-parent@example.invalid', role: 'parent', name: 'Booster確認 保護者' },
  { uid: 'eiken_seed_teacher', email: 'eiken-seed-teacher@example.invalid', role: 'teacher', name: 'Booster確認 講師' },
  { uid: 'eiken_seed_master', email: 'eiken-seed-master@example.invalid', role: 'master', name: 'Booster確認 管理者' },
];

for (const user of users) {
  try {
    await auth.getUser(user.uid);
    await auth.updateUser(user.uid, { email: user.email, password, displayName: user.name });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid: user.uid, email: user.email, password, displayName: user.name });
  }
}

const courseId = 'eiken_seed_grade2';
const unitId = 'eiken_seed_grade2_week1';
const taskIds = {
  video: 'eiken_seed_task_video',
  textbook: 'eiken_seed_task_textbook',
  live: 'eiken_seed_task_live',
  quiz: 'eiken_seed_task_quiz',
  writing: 'eiken_seed_task_writing',
};
const quizId = 'eiken_seed_quiz_week1';
const questionId = 'eiken_seed_question_week1_1';
const batch = db.batch();
const set = (collection, id, data) => batch.set(db.collection(collection).doc(id), {
  ...data,
  updated_at: FieldValue.serverTimestamp(),
}, { merge: true });

for (const user of users) {
  set('users', user.uid, {
    role: user.role,
    name: user.name,
    student_name: user.role === 'student' ? user.name : '',
    parent_name: user.role === 'parent' ? user.name : '',
    teacher_name: user.role === 'teacher' ? user.name : '',
    grade: user.grade || '',
    school_id: 'seed-school',
    school_ids: ['seed-school'],
    enabled_programs: ['eiken'],
    student_ids: user.role === 'parent' ? ['eiken_seed_student', 'eiken_seed_followup'] : [],
    parent_uid: user.role === 'student' ? 'eiken_seed_parent' : '',
    created_at: FieldValue.serverTimestamp(),
  });
}

set('eiken_courses', courseId, {
  name: '英検2級 Booster',
  level: '2kyu',
  academic_year: now.getFullYear(),
  school_id: 'seed-school',
  status: 'active',
  description: '開発確認用のBooster講座です。',
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_course_units', unitId, {
  course_id: courseId,
  title: '要約問題の基本',
  phase: 'フェーズ1 基礎構築',
  week_no: 1,
  sequence: 1,
  status: 'published',
  description: 'Week 1の開発確認用ユニット',
  created_at: FieldValue.serverTimestamp(),
});

const tasks = [
  [taskIds.video, '要約問題の基本映像', 'video', 1, { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', learning_points: '重要情報の選び方' }],
  [taskIds.textbook, 'テキスト P.24〜27', 'textbook', 2, { textbook_name: 'Booster 2級', pages: '24〜27', instructions: '例題を確認して練習問題に取り組みます。' }],
  [taskIds.live, 'Week 1 LIVE授業', 'live_lesson', 3, {}],
  [taskIds.quiz, 'Week 1 確認テスト', 'quiz', 4, { quiz_id: quizId }],
  [taskIds.writing, '意見論述 AI添削', 'ai_writing', 5, { assignment_type: 'opinion', prompt: 'Do you think students should use tablets at school?' }],
];
tasks.forEach(([id, title, taskType, sequence, details], index) => set('eiken_tasks', id, {
  course_id: courseId,
  unit_id: unitId,
  title,
  description: `${title}に取り組みます。`,
  task_type: taskType,
  sequence,
  is_required: true,
  priority: 'required',
  estimated_minutes: taskType === 'live_lesson' ? 60 : 15,
  status: 'published',
  prerequisites: index === 0 ? [] : [tasks[index - 1][0]],
  details,
  created_at: FieldValue.serverTimestamp(),
}));

set('eiken_lessons', 'eiken_seed_lesson_week1', {
  course_id: courseId,
  school_id: 'seed-school',
  title: 'Week 1 LIVE授業',
  start_at: Timestamp.fromDate(lessonStart),
  end_at: Timestamp.fromDate(lessonEnd),
  teacher_ids: ['eiken_seed_teacher'],
  meeting_id: '',
  status: 'scheduled',
  join_open_before_minutes: 15,
  join_close_after_minutes: 30,
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_quizzes', quizId, {
  course_id: courseId,
  task_id: taskIds.quiz,
  title: 'Week 1 確認テスト',
  quiz_type: 'periodic',
  max_attempts: 2,
  status: 'published',
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_quiz_questions', questionId, {
  quiz_id: quizId,
  question: '“important”に最も近い意味を選んでください。',
  question_type: 'single_choice',
  options: ['必要な', '静かな', '短い'],
  correct_answer: '必要な',
  explanation: 'importantは「重要な、必要な」という意味です。',
  skill_tag: '語彙',
  sequence: 1,
  created_at: FieldValue.serverTimestamp(),
});

for (const studentId of ['eiken_seed_student', 'eiken_seed_followup']) {
  set('course_enrollments', `${studentId}_${courseId}`, {
    user_id: studentId,
    program_id: 'eiken',
    course_id: courseId,
    school_id: 'seed-school',
    status: 'active',
    created_at: FieldValue.serverTimestamp(),
  });
}
set('eiken_teacher_assignments', 'eiken_seed_teacher_assignment', {
  teacher_id: 'eiken_seed_teacher',
  course_id: courseId,
  school_id: 'seed-school',
  status: 'active',
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_task_progress', `eiken_seed_student_${taskIds.video}`, {
  student_id: 'eiken_seed_student',
  course_id: courseId,
  task_id: taskIds.video,
  status: 'completed',
  understanding: 'good',
  started_at: FieldValue.serverTimestamp(),
  completed_at: FieldValue.serverTimestamp(),
});
set('eiken_quiz_results', 'eiken_seed_quiz_result', {
  student_id: 'eiken_seed_student',
  course_id: courseId,
  quiz_id: quizId,
  score: 1,
  max_score: 1,
  percentage: 100,
  skill_scores: { '語彙': 100 },
  attempt_no: 1,
  submitted_at: FieldValue.serverTimestamp(),
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_writing_submissions', `eiken_seed_student_${taskIds.writing}`, {
  submission_id: `eiken_seed_student_${taskIds.writing}`,
  student_id: 'eiken_seed_student',
  course_id: courseId,
  task_id: taskIds.writing,
  assignment_type: 'opinion',
  original_answer: 'I think students should use tablets because they can find information quickly.',
  word_count: 12,
  evaluation_status: 'completed',
  scores: { content: 3, organization: 3, vocabulary: 2, grammar: 3 },
  strengths: ['主張と理由が明確です。'],
  priority_improvements: ['具体例を1つ追加しましょう。'],
  corrected_example: 'I think students should use tablets because they can find information quickly and study efficiently.',
  next_focus: '理由を支える具体例を加えましょう。',
  model: 'mock',
  prompt_version: 'eiken-writing-v1',
  submitted_at: FieldValue.serverTimestamp(),
  evaluated_at: FieldValue.serverTimestamp(),
  created_at: FieldValue.serverTimestamp(),
});
set('eiken_follow_up_records', 'eiken_seed_followup_record', {
  student_id: 'eiken_seed_followup',
  course_id: courseId,
  status: 'noted',
  note: '学習記録がない状態を確認するための開発用データです。',
  created_by: 'eiken_seed_master',
  created_by_role: 'master',
  created_at: FieldValue.serverTimestamp(),
});

await batch.commit();
console.log('Booster development seed completed.');
console.log(users.map(user => `${user.role}: ${user.email}`).join('\n'));
