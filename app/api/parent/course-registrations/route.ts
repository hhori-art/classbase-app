import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { formatClassDays, parseClassDays } from '@/lib/class-days';
import { normalizeCourseGrade } from '@/lib/course-registration-rules';
import { verifyCourseRegistrationToken, type CourseRegistrationGrant } from '@/lib/server/course-registration-token';
import { linkedParentIds, loadParentIdsListingStudent } from '@/lib/server/linked-parents';
import { queuePushToUsers } from '@/lib/server/web-push';

export const runtime = 'nodejs';

const clean = (value: unknown, max = 300) => String(value || '').normalize('NFKC').trim().slice(0, max);

const registrationId = (parts: string[]) => `registration_${crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 40)}`;

const NOTIFICATION_SUMMARY_MAX = 140;

/** 「火 2時間目 理科（物理）」の形にする。単元は週ごとに変わるので入れない。 */
const grantLabel = (grant: CourseRegistrationGrant) => {
  const words = Array.from(new Set(String(grant.course_text || '').split(/\s+/).map(word => word.trim()).filter(Boolean)));
  const course = words.length >= 2 ? `${words[0]}（${words[1]}）` : words[0] || '講座';
  return [grant.day, grant.slot, course].filter(Boolean).join(' ');
};

/** 選んだ講座の一覧を通知の本文用に短くまとめる。 */
function summarizeCourseSelection(labels: string[]) {
  const unique = Array.from(new Set(labels.filter(Boolean)));
  const shown: string[] = [];
  for (const label of unique) {
    const next = [...shown, label].join('、');
    if (shown.length > 0 && next.length > NOTIFICATION_SUMMARY_MAX) break;
    shown.push(label.length > NOTIFICATION_SUMMARY_MAX ? `${label.slice(0, NOTIFICATION_SUMMARY_MAX - 1)}…` : label);
  }
  const rest = unique.length - shown.length;
  return `${shown.join('、')}${rest > 0 ? ` ほか${rest}件` : ''}`;
}

const timestampKey = (value: any) => {
  if (!value) return '';
  if (typeof value.toMillis === 'function') return String(value.toMillis());
  if (typeof value === 'object' && (value._seconds ?? value.seconds) !== undefined) return `${value._seconds ?? value.seconds}.${value._nanoseconds ?? value.nanoseconds ?? 0}`;
  return String(value);
};

const selectionSignature = (type: string, year: unknown, term: unknown, ids: unknown) => [
  type,
  String(year || ''),
  String(term || ''),
  ...(Array.isArray(ids) ? ids.map(String).filter(Boolean).sort() : []),
].join('\u0000');

type ChangeNotice = {
  user: Awaited<ReturnType<typeof getServerUser>>;
  studentId: string;
  /** 保存前の生徒プロフィール（変更前の状態と保護者の紐づけを読む）。 */
  before: FirebaseFirestore.DocumentData;
  registrationType: 'regular' | 'test_prep';
  year: number;
  term: string;
  selectedCourseIds: string[];
  labels: string[];
};

/**
 * 受講講座の変更を、変更した本人以外の家族（生徒本人・つながっている保護者）へ知らせる。
 * 通知IDは「変更前の更新時刻＋変更後の内容」から決めるので、同じ変更の再送では重複しない。
 * 通知の失敗で保存を失敗扱いにしない。
 */
