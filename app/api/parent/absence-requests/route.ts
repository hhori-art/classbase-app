import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { verifyTransferOptionToken } from '@/lib/server/transfer-option-token';
import { weekdayFromDateKey } from '@/lib/date-key';
import { normalizeClassButtonSettings } from '@/lib/class-button-settings';
import { LESSON_ENDED_MESSAGE, lessonDayEnded } from '@/lib/lesson-deadline';
import { linkedParentIds, loadParentIdsListingStudent } from '@/lib/server/linked-parents';
import { queuePushToUsers } from '@/lib/server/web-push';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { isTodayGradeTransferShift, todayPeriodEnded } from '@/lib/server/student-today-lessons';
import { jstTodayKey } from '@/lib/lesson-deadline';
import { ABSENCE_WINDOW_MESSAGE, isWithinAbsenceWindow } from '@/lib/absence-window';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
/** 通知の本文の日付（10月25日(日)）。 */
const dateText = (dateKey: string) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
  ? `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日(${WEEKDAY_LABELS[new Date(`${dateKey}T12:00:00+09:00`).getUTCDay()]})`
  : dateKey;

export const runtime = 'nodejs';

function clean(value: unknown) {
  return String(value || '').trim();
}

/** トランザクションの確定後に送る端末通知（ロック画面に出るため名前・理由は含めない）。 */
type PushPlan = { title: string; body: string; studentIds: string[]; parentIds: string[] };

function sendPushPlan(plan: PushPlan | null) {
  if (!plan) return;
  queuePushToUsers(plan.studentIds, { title: plan.title, body: plan.body, link: '/student/notifications' }, { kind: 'attendance' });
  queuePushToUsers(plan.parentIds, { title: plan.title, body: plan.body, link: '/parent/notifications' }, { kind: 'attendance' });
}

function parentLinkedTo(user: Awaited<ReturnType<typeof getServerUser>>, studentId: string, student: FirebaseFirestore.DocumentData) {
  const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids.map(String) : [];
  return linkedIds.includes(studentId) || clean(student.parent_uid) === user.uid;
}

const ABSENCE_LABELS: Record<string, string> = { absent: '欠席', late: '遅刻' };

const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'rejected']);
const isActiveRequest = (data: FirebaseFirestore.DocumentData | undefined) => Boolean(data) && !INACTIVE_STATUSES.has(clean(data?.status).toLowerCase());
const hasRegisteredTransfer = (data: FirebaseFirestore.DocumentData) => data.transfer_status === 'registered' || Boolean(clean(data.transfer_request_id));
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * 同じ生徒・同じ日の有効な欠席連絡は1件にまとめる。
 * 振替登録済みのものを優先し、なければ最後に更新されたものを残す。残りは置き換え対象として返す。
 */
function pickActiveAbsence(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const active = docs.filter(doc => isActiveRequest(doc.data()));
  const stamp = (data: FirebaseFirestore.DocumentData) => {
    const value = data.updated_at || data.created_at;
    return Number(value?.toMillis?.() || value?.seconds * 1000 || 0) || 0;
  };
  const sorted = [...active].sort((a, b) => (
    Number(hasRegisteredTransfer(b.data())) - Number(hasRegisteredTransfer(a.data())) ||
    stamp(b.data()) - stamp(a.data())
  ));
  const primary = sorted[0] || null;
  // 振替登録済みの欠席は、振替記録とのつながりを壊さないように取り消さない。
  const duplicates = sorted.slice(1).filter(doc => !hasRegisteredTransfer(doc.data()));
  return { primary, duplicates };
}

/**
 * 欠席・遅刻の連絡を、連絡しなかった側へ理由つきで知らせる。
 * - 保護者が連絡した → 生徒と、ほかの保護者へ
 * - 生徒が連絡した → 保護者全員へ
 */
