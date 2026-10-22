// Seeds realistic UI data for one school (112) into the LOCAL security emulators so the visual QA
// run (scripts/visual-qa/run.mjs) captures populated screens. Idempotent: every document uses a
// fixed `vqa-` id (or the account uid) and is overwritten on each run.
//
// Same safety stops as scripts/security/create-diagnosis-accounts.mjs: refuses unless the emulator
// hosts and project are the local demo ones. Run `npm run security:accounts` first.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = 'demo-classbase-security';
const root = process.cwd();
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
if (
  authEmulatorHost !== '127.0.0.1:9099' ||
  firestoreEmulatorHost !== '127.0.0.1:8085' ||
  (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS
) {
  console.error('Safety stop: this command only writes to the local security emulators.');
  process.exit(1);
}
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulatorHost;
process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulatorHost;
if (!getApps().length) initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();

// Confirm the emulator is really there (the admin SDK would otherwise hang/retry).
const probe = await fetch(`http://${authEmulatorHost}/emulator/v1/projects/${projectId}/config`).catch(() => null);
if (!probe || !probe.ok) {
  console.error('Safety stop: the local auth emulator is not reachable. Run `npm run security:start` first.');
  process.exit(1);
}
const diagnosisAccountsPath = path.join(root, '.security-diagnosis-accounts.json');
if (!fs.existsSync(diagnosisAccountsPath)) {
  console.error('Missing .security-diagnosis-accounts.json. Run `npm run security:accounts` first.');
  process.exit(1);
}

// ---- dates (Asia/Tokyo) ------------------------------------------------------------------------
const jstDateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const now = new Date();
const today = jstDateKey(now);
const addDays = (key, days) => {
  const d = new Date(`${key}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return jstDateKey(d);
};
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const weekdayOf = (key) => WEEKDAYS[new Date(`${key}T12:00:00+09:00`).getUTCDay()];
const todayWeekday = weekdayOf(today);
const ts = (key, time = '12:00') => Timestamp.fromDate(new Date(`${key}T${time}:00+09:00`));
const iso = (key, time = '12:00') => new Date(`${key}T${time}:00+09:00`).toISOString();
const year = Number(today.slice(0, 4));
const thisMonth = today.slice(0, 7);

// ---- school ------------------------------------------------------------------------------------
const SCHOOL_NAME = '創造学園 オンライン校';
const school = { school: SCHOOL_NAME, school_id: '112', school_code: '112', school_name: SCHOOL_NAME, school_ids: ['112'] };

// Canonical courses per grade (period mapping follows lib/course-registration-match.ts).
const COURSES = {
  中1: [{ subject: '社会', course: '地理', period: 1, unit: '世界の気候と人々の暮らし' }, { subject: '理科', course: '生物', period: 2, unit: '植物のつくりとはたらき' }],
  中2: [{ subject: '理科', course: '化学', period: 1, unit: '化学変化と原子・分子' }, { subject: '社会', course: '歴史', period: 2, unit: '江戸幕府の成立と鎖国' }],
  中3: [{ subject: '理科', course: '物理', period: 1, unit: '運動とエネルギー' }, { subject: '社会', course: '公民', period: 2, unit: '日本国憲法と基本的人権' }],
};
const PERIOD_TIMES = { 1: ['19:20', '20:25'], 2: ['20:35', '21:40'] };
const courseKey = (grade, c, weekday) => `course_${grade}_${c.subject}_${c.course}_${weekday}_${c.period}限`;

// ---- accounts ------------------------------------------------------------------------------------
const T_SEMI = 'security-teacher-semi-dedicated';
const T_DED = 'security-teacher-dedicated';
const STUDENTS = [
  { uid: 'security-student', login_id: '90000001', name: '佐藤 陽菜', kana: 'さとう ひな', grade: '中3', parent: 'security-parent', coins: 1280 },
  { uid: 'security-student-2', login_id: '90000002', name: '鈴木 大翔', kana: 'すずき ひろと', grade: '中3', parent: 'vqa-parent-2', coins: 640 },
  { uid: 'vqa-student-3', login_id: '90000003', name: '高橋 結衣', kana: 'たかはし ゆい', grade: '中2', parent: 'security-parent', coins: 920 },
  { uid: 'vqa-student-4', login_id: '90000004', name: '田中 蓮', kana: 'たなか れん', grade: '中2', parent: 'vqa-parent-2', coins: 150 },
  { uid: 'vqa-student-5', login_id: '90000005', name: '伊藤 さくら', kana: 'いとう さくら', grade: '中2', parent: null, coins: 2210 },
  { uid: 'vqa-student-6', login_id: '90000006', name: '渡辺 悠真', kana: 'わたなべ ゆうま', grade: '中1', parent: null, coins: 30 },
  { uid: 'vqa-student-7', login_id: '90000007', name: '山本 美咲（長い名前の表示確認用）', kana: 'やまもと みさき', grade: '中1', parent: null, coins: 480 },
  { uid: 'vqa-student-8', login_id: '90000008', name: '中村 湊', kana: 'なかむら みなと', grade: '中3', parent: null, coins: 0 },
];
const PARENTS = [
  { uid: 'security-parent', login_id: 'security_parent', name: '佐藤 真由美' },
  { uid: 'vqa-parent-2', login_id: 'vqa_parent_2', name: '鈴木 健一' },
];
const studentsOf = (parentUid) => STUDENTS.filter(s => s.parent === parentUid);
const shortName = (s) => s.name.replace(/（.*）/, '');

// Auth users for accounts that do not exist in create-diagnosis-accounts (not used for login).
const visualAccountsPath = path.join(root, '.visual-qa', 'accounts.json');
fs.mkdirSync(path.dirname(visualAccountsPath), { recursive: true });
const storedVisual = fs.existsSync(visualAccountsPath) ? JSON.parse(fs.readFileSync(visualAccountsPath, 'utf8')) : { accounts: [] };
const visualAccounts = [];
async function ensureAuthUser(uid, loginId, displayName, role) {
  const existing = storedVisual.accounts.find(a => a.uid === uid);
  const password = existing?.password || `Q9!${crypto.randomBytes(18).toString('base64url')}`;
  const email = `${loginId}@classbase.local`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email, password, displayName, disabled: false });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid, email, password, displayName, disabled: false });
  }
  visualAccounts.push({ uid, login_id: loginId, email, password, role });
}

const batchWriter = () => {
  let batch = db.batch();
  let count = 0;
  let total = 0;
  return {
    set(ref, data, options = {}) {
      batch.set(ref, data, options);
      count += 1; total += 1;
    },
    async flushIfNeeded() {
      if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
    },
    async commit() { if (count) await batch.commit(); batch = db.batch(); count = 0; return total; },
  };
};
const w = batchWriter();
const col = (name) => db.collection(name);

// ---- settings / gating ---------------------------------------------------------------------------
const allTrue = (keys) => Object.fromEntries(keys.map(k => [k, true]));
w.set(col('settings').doc('portal_visibility'), {
  student: allTrue(['adaptiveQuest', 'chat', 'homework', 'recordings', 'absence', 'transfer', 'calendar', 'changeRequest', 'community', 'ocrQuiz', 'news', 'notifications', 'settings', 'shop', 'history']),
  parent: allTrue(['homework', 'attendance', 'absence', 'transfer', 'recordings', 'aiMessages', 'announcements', 'calendar', 'contact', 'notificationSettings', 'notifications', 'settings', 'courseRegistration']),
  teacher: allTrue(['dashboard', 'work', 'attendance', 'shifts', 'substitutions', 'community', 'notifications', 'settings', 'news', 'calendar', 'chat', 'contacts', 'homework', 'pf', 'riskMonitor', 'slides', 'students']),
  admin: allTrue(['users', 'schoolStudents', 'sso', 'shifts', 'monthlySchedules', 'attendance', 'attendanceDiagnostics', 'substitutions', 'announcements', 'requests', 'parentInquiries', 'registrationTasks', 'curriculum', 'pf', 'recordings', 'slides', 'community', 'rewards', 'stats', 'betaAnalytics', 'surveySettings', 'imports', 'delete', 'line', 'notifications', 'settings']),
  updated_at: Timestamp.now(),
}, { merge: true });
w.set(col('settings').doc('class_button'), { period1_start: '19:20', period1_end: '20:25', period2_start: '20:35', period2_end: '21:40', show_before_minutes: 30, show_after_minutes: 30 }, { merge: true });
w.set(col('settings').doc('global'), { current_week: '12', current_year: year }, { merge: true });
w.set(col('system_status').doc('global'), { is_maintenance: false }, { merge: true });

// ---- users ---------------------------------------------------------------------------------------
for (const s of STUDENTS) {
  const courses = COURSES[s.grade];
  const science = courses.find(c => c.subject === '理科').course;
  const social = courses.find(c => c.subject === '社会').course;
  if (!s.uid.startsWith('security-')) await ensureAuthUser(s.uid, s.login_id, shortName(s), 'student');
  w.set(col('users').doc(s.uid), {
    uid: s.uid, role: 'student', name: s.name, displayName: s.name, student_name: s.name, student_name_kana: s.kana,
    lifetime_id: s.login_id, initial_login_id: s.login_id, email: `${s.login_id}@classbase.local`,
    status: 'active', account_status: 'active', isFirstLogin: false,
    ...school, classroom: SCHOOL_NAME,
    grade: s.grade, day_of_week: todayWeekday, subjects: ['理科', '社会'], subject_science: science, subject_social: social,
    parent_uid: s.parent || null, parent_ids: s.parent ? [s.parent] : [],
    active_course_registration_id: `vqa-reg-${s.uid}`, course_registration_year: year, course_registration_term: 'term',
    selected_course_keys: courses.map(c => courseKey(s.grade, c, todayWeekday)), selected_course_ids: [],
    coins: s.coins, total_coins: s.coins + 300, login_count: 42, login_streak: 5, best_login_streak: 12,
    quest_clear_count: 18, recording_complete_count: 7, earned_badges: [], owned_cosmetics: [],
    course_start_month: `${year}-04`, member_type: 'enrolled', last_login: ts(today, '18:30'),
    visual_qa_seed: true, updated_at: Timestamp.now(),
  }, { merge: true });
}
for (const p of PARENTS) {
  if (!p.uid.startsWith('security-')) await ensureAuthUser(p.uid, p.login_id, p.name, 'parent');
  w.set(col('users').doc(p.uid), {
    uid: p.uid, role: 'parent', name: p.name, displayName: p.name, parent_name: p.name,
    lifetime_id: p.login_id, initial_login_id: p.login_id, email: `${p.login_id}@classbase.local`,
    status: 'active', account_status: 'active', isFirstLogin: false, ...school,
    student_ids: studentsOf(p.uid).map(s => s.uid), visual_qa_seed: true, updated_at: Timestamp.now(),
  }, { merge: true });
}
const TEACHERS = [
  { uid: T_SEMI, name: '小林 誠', category: 'semi_dedicated', manager: false },
  { uid: T_DED, name: '加藤 由美子', category: 'dedicated', manager: true },
];
for (const t of TEACHERS) {
  w.set(col('users').doc(t.uid), {
    role: 'teacher', name: t.name, displayName: t.name, teacher_name: t.name, ...school,
    employment_category: t.category, enabled_programs: ['science_social'], attendance_school_manager: t.manager,
    status: 'active', account_status: 'active', isFirstLogin: false, visual_qa_seed: true, updated_at: Timestamp.now(),
  }, { merge: true });
}
for (const uid of ['security-master', 'security-master-2', 'security-admin']) {
  w.set(col('users').doc(uid), { isFirstLogin: false, account_status: 'active' }, { merge: true });
}
const teacherName = (uid) => TEACHERS.find(t => t.uid === uid).name;

// ---- shift assignments (today ±, 1限/2限 per grade) ----------------------------------------------
const shiftDates = [-7, 0, 7, 14].map(offset => addDays(today, offset));
const shiftIds = {};
let meetingSeq = 0;
for (const date of shiftDates) {
  for (const grade of ['中1', '中2', '中3']) {
    for (const c of COURSES[grade]) {
      meetingSeq += 1;
      const teacher = (grade === '中2' || c.period === 2) ? T_SEMI : T_DED;
      const id = `vqa-shift-${date}-${grade}-${c.period}`;
      shiftIds[`${date}|${grade}|${c.period}`] = id;
      const meetingId = `8${String(1234567000 + meetingSeq).padStart(10, '0')}`;
      w.set(col('shift_assignments').doc(id), {
        target_date: date, period: c.period, note: `【${c.period}限】`, role_type: 'main',
        user_id: teacher, teacher_name: teacherName(teacher),
        target_grade: grade, target_subject: c.subject, target_detail_subject: c.course, unit: c.unit,
        target_place: c.period === 1 ? 'スタジオA' : 'スタジオB',
        target_meeting_id: meetingId, target_password: '123456',
        target_signin_address: `${teacher}@classbase.local`, target_join_url: `https://zoom.us/j/${meetingId}`,
        school_id: '112', created_at: iso(addDays(date, -10)),
      });
      if (date === today && grade === '中2') {
        // a sub teacher row for the dashboard grouping
        w.set(col('shift_assignments').doc(`${id}-sub`), {
          target_date: date, period: c.period, note: `【${c.period}限】`, role_type: 'sub', parent_id: id,
          user_id: T_DED, teacher_name: teacherName(T_DED), target_grade: grade, target_subject: c.subject,
          target_detail_subject: c.course, unit: c.unit, target_place: 'サブ席', school_id: '112', created_at: iso(addDays(date, -10)),
        });
      }
    }
  }
}