async function notifyCourseRegistrationChange(db: FirebaseFirestore.Firestore, notice: ChangeNotice) {
  const { user, studentId, before, registrationType } = notice;
  const testPrep = registrationType === 'test_prep';
  const previous = testPrep
    ? selectionSignature(registrationType, before.test_prep_course_registration_year, before.test_prep_course_registration_term, before.selected_test_prep_course_ids)
    : selectionSignature(registrationType, before.course_registration_year, before.course_registration_term, before.selected_course_ids);
  const next = selectionSignature(registrationType, notice.year, notice.term, notice.selectedCourseIds);
  // 内容が変わっていない保存（保存後の再送など）は知らせない。
  if (previous === next) return;

  const extraParentIds = await loadParentIdsListingStudent(db, studentId).catch(() => [] as string[]);
  const parentIds = linkedParentIds(before, extraParentIds).filter(id => id !== user.uid && id !== studentId);
  const recipients: { id: string; role: 'student' | 'parent' }[] = [
    ...(user.role === 'parent' ? [{ id: studentId, role: 'student' as const }] : []),
    ...parentIds.map(id => ({ id, role: 'parent' as const })),
  ];
  if (recipients.length === 0) return;

  const studentName = clean(before.student_name || before.name, 60) || 'お子さま';
  const courseWord = testPrep ? '対策講座' : '受講講座';
  const summary = notice.selectedCourseIds.length === 0
    ? `${courseWord}の登録がすべて解除されました。`
    : `変更後の${courseWord}：${summarizeCourseSelection(notice.labels)}`;
  const version = timestampKey(testPrep ? before.test_prep_course_registration_updated_at : before.course_registration_updated_at);
  const changeKey = crypto.createHash('sha256').update([studentId, user.uid, version, next].join('\u0000')).digest('hex').slice(0, 32);

  const results = await Promise.allSettled(recipients.map(recipient => {
    const title = recipient.role === 'student'
      ? `保護者の方が${courseWord}を変更しました`
      : user.role === 'parent'
        ? `保護者の方が${studentName}さんの${courseWord}を変更しました`
        : `${studentName}さんが${courseWord}を変更しました`;
    return db.collection('user_notifications').doc(`course_change_${changeKey}_${recipient.id}`).create({
      user_id: recipient.id,
      role: recipient.role,
      title,
      message: summary,
      kind: 'course_registration_changed',
      link: recipient.role === 'student' ? '/student/timetable' : '/parent/courses',
      student_id: studentId,
      student_name: studentName,
      changed_by: user.uid,
      changed_by_role: user.role,
      registration_type: registrationType,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    });
  }));
  results.forEach(result => {
    if (result.status === 'rejected') {
      const code = (result.reason as any)?.code;
      // 同じ変更の再送で、すでに作られている通知は成功とみなす。
      if (code === 6 || code === 'already-exists') return;
      console.error('course registration notification failed', result.reason);
    }
  });  // 新しく通知を作れた相手だけ端末にも知らせる（同じ変更の再送では送らない）。
  const created = recipients.filter((_, index) => results[index].status === 'fulfilled');
  const createdStudents = created.filter(item => item.role === 'student').map(item => item.id);
  const createdParents = created.filter(item => item.role === 'parent').map(item => item.id);
  queuePushToUsers(createdStudents, { title: `保護者の方が${courseWord}を変更しました`, body: 'アプリで確認してください。', link: '/student/timetable' }, { kind: 'registration' });
  queuePushToUsers(createdParents, { title: `${courseWord}が変更されました`, body: 'アプリで確認してください。', link: '/parent/courses' }, { kind: 'registration' });
}

