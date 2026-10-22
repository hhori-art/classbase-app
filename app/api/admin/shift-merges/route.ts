import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, type ServerUser } from '@/lib/server-auth';
import { canManageAdminApp } from '@/lib/admin-app-access';
import { writeAuditLog } from '@/lib/server/audit-log';
import { isMainLessonShift, periodFromShift } from '@/lib/student-course-schedule';
import {
  MERGE_MEMBER_FIELDS,
  mergeAudienceOf,
  mergeMemberPatch,
  ownShiftMeetingId,
  validateShiftMerge,
  type ShiftMergeAudience,
} from '@/lib/shift-merge';

export const runtime = 'nodejs';

/** 授業の合併を見られる・変更できるのは、マスターと理社講座の管理者（理社講座の権限を持つ管理者）だけ。 */
const canManageShiftMerges = (user: ServerUser) => canManageAdminApp(user, 'science_social');

const clean = (value: unknown) => String(value ?? '').trim();
const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 指定した日のメイン授業の講師配置と、合併の状態（授業の合併の画面用）。 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canManageShiftMerges(actor)) throw new Error('forbidden');
    const date = clean(request.nextUrl.searchParams.get('date'));
    if (!isDateKey(date)) return Response.json({ ok: false, error: '日付を指定してください。' }, { status: 400 });
    const snap = await adminDb().collection('shift_assignments').where('target_date', '==', date).limit(500).get();
    const shifts = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }))
      .filter(isMainLessonShift)
      .map(shift => ({
        id: shift.id,
        target_date: shift.target_date,
        period: periodFromShift(shift),
        grade: clean(shift.target_grade),
        subject: clean(shift.target_subject),
        detail_subject: clean(shift.target_detail_subject),
        unit: clean(shift.unit),
        teacher_name: clean(shift.teacher_name),
        school: clean(shift.school_name || shift.school),
        meeting_id: ownShiftMeetingId(shift),
        merge_host_shift_id: clean(shift.merge_host_shift_id) || null,
        merge_host_label: clean(shift.merge_host_label) || null,
        merge_audiences: Array.isArray(shift.merge_audiences) ? shift.merge_audiences : [],
      }))
      .sort((a, b) => a.period - b.period || a.grade.localeCompare(b.grade, 'ja') || a.subject.localeCompare(b.subject, 'ja'));
    return Response.json({ ok: true, date, shifts });
  } catch (error) {
    return jsonError(error);
  }
}

/** 合併する（action=merge）・解除する（action=unmerge）。 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canManageShiftMerges(actor)) throw new Error('forbidden');
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action);
    const db = adminDb();
    const shifts = db.collection('shift_assignments');

    if (action === 'merge') {
      const hostId = clean(body.host_shift_id);
      const memberIds: string[] = Array.from(new Set<string>((Array.isArray(body.shift_ids) ? body.shift_ids : []).map(clean).filter(Boolean)));
      if (!hostId || memberIds.length === 0 || memberIds.length > 20) {
        return Response.json({ ok: false, error: '合併先と、合併する授業（20件まで）を選んでください。' }, { status: 400 });
      }
      const result = await db.runTransaction(async transaction => {
        const [hostSnap, ...memberSnaps] = await transaction.getAll(shifts.doc(hostId), ...memberIds.map(id => shifts.doc(id)));
        const host = hostSnap.exists ? hostSnap.data() || {} : null;
        const members = memberSnaps.map(snap => ({ id: snap.id, data: snap.exists ? snap.data() || {} : null }));
        const error = validateShiftMerge({ hostId, host, members, periodOf: periodFromShift });
        if (error) return { error };
        const patch = { ...mergeMemberPatch(hostId, host!), merged_at: FieldValue.serverTimestamp(), merged_by: actor.uid };
        members.forEach(member => transaction.set(shifts.doc(member.id), patch, { merge: true }));
        const current: ShiftMergeAudience[] = Array.isArray(host!.merge_audiences) ? host!.merge_audiences : [];
        const audiences = new Map(current.map(item => [item.shift_id, item]));
        members.forEach(member => audiences.set(member.id, mergeAudienceOf(member.id, member.data!)));
        transaction.set(shifts.doc(hostId), {
          merge_audiences: Array.from(audiences.values()),
          merged_shift_ids: Array.from(audiences.keys()),
          merge_updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { error: '', host: host!, members };
      });
      if (result.error) return Response.json({ ok: false, error: result.error }, { status: 400 });
      await writeAuditLog({
        actor, action: 'shift_merge', target_type: 'shift_assignment', target_id: hostId,
        target_label: [result.host?.target_date, mergeMemberPatch(hostId, result.host || {}).merge_host_label].filter(Boolean).join(' '),
        details: { host_shift_id: hostId, merged_shift_ids: memberIds },
      });
      return Response.json({ ok: true, host_shift_id: hostId, merged_shift_ids: memberIds });
    }

    if (action === 'unmerge') {
      const shiftId = clean(body.shift_id);
      if (!shiftId) return Response.json({ ok: false, error: '解除する授業を選んでください。' }, { status: 400 });
      const result = await db.runTransaction(async transaction => {
        const memberSnap = await transaction.get(shifts.doc(shiftId));
        const member = memberSnap.exists ? memberSnap.data() || {} : null;
        const hostId = clean(member?.merge_host_shift_id);
        if (!member || !hostId) return { error: 'この授業は合併されていません。' };
        const hostSnap = await transaction.get(shifts.doc(hostId));
        transaction.set(shifts.doc(shiftId), Object.fromEntries(MERGE_MEMBER_FIELDS.map(field => [field, FieldValue.delete()])), { merge: true });
        if (hostSnap.exists) {
          const remaining = ((hostSnap.data()?.merge_audiences || []) as ShiftMergeAudience[]).filter(item => item.shift_id !== shiftId);
          transaction.set(shifts.doc(hostId), {
            merge_audiences: remaining,
            merged_shift_ids: remaining.map(item => item.shift_id),
            merge_updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return { error: '', hostId };
      });
      if (result.error) return Response.json({ ok: false, error: result.error }, { status: 400 });
      await writeAuditLog({
        actor, action: 'shift_unmerge', target_type: 'shift_assignment', target_id: shiftId,
        details: { shift_id: shiftId, host_shift_id: result.hostId },
      });
      return Response.json({ ok: true, shift_id: shiftId });
    }

    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