// ---- course registrations --------------------------------------------------------------------------
for (const s of STUDENTS) {
  const courses = COURSES[s.grade];
  w.set(col('course_registrations').doc(`vqa-reg-${s.uid}`), {
    student_id: s.uid, student_name: s.name, parent_id: s.parent || null, grade: s.grade, ...school,
    year, term: 'term', term_label: `${year}年度 後期`, registration_type: 'regular',
    status: 'active', is_current: true, current: true, approval_status: 'not_required',
    selected_course_ids: courses.map(c => shiftIds[`${today}|${s.grade}|${c.period}`]),
    selected_course_keys: courses.map(c => courseKey(s.grade, c, todayWeekday)),
    selected_course_labels: courses.map(c => `${s.grade} ${c.subject} ${c.course} / ${todayWeekday}曜 ${c.period}限`),
    created_at: ts(addDays(today, -40)), updated_at: ts(addDays(today, -3)),
  });
}

// ---- teacher availability / substitutions --------------------------------------------------------
for (const t of TEACHERS) {
  const day = (status) => (status === 'available'
    ? { status, start_time: '19:00', end_time: '22:00', workplace: 'オンライン', roles: ['main'], note: '' }
    : { status, start_time: '', end_time: '', workplace: '', roles: [], commitment_type: '本業', commitment_end_time: '18:00', note: '平日は本業あり' });
  w.set(col('teacher_availability_profiles').doc(t.uid), {
    teacher_id: t.uid, user_id: t.uid, teacher_name: t.name,
    weekdays: { mon: day('available'), tue: day('after_commitment'), wed: day('available'), thu: day('unavailable'), fri: day('available'), sat: day('unavailable'), sun: day('unavailable') },
    updated_at: Timestamp.now(),
  });
  for (let i = 0; i < 4; i += 1) {
    const date = addDays(today, i * 2 + 1);
    w.set(col('teacher_availability').doc(`vqa-avail-${t.uid}-${i}`), {
      teacher_id: t.uid, user_id: t.uid, teacher_name: t.name, available_date: date, time_range: '19:00-22:00',
      workplace: 'オンライン', location: 'オンライン', roles: ['main'], status: 'possible', note: i === 1 ? '20時以降のみ' : '', created_at: iso(today),
    });
  }
}
w.set(col('teacher_substitution_posts').doc('vqa-sub-1'), {
  target_date: addDays(today, 7), period: '2限', title: '中2 社会 歴史', detail: '家庭の事情で代講をお願いしたいです。資料は共有フォルダにあります。',
  status: 'open', teacher_id: T_SEMI, teacher_name: teacherName(T_SEMI), requester_id: T_SEMI, requested_by_teacher: true, created_by: T_SEMI,
  shift_assignment_id: shiftIds[`${addDays(today, 7)}|中2|2`], shift_summary: { grade: '中2', subject: '社会', course: '歴史', period: 2 },
  created_at: ts(addDays(today, -1)),
});
w.set(col('teacher_substitution_posts').doc('vqa-sub-2'), {
  target_date: addDays(today, 14), period: '1限', title: '中3 理科 物理', detail: '研修参加のため',
  status: 'claimed', teacher_id: T_DED, teacher_name: teacherName(T_DED), requester_id: T_DED, requested_by_teacher: true, created_by: T_DED,
  shift_assignment_id: shiftIds[`${addDays(today, 14)}|中3|1`], claimed_by: T_SEMI, claimed_by_name: teacherName(T_SEMI), created_at: ts(addDays(today, -4)),
});

