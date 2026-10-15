import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'classbase-security-diagnosis';
const root = process.cwd();
const keyPath = path.join(root, '.security-staging-service-account.json');
if (!fs.existsSync(keyPath)) throw new Error('Missing diagnosis service-account key.');

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.private_key) {
  throw new Error('Safety stop: service-account key is not for the diagnosis project.');
}
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

const jstDate = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const addDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return jstDate(date);
};
const today = jstDate();
const year = Number(today.slice(0, 4));
const academicYear = Number(today.slice(5, 7)) >= 4 ? year : year - 1;
const timestampAt = (dateKey, hour = 9) => Timestamp.fromDate(new Date(`${dateKey}T${String(hour).padStart(2, '0')}:00:00+09:00`));

const allVisible = {
  student: Object.fromEntries(['adaptiveQuest','chat','homework','recordings','absence','transfer','calendar','changeRequest','community','ocrQuiz','news','notifications','settings','shop','history'].map(key => [key, true])),
  parent: Object.fromEntries(['homework','attendance','absence','transfer','recordings','aiMessages','announcements','calendar','contact','notificationSettings','notifications','settings'].map(key => [key, true])),
  teacher: Object.fromEntries(['dashboard','work','attendance','shifts','substitutions','community','notifications','settings','news','calendar','chat','contacts','homework','pf','riskMonitor','slides','students'].map(key => [key, true])),
  admin: Object.fromEntries(['users','schoolStudents','sso','shifts','monthlySchedules','attendance','attendanceCorrections','attendanceDiagnostics','substitutions','announcements','requests','parentInquiries','registrationTasks','curriculum','pf','recordings','community','rewards','stats','betaAnalytics','surveySettings','imports','delete','line','notifications','slides','settings'].map(key => [key, true])),
};

const docs = [];
const put = (collection, id, data) => docs.push({ collection, id, data: { ...data, diagnosis_test_data: true } });

put('settings', 'portal_visibility', { ...allVisible, diagnosis_note: '外部脆弱性診断用。全機能を表示。' });
put('settings', 'class_button', { enabled: true, label: '授業に参加', show_countdown: true, diagnostic_mode: true });
put('settings', 'global', { school_name: '診断用校舎', teacher_contact_enabled: true, risk_monitor_enabled: true, current_year: String(year), current_week: '1' });
put('settings', 'subjects', { urls: {}, diagnostic_note: '外部接続先は診断環境では未設定です。' });
put('settings', 'notification_channels', {
  in_app: true, in_app_enabled: true,
  line: false, line_enabled: false, student_line_enabled: false, parent_line_enabled: false,
  teacher_line_enabled: false, admin_line_enabled: false,
  email: false, email_enabled: false, diagnostic_mode: true,
});
put('settings', 'mission_control', {
  login: true, recording: true, community: true,
  custom_missions: [{ id: 'diagnosis-review', title: '診断用画面を確認', description: '診断用ミッションです。', condition: 'login', reward: 10, enabled: true }],
});

const students = [
  { id: 'security-student', name: '診断用 生徒', login: true, attendance: ['出席','出席','遅刻','欠席'], homework: [true,true,false], quizzes: [82,74,null] },
  { id: 'security-demo-student-2', name: '診断用 生徒B', attendance: ['出席','出席','出席','出席'], homework: [true,true,true], quizzes: [94,88,91] },
  { id: 'security-demo-student-3', name: '診断用 生徒C', attendance: ['出席','欠席','欠席','遅刻'], homework: [true,false,false], quizzes: [58,null,null] },
];

