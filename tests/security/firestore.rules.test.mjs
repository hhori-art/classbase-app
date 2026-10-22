import fs from 'node:fs';
import test, { after, before, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env;
const projectId = 'demo-classbase-security';

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/student-1'), { role: 'student', school: '112' }),
      setDoc(doc(db, 'users/student-2'), { role: 'student', school: '112' }),
      setDoc(doc(db, 'users/teacher-1'), { role: 'teacher', school: '112' }),
      setDoc(doc(db, 'users/teacher-2'), { role: 'teacher', school: '112' }),
      setDoc(doc(db, 'users/dedicated-approver-1'), { role: 'teacher', school: '112', employment_category: 'dedicated', attendance_school_manager: true }),
      setDoc(doc(db, 'users/semi-approver-1'), { role: 'teacher', school: '112', employment_category: 'semi_dedicated', attendance_school_manager: true }),
      setDoc(doc(db, 'users/parent-1'), { role: 'parent', student_ids: ['student-1'] }),
      setDoc(doc(db, 'users/admin-1'), { role: 'admin', school_ids: ['112'], admin_permissions: { science_social: true } }),
      setDoc(doc(db, 'users/admin-no-permission'), { role: 'admin', school_ids: ['112'], admin_permissions: { science_social: false } }),
      setDoc(doc(db, 'users/attendance-admin-1'), { role: 'attendance_admin', school_id: '112', school_ids: ['112'] }),
      setDoc(doc(db, 'users/master-1'), { role: 'master' }),
      setDoc(doc(db, 'attendance/student-1_2026-08-26'), { user_id: 'student-1', type: 'joined' }),
      setDoc(doc(db, 'announcements/teacher-only'), { target: 'teacher', title: '講師向け' }),
      setDoc(doc(db, 'shift_assignments/private-placement'), { target_date: '2026-10-02', teacher_name: '講師1', target_meeting_id: '123456789' }),
      setDoc(doc(db, 'attendance_shift_plans/private-plan'), { date: '2026-10-09', teacher_id: 'teacher-1', school_id: '112' }),
      setDoc(doc(db, 'homework_assignments/private-homework'), { target_grade: '中3', subject: '理科', title: '生徒向け宿題' }),
      setDoc(doc(db, 'monthly_schedules/private-schedule'), { audience: 'student', school_id: '112', grades: ['中3'], title: '生徒向け予定' }),
      setDoc(doc(db, 'class_recordings/private-recording'), { grade: '中3', subject: '理科', video_url: 'https://zoom.us/rec/share/secret' }),
      setDoc(doc(db, 'attendance_payroll_rate_masters/rate-1'), { person_code: 'sensitive' }),
      setDoc(doc(db, 'users/student-1/chat_history/message-1'), { role: 'assistant', content: 'private' }),
      setDoc(doc(db, 'teacher_inquiries/inquiry-1'), { studentId: 'student-1', content: 'private', status: 'unread' }),
      setDoc(doc(db, 'chat_logs/message-1'), { uid: 'student-1', role: 'user', message: 'private' }),
      setDoc(doc(db, 'learning_units/unit-1'), { grade: '中2', subject: '物理', unit_name: '電流' }),
      setDoc(doc(db, 'lesson_slides/slide-1'), { grade: '中2', subject: '物理', unit_name: '電流' }),
      setDoc(doc(db, 'quizzes/quiz-1'), { question: '問題', correct_answer: '正解' }),
    ]);
  });
});

after(async () => env?.cleanup());

test('未認証ユーザーは生徒プロフィールを読めない', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/student-1')));
});

test('生徒は自分だけを読み、他の生徒プロフィールは読めない', async () => {
  const db = env.authenticatedContext('student-1').firestore();
  await assertSucceeds(getDoc(doc(db, 'users/student-1')));
  await assertFails(getDoc(doc(db, 'users/student-2')));
});

test('生徒は自分のroleをmasterへ昇格できない', async () => {
  const db = env.authenticatedContext('student-1').firestore();
  await assertFails(updateDoc(doc(db, 'users/student-1'), { role: 'master' }));
});