// ---- work records / attendance corrections --------------------------------------------------------
const workDays = [-14, -7, -2, -1, 0].map(o => addDays(today, o));
for (const t of TEACHERS) {
  workDays.forEach((date, index) => {
    const isToday = date === today;
    const status = isToday ? 'pending' : index < 2 ? 'approved' : 'pending';
    w.set(col('work_records').doc(`vqa-work-${t.uid}-${date}`), {
      teacher_id: t.uid, teacher_name: t.name, ...school, date,
      start_time: iso(date, '19:00'), end_time: isToday ? null : iso(date, '21:50'),
      status, attendance_kind: 'normal', default_program: 'science_social', workplace_type: 'online',
      work_segments: isToday ? [] : [
        { id: 'seg1', start: '19:00', end: '19:20', type: 'office', program: 'science_social', grade: '', school_id: '112', approval_status: status === 'approved' ? 'approved' : 'pending' },
        { id: 'seg2', start: '19:20', end: '20:25', type: 'lesson', program: 'science_social', grade: '中2', school_id: '112', approval_status: status === 'approved' ? 'approved' : 'pending' },
        { id: 'seg3', start: '20:25', end: '20:35', type: 'break', program: 'science_social', grade: '', school_id: '112', approval_status: status === 'approved' ? 'approved' : 'pending' },
        { id: 'seg4', start: '20:35', end: '21:40', type: 'lesson', program: 'science_social', grade: '中3', school_id: '112', approval_status: status === 'approved' ? 'approved' : 'pending' },
      ],
      detail_approval_status: status === 'approved' ? 'approved' : 'pending',
      transportation: [], transportation_status: index % 2 ? 'none' : 'entered',
      created_at: iso(date, '19:00'),
    });
  });
}
w.set(col('attendance_correction_requests').doc('vqa-corr-1'), {
  teacher_id: T_SEMI, teacher_name: teacherName(T_SEMI), ...school, target_date: addDays(today, -2), request_type: 'time_correction',
  requested_start_time: iso(addDays(today, -2), '18:55'), requested_end_time: iso(addDays(today, -2), '21:55'), reason: '退勤打刻を押し忘れたため', status: 'pending',
  work_record_id: `vqa-work-${T_SEMI}-${addDays(today, -2)}`, created_at: ts(addDays(today, -1)),
});

