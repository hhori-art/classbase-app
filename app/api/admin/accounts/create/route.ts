import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { generateInitialPassword } from '@/lib/password';
import type { AdminAppPermissions } from '@/lib/admin-app-permissions';
import { normalizeEmploymentCategory } from '@/lib/employment-category';
import {
  findAccountProfileDocs,
  normalizeAccountLoginId,
  normalizeInitialPassword,
  syncAuthAccountCredentials,
} from '@/lib/server/account-credentials';

export const runtime = 'nodejs';

const ROLES = ['student', 'teacher', 'parent', 'admin', 'master'] as const;
type Role = typeof ROLES[number];

function normalizeRole(role: unknown): Role {
  const value = String(role || 'student').toLowerCase();
  if (['attendance_admin', 'attendance_only', 'attendance_manager'].includes(value)) return 'teacher';
  return ROLES.includes(value as Role) ? value as Role : 'student';
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);

    const body = await request.json();
    const role = normalizeRole(body.role);
    const loginId = normalizeAccountLoginId(body.login_id || body.lifetime_id);
    const requestedPassword = normalizeInitialPassword(body.password);
    const password = requestedPassword || generateInitialPassword();
    const displayName = String(body.display_name || body.student_name || body.name || '').trim();
    const schoolId = String(body.school_id || body.school || '').trim();
    const employmentCategory = normalizeEmploymentCategory(body.employment_category, role);
    const enabledPrograms = role === 'teacher' && Array.isArray(body.enabled_programs)
      ? body.enabled_programs.map(String).filter((value: string) => value === 'science_social')
      : [];
    const prescribedWorkStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.prescribed_work_start || '')) ? String(body.prescribed_work_start) : '09:00';
    const prescribedWorkEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.prescribed_work_end || '')) ? String(body.prescribed_work_end) : '18:00';
    const prescribedBreakMinutes = Math.max(0, Math.min(240, Math.floor(Number(body.prescribed_break_minutes ?? 60) || 0)));
    const prescribedWorkDays = Array.isArray(body.prescribed_work_days)
      ? Array.from(new Set<number>(body.prescribed_work_days.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6)))
      : [1, 2, 3, 4, 5];

    if (!loginId) return Response.json({ ok: false, error: 'login_id is required' }, { status: 400 });
    if (!displayName) return Response.json({ ok: false, error: 'display_name is required' }, { status: 400 });
    if (password.length < 6) return Response.json({ ok: false, error: 'password must be 6+ characters' }, { status: 400 });
    if (['admin', 'master'].includes(role) && actor.role !== 'master') throw new Error('forbidden');
    if (!canManageSchool(actor, schoolId || null)) throw new Error('forbidden');

    const db = adminDb();
    const matchingProfiles = await findAccountProfileDocs(loginId, body.email);
    const requestedUserId = String(body.user_id || '').trim();
    if (requestedUserId && !matchingProfiles.some(profile => profile.id === requestedUserId)) {
      const requestedProfile = await db.collection('users').doc(requestedUserId).get();
      if (requestedProfile.exists) {
        matchingProfiles.unshift(requestedProfile);
      }
    }
    const preferredProfile = matchingProfiles.find(profile => profile.id === requestedUserId) || matchingProfiles[0] || null;

    const authUser = await syncAuthAccountCredentials({
      loginId,
      email: body.email,
      password,
      displayName,
      disabled: body.account_status === 'suspended',
      preferredUid: preferredProfile?.id,
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
    const requestedPermissions = body.admin_permissions && typeof body.admin_permissions === 'object'
      ? body.admin_permissions as Partial<AdminAppPermissions>
      : {};
    const adminPermissions: AdminAppPermissions =
      role === 'master'
        ? { science_social: true, eiken: true, attendance: true }
        : {
              science_social: requestedPermissions.science_social === true,
              eiken: requestedPermissions.eiken === true,
              attendance: requestedPermissions.attendance === true,
            };

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
      employment_category: role === 'teacher' ? employmentCategory : null,
      enabled_programs: role === 'teacher' ? enabledPrograms : [],
      prescribed_work_start: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkStart : null,
      prescribed_work_end: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkEnd : null,
      prescribed_break_minutes: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedBreakMinutes : null,
      prescribed_work_days: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkDays : null,
    };

    if (role === 'student') {
      Object.assign(baseData, {
        student_name: displayName,
        name: null,
        grade: String(body.grade || ''),
        classroom: String(body.classroom || ''),
        middle_school: String(body.middle_school || body.junior_high_school || ''),
        course_start_month: String(body.course_start_month || ''),
        sibling_ids: Array.isArray(body.sibling_ids) ? body.sibling_ids.map(String).filter(Boolean) : String(body.sibling_ids || '').split(',').map(v => v.trim()).filter(Boolean),
        twin_sibling_ids: Array.isArray(body.twin_sibling_ids) ? body.twin_sibling_ids.map(String).filter(Boolean) : String(body.twin_sibling_ids || '').split(',').map(v => v.trim()).filter(Boolean),
        trial_event_ids: Array.isArray(body.trial_event_ids) ? body.trial_event_ids.map(String).filter(Boolean) : [],
        trial_continued: Boolean(body.trial_continued),
        enrollment_cancel_month: String(body.enrollment_cancel_month || ''),
        enrollment_cancel_reason: String(body.enrollment_cancel_reason || ''),
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
        ...(role === 'admin' || role === 'master'
          ? {
              admin_permissions: adminPermissions,
              eiken_admin: adminPermissions.eiken,
            }
          : {}),
      });
    }

    if (status === 'suspended') baseData.suspended_at = FieldValue.serverTimestamp();
    if (status === 'withdrawn') baseData.withdrawn_at = FieldValue.serverTimestamp();
    if (status === 'archived') baseData.archived_at = FieldValue.serverTimestamp();

    const userRef = db.collection('users').doc(uid);
    const before = await userRef.get();
    const existingProfile = before.exists ? before : preferredProfile;
    await userRef.set({
      ...(existingProfile?.data() || {}),
      ...baseData,
      isFirstLogin: existingProfile?.exists ? existingProfile.data()?.isFirstLogin ?? false : true,
      created_at: existingProfile?.exists ? existingProfile.data()?.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      credentials_synced_at: FieldValue.serverTimestamp(),
      credentials_synced_by: actor.uid,
    }, { merge: true });

    const duplicateProfiles = matchingProfiles.filter(profile => profile.id !== uid);
    if (duplicateProfiles.length > 0) {
      const batch = db.batch();
      duplicateProfiles.forEach(profile => {
        batch.set(profile.ref, {
          initial_password: password,
          raw_password: password,
          credential_primary_uid: uid,
          credentials_synced_at: FieldValue.serverTimestamp(),
          credentials_synced_by: actor.uid,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
    }

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
      const parentPassword = String(body.parent_password || '').trim() || generateInitialPassword();
      const parentName = String(body.parent_name || `${displayName} 保護者`).trim();
      const parentProfiles = await findAccountProfileDocs(parentLoginId, body.parent_email);
      const parentAuth = await syncAuthAccountCredentials({
        loginId: parentLoginId,
        email: body.parent_email,
        password: parentPassword,
        displayName: parentName,
        disabled: body.account_status === 'suspended',
        preferredUid: parentProfiles[0]?.id,
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
        isFirstLogin: parentSnap.exists ? parentSnap.data()?.isFirstLogin ?? false : true,
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
        updated: !parentAuth.auth_created,
        isFirstLogin: parentSnap.exists ? parentSnap.data()?.isFirstLogin ?? false : true,
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

    return Response.json({
      ok: true,
      uid,
      email,
      initial_password: password,
      isFirstLogin: before.exists ? before.data()?.isFirstLogin ?? false : true,
      parent: parentInfo,
      event_id: eventId,
      updated: Boolean(existingProfile?.exists),
      synchronized_auth_count: authUser.synchronized_auth_uids.length,
    });
  } catch (error) {
    return jsonError(error);
  }
}