test('権限のない校舎管理者は他ユーザーを読めない', async () => {
  const db = env.authenticatedContext('admin-no-permission').firestore();
  await assertFails(getDoc(doc(db, 'users/student-1')));
});

test('保護者は紐付く生徒だけを読める', async () => {
  const db = env.authenticatedContext('parent-1').firestore();
  await assertSucceeds(getDoc(doc(db, 'users/student-1')));
  await assertFails(getDoc(doc(db, 'users/student-2')));
});

test('生徒は出席を直接作成できず専用APIを経由する', async () => {
  const db = env.authenticatedContext('student-1').firestore();
  await assertFails(setDoc(doc(db, 'attendance/own'), { user_id: 'student-1', type: 'joined' }));
  await assertFails(setDoc(doc(db, 'attendance/other'), { user_id: 'student-2', type: 'joined' }));
});

test('AI履歴・先生相談・個別チャットは全ロールが専用APIを経由する', async () => {
  for (const uid of ['student-1', 'teacher-1', 'admin-1', 'master-1', 'parent-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'users/student-1/chat_history/message-1')));
    await assertFails(setDoc(doc(db, 'users/student-1/chat_history/direct'), { role: 'assistant', content: 'forged' }));
    await assertFails(getDoc(doc(db, 'teacher_inquiries/inquiry-1')));
    await assertFails(setDoc(doc(db, 'teacher_inquiries/direct'), { studentId: 'student-1', content: 'forged' }));
    await assertFails(getDoc(doc(db, 'chat_logs/message-1')));
    await assertFails(setDoc(doc(db, 'chat_logs/direct'), { uid: 'student-1', role: 'teacher', message: 'forged' }));
  }
});

test('学習単元は閲覧専用、PPT教材メタデータは講師・理社管理者だけが閲覧できる', async () => {
  for (const uid of ['student-1', 'teacher-1', 'admin-1', 'master-1', 'parent-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'learning_units/unit-1')));
    await assertFails(setDoc(doc(db, `learning_units/new-${uid}`), { grade: '中2' }));
  }
  for (const uid of ['teacher-1', 'admin-1', 'master-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'lesson_slides/slide-1')));
    await assertFails(setDoc(doc(db, `lesson_slides/new-${uid}`), { grade: '中2' }));
  }
  for (const uid of ['student-1', 'parent-1', 'admin-no-permission']) {
    await assertFails(getDoc(doc(env.authenticatedContext(uid).firestore(), 'lesson_slides/slide-1')));
  }
  const adminDb = env.authenticatedContext('admin-1').firestore();
  await assertSucceeds(getDoc(doc(adminDb, 'quizzes/quiz-1')));
  await assertFails(setDoc(doc(adminDb, 'quizzes/quiz-2'), { question: '直接作成' }));
  await assertFails(deleteDoc(doc(adminDb, 'quizzes/quiz-1')));
});

test('お知らせの対象判定をクライアントから迂回できない', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('student-1').firestore(), 'announcements/teacher-only')));
  await assertFails(getDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'announcements/teacher-only')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-1').firestore(), 'announcements/teacher-only')));
  await assertFails(setDoc(doc(env.authenticatedContext('admin-1').firestore(), 'announcements/forged'), { target: 'all', title: '改ざん' }));
  await assertFails(setDoc(doc(env.authenticatedContext('master-1').firestore(), 'announcements/direct'), { target: 'all', title: '直接作成' }));
});

test('生徒は全講師の配置やZoom情報を直接読み取れない', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('student-1').firestore(), 'shift_assignments/private-placement')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'shift_assignments/private-placement')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-1').firestore(), 'shift_assignments/private-placement')));
});

test('授業アンケートは改ざん防止のため専用APIからのみ保存する', async () => {
  for (const uid of ['student-1', 'teacher-1', 'admin-1', 'master-1']) {
    await assertFails(setDoc(doc(env.authenticatedContext(uid).firestore(), `survey_responses/direct-${uid}`), {
      student_id: 'student-1', shift_id: 'private-placement', answers: { 1: 5 },
    }));
  }
});