// ---- student attendance (class participation) -----------------------------------------------------
const pastLessonDays = [-28, -21, -14, -7].map(o => addDays(today, o));
STUDENTS.forEach((s, si) => {
  pastLessonDays.forEach((date, di) => {
    const absent = (si + di) % 5 === 4;
    const c = COURSES[s.grade][0];
    w.set(col('attendance').doc(`${s.uid}_${date}`), {
      user_id: s.uid, student_id: s.uid, student_name: s.name, ...school, target_date: date,
      type: absent ? 'absent' : (si + di) % 7 === 3 ? '遅刻' : 'joined', subject: c.subject, course_name: c.course,
      participation_subjects: absent ? [] : COURSES[s.grade].map(x => x.subject),
      participations: absent ? [] : COURSES[s.grade].map(x => ({ class_id: shiftIds[`${date}|${s.grade}|${x.period}`] || '', target_date: date, subject: x.subject, course_name: x.course })),
      created_at: ts(date, '19:25'), updated_at: ts(date, '21:40'),
    });
  });
  w.set(col('pf_records').doc(`vqa-pf-${s.uid}`), { student_id: s.uid, week_number: '12', attendance_status: si % 4 === 3 ? '欠' : '出', ...school });
});

// ---- requests: absence / transfer / change / exchange ----------------------------------------------
const [s1, s2, s3, s4] = STUDENTS;
const absenceDate = addDays(today, 7);
w.set(col('requests').doc('vqa-absence-1'), {
  type: 'absence', user_id: s1.uid, student_id: s1.uid, student_name: s1.name, parent_id: s1.parent, parent_name: '佐藤 真由美', ...school,
  source: 'parent_portal', absence_type: 'absent', target_date: absenceDate,
  content: '【欠席連絡】\n部活動の大会のため欠席します。振替を希望します。', reason: '部活動の大会',
  transfer_status: 'registered', transfer_selection_mode: 'parent', transfer_request_id: 'vqa-transfer-1', transfer_required_by_parent: true,
  status: 'completed', created_at: ts(addDays(today, -2), '20:10'), updated_at: ts(addDays(today, -2), '20:12'),
});
w.set(col('requests').doc('vqa-transfer-1'), {
  type: 'transfer', user_id: s1.uid, student_id: s1.uid, student_name: s1.name, parent_id: s1.parent, ...school,
  absence_request_id: 'vqa-absence-1', absence_date: absenceDate, target_date: addDays(today, 14),
  transfer_shift_id: shiftIds[`${addDays(today, 14)}|中3|1`], target_shift_id: shiftIds[`${addDays(today, 14)}|中3|1`],
  transfer_subject: '理科', transfer_course_name: '物理', transfer_unit: '運動とエネルギー', transfer_period: 1,
  transfer_meeting_id: '81234567890', status: 'confirmed', transfer_status: 'registered',
  created_at: ts(addDays(today, -2), '20:12'), updated_at: ts(addDays(today, -2), '20:12'),
});
w.set(col('requests').doc('vqa-absence-2'), {
  type: 'absence', user_id: s3.uid, student_id: s3.uid, student_name: s3.name, parent_id: s3.parent, parent_name: '佐藤 真由美', ...school,
  source: 'student_portal', absence_type: 'late', target_date: today,
  content: '【遅刻連絡】\n塾の補講があり、20時ごろ参加します。', reason: '補講',
  transfer_status: null, transfer_selection_mode: null, status: 'pending',
  created_at: ts(today, '17:40'), updated_at: ts(today, '17:40'),
});
w.set(col('requests').doc('vqa-absence-3'), {
  type: 'absence', user_id: s2.uid, student_id: s2.uid, student_name: s2.name, parent_id: s2.parent, parent_name: '鈴木 健一', ...school,
  source: 'parent_portal', absence_type: 'absent', target_date: addDays(today, 7),
  content: '【欠席連絡】\n体調不良のため欠席します。', reason: '体調不良',
  transfer_status: 'waiting_student_selection', transfer_selection_mode: 'student', status: 'pending',
  created_at: ts(addDays(today, -1), '08:15'), updated_at: ts(addDays(today, -1), '08:15'),
});
w.set(col('requests').doc('vqa-change-1'), {
  type: 'change', user_id: s4.uid, student_id: s4.uid, student_name: s4.name, ...school, status: 'pending',
  target_day: '水', target_science: '化学', target_social: '歴史', content: '曜日変更の希望（習い事の曜日が変わったため）',
  created_at: ts(addDays(today, -3)), updated_at: ts(addDays(today, -3)),
});
w.set(col('requests').doc('vqa-exchange-1'), {
  type: 'exchange', user_id: STUDENTS[4].uid, student_id: STUDENTS[4].uid, student_name: STUDENTS[4].name, userName: STUDENTS[4].name, ...school,
  status: 'preparing', rewardName: '図書カード 500円分', cost: 500, created_at: ts(addDays(today, -5)), updated_at: ts(addDays(today, -4)),
});

