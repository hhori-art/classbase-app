import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { EMPLOYMENT_CATEGORIES, isAttendanceUserRole } from '@/lib/employment-category';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const body = await request.json();
    const action = String(body.action || '');
    const db = adminDb();
    if (action === 'initialize_missing') {
      const legacyRoles = ['attendance_admin', 'attendance_only', 'attendance_manager'];
      const snapshot = await db.collection('users').where('role', 'in', ['teacher', ...legacyRoles]).limit(5000).get();
      const targets = snapshot.docs.filter(doc => !doc.data().employment_category || legacyRoles.includes(String(doc.data().role || '')));
      let migratedRoles = 0;
      for (let offset = 0; offset < targets.length; offset += 400) {
        const batch = db.batch();
        targets.slice(offset, offset + 400).forEach(doc => {
          const data = doc.data();
          if (legacyRoles.includes(String(data.role || ''))) migratedRoles += 1;
          batch.set(doc.ref, {
            ...(legacyRoles.includes(String(data.role || '')) ? { role: 'teacher' } : {}),
            employment_category: data.employment_category || 'semi_dedicated',
            enabled_programs: Array.isArray(data.enabled_programs) ? data.enabled_programs.filter((value: unknown) => value === 'science_social') : [],
            employment_category_updated_at: FieldValue.serverTimestamp(),
            employment_category_updated_by: actor.uid,
          }, { merge: true });
        });
        await batch.commit();
      }
      return Response.json({ ok: true, updated: targets.length, migrated_roles: migratedRoles });
    }
    if (action === 'update') {
      const userId = String(body.user_id || '').trim();
      const category = String(body.employment_category || '');
      if (!userId || !EMPLOYMENT_CATEGORIES.includes(category as any)) return Response.json({ ok: false, error: '区分を指定してください。' }, { status: 400 });
      const ref = db.collection('users').doc(userId);
      const snapshot = await ref.get();
      if (!snapshot.exists || !isAttendanceUserRole(snapshot.data()?.role)) return Response.json({ ok: false, error: '講師・勤怠利用者のアカウントではありません。' }, { status: 400 });
      await ref.set({ employment_category: category, employment_category_updated_at: FieldValue.serverTimestamp(), employment_category_updated_by: actor.uid }, { merge: true });
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: '操作が不正です。' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