students.forEach((student, index) => {
  put('users', student.id, {
    uid: student.id, role: 'student', name: student.name, student_name: student.name,
    grade: '中3', school: '112', school_id: '112', classroom: '診断用校舎',
    day_of_week: index === 1 ? ['水','金'] : ['火','木'], subjects: ['理科','社会','英語','数学','国語'],
    parent_uid: student.id === 'security-student' ? 'security-parent' : '', coins: index === 0 ? 360 : 120,
    enabled_programs: student.id === 'security-student' ? ['science_social'] : [],
    selected_badge: 'beta_tester', status: 'active', diagnosis_test_account: true,
    ...(student.login ? {} : { lifetime_id: `diagnosis-demo-${index + 1}`, auth_disabled: true }),
  });
  student.attendance.forEach((status, offset) => put('attendance', `security-demo-attendance-${index}-${offset}`, {
    user_id: student.id, student_id: student.id, student_name: student.name,
    target_date: addDays(today, offset - 3), attendance_status: status, status, school_id: '112', grade: '中3',
  }));
  student.homework.forEach((completed, offset) => put('pf_learning_records', `security-demo-pf-homework-${index}-${offset}`, {
    student_id: student.id, user_id: student.id, student_name: student.name, date: addDays(today, offset - 2),
    kind: 'homework', status: completed ? '提出済' : '未提出', completed, school_id: '112', grade: '中3',
  }));
  student.quizzes.forEach((score, offset) => put('pf_learning_records', `security-demo-pf-quiz-${index}-${offset}`, {
    student_id: student.id, user_id: student.id, student_name: student.name, date: addDays(today, offset - 2),
    kind: 'quiz', status: score === null ? '未実施' : '実施済', completed: score !== null, score, school_id: '112', grade: '中3',
  }));
});

put('users', 'security-teacher-dedicated', { assigned_student_ids: students.map(item => item.id), teacher_name: '診断用 専任講師' });
put('users', 'security-teacher-semi-dedicated', { assigned_student_ids: students.map(item => item.id), teacher_name: '診断用 準専任講師' });
put('users', 'security-parent', { student_ids: ['security-student'], enabled_programs: ['science_social'] });

const shiftDates = [today, addDays(today, 2), addDays(today, 5), addDays(today, 7), addDays(today, 12)];
shiftDates.forEach((date, index) => {
  const isScience = index % 2 === 0;
  put('shift_assignments', `security-demo-shift-main-${index}`, {
    target_date: date, user_id: 'security-teacher-dedicated', teacher_id: 'security-teacher-dedicated',
    teacher_name: '診断用 専任講師', role_type: 'main', target_grade: '中3', grade: '中3',
    target_subject: isScience ? '理科' : '社会', target_detail_subject: isScience ? '中3理科' : '中3社会',
    subject: isScience ? '理科' : '社会', note: index % 3 === 0 ? '【1限】診断用授業' : '【2限】診断用授業',
    period: index % 3 === 0 ? '1限' : '2限', target_place: '診断用校舎', school: '112', school_id: '112',
    unit: isScience ? '化学変化とイオン' : '現代社会と政治', target_meeting_id: `90000000${index + 1}`,
  });
  put('shift_assignments', `security-demo-shift-sub-${index}`, {
    target_date: date, user_id: 'security-teacher-semi-dedicated', teacher_id: 'security-teacher-semi-dedicated',
    teacher_name: '診断用 準専任講師', role_type: 'sub', parent_id: `security-demo-shift-main-${index}`,
    target_grade: '中3', grade: '中3', target_subject: isScience ? '理科' : '社会',
    target_detail_subject: 'サポート', note: index % 3 === 0 ? '【1限】サポート' : '【2限】サポート',
    period: index % 3 === 0 ? '1限' : '2限', target_place: '診断用校舎', school: '112', school_id: '112',
  });
});

// 勤怠承認画面の理社配置照合・同日重複・該当実績ジャンプを実ブラウザで確認する固定データ。
put('shift_assignments', 'security-demo-shift-reconciliation-1', {
  target_date: addDays(today, -1), user_id: 'security-teacher-semi-dedicated', teacher_id: 'security-teacher-semi-dedicated',
  teacher_name: '診断用 準専任講師', role_type: 'main', target_grade: '中3', target_subject: '理科',
  target_detail_subject: '理社講座', period: '1限', note: '【1限】勤怠照合診断', school: '112', school_id: '112',
});
put('shift_assignments', 'security-demo-shift-reconciliation-2', {
  target_date: addDays(today, -1), user_id: 'security-teacher-semi-dedicated', teacher_id: 'security-teacher-semi-dedicated',
  teacher_name: '診断用 準専任講師', role_type: 'sub', target_grade: '中3', target_subject: '社会',
  target_detail_subject: '理社講座', period: '2限', note: '【2限】勤怠照合診断', school: '112', school_id: '112',
});

