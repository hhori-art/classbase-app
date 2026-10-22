import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { buildZoomJoinUrl, hasZoomPasswordToken } from '@/lib/zoom-url';
import { fetchOfficialZoomJoinUrl } from '@/lib/zoom-meeting';
import { weekdayFromDateKey } from '@/lib/date-key';
import { normalizeCourseText } from '@/lib/course-text';
import {
  getShiftJoinUrl,
  getShiftMeetingId,
  isStudentVisibleShift,
  normalizeGrade,
  periodFromShift,
  preferSheetSyncedShifts,
} from '@/lib/student-course-schedule';
import { loadTodayLessonSources, resolveTodayEligibility } from '@/lib/server/student-today-lessons';
import { issueClassParticipationToken } from '@/lib/server/class-participation-token';

export const runtime = 'nodejs';

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
};

const normalize = normalizeCourseText;

const buildZoomUrl = (shift: any) => {
  return buildZoomJoinUrl({
    meetingId: getShiftMeetingId(shift),
    joinUrl: getShiftJoinUrl(shift),
  });
};

const resolveStudentZoomUrl = async (shift: any) => {
  const existingUrl = buildZoomUrl(shift);
  if (hasZoomPasswordToken(existingUrl)) return existingUrl;

  const meetingId = getShiftMeetingId(shift);
  if (!meetingId) return existingUrl;

  try {
    const officialJoinUrl = await fetchOfficialZoomJoinUrl(meetingId);
    if (!officialJoinUrl) return existingUrl;
    if (shift.id && !shift._schedule_fallback) {
      await adminDb().collection('shift_assignments').doc(String(shift.id)).set({
        target_join_url: officialJoinUrl,
        zoom_join_url_updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return officialJoinUrl;
  } catch (error) {
    console.warn('[today-classes] Zoom join URL refresh failed', {
      shift_id: shift.id || null,
      meeting_id: meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return existingUrl;
  }
};

const uniqueValues = (values: unknown[]) => Array.from(new Set(
  values.map(value => String(value || '').trim()).filter(Boolean)
));

const mergeClassCandidates = (classes: any[]) => {
  const groups = new Map<string, any[]>();
  classes.forEach(item => {
    const meetingKey = String(item.meeting_id || '').replace(/\D/g, '');
    const key = [
      item.target_date || '',
      item.period || '',
      meetingKey || item.url || item.id,
    ].join('__');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });

  return Array.from(groups.values()).map(group => {
    const first = group[0];
    if (group.length === 1) return first;
    const subjects = uniqueValues(group.map(item => item.subject));
    const courseNames = uniqueValues(group.map(item => item.course_name));
    const units = uniqueValues(group.map(item => item.unit));
    const reasons = uniqueValues(group.map(item => item.match_reason));
    return {
      ...first,
      id: uniqueValues(group.map(item => item.id)).join('__'),
      subject: courseNames.length > 0 ? courseNames.join(' / ') : subjects.join(' / ') || first.subject,
      course_name: courseNames.join(' / '),
      unit: units.join(' / '),
      match_reason: reasons.join(' / ') || first.match_reason,
      merged_shift_ids: uniqueValues(group.map(item => item.id)),
    };
  });
};

const pickStudentFacingTransferShifts = (shifts: any[]) => {
  const groups = new Map<string, any[]>();
  shifts.forEach(shift => {
    const key = [
      shift.target_date || '',
      normalizeGrade(shift.target_grade),
      periodFromShift(shift),
    ].join('__');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });

  return Array.from(groups.values()).flatMap(group => {
    return preferSheetSyncedShifts(group);
  });
};

const recurringShiftFallback = async (targetDate: string, period: number) => {
  const snapshot = await adminDb().collection('shift_assignments')
    .where('target_date', '>=', addDaysToDateKey(targetDate, -35))
    .where('target_date', '<=', addDaysToDateKey(targetDate, 35))
    .orderBy('target_date', 'desc')
    .limit(500)
    .get();
  const weekday = weekdayFromDateKey(targetDate);
  const candidates = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(isStudentVisibleShift)
    .filter((shift: any) => shift.target_date !== targetDate)
    .filter((shift: any) => weekdayFromDateKey(shift.target_date) === weekday)
    .filter((shift: any) => !period || periodFromShift(shift) === period);
  const unique = new Map<string, any>();
  preferSheetSyncedShifts(candidates).forEach((shift: any) => {
    const key = [
      normalizeGrade(shift.target_grade),
      normalize(shift.target_subject),
      normalize(shift.target_detail_subject),
      periodFromShift(shift),
      getShiftMeetingId(shift),
    ].join('__');
    if (!unique.has(key)) unique.set(key, {
      ...shift,
      id: `schedule_fallback_${shift.id}_${targetDate}`,
      _source_shift_id: shift.id,
      _schedule_fallback: true,
      target_date: targetDate,
    });
  });
  return Array.from(unique.values());
};

const attachParticipationTokens = (classes: any[], studentId: string, targetDate: string) => classes.map(item => ({
  ...item,
  participation_token: issueClassParticipationToken({
    student_id: studentId,
    class_id: String(item.id || ''),
    target_date: String(item.target_date || targetDate),
    subject: String(item.subject || '授業'),
    course_name: String(item.course_name || item.subject || '授業'),
  }),
}));

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);

    const params = request.nextUrl.searchParams;
    const previewMode = params.get('preview') === 'teacher';
    const betaTransferMode = params.get('beta_transfer') === '1' || params.get('beta_transfer') === 'true';
    if (previewMode) requireRole(user, ['teacher', 'master', 'admin']);
    else requireRole(user, ['student']);
    // 振替候補は、署名付き候補から確定したrequestsの経路だけを信頼する。
    // 同学年だけで参加トークンを発行する旧beta経路は未登録授業への参加を許すため廃止する。
    if (betaTransferMode) {
      return Response.json({ ok: false, error: 'transfer registration is required' }, { status: 400 });
    }

    const period = Number(params.get('period') || 0);
    const db = adminDb();

    const sources = await loadTodayLessonSources(db, { studentId: previewMode ? null : user.uid, period });
    const { targetDate, transferRequests } = sources;
    let rawShifts = sources.rawShifts;
    let scheduleFallbackUsed = false;
    if (rawShifts.length === 0 && previewMode) {
      rawShifts = await recurringShiftFallback(targetDate, period);
      scheduleFallbackUsed = rawShifts.length > 0;
      console.warn('[today-classes] today placement missing; recurring schedule fallback used', {
        target_date: targetDate,
        period,
        fallback_count: rawShifts.length,
      });
    }
    const shifts = preferSheetSyncedShifts(rawShifts);

    const { eligibleShiftIds, eligibleReasons, testPrepShiftIds } = resolveTodayEligibility({
      shifts,
      registrationDocs: sources.registrationDocs,
      transferRequests,
      masters: sources.masters,
      profile: user.profile,
      targetDate,
    });

    if (previewMode) {
      const previewShifts = pickStudentFacingTransferShifts(shifts);
      const classes = mergeClassCandidates(await Promise.all(previewShifts.map(async (shift: any) => ({
        id: shift.id,
        url: await resolveStudentZoomUrl(shift),
        meeting_id: getShiftMeetingId(shift),
        grade: normalizeGrade(shift.target_grade || shift.grade),
        subject: shift.target_detail_subject || shift.target_subject || shift.subject || '授業',
        course_name: shift.target_detail_subject || '',
        unit: shift.unit || '',
        period: periodFromShift(shift),
        target_date: shift.target_date || targetDate,
        source: 'teacher_preview',
        match_reason: 'テスト表示',
      }))));
      return Response.json(
        { ok: true, date: targetDate, period, classes, preview: true, schedule_fallback: scheduleFallbackUsed },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    let matchedClasses = shifts
      .map((shift: any) => ({
        shift,
        source: transferRequests.some((req: any) => [req.transfer_shift_id, req.target_shift_id, req.shift_assignment_id].includes(shift.id))
          ? 'transfer'
          : testPrepShiftIds.has(String(shift.id))
            ? 'test_prep'
          : eligibleShiftIds.has(shift.id)
            ? 'course_registration'
            : 'unmatched',
      }))
      .filter(item => eligibleShiftIds.has(item.shift.id));
    const classes = attachParticipationTokens(mergeClassCandidates(await Promise.all(matchedClasses
      .map(async item => ({
        id: item.shift.id,
        url: await resolveStudentZoomUrl(item.shift),
        meeting_id: getShiftMeetingId(item.shift),
        grade: normalizeGrade(item.shift.target_grade || item.shift.grade),
        subject: item.shift.target_detail_subject || item.shift.target_subject || item.shift.subject || '授業',
        course_name: item.shift.target_detail_subject || '',
        unit: item.shift.unit || '',
        period: periodFromShift(item.shift),
        target_date: item.shift.target_date || targetDate,
        source: item.source,
        match_reason: eligibleReasons.get(String(item.shift.id)) || '受講登録と一致',
      })))), user.uid, targetDate);

    return Response.json({
      ok: true,
      date: targetDate,
      period,
      classes,
      matching_mode: 'exact',
      schedule_missing: shifts.length === 0,
      schedule_fallback: scheduleFallbackUsed,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