test('シフト管理は専任の承認者に許可し、勤怠管理者と準専任には許可しない', async () => {
  const dedicatedDb = env.authenticatedContext('dedicated-approver-1').firestore();
  await assertSucceeds(getDoc(doc(dedicatedDb, 'shift_assignments/private-placement')));
  await assertSucceeds(setDoc(doc(dedicatedDb, 'shift_assignments/dedicated-created'), {
    target_date: '2026-10-08', teacher_name: '講師1', role_type: 'general',
  }));
  await assertSucceeds(updateDoc(doc(dedicatedDb, 'shift_assignments/private-placement'), { note: '専任承認者が更新' }));

  const attendanceDb = env.authenticatedContext('attendance-admin-1').firestore();
  await assertFails(getDoc(doc(attendanceDb, 'shift_assignments/private-placement')));
  await assertFails(setDoc(doc(attendanceDb, 'shift_assignments/attendance-created'), {
    target_date: '2026-10-08', teacher_name: '講師1', role_type: 'general',
  }));

  const semiDb = env.authenticatedContext('semi-approver-1').firestore();
  await assertFails(updateDoc(doc(semiDb, 'shift_assignments/private-placement'), { note: '準専任が更新' }));
});

test('勤怠承認シフトは全ロールがFirestoreを直接操作せず専用APIを経由する', async () => {
  for (const uid of ['teacher-1', 'dedicated-approver-1', 'attendance-admin-1', 'master-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'attendance_shift_plans/private-plan')));
    await assertFails(setDoc(doc(db, `attendance_shift_plans/direct-${uid}`), {
      date: '2026-10-09', teacher_id: 'teacher-1', school_id: '112', start: '16:00', end: '17:00',
    }));
  }
});

test('生徒は宿題を直接読み取れず対象者検証APIを経由する', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('student-1').firestore(), 'homework_assignments/private-homework')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'homework_assignments/private-homework')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-1').firestore(), 'homework_assignments/private-homework')));
});

test('生徒・保護者は月間予定を直接読み取れず対象者検証APIを経由する', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('student-1').firestore(), 'monthly_schedules/private-schedule')));
  await assertFails(getDoc(doc(env.authenticatedContext('parent-1').firestore(), 'monthly_schedules/private-schedule')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'monthly_schedules/private-schedule')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-1').firestore(), 'monthly_schedules/private-schedule')));
});

test('生徒は録画URLをFirestoreから直接読み取れず対象者検証APIを経由する', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('student-1').firestore(), 'class_recordings/private-recording')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'class_recordings/private-recording')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-1').firestore(), 'class_recordings/private-recording')));
});

test('生徒は出席記録の所有者を書き換えられない', async () => {
  const db = env.authenticatedContext('student-1').firestore();
  await assertFails(updateDoc(doc(db, 'attendance/student-1_2026-08-26'), { user_id: 'student-2' }));
});

test('講座登録は生徒・保護者・管理者・masterのクライアントから直接変更できない', async () => {
  const payload = { student_id: 'student-1', parent_id: 'parent-1', status: 'active', selected_course_ids: ['forged'] };
  for (const uid of ['student-1', 'parent-1', 'admin-1', 'master-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, `course_registrations/direct-${uid}`), payload));
  }
});

test('給与単価マスターはmasterでもクライアントSDKから読めない', async () => {
  const db = env.authenticatedContext('master-1').firestore();
  await assertFails(getDoc(doc(db, 'attendance_payroll_rate_masters/rate-1')));
});

test('masterだけがユーザーを作成・削除できる', async () => {
  const masterDb = env.authenticatedContext('master-1').firestore();
  const studentDb = env.authenticatedContext('student-1').firestore();
  await assertSucceeds(setDoc(doc(masterDb, 'users/new-user'), { role: 'student' }));
  await assertFails(setDoc(doc(studentDb, 'users/attacker-created'), { role: 'master' }));
  await assertSucceeds(deleteDoc(doc(masterDb, 'users/new-user')));
});

for (const field of ['employment_category', 'employment_type', 'worker_type', 'attendance_school_manager', 'school', 'school_id', 'classroom', 'email', 'lifetime_id', 'initial_login_id', 'uid', 'id', 'zoom_email', 'zoomEmail', 'target_signin_address', 'signin_address', 'teacher_zoom_email']) {
  test(`プロフィール自己更新で権限・認証に使う ${field} を変更できない`, async () => {
    const db = env.authenticatedContext('teacher-1').firestore();
    await assertFails(updateDoc(doc(db, 'users/teacher-1'), { [field]: field === 'attendance_school_manager' ? true : 'dedicated' }));
  });
}

test('講師は従来どおり自分の通知設定を保存できる', async () => {
  await assertSucceeds(updateDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'users/teacher-1'), {
    settings: { sound: false }, notification_preferences: { email: true }, updated_at: 'test',
  }));
});

