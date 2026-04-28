import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

const ROLES = ['student', 'teacher', 'parent', 'admin', 'master'] as const;
type Role = typeof ROLES[number];

function normalizeEmail(loginId: string, email?: string) {
  const cleaned = String(email || '').trim();
  if (cleaned.includes('@')) return cleaned;
  return `${String(loginId).trim()}@classbase.local`;
}

function notFoundAuthError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'auth/user-not-found' || message.includes('no user record') || message.includes('not found');
}

async function upsertAuthUser(params: {
  loginId: string;
  email?: string;
  password: string;
  displayName: string;
  disabled?: boolean;
}) {
  const auth = adminAuth();
  const email = normalizeEmail(params.loginId, params.email);
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, {
      password: params.password,
      displayName: params.displayName,
      emailVerified: true,
      disabled: Boolean(params.disabled),
    });
    return { uid: existing.uid, email, updated: true };
  } catch (error: any) {
    if (!notFoundAuthError(error)) throw error;
    const created = await auth.createUser({
      email,
      password: params.password,
      displayName: params.displayName,
      emailVerified: true,
      disabled: Boolean(params.disabled),
    });
    return { uid: created.uid, email, updated: false };
  }
}

function normalizeRole(role: unknown): Role {
  const value = String(role || 'student').toLowerCase();
  return ROLES.includes(value as Role) ? value as Role : 'student';
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const role = normalizeRole(body.role);
    const loginId = String(body.login_id || body.lifetime_id || '').trim();
    const password = String(body.password || 'class1234').trim();
    const displayName = String(body.display_name || body.student_name || body.name || '').trim();
    const schoolId = String(body.school_id || body.school || '').trim();

    if (!loginId) return Response.json({ ok: false, error: 'login_id is required' }, { status: 400 });
    if (!displayName) return Response.json({ ok: false, error: 'display_name is required' }, { status: 400 });
    if (password.length < 6) return Response.json({ ok: false, error: 'password must be 6+ characters' }, { status: 400 });
    if (role === 'master' && actor.role !== 'master') throw new Error('forbidden');
    if (!canManageSchool(actor, schoolId || null)) throw new Error('forbidden');

    const db = adminDb();

    const authUser = await upsertAuthUser({
      loginId,
      email: body.email,
      password,
      displayName,
      disabled: body.account_status === 'suspended',
    });
    const uid = authUser.uid;
    const email = authUser.email;

    const status = String(body.account_status || 'active');
    const studentIds: string[] = Array.isArray(body.student_ids)
      ? body.student_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : String(body.student_ids || '').split(',').map(v => v.trim()).filter(Boolean);
    const schoolIds: string[] = Array.isArray(body.school_ids)
      ? body.school_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : String(body.school_ids || schoolId || '').split(',').map(v => v.trim()).filter(Boolean);

    const baseData: Record<string, unknown> = {
      uid,
      id: uid,
      role,
      email,
      lifetime_id: loginId,
      initial_login_id: loginId,
      initial_password: password,
      raw_password: password,
      account_status: status,
      status,
      school_id: schoolId || null,
      school: schoolId || null,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actor.uid,
    };

    if (role === 'student') {
      Object.assign(baseData, {
        student_name: displayName,
        name: null,
        grade: String(body.grade || ''),
        classroom: String(body.classroom || ''),
        day_of_week: String(body.day_of_week || ''),
        subject_science: String(body.subject_science || body.science_subject || ''),
        subject_social: String(body.subject_social || body.social_subject || ''),
        phone_number: String(body.phone_number || body.phone || ''),
        camera_off_requested: Boolean(body.camera_off_requested),
        absence_call_not_required: Boolean(body.absence_call_not_required),
        parent_ids: Array.isArray(body.parent_ids) ? body.parent_ids : [],
      });
    } else if (role === 'parent') {
      Object.assign(baseData, {
        parent_name: displayName,
        name: displayName,
        student_name: null,
        student_ids: studentIds,
      });
    } else {
      Object.assign(baseData, {
        name: displayName,
        student_name: null,
        school_ids: role === 'admin' || role === 'master' ? schoolIds : [],
      });
    }

    if (status === 'suspended') baseData.suspended_at = FieldValue.serverTimestamp();
    if (status === 'withdrawn') baseData.withdrawn_at = FieldValue.serverTimestamp();
    if (status === 'archived') baseData.archived_at = FieldValue.serverTimestamp();

    const userRef = db.collection('users').doc(uid);
    const before = await userRef.get();
    await userRef.set({
      ...baseData,
      created_at: before.exists ? before.data()?.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });

    if (role === 'parent') {
      await Promise.all(studentIds.map(studentId => db.collection('users').doc(studentId).set({
        parent_ids: FieldValue.arrayUnion(uid),
        parent_uid: uid,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true })));
    }

    let parentInfo: Record<string, unknown> | null = null;
    if (role === 'student' && body.auto_create_parent !== false) {
      const parentLoginId = String(body.parent_login_id || `${loginId}P`).trim();
      const parentPassword = String(body.parent_password || password || 'class1234').trim();
      const parentName = String(body.parent_name || `${displayName} 保護者`).trim();
      const parentAuth = await upsertAuthUser({
        loginId: parentLoginId,
        email: body.parent_email,
        password: parentPassword,
        displayName: parentName,
        disabled: body.account_status === 'suspended',
      });
      const parentRef = db.collection('users').doc(parentAuth.uid);
      const parentSnap = await parentRef.get();
      await parentRef.set({
        uid: parentAuth.uid,
        id: parentAuth.uid,
        role: 'parent',
        email: parentAuth.email,
        lifetime_id: parentLoginId,
        initial_login_id: parentLoginId,
        initial_password: parentPassword,
        raw_password: parentPassword,
        parent_name: parentName,
        name: parentName,
        student_ids: FieldValue.arrayUnion(uid),
        school_id: schoolId || null,
        school: schoolId || null,
        account_status: status,
        status,
        created_at: parentSnap.exists ? parentSnap.data()?.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actor.uid,
      }, { merge: true });
      await userRef.set({
        parent_ids: FieldValue.arrayUnion(parentAuth.uid),
        parent_uid: parentAuth.uid,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      parentInfo = {
        uid: parentAuth.uid,
        login_id: parentLoginId,
        initial_password: parentPassword,
        parent_name: parentName,
        email: parentAuth.email,
        updated: parentAuth.updated,
      };
    }

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: before.exists ? 'account_updated_by_admin' : 'account_created_by_admin',
      target_id: uid,
      target_type: 'user',
      school: schoolId || actor.school,
      metadata: { role, status, login_id: loginId },
    });

    return Response.json({ ok: true, uid, email, parent: parentInfo, event_id: eventId, updated: before.exists });
  } catch (error) {
    return jsonError(error);
  }
}
