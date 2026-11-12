import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { jstDateKey } from '@/lib/date-key';
import { zoomApiAccessToken } from '@/lib/server/zoom-api';
import { normalizeMeetingId } from '@/lib/zoom-recording-match';
import { periodFromShift } from '@/lib/student-course-schedule';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { normalizeClassButtonSettings } from '@/lib/class-button-settings';
import {
  cameraOnMinutes, cameraRate, matchCameraCandidate, normalizeCameraMonitorRule, presentMinutes,
  type CameraCandidate, type QosSample,
} from '@/lib/camera-time';

/**
 * 授業中にカメラがオンだった分数を Zoom のダッシュボード（参加者のQoS、1分ごと）から求めて記録する。
 * 記録は、講師の声かけリスト（続けてカメラオフ）と、管理画面の「授業のカメラON率」（先生ごと・授業ごと）に使う。
 * カメラを隠してオンにもできるので、コインなどのご褒美には使わない。
 * 毎晩、その日の授業が終わったあとに1回動かす（Vercel Cron）。Zoom アプリに dashboard のスコープが要る。
 *  - 授業：今日の講師配置で Zoom のミーティングIDがあるもの。時間は授業ボタンの設定の時限の開始〜終了。
 *  - 生徒：その授業に授業ボタンで入った生徒（attendance の participations）だけを候補にし、Zoom の表示名で照らし合わせる。
 *  - 記録：camera_session_summaries/{日付}_{講師配置ID}_{生徒ID}。同じ日を処理し直すと上書きする。
 */

const ZOOM_API = 'https://api.zoom.us/v2';
const SUMMARY_COLLECTION = 'camera_session_summaries';
const clean = (value: unknown) => String(value ?? '').trim();

async function zoomGet(token: string, path: string) {
  // ダッシュボードの API は呼べる回数が少ないので、429（回数超え）のときは少し待って3回まで呼び直す。
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${ZOOM_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 429 && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    return { ok: response.ok, status: response.status, body: body as Record<string, any> };
  }
}

/** 同時に動かす数を limit までにして、順に処理する。 */
async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

/** UUID が / で始まるか // を含むときは2回エンコードする（Zoom の決まり）。 */
const encodeMeetingKey = (value: string) => (value.startsWith('/') || value.includes('//') ? encodeURIComponent(encodeURIComponent(value)) : encodeURIComponent(value));

class ZoomScopeError extends Error {}

/** ミーティング（ID か UUID）の参加者ごとの1分ごとの記録を、全ページ読む。 */
async function loadParticipantQos(token: string, meetingKey: string, type: 'past' | 'live') {
  const participants: { user_name: string; samples: QosSample[] }[] = [];
  let next = '';
  // 1ページ10人まで（Zoom の上限）。大きな会議でも読み切れるよう100ページ（1000人）まで。
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ type, page_size: '10', ...(next ? { next_page_token: next } : {}) });
    const result = await zoomGet(token, `/metrics/meetings/${encodeMeetingKey(meetingKey)}/participants/qos?${query}`);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403 || (result.status === 400 && /scope/i.test(String(result.body.message)))) throw new ZoomScopeError(String(result.body.message || result.status));
      // 終わっていない・見つからない（live で今は開いていない など）は空として扱う。
      return participants;
    }
    (Array.isArray(result.body.participants) ? result.body.participants : []).forEach((item: any) => {
      participants.push({ user_name: clean(item?.user_name), samples: Array.isArray(item?.user_qos) ? item.user_qos : [] });
    });
    next = clean(result.body.next_page_token);
    if (!next) break;
  }
  return participants;
}

/** その日に開かれたミーティング（終わったもの）の UUID を、ミーティングIDごとに集める。 */
async function listPastInstances(token: string, date: string, meetingIds: Set<string>) {
  const instances = new Map<string, string[]>();
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  const dayEnd = dayStart + 86_400_000;
  // ダッシュボードの日付は UTC なので、前の日から当日までを読んで日本時間で絞る。
  const from = new Date(dayStart).toISOString().slice(0, 10);
  const to = new Date(dayEnd).toISOString().slice(0, 10);
  let next = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ type: 'past', from, to, page_size: '300', ...(next ? { next_page_token: next } : {}) });
    const result = await zoomGet(token, `/metrics/meetings?${query}`);
    if (!result.ok) {
      if ([400, 401, 403].includes(result.status)) throw new ZoomScopeError(String(result.body.message || result.status));
      throw new Error(`zoom-metrics-meetings-${result.status}`);
    }
    (Array.isArray(result.body.meetings) ? result.body.meetings : []).forEach((meeting: any) => {
      const id = normalizeMeetingId(meeting?.id);
      const start = Date.parse(clean(meeting?.start_time));
      const end = Date.parse(clean(meeting?.end_time)) || start;
      if (!meetingIds.has(id) || !clean(meeting?.uuid) || end < dayStart || start >= dayEnd) return;
      instances.set(id, [...(instances.get(id) || []), clean(meeting.uuid)]);
    });
    next = clean(result.body.next_page_token);
    if (!next) break;
  }
  return instances;
}