test('講師の基本勤務設定は講師が直接書き込めず（APIで保存）、本人とmasterは読める', async () => {
  const ownRef = doc(env.authenticatedContext('teacher-1').firestore(), 'teacher_availability_profiles/teacher-1');
  const value = {
    teacher_id: 'teacher-1',
    user_id: 'teacher-1',
    teacher_name: '講師1',
    weekdays: { mon: { status: 'available', start_time: '19:00', end_time: '22:00' } },
    created_at: '2026-09-25T00:00:00.000Z',
  };
  await assertFails(setDoc(ownRef, value));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'teacher_availability_profiles/teacher-1'), value));
  await assertFails(updateDoc(ownRef, { weekdays: { mon: { status: 'unavailable', commitment_type: 'university', commitment_end_time: '19:00' } } }));
  await assertFails(updateDoc(ownRef, { teacher_id: 'teacher-2' }));
  await assertFails(deleteDoc(ownRef));
  await assertFails(setDoc(doc(env.authenticatedContext('teacher-2').firestore(), 'teacher_availability_profiles/teacher-1'), { ...value, teacher_id: 'teacher-2' }));
  await assertSucceeds(getDoc(ownRef));
  await assertFails(getDoc(doc(env.authenticatedContext('teacher-2').firestore(), 'teacher_availability_profiles/teacher-1')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('master-1').firestore(), 'teacher_availability_profiles/teacher-1')));
});

test('校舎管理者は勤怠管理権限を付与できない', async () => {
  await assertFails(updateDoc(doc(env.authenticatedContext('admin-1').firestore(), 'users/teacher-1'), {
    employment_category: 'dedicated', attendance_school_manager: true,
  }));
});

for (const collection of ['mail', 'password_reset_tokens', 'email_verification_tokens', 'password_recovery_rate_limits', 'password_recovery_requests', 'attendance_payroll_rate_masters', 'attendance_regular_imports', 'attendance_import_batches']) {
  test(`包括ルールでも ${collection} のサーバー専用境界を迂回できない`, async () => {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), collection, 'secret'), { value: 'fixture' }));
    for (const uid of ['admin-1', 'master-1']) {
      const ref = doc(env.authenticatedContext(uid).firestore(), collection, 'secret');
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { value: 'forged' }));
      await assertFails(deleteDoc(ref));
    }
  });
}

test('生徒は他人の提出物を自分名義にして奪えない', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'submissions/other'), {
    student_id: 'student-2', assignment_id: 'homework-1', status: 'submitted',
  }));
  await assertFails(updateDoc(doc(env.authenticatedContext('student-1').firestore(), 'submissions/other'), {
    student_id: 'student-1', comment: 'changed',
  }));
});

test('生徒は提出状態や講師フィードバックを直接作成・更新できない', async () => {
  const ref = doc(env.authenticatedContext('student-1').firestore(), 'submissions/own');
  await assertFails(setDoc(ref, { student_id: 'student-1', assignment_id: 'homework-1', status: 'checked', feedback: '偽の評価' }));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'submissions/own'), {
    student_id: 'student-1', assignment_id: 'homework-1', status: 'resubmit', feedback: '再提出してください',
  }));
  await assertFails(updateDoc(ref, { status: 'checked', feedback: null, teacher_comment: '合格' }));
});

