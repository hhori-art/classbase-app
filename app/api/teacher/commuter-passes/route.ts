import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, canManageAttendanceSchool, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { cleanFareLabel, normalizeTransportType } from '@/lib/transport-fares';
import { createEkispertCommuterPass } from '@/lib/transport-fare-providers';

export const runtime = 'nodejs';

const activeStatuses = new Set(['active', 'renewed']);

const toDateKey = (value: unknown) => String(value || '').slice(0, 10);

function todayKey() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDaysKey(days: number) {
  const date = new Date(`${todayKey()}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isActivePass(data: FirebaseFirestore.DocumentData) {
  const status = String(data.status || 'active');
  const endDate = toDateKey(data.end_date);
  return activeStatuses.has(status) && (!endDate || endDate >= todayKey());
}

async function requireTargetAccess(user: Awaited<ReturnType<typeof getServerUser>>, teacherId: string) {
  if (teacherId === user.uid) return;
  const target = await adminDb().collection('users').doc(teacherId).get();
  if (!target.exists || !canManageAttendanceSchool(user, target.data()?.school_id || target.data()?.school)) throw new Error('forbidden');
}

function passView(id: string, data: FirebaseFirestore.DocumentData) {
  const active = isActivePass(data);
  const endDate = toDateKey(data.end_date);
  return {
    id,
    ...data,
    active,
    expired: Boolean(endDate) && endDate < todayKey(),
    needs_confirmation: active && endDate <= addDaysKey(14),
  };
}

/** 勤怠管理者：担当校舎の講師の定期をまとめて確認する。 */
async function listManagedPasses(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (!canManageAttendance(user)) throw new Error('forbidden');
  const db = adminDb();
  const docs = await getAllQueryDocuments(db.collection('teacher_commuter_passes'));
  const teacherIds = Array.from(new Set(docs.map(doc => String(doc.data()?.teacher_id || '')).filter(Boolean)));
  const teachers = new Map<string, FirebaseFirestore.DocumentData>();
  for (let index = 0; index < teacherIds.length; index += 100) {
    const snaps = await db.getAll(...teacherIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
    snaps.forEach(snap => { if (snap.exists) teachers.set(snap.id, snap.data() || {}); });
  }
  return docs
    .map(doc => {
      const data = doc.data() || {};
      const teacher = teachers.get(String(data.teacher_id || '')) || {};
      const school = String(teacher.school_id || teacher.school || '');
      return { ...passView(doc.id, data), teacher_name: teacher.name || teacher.teacher_name || data.teacher_name || '', teacher_school: school };
    })
    .filter(pass => canManageAttendanceSchool(user, pass.teacher_school))
    .sort((a: any, b: any) => String(a.end_date || '').localeCompare(String(b.end_date || '')));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin', 'admin', 'master']);

    if (request.nextUrl.searchParams.get('scope') === 'managed') {
      return Response.json({ ok: true, passes: await listManagedPasses(user) });
    }

    const teacherId = request.nextUrl.searchParams.get('teacher_id') || user.uid;
    await requireTargetAccess(user, teacherId);

    const snap = await adminDb()
      .collection('teacher_commuter_passes')
      .where('teacher_id', '==', teacherId)
      .limit(20)
      .get();

    const passes = snap.docs
      .map(doc => passView(doc.id, doc.data() || {}))
      .sort((a: any, b: any) => String(b.end_date || '').localeCompare(String(a.end_date || '')));

    return Response.json({ ok: true, passes });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin', 'admin', 'master']);

    const body = await request.json().catch(() => ({}));
    const teacherId = String(body.teacher_id || user.uid);
    await requireTargetAccess(user, teacherId);

    const transportType = normalizeTransportType(body.transport_type || '');
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    const startDate = toDateKey(body.start_date) || todayKey();
    const endDate = toDateKey(body.end_date);
    const routeLine = String(body.route_line || '').trim();
    const status = String(body.status || 'active');

    if (!transportType || !from || !to || !endDate) {
      return Response.json({ ok: false, error: 'missing-params', message: '交通機関・区間・有効期限を入力してください。' }, { status: 400 });
    }

    const teiki = await createEkispertCommuterPass({
      transportType,
      from,
      to,
    });

    const payload = {
      teacher_id: teacherId,
      teacher_name: user.profile?.student_name || user.profile?.name || user.profile?.displayName || '',
      transport_type: transportType,
      route_line: routeLine,
      from,
      to,
      start_date: startDate,
      end_date: endDate,
      status,
      serialize_data: teiki?.serializeData || '',
      display_route: teiki?.displayRoute || `${from} - ${to}`,
      source: cleanFareLabel(teiki?.serializeData ? '駅すぱあと API 定期情報' : '手動登録'),
      updated_at: Timestamp.now(),
      updated_by: user.uid,
    };

    const db = adminDb();
    const id = String(body.id || '').trim();
    const ref = id
      ? db.collection('teacher_commuter_passes').doc(id)
      : db.collection('teacher_commuter_passes').doc();

    if (id) {
      const existing = await ref.get();
      if (!existing.exists) throw new Error('not-found');
      await requireTargetAccess(user, String(existing.data()?.teacher_id || ''));
      if (existing.data()?.teacher_id !== teacherId) throw new Error('forbidden');
      await ref.set(payload, { merge: true });
    } else {
      await ref.set({ ...payload, created_at: Timestamp.now(), created_by: user.uid });
    }

    return Response.json({ ok: true, id: ref.id, pass: { id: ref.id, ...payload } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin', 'admin', 'master']);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim();
    if (!id || !['renewed', 'not_purchased', 'inactive'].includes(action)) {
      return Response.json({ ok: false, error: 'invalid-request' }, { status: 400 });
    }

    const ref = adminDb().collection('teacher_commuter_passes').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('not-found');
    await requireTargetAccess(user, String(snap.data()?.teacher_id || ''));

    const update: Record<string, unknown> = {
      updated_at: Timestamp.now(),
      updated_by: user.uid,
      last_confirmed_at: Timestamp.now(),
      confirmation_action: action,
    };
    if (action === 'not_purchased' || action === 'inactive') {
      update.status = 'inactive';
    } else {
      update.status = 'active';
      if (body.end_date) {
        const endDate = toDateKey(body.end_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return Response.json({ ok: false, error: '新しい有効期限を正しい日付で入力してください。' }, { status: 400 });
        }
        update.end_date = endDate;
      }
    }

    await ref.set(update, { merge: true });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** 勤怠管理者だけが、誤登録や不要になった定期を削除できる（交通費の定期控除にも使われなくなる）。 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['attendance_admin', 'admin', 'master']);
    if (!canManageAttendance(user)) throw new Error('forbidden');
    const id = String(request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return Response.json({ ok: false, error: 'id-required' }, { status: 400 });
    const ref = adminDb().collection('teacher_commuter_passes').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('not-found');
    const teacherId = String(snap.data()?.teacher_id || '');
    await requireTargetAccess(user, teacherId);
    await ref.delete();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