type ShiftWindow = {
  id: string; meetingId: string; startMs: number; endMs: number; label: string;
  period: number; teacherId: string; teacherName: string; grade: string; subject: string; detailSubject: string;
};

export async function runCameraTimeRecords(options: { date?: string; dryRun?: boolean } = {}) {
  const date = options.date || jstDateKey();
  const db = adminDb();
  const [missionSnap, masters] = await Promise.all([db.collection('settings').doc('mission_control').get(), loadStudentClassMasters()]);
  const rule = normalizeCameraMonitorRule(missionSnap.data()?.camera_monitor);
  if (!rule.enabled && !options.dryRun) return { date, skipped: 'disabled' as const };
  const classSettings = normalizeClassButtonSettings(masters.classButtonSettingsData || {});
  const periodTimes: Record<number, [string, string]> = {
    1: [classSettings.period1_start, classSettings.period1_end],
    2: [classSettings.period2_start, classSettings.period2_end],
  };

  // 今日の授業（ミーティングIDがあるもの）と、その時限の時間。
  const shiftSnap = await db.collection('shift_assignments').where('target_date', '==', date).limit(2000).get();
  const shifts: ShiftWindow[] = [];
  shiftSnap.docs.forEach(doc => {
    const data = doc.data() || {};
    const meetingId = normalizeMeetingId(data.target_meeting_id);
    const period = periodFromShift({ id: doc.id, ...data });
    const times = periodTimes[Number(period)];
    if (!meetingId || !times) return;
    const startMs = Date.parse(`${date}T${times[0]}:00+09:00`);
    const endMs = Date.parse(`${date}T${times[1]}:00+09:00`);
    if (!Number.isFinite(startMs) || !(endMs > startMs)) return;
    shifts.push({
      id: doc.id, meetingId, startMs, endMs,
      label: [data.target_grade, data.target_subject, data.target_detail_subject].map(clean).filter(Boolean).join(' '),
      period: Number(period),
      teacherId: clean(data.user_id || data.teacher_id),
      teacherName: clean(data.teacher_name),
      grade: clean(data.target_grade),
      subject: clean(data.target_subject),
      detailSubject: clean(data.target_detail_subject),
    });
  });
  if (!shifts.length) return { date, shifts: 0, students: 0, saved: 0 };

  // 授業ボタンで入った生徒を、授業ごとの候補にする。
  const attendanceSnap = await db.collection('attendance').where('target_date', '==', date).select('user_id', 'student_id', 'participations').limit(5000).get();
  const candidatesByShift = new Map<string, Set<string>>();
  attendanceSnap.docs.forEach(doc => {
    const data = doc.data();
    const studentId = clean(data.student_id || data.user_id);
    if (!studentId) return;
    (Array.isArray(data.participations) ? data.participations : []).forEach((part: any) => {
      const shiftId = clean(part?.class_id);
      if (!shiftId) return;
      candidatesByShift.set(shiftId, (candidatesByShift.get(shiftId) || new Set()).add(studentId));
    });
  });
  const targetShifts = shifts.filter(shift => candidatesByShift.get(shift.id)?.size);
  if (!targetShifts.length) return { date, shifts: 0, students: 0, saved: 0 };
  const studentIds = Array.from(new Set(targetShifts.flatMap(shift => Array.from(candidatesByShift.get(shift.id) || []))));
  const profiles = new Map<string, FirebaseFirestore.DocumentData>();
  for (let index = 0; index < studentIds.length; index += 100) {
    const snaps = await db.getAll(...studentIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
    snaps.forEach(snap => { if (snap.exists && clean(snap.data()?.role) === 'student') profiles.set(snap.id, snap.data() || {}); });
  }

  // Zoom：その日の終わったミーティングと、まだ開いているミーティングの、参加者ごとの1分ごとの記録。
  const token = await zoomApiAccessToken();
  const meetingIds = new Set(targetShifts.map(shift => shift.meetingId));
  let instances: Map<string, string[]>;
  try {
    instances = await listPastInstances(token, date, meetingIds);
  } catch (error) {
    if (error instanceof ZoomScopeError) return { date, skipped: 'zoom-scope-missing' as const, detail: error.message.slice(0, 200) };
    throw error;
  }
  const participantsByMeeting = new Map<string, { user_name: string; samples: QosSample[] }[]>();
  try {
    // 会議ごとに順番に読むと時間切れになる（11/9、60秒）ので、終わった回とまだ開いている回をまとめて、4つずつ並べて読む。
    const jobs = Array.from(meetingIds).flatMap(meetingId => [
      ...(instances.get(meetingId) || []).map(uuid => ({ meetingId, key: uuid, type: 'past' as const })),
      { meetingId, key: meetingId, type: 'live' as const },
    ]);
    const lists = await mapLimit(jobs, 4, job => loadParticipantQos(token, job.key, job.type));
    jobs.forEach((job, index) => {
      participantsByMeeting.set(job.meetingId, [...(participantsByMeeting.get(job.meetingId) || []), ...lists[index]]);
    });
  } catch (error) {
    if (error instanceof ZoomScopeError) return { date, skipped: 'zoom-scope-missing' as const, detail: error.message.slice(0, 200) };
    throw error;
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedNames = new Set<string>();
  let emptyNames = 0;
  let candidateCount = 0;
  let saved = 0;
  const results: { shift_id: string; student_id: string; camera_minutes: number; present_minutes: number; camera_rate: number | null }[] = [];
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  for (const shift of targetShifts) {
    const candidates: CameraCandidate[] = Array.from(candidatesByShift.get(shift.id) || [])
      .filter(id => profiles.has(id))
      .map(id => ({ id, name: clean(profiles.get(id)!.student_name || profiles.get(id)!.name), lifetimeId: clean(profiles.get(id)!.lifetime_id || profiles.get(id)!.student_number) }));
    candidateCount += candidates.length;
    const samplesByStudent = new Map<string, { samples: QosSample[]; names: Set<string> }>();
    (participantsByMeeting.get(shift.meetingId) || []).forEach(participant => {
      if (!presentMinutes(participant.samples, shift.startMs, shift.endMs).size) return;
      const student = matchCameraCandidate(participant.user_name, candidates);
      if (!student) {
        unmatched += 1;
        if (!participant.user_name) emptyNames += 1;
        else unmatchedNames.add(`${shift.id}\u0000${participant.user_name}`);
        return;
      }
      const entry = samplesByStudent.get(student.id) || { samples: [], names: new Set<string>() };
      entry.samples.push(...participant.samples);
      entry.names.add(participant.user_name.slice(0, 60));
      samplesByStudent.set(student.id, entry);
    });
    for (const [studentId, entry] of samplesByStudent) {
      matched += 1;
      const cameraMinutes = cameraOnMinutes(entry.samples, shift.startMs, shift.endMs).size;
      const present = presentMinutes(entry.samples, shift.startMs, shift.endMs).size;
      const rate = cameraRate(cameraMinutes, present);
      results.push({ shift_id: shift.id, student_id: studentId, camera_minutes: cameraMinutes, present_minutes: present, camera_rate: rate });
      if (options.dryRun) continue;
      const profile = profiles.get(studentId) || {};
      writes.push({ ref: db.collection(SUMMARY_COLLECTION).doc(`${date}_${shift.id}_${studentId}`.replace(/[\/\s#?]/g, '_')), data: {
        student_id: studentId,
        classroom: clean(profile.classroom || profile.school || profile.school_id),
        shift_id: shift.id,
        target_date: date,
        period: shift.period,
        teacher_id: shift.teacherId,
        teacher_name: shift.teacherName,
        grade: shift.grade,
        subject: shift.subject,
        detail_subject: shift.detailSubject,
        lesson_label: shift.label,
        lesson_minutes: Math.round((shift.endMs - shift.startMs) / 60_000),
        present_minutes: present,
        camera_minutes: cameraMinutes,
        camera_rate: rate,
        zoom_names: Array.from(entry.names).slice(0, 5),
        updated_at: FieldValue.serverTimestamp(),
      } });
    }
  }
  // 1回のまとめ書きは500件までなので、400件ずつ書く。
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
    saved += Math.min(400, writes.length - index);
  }
  return {
    date,
    rule,
    shifts: targetShifts.length,
    meetings: meetingIds.size,
    zoom_participants: Array.from(participantsByMeeting.values()).reduce((sum, list) => sum + list.length, 0),
    matched,
    unmatched,
    saved,
    // 試しのときだけ、照らし合わせの様子（名前は出さず件数だけ）と結果を返す。
    ...(options.dryRun ? { candidates: candidateCount, unmatched_distinct: unmatchedNames.size, unmatched_empty_name: emptyNames, preview: results.slice(0, 50) } : {}),
  };
}