test('講師専用コミュニティの更新は全講師が専用APIを経由する', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'teacher_community_topics/topic-1'), {
    creator_uid: 'teacher-1', likes: 0, liked_by: [],
  }));
  await assertFails(updateDoc(doc(env.authenticatedContext('student-1').firestore(), 'teacher_community_topics/topic-1'), { likes: 100 }));
  await assertFails(updateDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'teacher_community_topics/topic-1'), { likes: 1, liked_by: ['teacher-1'] }));
});

test('校舎管理者はmasterの資格情報を読んだり復旧先を変更したりできない', async () => {
  const db = env.authenticatedContext('admin-1').firestore();
  await assertFails(getDoc(doc(db, 'users/master-1')));
  await assertFails(updateDoc(doc(db, 'users/master-1'), { recovery_email: 'attacker@example.test', recovery_email_verified_at: 'now' }));
  await assertSucceeds(getDoc(doc(db, 'users/admin-1')));
});

test('自己更新では給与照合用の別名や所定勤務条件も保護する', async () => {
  const ref = doc(env.authenticatedContext('teacher-1').firestore(), 'users/teacher-1');
  for (const field of ['staff_id', 'employeeId', 'school_name', 'prescribed_work_start', 'prescribed_work_days']) {
    await assertFails(updateDoc(ref, { [field]: field === 'prescribed_work_days' ? [] : 'forged' }));
  }
});

test('コミュニティの報酬カウンターとリアクションをクライアントから書き換えられない', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'teacher_community_topics/reactions'), {
    creator_uid: 'teacher-1', likes: 0, liked_by: [], votes: {}, voted_by: [], reward_given: false,
  }));
  const ref = doc(env.authenticatedContext('teacher-1').firestore(), 'teacher_community_topics/reactions');
  await assertFails(updateDoc(ref, { likes: 100, liked_by: ['teacher-1'] }));
  await assertFails(updateDoc(ref, { reward_given: true }));
  await assertFails(updateDoc(ref, { likes: 1, liked_by: ['teacher-1'] }));
  await assertFails(updateDoc(ref, { likes: 2, liked_by: ['teacher-1', 'forged-user'] }));
  await assertFails(updateDoc(ref, { votes: { 0: 1 }, voted_by: ['teacher-1'] }));
  await assertFails(updateDoc(ref, { votes: { 0: 2 }, voted_by: ['teacher-1'] }));
});

test('生徒コミュニティは承認済み投稿だけを公開しコメント書込はAPIに限定する', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'community_topics/pending'), { is_approved: false, creator_uid: 'student-1' });
    await setDoc(doc(db, 'community_topics/approved'), { is_approved: true, creator_uid: 'student-1' });
    await setDoc(doc(db, 'community_topics/pending/comments/comment'), { uid: 'student-1', text: '非公開' });
  });
  const studentDb = env.authenticatedContext('student-1').firestore();
  const adminDb = env.authenticatedContext('admin-1').firestore();
  await assertFails(getDoc(doc(studentDb, 'community_topics/pending')));
  await assertSucceeds(getDoc(doc(studentDb, 'community_topics/approved')));
  await assertFails(getDoc(doc(studentDb, 'community_topics/pending/comments/comment')));
  await assertSucceeds(getDoc(doc(adminDb, 'community_topics/pending')));
  await assertFails(setDoc(doc(studentDb, 'community_topics/approved/comments/direct'), { uid: 'student-1', text: '直接書込' }));
});

test('クエスト採点セッションは全クライアントから非公開にする', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'quest_sessions/session'), {
    student_id: 'student-1', questions: [{ correct_answer: 'secret' }],
  }));
  for (const uid of ['student-1', 'admin-1', 'master-1']) {
    const ref = doc(env.authenticatedContext(uid).firestore(), 'quest_sessions/session');
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { used: false }));
  }
});