// ---- announcements / notifications ------------------------------------------------------------------
const ANNOUNCEMENTS = [
  { id: 'vqa-ann-1', title: '【重要】冬期講習の申込受付を開始しました', label: 'important', target: 'all', days: -1, content: '冬期講習（12/24〜1/6）の申込受付を開始しました。保護者ページの「受講登録」から11月30日までにお申し込みください。' },
  { id: 'vqa-ann-2', title: '定期テスト対策授業のお知らせ', label: 'event', target: 'student', days: -3, content: '11月の定期テストに向けて、対策授業を実施します。対象範囲は各学年の授業ページをご確認ください。' },
  { id: 'vqa-ann-3', title: 'Zoomアプリの更新をお願いします', label: 'alert', target: 'parent', days: -5, content: '授業に参加できない事例が報告されています。Zoomアプリを最新版に更新してください。' },
  { id: 'vqa-ann-4', title: '講師向け：勤怠入力ルールの変更', label: 'info', target: 'teacher', days: -2, content: '11月から休憩時間の入力が必須になります。' },
];
for (const a of ANNOUNCEMENTS) {
  w.set(col('announcements').doc(a.id), {
    title: a.title, content: a.content, target: a.target, label: a.label, school_ids: ['112'], grades: [], attachments: [],
    publish_at: ts(addDays(today, a.days), '09:00'), status: 'published', archived: false, read_count: 3,
    created_by: 'security-master', created_at: ts(addDays(today, a.days), '09:00'), updated_at: ts(addDays(today, a.days), '09:00'),
  });
}
const notify = (id, userId, role, title, message, kind, link, days, read = false) => w.set(col('user_notifications').doc(id), {
  user_id: userId, role, title, message, kind, link, read, read_at: read ? ts(addDays(today, days), '21:00') : null, created_at: ts(addDays(today, days), '18:00'),
});
notify('vqa-n-1', s1.uid, 'student', 'まもなく授業が始まります', `今日の1限「中3 理科 物理」は19:20開始です。`, 'class_start', '/student', 0);
notify('vqa-n-2', s1.uid, 'student', '振替が登録されました', '来週の欠席分の振替授業が登録されました。', 'transfer', '/student/absence', -2, true);
notify('vqa-n-3', 'security-parent', 'parent', 'お問い合わせに返信がありました', 'サポートセンターから返信が届きました。', 'parent_inquiry', '/parent/contact', -1);
notify('vqa-n-4', 'security-parent', 'parent', '欠席連絡を受け付けました', `${absenceDate} の欠席連絡を受け付けました。`, 'absence', '/parent', -2, true);
notify('vqa-n-5', T_SEMI, 'teacher', '代講募集が投稿されました', '中2 社会 歴史（2限）の代講者を募集しています。', 'substitution', '/teacher/substitutions', -1);
w.set(col('safety_alerts').doc('vqa-safety-1'), {
  student_id: STUDENTS[5].uid, student_name: STUDENTS[5].name, ...school, category: 'stress', category_label: '強いストレス', severity: 'medium',
  excerpt: 'テストのことを考えると眠れない…', status: 'open', created_at: ts(addDays(today, -1), '22:10'),
});