put('monthly_schedules', 'security-demo-schedule-exam', {
  title: '診断用 月例確認テスト', start_date: addDays(today, 6), end_date: addDays(today, 6),
  target_date: addDays(today, 6), audience: 'student_parent', category: 'exam', grades: ['中3'], description: '診断用の予定です。',
});
put('monthly_schedules', 'security-demo-schedule-break', {
  title: '診断用 休講期間', start_date: addDays(today, 14), end_date: addDays(today, 16),
  audience: 'all', category: 'holiday', grades: ['中3'], description: '診断用の複数日予定です。',
});

const homework = [
  ['security-demo-homework-upcoming','理科','化学変化とイオン',addDays(today, 3),'次回授業までに指定範囲を解いてください。'],
  ['security-demo-homework-submitted','社会','現代社会のしくみ',addDays(today, 1),'資料を確認して画像を提出してください。'],
  ['security-demo-homework-overdue','英語','長文読解',addDays(today, -2),'診断で期限切れ表示を確認する課題です。'],
];
homework.forEach(([id, subject, title, deadline, description]) => put('homework_assignments', id, {
  subject, title, target_grade: '中3', deadline, description, instructions: description,
  teacher_id: 'security-teacher-dedicated', teacher_name: '診断用 専任講師', created_at: timestampAt(addDays(today, -5)),
}));
put('submissions', 'security-demo-submission-approved', {
  assignment_id: 'security-demo-homework-submitted', student_id: 'security-student', student_name: '診断用 生徒',
  status: 'approved', submitted_at: timestampAt(today, 16), feedback: 'よくできています。',
});
put('submissions', 'security-demo-submission-pending', {
  assignment_id: 'security-demo-homework-upcoming', student_id: 'security-demo-student-2', student_name: '診断用 生徒B',
  status: 'pending', submitted_at: timestampAt(today, 15),
});

[
  ['security-demo-news-1','重要：診断環境のお知らせ','これは外部診断用の匿名テストデータです。','all',today],
  ['security-demo-news-2','次回授業について','次回授業の予定をカレンダーから確認できます。','student',addDays(today,-1)],
  ['security-demo-news-3','保護者向けご案内','出欠・宿題・小テスト状況をご確認ください。','parent',addDays(today,-2)],
].forEach(([id,title,content,target,date]) => put('announcements', id, {
  title, content, body: content, message: content, target, created_at: timestampAt(date, 10), created_by: 'security-admin',
}));

['security-master','security-admin','security-teacher-dedicated','security-teacher-semi-dedicated','security-student','security-parent'].forEach((uid, index) => {
  put('user_notifications', `security-demo-notification-${index}-unread`, {
    user_id: uid, title: '診断用：未読通知', message: '未読から既読への操作を確認できます。', kind: 'お知らせ', read: false, created_at: timestampAt(today, 11),
  });
  put('user_notifications', `security-demo-notification-${index}-read`, {
    user_id: uid, title: '診断用：確認済み通知', message: '既読通知の表示確認用です。', kind: 'システム', read: true, created_at: timestampAt(addDays(today,-1), 11),
  });
});

put('class_recordings', 'security-demo-recording-1', {
  target_date: addDays(today, -3), grade: '中3', subject: '理科', title: '診断用 理科授業録画',
  unit: '化学変化とイオン', detail_subject: '化学', recording_type: 'normal', school_year: academicYear,
  video_url: '', diagnostic_placeholder: true,
});
put('class_recordings', 'security-demo-recording-2', {
  target_date: addDays(today, -10), grade: '中3', subject: '社会', title: '診断用 定期テスト対策',
  unit: '公民', detail_subject: '現代社会', recording_type: 'test_prep', school_year: academicYear,
  video_url: '', diagnostic_placeholder: true,
});
put('recording_views', 'security-demo-recording-view', {
  user_id: 'security-student', student_id: 'security-student', recording_id: 'security-demo-recording-1',
  event_type: 'complete', watched_seconds: 2700, target_date: addDays(today, -2), created_at: timestampAt(addDays(today,-2), 20),
});