function queueCounterpartNotifications(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: {
    user: Awaited<ReturnType<typeof getServerUser>>;
    student: FirebaseFirestore.DocumentData;
    studentId: string;
    requestId: string;
    targetDate: string;
    absenceType: string;
    reason: string;
    transferNote?: string;
    studentExtra?: Record<string, unknown>;
    studentGuide?: string;
    extraParentIds?: string[];
    updated?: boolean;
  },
) {
  const { user, student, studentId, requestId, targetDate, absenceType, reason } = input;
  const label = ABSENCE_LABELS[absenceType] || '欠席';
  const studentName = clean(student.student_name || student.name) || '生徒';
  const senderName = user.role === 'parent'
    ? `保護者（${clean(user.profile.parent_name || user.profile.name) || '保護者'}）`
    : `${studentName}さん本人`;
  const lines = [
    `${dateText(targetDate)}の${label}連絡を${senderName}が送りました。`,
    `理由：${reason || '（記入なし）'}`,
    input.transferNote || '',
  ].filter(Boolean);
  const base = {
    title: input.updated ? `${label}連絡が変更されました` : `${label}連絡が届きました`,
    kind: user.role === 'parent' ? 'parent_absence_submitted' : 'student_absence_submitted',
    request_id: requestId,
    target_date: targetDate,
    absence_type: absenceType,
    reason,
    read: false,
    created_at: FieldValue.serverTimestamp(),
  };

  if (user.role === 'parent') {
    transaction.set(db.collection('user_notifications').doc(`absence_${requestId}`), {
      ...base,
      user_id: studentId,
      role: 'student',
      link: '/student',
      message: [...lines, input.studentGuide || ''].filter(Boolean).join('\n'),
      ...(input.studentExtra || {}),
    });
  }
  const parentIds = linkedParentIds(student, input.extraParentIds || []).filter(parentId => parentId !== user.uid);
  parentIds
    .forEach(parentId => {
      transaction.set(db.collection('user_notifications').doc(`absence_${requestId}_parent_${parentId}`), {
        ...base,
        user_id: parentId,
        role: 'parent',
        student_id: studentId,
        student_name: studentName,
        link: `/parent?student_id=${encodeURIComponent(studentId)}`,
        message: lines.join('\n'),
      });
    });
  return {
    title: base.title,
    body: `${dateText(targetDate)}の${label}連絡です。アプリで確認してください。`,
    studentIds: user.role === 'parent' ? [studentId] : [],
    parentIds,
  } satisfies PushPlan;
}

/** その日いちばん遅い授業（2時間目）の終了時刻。欠席・遅刻の連絡と取り消しの締切に使う。 */
async function loadLessonEnd(db: FirebaseFirestore.Firestore) {
  const settingsSnap = await db.collection('settings').doc('class_button').get();
  return normalizeClassButtonSettings(settingsSnap.data() || {}).period2_end;
}