// ---- parent inquiry thread ---------------------------------------------------------------------------
w.set(col('parent_inquiries').doc('vqa-inq-1'), {
  parent_id: 'security-parent', parent_name: '佐藤 真由美', subject: '振替授業の参加方法について', category: 'absence',
  student_id: s1.uid, student_name: s1.name, content: '来週の振替授業はどのZoomに入ればよいでしょうか。',
  status: 'answered', destination: 'support_center', school_id: '112', school_name: SCHOOL_NAME,
  messages: [
    { sender_role: 'parent', sender_id: 'security-parent', sender_name: '佐藤 真由美', text: '来週の振替授業はどのZoomに入ればよいでしょうか。', created_at_iso: iso(addDays(today, -2), '20:30') },
    { sender_role: 'staff', sender_id: 'security-master', sender_name: 'サポートセンター', text: 'お問い合わせありがとうございます。振替授業は生徒ページのホームに「参加する」ボタンが表示されますので、そちらから入室してください。', created_at_iso: iso(addDays(today, -1), '10:05') },
    { sender_role: 'parent', sender_id: 'security-parent', sender_name: '佐藤 真由美', text: '承知しました。ありがとうございます。', created_at_iso: iso(addDays(today, -1), '12:40') },
  ],
  message_count: 3, unread_for_admin: true, unread_for_parent: false,
  created_at: ts(addDays(today, -2), '20:30'), updated_at: ts(addDays(today, -1), '12:40'),
});
w.set(col('parent_inquiries').doc('vqa-inq-2'), {
  parent_id: 'vqa-parent-2', parent_name: '鈴木 健一', subject: 'ログインできません', category: 'account',
  student_id: s2.uid, student_name: s2.name, content: '子どもがパスワードを忘れてしまいログインできません。再発行をお願いできますか。',
  status: 'open', destination: 'support_center', school_id: '112', school_name: SCHOOL_NAME,
  messages: [{ sender_role: 'parent', sender_id: 'vqa-parent-2', sender_name: '鈴木 健一', text: '子どもがパスワードを忘れてしまいログインできません。再発行をお願いできますか。', created_at_iso: iso(today, '07:50') }],
  message_count: 1, unread_for_admin: true, unread_for_parent: false, created_at: ts(today, '07:50'), updated_at: ts(today, '07:50'),
});