put('quest_results', 'security-demo-quest-pass', {
  student_id: 'security-student', grade: '中3', subject: '理科', unit_name: 'イオン', unit_stage_label: '標準',
  target_question_count: 10, mastered_question_count: 9, score: 90, is_passed: true, created_at: timestampAt(addDays(today,-2), 19),
});
put('quest_results', 'security-demo-quest-retry', {
  student_id: 'security-student', grade: '中3', subject: '社会', unit_name: '日本国憲法', unit_stage_label: '基礎',
  target_question_count: 10, mastered_question_count: 6, score: 60, is_passed: false, created_at: timestampAt(addDays(today,-5), 19),
});
put('coin_transactions', 'security-demo-coin-earned', { user_id: 'security-student', amount: 50, reason: '診断用クエスト合格', created_at: timestampAt(addDays(today,-2), 19) });
put('coin_transactions', 'security-demo-coin-bonus', { user_id: 'security-student', amount: 20, reason: '診断用ログインボーナス', created_at: timestampAt(addDays(today,-1), 8) });

put('community_topics', 'security-demo-community-thread', {
  title: '次の理科で復習したい単元は？', type: 'thread', is_approved: true, author_name: '診断用 生徒B',
  created_by: 'security-demo-student-2', likes: 3, liked_by: [], created_at: timestampAt(addDays(today,-2), 18),
});
put('community_topics', 'security-demo-community-vote', {
  title: '小テスト対策で使いたい教材', type: 'vote', is_approved: true, author_name: '診断用 生徒C',
  created_by: 'security-demo-student-3', options: ['一問一答','確認プリント','解説動画'], votes: { 0: 2, 1: 1, 2: 0 },
  voted_by: [], likes: 1, liked_by: [], created_at: timestampAt(addDays(today,-3), 18),
});
put('community_topics/security-demo-community-thread/comments', 'security-demo-comment-1', {
  text: '化学変化をもう一度確認したいです。', author_name: '診断用 生徒', user_id: 'security-student', created_at: timestampAt(addDays(today,-1), 18),
});
put('teacher_community_topics', 'security-demo-teacher-topic', {
  title: '中3クラスの引継ぎ事項', type: 'thread', is_approved: true, author_name: '診断用 専任講師',
  created_by: 'security-teacher-dedicated', likes: 1, liked_by: [], created_at: timestampAt(addDays(today,-1), 17),
});

[
  ['security-demo-reward-1','オリジナルノート',100],
  ['security-demo-reward-2','オリジナルペン',250],
  ['security-demo-reward-3','プレミアム景品',500],
].forEach(([id,name,required]) => put('rewards', id, { name, description: '診断用景品です。', required_coins: required, image_url: '', active: true }));

put('requests', 'security-demo-absence-request', {
  user_id: 'security-student', student_id: 'security-student', student_name: '診断用 生徒', type: 'absence',
  target_date: addDays(today, 5), date: addDays(today, 5), reason: '診断用の欠席申請（振替候補あり）', status: 'pending',
  transfer_selection_mode: 'student', transfer_status: 'waiting_student_selection', created_at: timestampAt(today, 12),
});
put('requests', 'security-demo-transfer-request', {
  user_id: 'security-student', student_id: 'security-student', student_name: '診断用 生徒', type: 'transfer',
  target_date: addDays(today, 10), requested_date: addDays(today, 12), reason: '診断用の振替申請', status: 'approved', created_at: timestampAt(addDays(today,-1), 12),
});
put('users/security-student/chat_history', 'security-demo-chat-1', {
  role: 'assistant', content: '診断用の学習アドバイス履歴です。', message: '診断用の学習アドバイス履歴です。', createdAt: timestampAt(addDays(today,-1), 18),
});