test('景品マスターと申請処理は管理画面から直接変更できず専用APIに限定する', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'rewards/reward'), { name: 'ノート', required_coins: 30, active: true });
    await setDoc(doc(db, 'requests/exchange'), { type: 'exchange', status: 'pending', userId: 'student-1', cost: 30 });
  });
  for (const uid of ['student-1', 'admin-1', 'master-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'rewards/reward')));
    await assertFails(updateDoc(doc(db, 'rewards/reward'), { active: false }));
  }
  await assertFails(updateDoc(doc(env.authenticatedContext('admin-1').firestore(), 'requests/exchange'), { status: 'completed' }));
  await assertFails(updateDoc(doc(env.authenticatedContext('master-1').firestore(), 'requests/exchange'), { status: 'completed' }));
});

test('ガチャ設定・抽選結果・デジタル景品の受け取り記録はクライアントから読み書きできない', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'gachas/g1'), { name: 'ガチャ', cost: 10, items: [] });
    await setDoc(doc(db, 'gacha_draws/student-1_d1'), { user_id: 'student-1', result: 'win' });
    await setDoc(doc(db, 'reward_grants/grant-1'), { user_id: 'student-1', digital_file_path: 'reward_files/a/b.pdf' });
  });
  for (const uid of ['student-1', 'admin-1', 'master-1']) {
    const db = env.authenticatedContext(uid).firestore();
    for (const path of ['gachas/g1', 'gacha_draws/student-1_d1', 'reward_grants/grant-1']) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { forged: true }));
    }
  }
});

test('生徒は獲得済みのバッジだけを装備でき、獲得バッジ自体は書き換えられない', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'users/student-1'), { earned_badges: ['badge_1', 'badge_pencil'] });
  });
  const db = env.authenticatedContext('student-1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/student-1'), { selected_badge: 'badge_pencil' }));
  await assertSucceeds(updateDoc(doc(db, 'users/student-1'), { selected_badge: 'badge_1' }));
  await assertFails(updateDoc(doc(db, 'users/student-1'), { selected_badge: 'badge_special_mvp' }));
  await assertFails(updateDoc(doc(db, 'users/student-1'), { earned_badges: ['badge_special_mvp'] }));
});

test('景品表示の個別許可とバッジ用カウンターは生徒本人や校舎管理者が書き換えられない', async () => {
  const studentDb = env.authenticatedContext('student-1').firestore();
  await assertFails(updateDoc(doc(studentDb, 'users/student-1'), { feature_overrides: { shop: true } }));
  await assertFails(updateDoc(doc(studentDb, 'users/student-1'), { gacha_draw_count: 100 }));
  await assertFails(updateDoc(doc(studentDb, 'users/student-1'), { owned_cosmetics: ['theme_rainbow'] }));
  await assertFails(updateDoc(doc(env.authenticatedContext('admin-1').firestore(), 'users/student-1'), { feature_overrides: { shop: true } }));
});

test('masterの通常の勤務記録作成と講師の拒否を維持する', async () => {
  const value = { teacher_id: 'teacher-1', date: '2026-09-01', status: 'pending', work_segments: [] };
  await assertSucceeds(setDoc(doc(env.authenticatedContext('master-1').firestore(), 'work_records/manual'), value));
  await assertFails(setDoc(doc(env.authenticatedContext('teacher-1').firestore(), 'work_records/forged'), value));
});

test('勤怠承認者は勤務記録を直接改ざん・削除できず専用APIを経由する', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'work_records/managed'), {
    teacher_id: 'teacher-1', date: '2026-09-01', status: 'pending', work_segments: [],
  }));
  const db = env.authenticatedContext('attendance-admin-1').firestore();
  await assertFails(setDoc(doc(db, 'work_records/forged'), { teacher_id: 'teacher-1', date: '2026-09-02' }));
  await assertFails(updateDoc(doc(db, 'work_records/managed'), { start_time: '2026-09-01T09:00:00+09:00' }));
  await assertFails(deleteDoc(doc(db, 'work_records/managed')));
});

test('停止済みアカウントは有効なIDトークンが残っていても直接データにアクセスできない', async () => {
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'users/student-1'), { account_status: 'suspended' }));
  const db = env.authenticatedContext('student-1').firestore();
  await assertFails(getDoc(doc(db, 'users/student-1')));
  await assertFails(updateDoc(doc(db, 'users/student-1'), { settings: { sound: true } }));
});
