import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { isAttendanceUserRole } from '@/lib/employment-category';

export const runtime = 'nodejs';

const SUPPORTED_PROGRAMS = ['science_social'];
const LEGACY_TEACHER_ROLES = ['attendance_admin', 'attendance_only', 'attendance_manager'];

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const body = await request.json();
    const userIds: string[] = Array.from(new Set<string>(
      Array.isArray(body.user_ids) ? body.user_ids.map((value: unknown) => String(value).trim()).filter(Boolean) : [],
    ));
    const program = String(body.program || '');
    const enabled = body.enabled === true;

    if (!userIds.length || userIds.length > 5000 || !SUPPORTED_PROGRAMS.includes(program)) {
      return Response.json({ ok: false, error: '対象の講師または講座指定が不正です。' }, { status: 400 });
    }

    const db = adminDb();
    const snapshots = await db.getAll(...userIds.map(userId => db.collection('users').doc(userId)));
    const targets = snapshots.filter(snapshot => snapshot.exists && isAttendanceUserRole(snapshot.data()?.role));

    for (let offset = 0; offset < targets.length; offset += 400) {
      const batch = db.batch();
      targets.slice(offset, offset + 400).forEach(snapshot => {
        const data = snapshot.data() || {};
        const programs = new Set(Array.isArray(data.enabled_programs) ? data.enabled_programs.map(String) : []);
        enabled ? programs.add(program) : programs.delete(program);
        batch.set(snapshot.ref, {
          ...(LEGACY_TEACHER_ROLES.includes(String(data.role || '').toLowerCase()) ? { role: 'teacher' } : {}),
          enabled_programs: Array.from(programs),
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actor.uid,
        }, { merge: true });
      });
      await batch.commit();
    }

    return Response.json({ ok: true, updated: targets.length, skipped: userIds.length - targets.length });
  } catch (error) {
    return jsonError(error);
  }
}