put('teacher_availability', 'security-demo-availability-dedicated', {
  teacher_id: 'security-teacher-dedicated', user_id: 'security-teacher-dedicated', teacher_name: '診断用 専任講師',
  available_date: addDays(today, 9), time_range: '18:00 - 22:00', workplace: '診断用校舎', location: '診断用校舎', roles: ['main'], status: 'possible',
});
put('teacher_availability', 'security-demo-availability-semi', {
  teacher_id: 'security-teacher-semi-dedicated', user_id: 'security-teacher-semi-dedicated', teacher_name: '診断用 準専任講師',
  available_date: addDays(today, 11), time_range: '19:00 - 22:00', workplace: '診断用校舎', location: '診断用校舎', roles: ['main','sub'], status: 'possible',
});
put('teacher_substitution_posts', 'security-demo-substitution-open', {
  created_by: 'security-admin', teacher_id: 'security-teacher-dedicated', teacher_name: '診断用 専任講師',
  target_date: addDays(today, 10), period: '1限', title: '中3理科 代行募集', detail: '診断用の代行返答操作を確認できます。',
  status: 'open', shift_assignment_id: 'security-demo-shift-main-4', created_at: timestampAt(today, 10),
});

put('work_records', 'security-demo-work-dedicated', {
  teacher_id: 'security-teacher-dedicated', teacher_name: '診断用 専任講師', date: addDays(today,-1),
  clock_in: `${addDays(today,-1)}T08:45:00+09:00`, clock_out: `${addDays(today,-1)}T19:10:00+09:00`,
  start_time: '08:45', end_time: '19:10', break_minutes: 60, status: 'completed', work_type: '専任', created_at: timestampAt(addDays(today,-1), 19),
});
put('work_records', 'security-demo-work-semi', {
  teacher_id: 'security-teacher-semi-dedicated', teacher_name: '診断用 準専任講師', date: addDays(today,-1),
  clock_in: `${addDays(today,-1)}T18:50:00+09:00`, clock_out: `${addDays(today,-1)}T22:05:00+09:00`,
  start_time: `${addDays(today,-1)}T18:50:00+09:00`, end_time: `${addDays(today,-1)}T22:05:00+09:00`,
  school_id: '112', school_name: '創造学園 オンライン校', break_minutes: 0, status: 'pending', detail_approval_status: 'pending', work_type: '準専任',
  transportation: [], transportation_status: 'none',
  work_segments: [
    { id: 'security-demo-segment-office', start: '18:50', end: '19:20', type: 'office', program: 'normal', office_task: 'lesson_preparation', school_id: '112', approval_status: 'pending' },
    { id: 'security-demo-segment-lesson', start: '19:20', end: '20:25', type: 'lesson', program: 'normal', grade: '中3', lesson_format: 'group', school_id: '112', approval_status: 'pending' },
  ],
  created_at: timestampAt(addDays(today,-1), 22),
});
put('attendance_correction_requests', 'security-demo-correction-pending', {
  work_record_id: 'security-demo-work-dedicated', request_type: 'clock_time',
  teacher_id: 'security-teacher-dedicated', teacher_name: '診断用 専任講師', target_date: addDays(today,-1),
  requested_start_time: `${addDays(today,-1)}T09:00:00+09:00`, requested_end_time: `${addDays(today,-1)}T19:00:00+09:00`,
  reason: '診断用の打刻修正依頼です。', status: 'pending', created_at: timestampAt(today, 9),
});