const notifySafely = (db: FirebaseFirestore.Firestore, notice: ChangeNotice) => notifyCourseRegistrationChange(db, notice)
  .catch(error => console.error('course registration notification failed', error));

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent', 'student']);

    const body = await request.json();
    const studentId = clean(body.student_id, 128);
    const selectedCourseIds: string[] = Array.from(new Set<string>(
      (Array.isArray(body.selected_course_ids) ? body.selected_course_ids : []).map((id: unknown) => clean(id, 500)).filter(Boolean)
    ));
    const registrationTokens: string[] = Array.isArray(body.registration_tokens)
      ? body.registration_tokens.map((token: unknown) => String(token || '')).filter(Boolean)
      : [];
    if (!studentId || selectedCourseIds.length > 100 || registrationTokens.length !== selectedCourseIds.length) {
      return Response.json({ ok: false, error: '受講講座の選択情報を再読み込みしてください。' }, { status: 400 });
    }

    const db = adminDb();
    const initialStudentSnap = await db.collection('users').doc(studentId).get();
    if (!initialStudentSnap.exists) throw new Error('student-not-found');
    const initialStudent = initialStudentSnap.data() || {};
    const studentGrade = normalizeCourseGrade(initialStudent.grade);
    const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids.map(String) : [];
    const isOwnStudentRequest = user.role === 'student' && user.uid === studentId;
    const isLinkedParentRequest = user.role === 'parent' && (linkedIds.includes(studentId) || clean(initialStudent.parent_uid, 128) === user.uid);
    if (!isOwnStudentRequest && !isLinkedParentRequest) throw new Error('forbidden');

    if (selectedCourseIds.length === 0) {
      const year = Number(body.year);
      const term = clean(body.term, 120);
      const registrationType = body.registration_type === 'test_prep' ? 'test_prep' : 'regular';
      if (!Number.isInteger(year) || year < 2020 || year > 2100 || !term) {
        return Response.json({ ok: false, error: '解除する年度・期を確認してください。' }, { status: 400 });
      }
      const requestId = clean(body.request_id, 200);
      const parentId = user.role === 'parent' ? user.uid : clean(initialStudent.parent_uid, 128);
      const ref = db.collection('course_registrations').doc(registrationId([
        user.uid, studentId, String(year), registrationType, term, requestId || 'direct',
      ]));
      const batch = db.batch();
      const activeRegistrationId = clean(registrationType === 'test_prep'
        ? initialStudent.active_test_prep_course_registration_id
        : initialStudent.active_course_registration_id, 200);
      if (activeRegistrationId && activeRegistrationId !== ref.id) {
        batch.set(db.collection('course_registrations').doc(activeRegistrationId), {
          is_current: false,
          current: false,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      batch.set(ref, {
        request_id: requestId || null,
        parent_id: parentId || null,
        student_id: studentId,
        student_name: initialStudent.student_name || initialStudent.name || '',
        grade: initialStudent.grade || '',
        year,
        term,
        registration_type: registrationType,
        selected_course_ids: [],
        selected_course_keys: [],
        selected_course_labels: [],
        status: 'active',
        approval_status: 'not_required',
        is_current: true,
        current: true,
        updated_by: user.uid,
        updated_by_role: user.role,
        updated_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.collection('users').doc(studentId), registrationType === 'test_prep' ? {
        active_test_prep_course_registration_id: ref.id,
        selected_test_prep_course_ids: [],
        selected_test_prep_course_keys: [],
        test_prep_course_registration_year: year,
        test_prep_course_registration_term: term,
        test_prep_course_registration_status: 'active',
        test_prep_course_registration_updated_at: FieldValue.serverTimestamp(),
      } : {
        active_course_registration_id: ref.id,
        selected_course_ids: [],
        selected_course_keys: [],
        selected_course_labels: [],
        course_registration_year: year,
        course_registration_term: term,
        course_registration_status: 'active',
        course_registration_updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      await notifySafely(db, {
        user, studentId, before: initialStudent, registrationType, year, term, selectedCourseIds: [], labels: [],
      });
      return Response.json({ ok: true, registration_id: ref.id, selected_course_ids: [], cleared: true });
    }
    let grants: CourseRegistrationGrant[];
    try {
      grants = registrationTokens.map(token => verifyCourseRegistrationToken(token, user.uid, studentGrade));
    } catch {
      return Response.json({ ok: false, error: '受講講座の候補が更新されました。再読み込みしてください。' }, { status: 403 });
    }
    const grantById = new Map(grants.map(grant => [grant.option_id, grant]));
    if (grantById.size !== selectedCourseIds.length || selectedCourseIds.some(id => !grantById.has(id))) {
      return Response.json({ ok: false, error: '選択した講座と受講許可が一致しません。' }, { status: 403 });
    }

    const first = grants[0];
    if (grants.some(grant => grant.year !== first.year || grant.term !== first.term || grant.registration_type !== first.registration_type || grant.request_id !== first.request_id)) {
      return Response.json({ ok: false, error: '異なる期・登録種別の講座は同時に登録できません。' }, { status: 400 });
    }
    if ((body.year && Number(body.year) !== first.year) || (body.term && clean(body.term, 120) !== first.term)) {
      return Response.json({ ok: false, error: '登録対象の年度または期が一致しません。' }, { status: 400 });
    }
    if (body.registration_type && (body.registration_type === 'test_prep' ? 'test_prep' : 'regular') !== first.registration_type) {
      return Response.json({ ok: false, error: '登録種別が一致しません。' }, { status: 400 });
    }
    if (first.request_id && clean(body.request_id, 200) !== first.request_id) {
      return Response.json({ ok: false, error: '登録依頼が一致しません。' }, { status: 400 });
    }

    const slotSelections = new Map<string, string>();
    const courseSelections = new Map<string, string>();
    for (const grant of grants) {
      const slotKey = `${grant.day}__${grant.slot}`;
      if (!grant.day || !grant.slot) continue;
      const current = slotSelections.get(slotKey);
      if (current && current !== grant.stable_key) {
        return Response.json({ ok: false, error: '同じ曜日・時限に複数の講座は登録できません。' }, { status: 400 });
      }
      slotSelections.set(slotKey, grant.stable_key);
      const courseKey = String(grant.course_key || grant.stable_key)
        .replace(new RegExp(`_${String(grant.day).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${String(grant.slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      const existingSchedule = courseSelections.get(courseKey);
      if (courseKey && existingSchedule && existingSchedule !== slotKey) {
        return Response.json({ ok: false, error: '同じ講座を別の曜日・時限で重複登録することはできません。' }, { status: 400 });
      }
      if (courseKey) courseSelections.set(courseKey, slotKey);
    }

    const selectedCourseKeys = Array.from(new Set(grants.map(grant => grant.stable_key).filter(Boolean)));
    const selectedCourseLabels = Array.from(new Set(grants.map(grant => grant.course_text).filter(Boolean)));
    const day = formatClassDays(parseClassDays(grants.map(grant => grant.day)), '、');
    const courseText = grants.map(grant => grant.course_text).join(' ');
    const science = ['物理', '化学', '生物', '地学'].find(value => courseText.includes(value)) || '';
    const social = ['地理', '歴史', '公民'].find(value => courseText.includes(value)) || '';
    const requestId = first.request_id;
    const ref = db.collection('course_registrations').doc(registrationId([
      user.uid, studentId, String(first.year), first.registration_type, first.term, requestId || 'direct',
    ]));

    const parentId = user.role === 'parent' ? user.uid : clean(initialStudent.parent_uid, 128);
    await db.runTransaction(async transaction => {
      const studentRef = db.collection('users').doc(studentId);
      const existingQuery = db.collection('course_registrations').where('student_id', '==', studentId).limit(100);
      const [studentSnap, existingSnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(existingQuery),
      ]);
      if (!studentSnap.exists) throw new Error('student-not-found');
      const student = studentSnap.data() || {};
      if (String(student.role || '') !== 'student' || normalizeCourseGrade(student.grade) !== studentGrade) throw new Error('student-profile-changed');
      const transactionLinkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids.map(String) : [];
      const transactionOwnRequest = user.role === 'student' && user.uid === studentId;
      const transactionParentRequest = user.role === 'parent' && (transactionLinkedIds.includes(studentId) || clean(student.parent_uid, 128) === user.uid);
      if (!transactionOwnRequest && !transactionParentRequest) throw new Error('forbidden');

      existingSnap.docs.forEach(docSnap => {
        const existingType = String(docSnap.data().registration_type || 'regular');
        if (docSnap.id !== ref.id && existingType === first.registration_type) {
          transaction.set(docSnap.ref, { is_current: false, current: false, updated_at: FieldValue.serverTimestamp() }, { merge: true });
        }
      });
      const existingRefSnap = existingSnap.docs.find(docSnap => docSnap.id === ref.id);
      transaction.set(ref, {
        request_id: requestId || null,
        parent_id: parentId || null,
        parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
        student_id: studentId,
        student_name: student.student_name || student.name || '',
        grade: student.grade || '',
        year: first.year,
        term: first.term,
        registration_type: first.registration_type,
        selected_course_ids: selectedCourseIds,
        selected_course_keys: selectedCourseKeys,
        selected_course_labels: selectedCourseLabels,
        status: 'active',
        approval_status: 'not_required',
        is_current: true,
        current: true,
        updated_by: user.uid,
        updated_by_role: user.role,
        updated_at: FieldValue.serverTimestamp(),
        ...(!existingRefSnap ? { created_at: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      const registrationProfileFields = first.registration_type === 'test_prep' ? {
        active_test_prep_course_registration_id: ref.id,
        selected_test_prep_course_ids: selectedCourseIds,
        selected_test_prep_course_keys: selectedCourseKeys,
        test_prep_course_registration_year: first.year,
        test_prep_course_registration_term: first.term,
        test_prep_course_registration_status: 'active',
        test_prep_course_registration_updated_at: FieldValue.serverTimestamp(),
      } : {
        active_course_registration_id: ref.id,
        selected_course_ids: selectedCourseIds,
        selected_course_keys: selectedCourseKeys,
        course_registration_year: first.year,
        course_registration_term: first.term,
        course_registration_status: 'active',
        course_registration_updated_at: FieldValue.serverTimestamp(),
      };
      transaction.set(studentRef, {
        ...registrationProfileFields,
        ...(day ? { day_of_week: day } : {}),
        ...(science ? { subject_science: science } : {}),
        ...(social ? { subject_social: social } : {}),
        ...(day || science || social ? {
          course_settings_updated_at: FieldValue.serverTimestamp(),
          course_settings_updated_by: user.uid,
          course_settings_approval_status: 'not_required',
        } : {}),
      }, { merge: true });
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'parent_course_registration_submitted',
      target_id: ref.id,
      target_type: 'course_registration',
      school: initialStudent.school || initialStudent.school_id || user.school,
      metadata: {
        student_id: studentId,
        year: first.year,
        term: first.term,
        registration_type: first.registration_type,
        selected_course_ids: selectedCourseIds,
        selected_course_keys: selectedCourseKeys,
        course_settings: { day_of_week: day, subject_science: science, subject_social: social },
        immediate: true,
      },
    }).catch(error => {
      console.error('course registration event write failed', error);
      return null;
    });

    await notifySafely(db, {
      user,
      studentId,
      before: initialStudent,
      registrationType: first.registration_type === 'test_prep' ? 'test_prep' : 'regular',
      year: first.year,
      term: first.term,
      selectedCourseIds,
      labels: grants.map(grantLabel),
    });

    return Response.json({ ok: true, registration_id: ref.id, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