/** 取り消しを受け付けないときの応答（理由を保護者・生徒に分かる言葉で返す）。 */
class CancelRefusal extends Error {
  constructor(readonly status: number, readonly code: string, readonly userMessage: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

const CANCEL_ENDED_MESSAGE = 'この日の授業はすでに終わっているため、取り消しできません。必要な場合は教室へご連絡ください。';
const TRANSFER_CONFIRM_MESSAGE = 'この欠席には振替が登録されています。欠席連絡を取り消すと、振替も取り消されます。';
const TRANSFER_ENDED_MESSAGE = '振替先の授業がすでに終わっているため、取り消しできません。教室へご連絡ください。';

/**
 * 送った欠席・遅刻の連絡を取り消す（その日の授業が終わるまで）。
 * - 生徒本人か、つながっている保護者だけが取り消せる（送信時と同じ確認）。
 * - 振替が登録されている欠席は、振替も一緒に取り消すと明示（cancel_transfer: true）したときだけ取り消す。
 *   振替だけが残ると「休む日がないのに振替がある」状態になるため、欠席だけの取り消しはしない。
 *   振替先の授業がもう終わっている場合は、出席の記録と食い違うため取り消さず教室への連絡を案内する。
 * - 連絡しなかった側（生徒・ほかの保護者）へ取り消しを知らせ、振替を選ぶお願いの通知も上書きする。
 */
async function cancelAbsence(
  db: FirebaseFirestore.Firestore,
  user: Awaited<ReturnType<typeof getServerUser>>,
  body: Record<string, unknown>,
) {
  try {
    const requestId = clean(body.request_id).slice(0, 200);
    if (!requestId || requestId.includes('/')) {
      return Response.json({ ok: false, error: 'request_id is required' }, { status: 400 });
    }
    const cancelTransfer = body.cancel_transfer === true;
    const requestRef = db.collection('requests').doc(requestId);
    const firstSnap = await requestRef.get();
    const first = firstSnap.data() || {};
    const studentId = clean(first.student_id || first.user_id);
    if (!firstSnap.exists || clean(first.type) !== 'absence' || !studentId) throw new Error('forbidden');
    if (user.role === 'student' && user.uid !== studentId) throw new Error('forbidden');
    const [lessonEnd, extraParentIds] = await Promise.all([loadLessonEnd(db), loadParentIdsListingStudent(db, studentId)]);
    const studentRef = db.collection('users').doc(studentId);

    let push: PushPlan | null = null;
    const result = await db.runTransaction(async transaction => {
      push = null;
      const [requestSnap, studentSnap] = await transaction.getAll(requestRef, studentRef);
      if (!requestSnap.exists || !studentSnap.exists) throw new Error('forbidden');
      const absence = requestSnap.data() || {};
      const student = studentSnap.data() || {};
      if (clean(absence.type) !== 'absence' || clean(absence.student_id || absence.user_id) !== studentId) throw new Error('forbidden');
      const stillOwn = user.role === 'student' ? user.uid === studentId : parentLinkedTo(user, studentId, student);
      if (!stillOwn || String(student.role || '') !== 'student') throw new Error('forbidden');
      const status = clean(absence.status).toLowerCase();
      if (status === 'cancelled' || status === 'canceled') return { alreadyCancelled: true, transferCancelled: false };
      if (!isActiveRequest(absence)) throw new CancelRefusal(400, 'request-not-active', 'この連絡はすでに教室で処理されているため、取り消しできません。');
      const targetDate = clean(absence.target_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || lessonDayEnded(targetDate, lessonEnd)) {
        throw new CancelRefusal(400, 'lesson-already-ended', CANCEL_ENDED_MESSAGE);
      }

      let transferCancelled = false;
      const transferId = clean(absence.transfer_request_id) || (absence.transfer_status === 'registered' ? `${requestId}_transfer` : '');
      if (transferId && !transferId.includes('/')) {
        const transferRef = db.collection('requests').doc(transferId);
        const transferSnap = await transaction.get(transferRef);
        const transfer = transferSnap.exists ? transferSnap.data() || {} : null;
        if (transfer && isActiveRequest(transfer) && clean(transfer.student_id || transfer.user_id) === studentId) {
          const transferDate = clean(transfer.target_date).slice(0, 10);
          const transferLabel = [formatDateKey(transferDate), clean(transfer.transfer_course_name || transfer.transfer_subject)].filter(Boolean).join(' ');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate) || lessonDayEnded(transferDate, lessonEnd)) {
            throw new CancelRefusal(400, 'transfer-lesson-ended', TRANSFER_ENDED_MESSAGE);
          }
          if (!cancelTransfer) {
            throw new CancelRefusal(409, 'transfer-registered', TRANSFER_CONFIRM_MESSAGE, { transfer: { id: transferId, target_date: transferDate, label: transferLabel } });
          }
          transaction.set(transferRef, {
            status: 'cancelled', transfer_status: 'cancelled', cancelled_with_absence: requestId,
            cancelled_at: FieldValue.serverTimestamp(), cancelled_by: user.uid, cancelled_by_role: user.role,
            updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
          transferCancelled = true;
        }
      }

      transaction.set(requestRef, {
        status: 'cancelled',
        ...(transferCancelled ? { transfer_status: 'cancelled' } : {}),
        ...(absence.transfer_status === 'waiting_student_selection' ? { transfer_status: null, transfer_required_by_parent: false } : {}),
        cancelled_at: FieldValue.serverTimestamp(), cancelled_by: user.uid, cancelled_by_role: user.role,
        last_updated_source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      push = queueCancelNotifications(transaction, db, {
        user, student, studentId, requestId, targetDate,
        absenceType: clean(absence.absence_type) || 'absent', transferCancelled, extraParentIds,
      });
      return { alreadyCancelled: false, transferCancelled };
    });
    sendPushPlan(push);
    return Response.json({ ok: true, id: requestId, status: 'cancelled', transfer_cancelled: result.transferCancelled, already_cancelled: result.alreadyCancelled });
  } catch (error) {
    if (error instanceof CancelRefusal) {
      return Response.json({ ok: false, error: error.code, message: error.userMessage, ...error.extra }, { status: error.status });
    }
    return jsonError(error);
  }
}

const formatDateKey = (dateKey: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : '';
};

/** 取り消しを、連絡しなかった側へ知らせる。送信時の通知と同じ文書を上書きして、振替を選ぶお願いを残さない。 */
function queueCancelNotifications(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: {
    user: Awaited<ReturnType<typeof getServerUser>>;
    student: FirebaseFirestore.DocumentData;
    studentId: string;
    requestId: string;
    targetDate: string;
    absenceType: string;
    transferCancelled: boolean;
    extraParentIds: string[];
  },
) {
  const { user, student, studentId, requestId, targetDate } = input;
  const label = ABSENCE_LABELS[input.absenceType] || '欠席';
  const studentName = clean(student.student_name || student.name) || '生徒';
  const senderName = user.role === 'parent'
    ? `保護者（${clean(user.profile.parent_name || user.profile.name) || '保護者'}）`
    : `${studentName}さん本人`;
  const message = [
    `${dateText(targetDate)}の${label}連絡を${senderName}が取り消しました。`,
    input.transferCancelled ? '登録されていた振替も取り消されました。' : '',
    '授業にはいつもどおり参加する予定です。',
  ].filter(Boolean).join('\n');
  const base = {
    title: `${label}連絡が取り消されました`,
    kind: user.role === 'parent' ? 'parent_absence_cancelled' : 'student_absence_cancelled',
    request_id: requestId,
    target_date: targetDate,
    absence_type: input.absenceType,
    message,
    read: false,
    read_at: null,
    created_at: FieldValue.serverTimestamp(),
  };
  if (user.role === 'parent') {
    transaction.set(db.collection('user_notifications').doc(`absence_${requestId}`), { ...base, user_id: studentId, role: 'student', link: '/student' });
  }
  const parentIds = linkedParentIds(student, input.extraParentIds).filter(parentId => parentId !== user.uid);
  parentIds
    .forEach(parentId => {
      transaction.set(db.collection('user_notifications').doc(`absence_${requestId}_parent_${parentId}`), {
        ...base, user_id: parentId, role: 'parent', student_id: studentId, student_name: studentName,
        link: `/parent?student_id=${encodeURIComponent(studentId)}`,
      });
    });
  return {
    title: base.title,
    body: `${targetDate}の${label}連絡が取り消されました。`,
    studentIds: user.role === 'parent' ? [studentId] : [],
    parentIds,
  } satisfies PushPlan;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent', 'student']);

    const body = await request.json();
    const db = adminDb();
    if (clean(body.action) === 'cancel') return await cancelAbsence(db, user, body);
    const studentId = clean(body.student_id);
    const type = clean(body.type) === 'transfer' ? 'transfer' : 'absence';
    const rawTargetDate = clean(body.target_date);
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawTargetDate) && weekdayFromDateKey(rawTargetDate)
      ? rawTargetDate
      : '';
    const reason = clean(body.reason || body.content);
    const absenceType = clean(body.absence_type) || 'absent';
    const studentSelectsTransfer = absenceType !== 'late' && Boolean(body.student_selects_transfer || body.transfer_selection_mode === 'student');

    if (!studentId || !targetDate) {
      return Response.json({ ok: false, error: 'student_id and target_date are required' }, { status: 400 });
    }
    // さかのぼって連絡できるのは3か月前まで。
    if (!isWithinAbsenceWindow(targetDate, jstTodayKey())) {
      return Response.json({ ok: false, error: ABSENCE_WINDOW_MESSAGE }, { status: 400 });
    }
    if (type === 'absence' && !reason) {
      return Response.json({ ok: false, error: 'reason is required' }, { status: 400 });
    }
    if (reason.length > 2000) {
      return Response.json({ ok: false, error: 'reason is too long' }, { status: 400 });
    }
    if (type === 'absence' && !['absent', 'late'].includes(absenceType)) {
      return Response.json({ ok: false, error: 'invalid absence_type' }, { status: 400 });
    }

    if (type === 'absence') {
      // 授業が終わった日の欠席・遅刻連絡は受け付けない（その日いちばん遅い授業＝2時間目の終了時刻まで）。
      // 振替（休んだ授業の補講）は授業後でも登録できるので、この締切は欠席・遅刻だけに使う。
      if (lessonDayEnded(targetDate, await loadLessonEnd(db))) {
        return Response.json({ ok: false, error: 'lesson-already-ended', message: LESSON_ENDED_MESSAGE }, { status: 400 });
      }
    }

    const studentSnap = await db.collection('users').doc(studentId).get();
    if (!studentSnap.exists) throw new Error('student-not-found');
    const student = studentSnap.data() || {};
    if (String(student.role || '') !== 'student') throw new Error('student-not-found');
    const isOwnStudentRequest = user.role === 'student' && user.uid === studentId;
    if (!isOwnStudentRequest && !parentLinkedTo(user, studentId, student)) throw new Error('forbidden');
    // 保護者側の student_ids にだけ登録されている保護者にも知らせる。
    const extraParentIds = await loadParentIdsListingStudent(db, studentId);

    // 同じ生徒・同じ日の欠席連絡は1件だけ有効にする（欠席⇔遅刻の変更や理由の修正は同じ記録を更新する）。
    const studentRef = db.collection('users').doc(studentId);
    const sameDayAbsenceQuery = db.collection('requests')
      .where('student_id', '==', studentId)
      .where('target_date', '==', targetDate)
      .where('type', '==', 'absence')
      .limit(10);
    const newAbsenceRef = db.collection('requests').doc(`parent_absence_${sha256(`${studentId}\u0000${targetDate}`)}`);
    const shared = (latestStudent: FirebaseFirestore.DocumentData) => ({
      user_id: studentId, student_id: studentId,
      student_name: latestStudent.student_name || latestStudent.name || '生徒',
      parent_id: user.role === 'parent' ? user.uid : clean(latestStudent.parent_uid) || null,
      parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
      source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
    });
    const replaceDuplicates = (transaction: FirebaseFirestore.Transaction, duplicates: FirebaseFirestore.QueryDocumentSnapshot[], keptId: string) => {
      duplicates.forEach(doc => transaction.set(doc.ref, {
        status: 'cancelled', replaced_by: keptId, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true }));
    };

    if (type === 'transfer') {
      const transferShiftId = clean(body.transfer_shift_id);
      const transferToken = clean(body.transfer_token);
      if (!transferShiftId || !transferToken) {
        return Response.json({ ok: false, error: 'transfer option is required' }, { status: 400 });
      }
      const pendingAbsenceId = `pending:${studentId}:${targetDate}`;
      const grant = verifyTransferOptionToken(transferToken, {
        actor_id: user.uid, student_id: studentId, absence_id: pendingAbsenceId, shift_id: transferShiftId,
      });
      // 「今日の同じ学年の授業へ振替」の署名は生徒本人のものだけ。授業時刻設定は共有キャッシュから読む。
      const gradeScope = grant.scope === 'grade';
      if (gradeScope && !isOwnStudentRequest) throw new Error('forbidden');
      const gradeScopeMasters = gradeScope ? await loadStudentClassMasters() : null;
      let push: PushPlan | null = null;
      const result = await db.runTransaction(async transaction => {
        push = null;
        const [latestStudentSnap, shiftSnap, newAbsenceSnap] = await transaction.getAll(
          studentRef,
          db.collection('shift_assignments').doc(transferShiftId),
          newAbsenceRef,
        );
        const sameDaySnap = await transaction.get(sameDayAbsenceQuery);
        if (!latestStudentSnap.exists || !shiftSnap.exists) throw new Error('transfer option not found');
        const latestStudent = latestStudentSnap.data() || {};
        const stillOwn = user.role === 'student' ? user.uid === studentId : parentLinkedTo(user, studentId, latestStudent);
        if (!stillOwn || String(latestStudent.role || '') !== 'student') throw new Error('forbidden');
        const shift = shiftSnap.data() || {};
        const shiftDate = clean(shift.target_date).slice(0, 10);
        const shiftUnit = clean(shift.unit);
        const shiftSubject = clean(shift.target_subject);
        const shiftCourse = clean(shift.target_detail_subject || shift.target_subject);
        if (shiftDate !== grant.target_date || shiftUnit !== grant.unit || shiftSubject !== grant.subject || shiftCourse !== grant.course_name) {
          throw new Error('transfer option changed; reload options');
        }
        if (shiftDate === targetDate) throw new Error('transfer date must differ from absence date');
        if (gradeScopeMasters) {
          // 署名後に配置や学年が変わっていないか、授業が終わっていないかを確定時にも確かめる。
          const today = jstTodayKey();
          if (!isTodayGradeTransferShift({ ...shift, id: transferShiftId }, { studentGrade: latestStudent.grade, targetDate: today, period: grant.period })) {
            throw new Error('transfer option changed; reload options');
          }
          if (todayPeriodEnded(gradeScopeMasters, today, grant.period)) throw new Error('transfer-target-ended');
        }

        // その日の欠席連絡がすでにあれば、それに振替をつなぐ。なければ欠席連絡を同時に作る。
        const { primary, duplicates } = pickActiveAbsence(sameDaySnap.docs);
        const absenceRef = primary ? primary.ref : newAbsenceRef;
        if (!primary && newAbsenceSnap.exists && isActiveRequest(newAbsenceSnap.data())) {
          const stale = newAbsenceSnap.data() || {};
          if (stale.student_id !== studentId || stale.target_date !== targetDate) throw new Error('absence id conflict');
        }
        const transferRef = db.collection('requests').doc(`${absenceRef.id}_transfer`);
        const existingTransferSnap = await transaction.get(transferRef);
        const existingTransfer = existingTransferSnap.exists ? existingTransferSnap.data() || {} : null;
        const existingAbsence = primary ? primary.data() : null;
        if (existingAbsence && hasRegisteredTransfer(existingAbsence)) {
          // 同じ振替先の再送信は成功扱い。別の授業への2件目の振替は受け付けない。
          if (clean(existingAbsence.transfer_request_id) === transferRef.id && existingTransfer?.transfer_shift_id === transferShiftId) {
            return { transferId: transferRef.id, absenceId: absenceRef.id };
          }
          throw new Error('transfer already registered');
        }
        if (existingTransfer && isActiveRequest(existingTransfer)) {
          if (existingTransfer.transfer_shift_id === transferShiftId && existingTransfer.student_id === studentId) {
            return { transferId: transferRef.id, absenceId: absenceRef.id };
          }
          throw new Error('transfer already registered');
        }

        const base = shared(latestStudent);
        const effectiveReason = reason || clean(existingAbsence?.reason);
        if (existingAbsence) {
          // 遅刻として連絡済みの日に振替を決めた場合は、欠席に切り替える。
          transaction.set(absenceRef, {
            absence_type: 'absent',
            ...(existingAbsence.absence_type === 'late' ? { content: `【欠席連絡】\n${effectiveReason || '振替登録と同時に欠席登録'}` } : {}),
            transfer_selection_mode: user.role === 'parent' ? 'parent' : clean(existingAbsence.transfer_selection_mode) || 'student',
            transfer_status: 'registered',
            transfer_request_id: transferRef.id,
            updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          transaction.set(absenceRef, {
            ...base, type: 'absence', absence_type: 'absent', target_date: targetDate,
            content: `【欠席連絡】\n${reason || '振替登録と同時に欠席登録'}`, reason,
            transfer_selection_mode: user.role === 'parent' ? 'parent' : 'student', transfer_status: 'registered',
            transfer_request_id: transferRef.id, transfer_required_by_parent: false, status: 'completed',
            created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
          });
        }
        replaceDuplicates(transaction, duplicates, absenceRef.id);
        transaction.set(transferRef, {
          ...base, type: 'transfer', absence_request_id: absenceRef.id, absence_date: targetDate,
          target_date: shiftDate, transfer_shift_id: transferShiftId, target_shift_id: transferShiftId,
          transfer_unit: shiftUnit || null, transfer_subject: shiftSubject || null,
          transfer_course_name: shiftCourse || null, transfer_period: grant.period || null,
          transfer_meeting_id: clean(shift.target_meeting_id) || null,
          content: `【振替確定】\n${shiftDate} ${shiftSubject} ${shiftCourse}${shiftUnit ? ` / ${shiftUnit}` : ''}\n${reason}`,
          reason, transfer_selection_mode: user.role === 'parent' ? 'parent' : 'student', transfer_status: 'registered', status: 'confirmed',
          created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
        });
        push = queueCounterpartNotifications(transaction, db, {
          user, student: latestStudent, studentId, requestId: absenceRef.id, targetDate, absenceType: 'absent', reason: effectiveReason,
          transferNote: `振替：${shiftDate} ${shiftCourse}${shiftUnit ? `（${shiftUnit}）` : ''}`,
          extraParentIds, updated: Boolean(existingAbsence),
        });
        return { transferId: transferRef.id, absenceId: absenceRef.id };
      });
      sendPushPlan(push);
      return Response.json({ ok: true, id: result.transferId, absence_id: result.absenceId, status: 'confirmed' });
    }

    let push: PushPlan | null = null;
    const result = await db.runTransaction(async transaction => {
      push = null;
      const [latestStudentSnap, newAbsenceSnap] = await transaction.getAll(studentRef, newAbsenceRef);
      const sameDaySnap = await transaction.get(sameDayAbsenceQuery);
      if (!latestStudentSnap.exists) throw new Error('student-not-found');
      const latestStudent = latestStudentSnap.data() || {};
      const stillOwn = user.role === 'student' ? user.uid === studentId : parentLinkedTo(user, studentId, latestStudent);
      if (!stillOwn || String(latestStudent.role || '') !== 'student') throw new Error('forbidden');
      const { primary, duplicates } = pickActiveAbsence(sameDaySnap.docs);
      const studentGuide = absenceType === 'late' ? '' : studentSelectsTransfer ? '振替先を選択してください。' : '必要に応じて振替登録をしてください。';
      // 保護者が振替を生徒に任せたときは、生徒の通知から振替選択へ進めるようにする（従来どおり）。
      const studentExtra = absenceType === 'late' ? {} : { kind: 'absence_transfer_required', transfer_required_by_parent: studentSelectsTransfer };

      if (primary) {
        const existing = primary.data();
        const transferRegistered = hasRegisteredTransfer(existing);
        if (absenceType === 'late' && transferRegistered) throw new Error('transfer already registered');
        // 振替の選び方は、振替がまだ決まっていないときだけ最新の連絡に合わせる。
        // 生徒本人の再送信では、保護者が「お子さまが選ぶ」にした指定を消さない。
        const selection = transferRegistered
          ? {}
          : absenceType === 'late'
            ? { transfer_selection_mode: null, transfer_status: null, transfer_required_by_parent: false }
            : studentSelectsTransfer
              ? { transfer_selection_mode: 'student', transfer_status: 'waiting_student_selection', transfer_required_by_parent: true }
              : user.role === 'parent'
                ? { transfer_selection_mode: null, transfer_status: null, transfer_required_by_parent: false }
                : {};
        const unchanged = clean(existing.absence_type || 'absent') === absenceType &&
          clean(existing.reason) === reason &&
          Object.entries(selection).every(([key, value]) => (existing[key] ?? null) === value) &&
          duplicates.length === 0;
        if (unchanged) return { id: primary.id };
        transaction.set(primary.ref, {
          absence_type: absenceType,
          content: `【欠席連絡】\n${reason}`,
          reason,
          ...selection,
          last_updated_source: user.role === 'parent' ? 'parent_portal' : 'student_portal',
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        replaceDuplicates(transaction, duplicates, primary.id);
        const studentWaiting = (selection as any).transfer_status === 'waiting_student_selection' || (!('transfer_status' in selection) && existing.transfer_status === 'waiting_student_selection');
        push = queueCounterpartNotifications(transaction, db, {
          user, student: latestStudent, studentId, requestId: primary.id, targetDate, absenceType, reason,
          studentGuide: absenceType === 'late' ? '' : transferRegistered ? '' : studentWaiting ? '振替先を選択してください。' : studentGuide,
          studentExtra: absenceType === 'late' || transferRegistered ? {} : { kind: 'absence_transfer_required', transfer_required_by_parent: studentWaiting },
          extraParentIds, updated: true,
        });
        return { id: primary.id };
      }

      if (newAbsenceSnap.exists && isActiveRequest(newAbsenceSnap.data())) {
        const stale = newAbsenceSnap.data() || {};
        if (stale.student_id !== studentId || stale.target_date !== targetDate) throw new Error('absence id conflict');
      }
      // 取り消し済みの同じIDの記録が残っていても、新しい連絡で上書きする。
      transaction.set(newAbsenceRef, {
        ...shared(latestStudent),
        type,
        absence_type: absenceType,
        target_date: targetDate,
        content: `【欠席連絡】\n${reason}`,
        reason,
        transfer_shift_id: null,
        target_shift_id: null,
        transfer_unit: null,
        transfer_subject: null,
        transfer_course_name: null,
        transfer_period: null,
        transfer_meeting_id: null,
        transfer_request_id: null,
        transfer_selection_mode: studentSelectsTransfer ? 'student' : null,
        transfer_status: studentSelectsTransfer ? 'waiting_student_selection' : null,
        transfer_required_by_parent: studentSelectsTransfer,
        status: 'completed',
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });

      push = queueCounterpartNotifications(transaction, db, {
        user, student: latestStudent, studentId, requestId: newAbsenceRef.id, targetDate, absenceType, reason,
        studentGuide, studentExtra, extraParentIds,
      });
      return { id: newAbsenceRef.id };
    });
    sendPushPlan(push);
    return Response.json({ ok: true, id: result.id, status: 'completed' });
  } catch (error) {
    return jsonError(error);
  }
}