put('learning_units', 'security-demo-learning-unit-science', {
  grade: '中3', subject: '化学', unit_name: '化学変化とイオン', content: '電解質、イオン、電池の基本事項',
  source_slide_id: 'security-demo-slide-science', created_at: timestampAt(addDays(today,-4), 10),
});
put('learning_units', 'security-demo-learning-unit-social', {
  grade: '中3', subject: '公民', unit_name: '現代社会と政治', content: '日本国憲法、国会、内閣、裁判所の基本事項',
  source_slide_id: 'security-demo-slide-social', created_at: timestampAt(addDays(today,-5), 10),
});
put('learning_units', 'security-demo-learning-unit-ai', {
  grade: '中3', subject: '地学', unit_name: '天体の動き（AI生成確認用）',
  content: '地球の自転と公転、太陽と星の日周運動、季節による星座の見え方',
  source_slide_id: 'security-demo-slide-ai-generation', prebuilt_question_count: 0,
  created_at: timestampAt(addDays(today,-2), 10),
});
[
  ['security-demo-quiz-1','security-demo-slide-science','化学変化とイオン','水溶液中で電気を運ぶ粒子を何と呼びますか？','イオン',['原子核','分子式','中性子'],'水溶液中で電気を帯びて移動する粒子がイオンです。'],
  ['security-demo-quiz-2','security-demo-slide-science','化学変化とイオン','陽イオンが移動する電極はどちらですか？','陰極',['陽極','中性極','接地極'],'正の電荷を持つ陽イオンは陰極へ移動します。'],
  ['security-demo-quiz-3','security-demo-slide-social','現代社会と政治','国の唯一の立法機関はどこですか？','国会',['内閣','最高裁判所','地方議会'],'日本国憲法で国会は国権の最高機関かつ唯一の立法機関です。'],
  ['security-demo-quiz-4','security-demo-slide-social','現代社会と政治','行政権を担当する機関はどこですか？','内閣',['国会','裁判所','地方議会'],'行政権は内閣に属します。'],
].forEach(([id,slideId,unitName,question,correct,wrong,explanation]) => put('quizzes', id, {
  grade: '中3', subject: unitName.includes('イオン') ? '理科' : '社会', source_slide_id: slideId, unit_name: unitName,
  question, correct_answer: correct, wrong_answers: wrong, explanation, difficulty: 2, skill: '基礎確認', created_at: timestampAt(addDays(today,-3), 10),
}));

put('lesson_slides', 'security-demo-slide-science', {
  grade: '中3', subject: '化学', category: 'science', unit_name: '化学変化とイオン',
  content: '診断用教材。電解質とイオンの基本を確認します。', file_name: 'security-diagnosis-science-material.txt',
  file_path: 'lesson_slides/diagnosis/security-diagnosis-science-material.txt', file_size: 150,
  term: '3期', year: String(academicYear), month: today.slice(5,7), tags: ['診断用','化学'], slide_count: 1,
  created_at: timestampAt(addDays(today,-2), 10),
});
put('lesson_slides', 'security-demo-slide-social', {
  grade: '中3', subject: '公民', category: 'society', unit_name: '現代社会と政治',
  content: '診断用教材。国会、内閣、裁判所の基本を確認します。', file_name: 'security-diagnosis-social-material.txt',
  file_path: 'lesson_slides/diagnosis/security-diagnosis-social-material.txt', file_size: 150,
  term: '3期', year: String(academicYear), month: today.slice(5,7), tags: ['診断用','公民'], slide_count: 1,
  created_at: timestampAt(addDays(today,-3), 10),
});

students.forEach((student, index) => {
  const statuses = index === 2 ? ['欠','欠','未'] : index === 0 ? ['出','欠','出'] : ['出','出','出'];
  statuses.forEach((status, offset) => put('pf_records', `security-demo-legacy-pf-${index}-${offset}`, {
    student_id: student.id, student_name: student.name, year: String(year), week_number: String(offset + 1),
    attendance_status: status, science_hw: offset === 2 && index !== 1 ? '未' : '済', social_hw: index === 2 ? '未' : '済',
    target_date: addDays(today, offset - 2), school_id: '112', grade: '中3',
  }));
});
put('pf_resolutions', 'security-demo-pf-resolution', {
  student_id: 'security-demo-student-3', year: String(year), att: true, hw: false,
  note: '診断用：出欠について確認済み、宿題は対応中。', resolved_by: 'security-teacher-dedicated', updated_at: timestampAt(today, 14),
});

put('chat_logs', 'security-demo-chat-alert', {
  uid: 'security-student', role: 'user', student_name: '診断用 生徒', message: '診断用：先生に相談したい内容があります。',
  is_alert: true, is_broadcast: false, created_at: timestampAt(addDays(today,-1), 18),
});
put('chat_logs', 'security-demo-chat-teacher-reply', {
  uid: 'security-student', role: 'teacher', teacher_name: '診断用 専任講師', student_name: '診断用 生徒',
  message: '診断用：次回授業の前に確認しましょう。', is_alert: false, created_at: timestampAt(today, 9),
});
put('teacher_inquiries', 'security-demo-teacher-inquiry', {
  uid: 'security-student', student_id: 'security-student', student_name: '診断用 生徒',
  subject: '学習相談', message: '診断用の未読問い合わせです。', status: 'unread', created_at: timestampAt(today, 10),
});