// ---- coins ---------------------------------------------------------------------------------------------
for (const s of STUDENTS.slice(0, 4)) {
  [[-3, 10, 'ログインボーナス', 'daily_login'], [-2, 30, '録画視聴完了', 'recording'], [-1, 20, 'クエストクリア', 'quest'], [-1, -100, 'ガチャ', 'gacha']].forEach(([d, amount, reason, source], i) => {
    w.set(col('coin_transactions').doc(`${s.uid}_vqa_${i}`), {
      user_id: s.uid, amount, reason, source, source_id: `vqa-${i}`, actor_id: s.uid, created_at: ts(addDays(today, d), '20:00'),
    });
  });
}

// ---- PF study progress / learning records / homework --------------------------------------------------
STUDENTS.forEach((s, si) => {
  const history = Array.from({ length: 6 }, (_, i) => {
    const date = addDays(today, -7 * (5 - i));
    const total = 40 + i * (12 + si) ;
    return { date, total, gained: i === 0 ? 0 : 12 + si, books_studied: 2 + (i % 2), import_id: `vqa-import-${i}` };
  });
  const total = history[history.length - 1].total;
  w.set(col('pf_study_progress').doc(s.uid), {
    books: {
      'vqa-book-sci': { name: `${s.grade} 理科 一問一答（${COURSES[s.grade].find(c => c.subject === '理科').course}）`, count: Math.round(total * 0.6), classes: [] },
      'vqa-book-soc': { name: `${s.grade} 社会 重要語句チェック`, count: Math.round(total * 0.4), classes: [] },
    },
    previous_books: {}, previous_snapshot_date: history[history.length - 2].date, last_snapshot_date: history[history.length - 1].date,
    total_count: total, book_count: 2, history, updated_at: Timestamp.now(),
  });
  [-6, -3, -1].forEach((d, i) => {
    w.set(col('pf_learning_records').doc(`vqa-pfl-${s.uid}-${i}`), {
      student_id: s.uid, date: addDays(today, d), kind: i === 1 ? 'quiz' : 'homework', title: i === 1 ? '確認テスト' : `宿題プリント ${i + 1}`,
      status: '提出済', completed: true, score: i === 1 ? 70 + si * 3 : null,
    });
  });
});
for (const grade of ['中1', '中2', '中3']) {
  COURSES[grade].forEach((c, i) => {
    w.set(col('homework_assignments').doc(`vqa-hw-${grade}-${i}`), {
      target_grade: grade, subject: c.subject, title: `${c.unit} 確認プリント（ノートの写真を提出）`, deadline: addDays(today, 3 + i),
      class_date: addDays(today, -7), status: 'active', archived: false, created_at: ts(addDays(today, -7)),
    });
  });
}
w.set(col('submissions').doc('vqa-sub-hw-1'), {
  student_id: s1.uid, student_name: s1.name, assignment_id: 'vqa-hw-中3-0', status: 'pending', submitted_at: iso(addDays(today, -1), '21:50'),
  title: '運動とエネルギー 確認プリント', comment: '問3がわかりませんでした',
});

// ---- review period ----------------------------------------------------------------------------------------
w.set(col('review_periods').doc('vqa-review-1'), {
  name: '2学期中間テスト 復習期間', start_date: addDays(today, -2), end_date: addDays(today, 12), subjects: ['理科', '社会'], status: 'active',
  items: [
    { id: 'review_a', date: addDays(today, 2), weekday: weekdayOf(addDays(today, 2)), subject: '理科', unit: '化学変化と原子・分子', grade: '中2', time: '19:20-20:25', lesson: '第1回', level: '通常' },
    { id: 'review_b', date: addDays(today, 3), weekday: weekdayOf(addDays(today, 3)), subject: '社会', unit: '日本国憲法と基本的人権', grade: '中3', time: '20:35-21:40', lesson: '第1回', level: '通常' },
    { id: 'review_c', date: addDays(today, 4), weekday: weekdayOf(addDays(today, 4)), subject: '理科', unit: '運動とエネルギー（総まとめ・応用問題演習）', grade: '中3', time: '19:20-20:25', lesson: '第2回', level: '応用' },
    { id: 'review_d', date: addDays(today, 5), weekday: weekdayOf(addDays(today, 5)), subject: '社会', unit: '世界の気候', grade: '全学年', time: '20:35-21:40', lesson: '第1回', level: '通常' },
  ],
  created_at: ts(addDays(today, -10)), updated_at: ts(addDays(today, -10)),
});
w.set(col('review_period_selections').doc(`vqa-review-1_${s1.uid}`), { period_id: 'vqa-review-1', student_id: s1.uid, grade: s1.grade, item_ids: ['review_b'] });

