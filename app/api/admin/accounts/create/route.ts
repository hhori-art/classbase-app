import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { writeAuditLog } from '@/lib/server/audit-log';
import { generateInitialPassword } from '@/lib/password';
import type { AdminAppPermissions } from '@/lib/admin-app-permissions';
import { normalizeEmploymentCategory } from '@/lib/employment-category';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { anonymousParentName, anonymousStudentName, isNoPersonalInfoSchool } from '@/lib/no-personal-info-schools';
import {
  findAccountProfileDocs,
  normalizeAccountLoginId,
  normalizeInitialPassword,
  prepareAuthAccountCredentials,
  assertAccountTargetAllowed,
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
  const requestId = crypto.randomUUID();
  let stage = 'authenticate';
  let actorUid = '';
  let actorRole = '';
  let requestedRole = '';
  try {
    const actor = await getServerUser(request);
    if (!['master', 'admin'].includes(actor.role)) throw new Error('forbidden');
    actorUid = actor.uid;
    actorRole = actor.role;

    stage = 'validate_request';
    const body = await request.json();
    const role = normalizeRole(body.role);
    requestedRole = role;
    const requestedUserId = String(body.user_id || '').trim();
    const canCreateRole = actor.role === 'master' || (
      actor.role === 'admin' && ['student', 'teacher', 'parent'].includes(role)
    );
    if (!canCreateRole) throw new Error('forbidden');
    const loginId = normalizeAccountLoginId(body.login_id || body.lifetime_id);
    const requestedPassword = normalizeInitialPassword(body.password);
    // 既存アカウントの情報編集で空欄なら、現在のPWを変更しない。
    const password = requestedPassword || (requestedUserId ? '' : generateInitialPassword());
    const schoolId = resolveAttendanceSchoolCode(
      body.school_id || body.school_code || body.school_name || body.school || ''
    );
    // 個人情報を入れずにテストしている校舎の生徒・保護者は、氏名の代わりに生徒番号を名前にする。
    const anonymous = (role === 'student' || role === 'parent') && isNoPersonalInfoSchool(schoolId);
    const displayName = anonymous
      ? (role === 'student' ? anonymousStudentName(body.login_id || body.lifetime_id) : anonymousParentName(body.login_id || body.lifetime_id))
      : String(body.display_name || body.student_name || body.name || '').trim();
    const schoolName = attendanceSchoolName(schoolId);
    const employmentCategory = normalizeEmploymentCategory(body.employment_category, role);
    const enabledPrograms = Array.isArray(body.enabled_programs)
      ? body.enabled_programs.map(String).filter((value: string) => (
          (role === 'teacher' && value === 'science_social') ||
          (role === 'student' && value === 'online_school')
        ))
      : [];
    const prescribedWorkStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.prescribed_work_start || '')) ? String(body.prescribed_work_start) : '09:00';
    const prescribedWorkEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.prescribed_work_end || '')) ? String(body.prescribed_work_end) : '18:00';
    const prescribedBreakMinutes = Math.max(0, Math.min(240, Math.floor(Number(body.prescribed_break_minutes ?? 60) || 0)));
    const prescribedWorkDays = Array.isArray(body.prescribed_work_days)
      ? Array.from(new Set<number>(body.prescribed_work_days.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6)))
      : [1, 2, 3, 4, 5];
    const isAttendanceApprover = role === 'teacher'
      && employmentCategory === 'dedicated'
      && body.attendance_school_manager === true;
    const requestedSchoolIds: string[] = Array.isArray(body.school_ids)
      ? body.school_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : String(body.school_ids || schoolId || '').split(',').map(v => v.trim()).filter(Boolean);
    const normalizedRequestedSchoolIds = requestedSchoolIds.map(resolveAttendanceSchoolCode).filter(Boolean);
    const schoolIds = Array.from(new Set([schoolId, ...normalizedRequestedSchoolIds].filter(Boolean)));

    if (!loginId) return Response.json({ ok: false, error: 'login_id is required' }, { status: 400 });
    if (!displayName) return Response.json({ ok: false, error: 'display_name is required' }, { status: 400 });
    if (requestedPassword && requestedPassword.length < 6) return Response.json({ ok: false, error: 'password must be 6+ characters' }, { status: 400 });
    const loginIdIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId);
    const loginIdIsStaffCode = /^(?:[A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])$/.test(loginId);
    if (!loginIdIsEmail && !loginIdIsStaffCode) {
      return Response.json({ ok: false, error: 'ログインIDは職員番号（半角英数字）またはメールアドレスで入力してください。' }, { status: 400 });
    }
    const requestedEmail = String(body.email || '').trim();
    if (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      return Response.json({ ok: false, error: 'メールアドレスの形式が正しくありません。空欄の場合はログインIDから自動設定されます。' }, { status: 400 });
    }
    if (role !== 'master' && !schoolId) {
      return Response.json({ ok: false, error: '校舎を一覧から選択してください。' }, { status: 400 });
    }
    const managesSchools = role === 'admin' || role === 'master' || isAttendanceApprover;
    if (managesSchools && normalizedRequestedSchoolIds.length !== requestedSchoolIds.length) {
      return Response.json({ ok: false, error: '管理できる校舎を一覧から選択してください。' }, { status: 400 });
    }
    if ((role === 'admin' || isAttendanceApprover) && !schoolIds.length) {
      return Response.json({ ok: false, error: '管理できる校舎を一覧から選択してください。' }, { status: 400 });
    }
    if (['admin', 'master'].includes(role) && actor.role !== 'master') throw new Error('forbidden');
    if (!canManageSchool(actor, schoolId || null)) throw new Error('forbidden');
    if (actor.role !== 'master' && (employmentCategory === 'dedicated' || body.attendance_school_manager === true)) throw new Error('forbidden');

    stage = 'find_existing_account';
    const db = adminDb();
    const matchingProfiles = await findAccountProfileDocs(loginId, body.email);
    if (requestedUserId && !matchingProfiles.some(profile => profile.id === requestedUserId)) {
      const requestedProfile = await db.collection('users').doc(requestedUserId).get();
      if (requestedProfile.exists) {
        matchingProfiles.unshift(requestedProfile);
      }
    }
    const preferredProfile = matchingProfiles.find(profile => profile.id === requestedUserId) || matchingProfiles[0] || null;
    if (!preferredProfile && !password) {
      return Response.json({ ok: false, error: '新規アカウントのパスワードを入力してください。' }, { status: 400 });
    }

    matchingProfiles.forEach(profile => assertAccountTargetAllowed(actor, profile.data() || {}));
    const studentIds: string[] = Array.isArray(body.student_ids)
      ? body.student_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : String(body.student_ids || '').split(',').map(v => v.trim()).filter(Boolean);
    const parentIds: string[] = Array.isArray(body.parent_ids) ? body.parent_ids.map(String).filter(Boolean) : [];
    for (const [ids, expectedRole] of [[studentIds, 'student'], [parentIds, 'parent']] as const) {
      for (const id of ids) {
        const linked = await db.collection('users').doc(id).get();
        const profile = linked.data() || {};
        if (!linked.exists || !(expectedRole === 'parent' ? ['parent', 'guardian'] : ['student']).includes(String(profile.role))) throw new Error('forbidden');
        assertAccountTargetAllowed(actor, profile);
      }
    }
    const parentLoginId = String(body.parent_login_id || `${loginId}P`).trim();
    const parentPassword = String(body.parent_password || '').trim() || generateInitialPassword();
    const parentName = anonymous ? anonymousParentName(parentLoginId) : String(body.parent_name || `${displayName} 保護者`).trim();
    const prepareParent = role === 'student' && body.auto_create_parent !== false;
    const parentProfiles = prepareParent ? await findAccountProfileDocs(parentLoginId, body.parent_email) : [];
    const syncParent = prepareParent ? await prepareAuthAccountCredentials({
      actor, loginId: parentLoginId, email: body.parent_email, password: parentPassword,
      displayName: parentName, disabled: body.account_status === 'suspended', preferredUid: parentProfiles[0]?.id,
    }) : null;
    const syncPrimary = await prepareAuthAccountCredentials({
      actor, loginId, email: body.email, password, displayName,
      disabled: body.account_status === 'suspended', preferredUid: preferredProfile?.id,
    });
    stage = 'sync_auth_account';
    const authUser = await syncPrimary();
    const uid = authUser.uid;
    const email = authUser.email;
    const status = String(body.account_status || 'active');
    const requestedPermissions = body.admin_permissions && typeof body.admin_permissions === 'object'
      ? body.admin_permissions as Partial<AdminAppPermissions>
      : {};
    const adminPermissions: AdminAppPermissions =
      role === 'master'
        ? { science_social: true, eiken: true, attendance: true, online_school: true }
        : {
              science_social: requestedPermissions.science_social === true,
              eiken: requestedPermissions.eiken === true,
              attendance: requestedPermissions.attendance === true,
              online_school: requestedPermissions.online_school === true,
            };
    const importBatchId = String(body.import_batch_id || '').trim().slice(0, 120);
    const importFileName = String(body.import_file_name || '').trim().slice(0, 240);

    const baseData: Record<string, unknown> = {
      uid,
      id: uid,
      role,
      email,
      lifetime_id: loginId,
      initial_login_id: loginId,
      ...(password ? { initial_password: password, raw_password: password } : {}),
      account_status: status,
      status,
      school_id: schoolId || null,
      school_code: schoolId || null,
      school_name: schoolName || null,
      school: schoolName || null,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actor.uid,
      employment_category: role === 'teacher' ? employmentCategory : null,
      attendance_school_manager: isAttendanceApprover,
      enabled_programs: role === 'teacher' || role === 'student' ? enabledPrograms : [],
      prescribed_work_start: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkStart : null,
      prescribed_work_end: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkEnd : null,
      prescribed_break_minutes: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedBreakMinutes : null,
      prescribed_work_days: role === 'teacher' && employmentCategory === 'dedicated' ? prescribedWorkDays : null,
      ...(importBatchId
        ? {
            latest_account_import_batch_id: importBatchId,
            latest_account_import_file_name: importFileName || null,
            latest_account_imported_at: FieldValue.serverTimestamp(),
            latest_account_imported_by: actor.uid,
          }
        : {}),
    };

    if (role === 'student') {
      Object.assign(baseData, {
        student_name: displayName,
        student_name_kana: anonymous ? '' : String(body.student_name_kana || body.name_kana || '').trim().slice(0, 120),
        name: null,
        grade: String(body.grade || ''),
        classroom: String(body.classroom || ''),
        middle_school: String(body.middle_school || body.junior_high_school || ''),
        course_start_month: String(body.course_start_month || ''),
        sibling_ids: Array.isArray(body.sibling_ids) ? body.sibling_ids.map(String).filter(Boolean) : String(body.sibling_ids || '').split(',').map(v => v.trim()).filter(Boolean),
        twin_sibling_ids: Array.isArray(body.twin_sibling_ids) ? body.twin_sibling_ids.map(String).filter(Boolean) : String(body.twin_sibling_ids || '').split(',').map(v => v.trim()).filter(Boolean),
        trial_event_ids: Array.isArray(body.trial_event_ids) ? body.trial_event_ids.map(String).filter(Boolean) : [],
        trial_continued: Boolean(body.trial_continued),
        member_type: body.member_type === 'general' ? 'general' : 'enrolled',
        summer_course_status: body.summer_course_status === 'attending' ? 'attending' : 'none',
        summer_only: Boolean(body.summer_only),
        enrollment_cancel_month: String(body.enrollment_cancel_month || ''),
        enrollment_cancel_reason: String(body.enrollment_cancel_reason || ''),
        day_of_week: String(body.day_of_week || ''),
        subject_science: String(body.subject_science || body.science_subject || ''),
        subject_social: String(body.subject_social || body.social_subject || ''),
        phone_number: String(body.phone_number || body.phone || ''),
        camera_off_requested: Boolean(body.camera_off_requested),
        absence_call_not_required: Boolean(body.absence_call_not_required),
        parent_ids: parentIds,
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
        school_ids: role === 'admin' || role === 'master' || isAttendanceApprover ? schoolIds : [],
        school_names: role === 'admin' || role === 'master' || isAttendanceApprover
          ? schoolIds.map(attendanceSchoolName)
          : [],
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

    stage = 'save_user_profile';
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
      stage = 'sync_duplicate_profiles';
      const batch = db.batch();
      duplicateProfiles.forEach(profile => {
        batch.set(profile.ref, {
          ...(password ? { initial_password: password, raw_password: password } : {}),
          credential_primary_uid: uid,
          credentials_synced_at: FieldValue.serverTimestamp(),
          credentials_synced_by: actor.uid,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
    }

    if (role === 'parent') {
      stage = 'link_parent_profile';
      await Promise.all(studentIds.map(studentId => db.collection('users').doc(studentId).set({
        parent_ids: FieldValue.arrayUnion(uid),
        parent_uid: uid,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true })));
    }

    let parentInfo: Record<string, unknown> | null = null;
    if (role === 'student' && body.auto_create_parent !== false) {
      stage = 'create_parent_account';
      const parentAuth = await syncParent!();
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
        school_code: schoolId || null,
        school_name: schoolName || null,
        school: schoolName || null,
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

    stage = 'write_audit_event';
    let eventId: string | null = null;
    try {
      eventId = await writeLearningEvent({
        actor_id: actor.uid,
        actor_role: actor.role,
        type: before.exists ? 'account_updated_by_admin' : 'account_created_by_admin',
        target_id: uid,
        target_type: 'user',
        school: schoolId || actor.school,
        metadata: { role, status, login_id: loginId },
      });
    } catch (eventError) {
      // アカウント本体の保存後に監査イベントだけが失敗しても、作成結果を失敗扱いにしない。
      console.error('[admin/accounts/create] audit event failed', {
        request_id: requestId,
        actor_uid: actor.uid,
        target_uid: uid,
        error: eventError instanceof Error ? eventError.message : String(eventError),
      });
    }

    // 操作ログ（パスワードは残さない）。記録に失敗してもアカウントの作成・更新は成功のまま返す。
    await writeAuditLog({
      actor,
      action: before.exists ? 'account_update' : 'account_create',
      target_type: 'user',
      target_id: uid,
      target_label: displayName,
      school_id: schoolId || null,
      details: {
        target_role: role,
        status,
        login_id: loginId,
        parent_id: parentInfo?.uid || null,
        parent_created: Boolean(parentInfo && !parentInfo.updated),
      },
    });

    return Response.json({
      ok: true,
      uid,
      email,
      initial_password: password || String(existingProfile?.data()?.initial_password || existingProfile?.data()?.raw_password || ''),
      isFirstLogin: before.exists ? before.data()?.isFirstLogin ?? false : true,
      parent: parentInfo,
      event_id: eventId,
      updated: Boolean(existingProfile?.exists),
      synchronized_auth_count: authUser.synchronized_auth_uids.length,
      reauth_required: authUser.reauth_required,
    });
  } catch (error: any) {
    const code = String(error?.code || '');
    const message = error instanceof Error ? error.message : String(error);
    console.error('[admin/accounts/create] failed', {
      request_id: requestId,
      stage,
      actor_uid: actorUid || null,
      actor_role: actorRole || null,
      requested_role: requestedRole || null,
      error_code: code || null,
      error: message,
    });

    if (code === 'auth/email-already-exists') {
      return Response.json({ ok: false, error: 'このメールアドレスは別のアカウントで使用されています。メール欄を空欄にするか、別のアドレスを入力してください。' }, { status: 409 });
    }
    if (code === 'auth/invalid-email') {
      return Response.json({ ok: false, error: 'メールアドレスまたはログインIDの形式が正しくありません。' }, { status: 400 });
    }
    if (code === 'auth/invalid-password') {
      return Response.json({ ok: false, error: 'パスワードは6文字以上で入力してください。' }, { status: 400 });
    }
    if (message === 'forbidden') {
      return Response.json({ ok: false, error: 'このアカウントを登録する権限、または対象校舎の権限がありません。' }, { status: 403 });
    }
    return jsonError(error);
  }
}