const term = '3期';
const requestId = 'security-demo-registration-request';
const optionIds = ['security-demo-course-science','security-demo-course-social'];
put('course_registration_options', optionIds[0], {
  year: academicYear, term, term_label: term, grade: '中3', subject: '理科', course_name: '中3理科', title: '中3理科',
  day_of_week: '火', day: '火', period: '1限', slot: '1限', is_active: true, start_date: today, end_date: addDays(today,45), school: '112', school_id: '112',
});
put('course_registration_options', optionIds[1], {
  year: academicYear, term, term_label: term, grade: '中3', subject: '社会', course_name: '中3社会', title: '中3社会',
  day_of_week: '木', day: '木', period: '1限', slot: '1限', is_active: true, start_date: today, end_date: addDays(today,45), school: '112', school_id: '112',
});
put('annual_curriculum_schedules', 'security-demo-curriculum-science', {
  year: academicYear, term, grade: '中3', subject: '理科', course_name: '中3理科', unit: '化学変化とイオン', week_no: '1', start_date: today, end_date: addDays(today,45),
});
put('annual_curriculum_schedules', 'security-demo-curriculum-social', {
  year: academicYear, term, grade: '中3', subject: '社会', course_name: '中3社会', unit: '現代社会と政治', week_no: '1', start_date: today, end_date: addDays(today,45),
});
put('annual_lesson_schedules', 'security-demo-lessons-1', { year: academicYear, week_no: '1', lesson_no: '1', start_date: today, end_date: addDays(today,45) });
put('registration_requests', requestId, {
  request_kind: 'course_registration', type: 'course_registration', is_active: true,
  title: `${term} 受講講座登録（診断用）`, target_audience: 'grade', target_grades: ['中3'],
  period_start: addDays(today,-1), period_end: addDays(today,14), deadline: addDays(today,14),
  course_option_ids: optionIds, curriculum_term: term, created_by: 'security-admin', created_at: timestampAt(addDays(today,-1), 9),
});
put('course_registrations', 'security-demo-prior-course-registration', {
  student_id: 'security-student', student_name: '診断用 生徒', parent_id: 'security-parent',
  request_id: 'security-demo-prior-request', registration_request_id: 'security-demo-prior-request',
  selected_course_ids: ['security-demo-course-science'], status: 'registered',
  note: '過去登録の表示確認用です。現在受付中の依頼には回答済み扱いにしません。', created_at: timestampAt(addDays(today,-30), 10),
});

const batches = [];
for (let index = 0; index < docs.length; index += 400) batches.push(docs.slice(index, index + 400));
for (const group of batches) {
  const batch = db.batch();
  group.forEach(item => {
    const segments = item.collection.split('/');
    const ref = segments.length === 1
      ? db.collection(segments[0]).doc(item.id)
      : db.collection(segments[0]).doc(segments[1]).collection(segments[2]).doc(item.id);
    batch.set(ref, { ...item.data, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  });
  await batch.commit();
}

const bucket = getStorage().bucket(`${PROJECT_ID}.firebasestorage.app`);
await Promise.all([
  bucket.file('lesson_slides/diagnosis/security-diagnosis-science-material.txt').save(
    'ClassBase security diagnosis sample\nGrade: 中3\nSubject: 理科\nUnit: 化学変化とイオン\nThis file contains anonymous test data only.\n',
    { contentType: 'text/plain; charset=utf-8', resumable: false, metadata: { metadata: { diagnosis_test_data: 'true' } } },
  ),
  bucket.file('lesson_slides/diagnosis/security-diagnosis-social-material.txt').save(
    'ClassBase security diagnosis sample\nGrade: 中3\nSubject: 社会\nUnit: 現代社会と政治\nThis file contains anonymous test data only.\n',
    { contentType: 'text/plain; charset=utf-8', resumable: false, metadata: { metadata: { diagnosis_test_data: 'true' } } },
  ),
]);

console.log(`Seeded ${docs.length} diagnosis demo documents in ${PROJECT_ID} for ${today}.`);