// ---- recordings ---------------------------------------------------------------------------------------------
let recSeq = 0;
for (const date of [-28, -21, -14, -7].map(o => addDays(today, o))) {
  for (const grade of ['中1', '中2', '中3']) {
    for (const c of COURSES[grade]) {
      recSeq += 1;
      const id = `vqa-rec-${date}-${grade}-${c.period}`;
      w.set(col('class_recordings').doc(id), {
        target_date: date, grade, subject: c.subject, detail_subject: c.course, title: `${grade} ${c.subject}（${c.course}）${c.unit}`, unit: c.unit,
        period: c.period, recording_type: 'regular', school_year: year, status: 'published', is_active: true, archived: false,
        video_url: `https://zoom.us/rec/share/vqa-fake-${recSeq}`, recording_meeting_id: `8123456${String(recSeq).padStart(4, '0')}`,
        zoom_recording_file_id: `vqa-file-${recSeq}`, trim_start_seconds: 0, recording_duration_seconds: 3900, school_ids: ['112'],
        created_at: ts(date, '22:00'),
      });
      if (grade === '中3' && recSeq % 2 === 0) {
        w.set(col('recording_views').doc(`${s1.uid}_${id}`), {
          user_id: s1.uid, recording_id: id, status: recSeq % 4 === 0 ? 'completed' : 'in_progress', credited_seconds: 1800, watched_seconds: 2100,
          duration_seconds: 3900, started_at: ts(addDays(date, 1), '19:00'), completed_at: recSeq % 4 === 0 ? ts(addDays(date, 1), '20:10') : null, updated_at: ts(addDays(date, 1), '20:10'),
        });
      }
    }
  }
  await w.flushIfNeeded();
}

// ---- chat history / chat logs / audit logs / quests / schedules ---------------------------------------
[
  ['user', '光合成でできるものは何ですか？'],
  ['assistant', '光合成では、二酸化炭素と水を材料にして、光のエネルギーを使って「デンプン」などの養分と「酸素」がつくられます。'],
  ['user', 'オームの法則の式を教えて'],
  ['assistant', '電圧 V = 電流 I × 抵抗 R です。たとえば 2A の電流が 5Ω の抵抗に流れると、電圧は 10V になります。'],
].forEach(([role, content], i) => {
  w.set(col('users').doc(s1.uid).collection('chat_history').doc(`vqa-chat-${i}`), {
    role, content, createdAt: ts(addDays(today, -1), `20:${String(10 + i).padStart(2, '0')}`), created_at_ms: Date.parse(iso(addDays(today, -1), `20:${String(10 + i).padStart(2, '0')}`)), seq: i, request_id: `vqa-req-${Math.floor(i / 2)}`,
  });
});
w.set(col('chat_logs').doc('vqa-chatlog-1'), {
  uid: s1.uid, student_name: s1.name, role: 'user', message: '先生、今日の宿題の範囲を教えてください。', read: false, student_read: true,
  teacher_id: T_SEMI, teacher_name: teacherName(T_SEMI), source: 'student', created_at: ts(addDays(today, -1), '21:45'), createdAt: ts(addDays(today, -1), '21:45'),
});
const AUDIT = [
  ['account_create', 'user', 'vqa-student-8', '中村 湊', -6], ['request_approve', 'request', 'vqa-change-1', '曜日変更 田中 蓮', -3],
  ['parent_inquiry_reply', 'parent_inquiry', 'vqa-inq-1', '振替授業の参加方法について', -1],
];
AUDIT.forEach(([action, targetType, targetId, label, d], i) => {
  w.set(col('admin_audit_logs').doc(`vqa-audit-${i}`), {
    action, actor_id: 'security-master', actor_name: '診断用 全体管理者', actor_role: 'master', actor_email: 'security_master@classbase.local',
    target_type: targetType, target_id: targetId, target_label: label, school_id: '112', details: {}, reported_by_client: false, created_at: ts(addDays(today, d), '15:00'),
  });
});
STUDENTS.slice(0, 3).forEach((s, i) => {
  w.set(col('quest_results').doc(`vqa-quest-${s.uid}`), { student_id: s.uid, is_passed: i !== 2, score: 80 - i * 15, created_at: ts(addDays(today, -2), '21:00') });
});
w.set(col('monthly_schedules').doc('vqa-sched-1'), {
  title: '文化の日（休講）', category: 'closed', audience: 'all', start_date: `${year}-11-03`, end_date: `${year}-11-03`, grades: [], school_ids: ['112'], archived: false,
});
w.set(col('monthly_schedules').doc('vqa-sched-2'), {
  title: '冬期講習', category: 'event', audience: 'student_parent', start_date: `${year}-12-24`, end_date: `${year + 1}-01-06`, grades: [], school_ids: ['112'], archived: false,
});
void thisMonth;

const total = await w.commit();
fs.writeFileSync(visualAccountsPath, `${JSON.stringify({ generated_at: new Date().toISOString(), accounts: visualAccounts }, null, 2)}\n`, { mode: 0o600 });
console.log(`[visual-qa seed] wrote ${total} documents for school 112 (today=${today}, ${todayWeekday}) to the local emulators.`);
console.log(`[visual-qa seed] extra auth accounts: ${visualAccounts.length} (stored in .visual-qa/accounts.json, git ignored).`);
