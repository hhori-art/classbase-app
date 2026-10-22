import 'server-only';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { getServerUser } from '@/lib/server-auth';

/**
 * 保護者に見せる「授業の受講記録」。
 * 授業日ごとに、どの教科を Zoom で受けたか・録画で見たか・欠席連絡があったかをまとめる。
 */

export type LessonRecordingWatch = {
  recording_id: string;
  first_watched_at_ms: number;
  last_watched_at_ms: number;
  watched_seconds: number;
  duration_seconds: number;
  completed: boolean;
};

export type LessonEntry = {
  key: string;
  subject: string;
  detail_subject: string;
  course_name: string;
  unit: string;
  title: string;
  period: number;
  live: boolean;
  recording: LessonRecordingWatch | null;
};

export type LessonDay = {
  date: string;
  classes: LessonEntry[];
  absence: { kind: 'absent' | 'late'; reason: string; status: string; by: string } | null;
  transfer: { title: string; status: string } | null;
};

const clean = (value: unknown, max = 500) => String(value || '').normalize('NFKC').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;
const subjectKey = (value: unknown) => clean(value, 200).replace(/\s+/g, '');

/** 「中2理科 生物」と「生物」のように、片方がもう片方を含めば同じ教科とみなす。 */
const sameSubject = (a: string, b: string) => {
  const x = subjectKey(a);
  const y = subjectKey(b);
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
};

/** 保護者に紐づく生徒だけを返す。紐づかなければ forbidden。 */
export async function loadLinkedStudentForParent(actor: Awaited<ReturnType<typeof getServerUser>>, studentId: string) {
  const db = adminDb();
  const snap = await db.collection('users').doc(studentId).get();
  const data = snap.data() || {};
  const listed = (Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids : []).map(value => clean(value, 128));
  if (!snap.exists || clean(data.role, 40) !== 'student' || (!listed.includes(studentId) && clean(data.parent_uid, 128) !== actor.uid)) {
    throw new Error('forbidden');
  }
  return { id: snap.id, data };
}

/**
 * 録画視聴は「生徒×録画」で1件。期間内の授業の録画は期間開始以降に見ているので、
 * updated_at で期間を切って新しい順に取る（複合インデックス recording_views(user_id, updated_at DESC)）。
 * インデックスが使えないときだけ、従来の上限つき取得に戻す。
 */
async function loadRecentViews(studentId: string, fromDate: string, limit: number) {
  const views = adminDb().collection('recording_views').where('user_id', '==', studentId);
  try {
    const since = Timestamp.fromDate(new Date(`${fromDate}T00:00:00+09:00`));
    return await views.where('updated_at', '>=', since).orderBy('updated_at', 'desc').limit(limit).get();
  } catch (error) {
    console.warn('[parent-learning-history] recording_views fallback', error);
    return views.limit(limit).get();
  }
}

type RequestDocs = { docs: FirebaseFirestore.QueryDocumentSnapshot[] };

export async function loadLessonDays(studentId: string, options: {
  /** この日付（YYYY-MM-DD）以降の出席を読む */
  fromDate: string;
  attendanceLimit?: number;
  viewLimit?: number;
  /** true のとき、録画視聴を fromDate 以降に更新されたものだけ新しい順に読む（件数の集計向け） */
  viewsSinceFromDate?: boolean;
  requestLimit?: number;
  /** 呼び出し側で読み込み済みの欠席・振替の requests（二重に読まないため） */
  requests?: { absence: RequestDocs; transfer: RequestDocs };
}) {
  const db = adminDb();
  const requestLimit = options.requestLimit ?? 60;
  const [attendanceSnap, viewSnap, absenceSnap, transferSnap] = await Promise.all([
    // 出席のドキュメントIDは「生徒ID_日付」なので、ID の範囲で期間を絞る（新しい日付を取りこぼさない）。
    db.collection('attendance')
      .where(FieldPath.documentId(), '>=', `${studentId}_${options.fromDate}`)
      .where(FieldPath.documentId(), '<=', `${studentId}_9999`)
      .limit(options.attendanceLimit ?? 250).get(),
    options.viewsSinceFromDate
      ? loadRecentViews(studentId, options.fromDate, options.viewLimit ?? 300)
      : db.collection('recording_views').where('user_id', '==', studentId).limit(options.viewLimit ?? 300).get(),
    options.requests?.absence ?? db.collection('requests').where('user_id', '==', studentId).where('type', '==', 'absence').limit(requestLimit).get(),
    options.requests?.transfer ?? db.collection('requests').where('user_id', '==', studentId).where('type', '==', 'transfer').limit(requestLimit).get(),
  ]);

  const recordingIds = Array.from(new Set(viewSnap.docs.map(doc => clean(doc.data().recording_id, 300)).filter(Boolean)));
  const recordingDocs = recordingIds.length
    ? await db.getAll(...recordingIds.map(id => db.collection('class_recordings').doc(id)))
    : [];
  const recordings = new Map(recordingDocs.filter(doc => doc.exists).map(doc => [doc.id, doc.data() || {}]));

  const days = new Map<string, LessonDay>();
  const dayFor = (date: string) => {
    if (!days.has(date)) days.set(date, { date, classes: [], absence: null, transfer: null });
    return days.get(date)!;
  };

  attendanceSnap.docs.forEach(doc => {
    const data = doc.data() || {};
    const date = clean(data.target_date || data.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || clean(data.user_id, 128) !== studentId) return;
    const type = clean(data.type || data.status || data.attendance_status, 40);
    if (type === 'absent' || type === 'absence') {
      const day = dayFor(date);
      if (!day.absence) day.absence = { kind: 'absent', reason: clean(data.reason || data.note, 300), status: 'recorded', by: 'school' };
      return;
    }
    const participations = Array.isArray(data.participations) && data.participations.length
      ? data.participations
      : [{ subject: data.subject, course_name: data.course_name }];
    const day = dayFor(date);
    participations.forEach((item: any) => {
      const subject = clean(item?.subject, 160) || '授業';
      const existing = day.classes.find(entry => sameSubject(entry.subject, subject));
      if (existing) { existing.live = true; return; }
      day.classes.push({ key: `${date}_live_${day.classes.length}`, subject, detail_subject: '', course_name: clean(item?.course_name, 160), unit: '', title: '', period: 0, live: true, recording: null });
    });
  });

  viewSnap.docs.forEach(doc => {
    const view = doc.data() || {};
    const recording = recordings.get(clean(view.recording_id, 300));
    if (!recording) return;
    const date = clean(recording.target_date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const subject = clean(recording.subject || recording.target_subject, 80);
    const detail = clean(recording.detail_subject || recording.target_detail_subject, 80);
    const watch: LessonRecordingWatch = {
      recording_id: doc.id,
      first_watched_at_ms: Number(view.started_at_ms) || millis(view.started_at) || millis(view.created_at),
      last_watched_at_ms: millis(view.completed_at) || millis(view.updated_at) || Number(view.started_at_ms) || 0,
      watched_seconds: Math.max(0, Number(view.watched_seconds) || 0),
      duration_seconds: Math.max(0, Number(view.duration_seconds) || Number(recording.recording_duration_seconds) || 0),
      completed: clean(view.status, 40) === 'completed',
    };
    const day = dayFor(date);
    const existing = day.classes.find(entry => !entry.recording && (sameSubject(entry.subject, detail) || sameSubject(entry.subject, subject)));
    const info = { detail_subject: detail, unit: clean(recording.unit, 160), title: clean(recording.title, 160), period: Number(recording.period) || 0 };
    if (existing) {
      Object.assign(existing, { ...info, subject: existing.subject || subject, recording: watch });
      return;
    }
    day.classes.push({ key: `${date}_rec_${doc.id}`, subject: subject || detail || '授業', course_name: '', ...info, live: false, recording: watch });
  });

  absenceSnap.docs.forEach(doc => {
    const data = doc.data() || {};
    const date = clean(data.target_date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const status = clean(data.status, 40);
    if (status === 'cancelled' || status === 'rejected') return;
    const day = dayFor(date);
    day.absence = {
      kind: clean(data.absence_type, 20) === 'late' ? 'late' : 'absent',
      reason: clean(data.reason || data.content, 300),
      status: status || 'pending',
      by: clean(data.source, 40) === 'parent_portal' ? 'parent' : clean(data.source, 40) === 'student_portal' ? 'student' : 'school',
    };
  });

  transferSnap.docs.forEach(doc => {
    const data = doc.data() || {};
    const date = clean(data.target_date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    dayFor(date).transfer = { title: clean(data.transfer_title || data.transfer_course_name || data.title, 160) || '振替授業', status: clean(data.status, 40) || 'pending' };
  });

  days.forEach(day => day.classes.sort((a, b) => (a.period || 9) - (b.period || 9) || a.subject.localeCompare(b.subject, 'ja')));
  return Array.from(days.values()).filter(day => day.date >= options.fromDate).sort((a, b) => b.date.localeCompare(a.date));
}

/** 今日（日本時間）から days 日前の日付キー */
export function jstDateKeyDaysAgo(days: number) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}
