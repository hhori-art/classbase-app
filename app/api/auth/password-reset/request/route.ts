import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  PASSWORD_RESET_TTL_LABEL,
  PASSWORD_RESET_TTL_MS,
  consumeRateLimit,
  getClientIp,
  getPublicBaseUrl,
  hashSecret,
  isUsableRecoveryEmail,
  newSecretToken,
  normalizeEmail,
  normalizeLoginId,
  normalizeName,
  queueRecoveryEmail,
  requestFingerprint,
  userDisplayNames,
} from '@/lib/server/password-recovery';
import { revokeOtherResetTokens } from '@/lib/server/password-reset-notice';
import { notifyPasswordRecoveryRequest, recoveryTargetSchool } from '@/lib/server/password-recovery-notify';
import { notifyInfoMatchPasswordReset } from '@/lib/server/password-recovery-alert';
import { profilePhones, recoveryInfoMatches } from '@/lib/password-recovery-match';
import { PASSWORD_SUPPORT_HOURS, PASSWORD_SUPPORT_PHONE, selfServicePasswordResetEnabled } from '@/lib/password-reset-availability';

export const runtime = 'nodejs';

// アカウントの有無・メール登録の有無が分からないよう、どの場合も同じ文面を返す。
const GENERIC_MESSAGE =
  '確認済みメールを登録している場合だけ届きます。届かない場合は「メールが使えない」から申し込むか、教室へ連絡してください。';
const MATCH_MESSAGE =
  '入力した内容が登録と一致した場合は、入力したメールアドレスに再設定のリンクを送りました。届かない場合は、入力内容を確かめるか、「メールが使えない」から申し込んでください。';
const SUPPORT_MESSAGE =
  '受付が完了しました。教室が確認して連絡します。問い合わせるときは受付番号を伝えてください。';
// 管理者が後から確認できるよう、入力そのもの（一致しなかった場合も）を短く切って残す。
const SUBMITTED_MAX_LENGTH = 64;
const submittedText = (value: unknown) =>
  String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '').trim().slice(0, SUBMITTED_MAX_LENGTH);
const ADMIN_ROLES = [
  'master', 'admin', 'master_admin', 'super_admin', 'school_admin',
  'branch_admin', 'campus_admin', 'classroom_admin', 'test_admin',
];

async function findUser(loginId: string) {
  const db = adminDb();
  const candidates = Array.from(new Set([loginId, loginId.toLowerCase(), loginId.toUpperCase()]));
  const matches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const value of candidates) {
    for (const field of ['lifetime_id', 'initial_login_id', 'login_id'] as const) {
      const snapshot = await db.collection('users').where(field, '==', value).limit(2).get();
      snapshot.docs.forEach(doc => matches.set(doc.id, doc));
    }
  }
  if (/^\d+$/.test(loginId)) {
    const snapshot = await db.collection('users').where('lifetime_id', '==', Number(loginId)).limit(2).get();
    snapshot.docs.forEach(doc => matches.set(doc.id, doc));
  }
  // 重複IDで別人の復旧先を選ばない。対象が一意な場合だけ進める。
  return matches.size === 1 ? Array.from(matches.values())[0] : null;
}

const profileDisplayName = (profile: FirebaseFirestore.DocumentData) =>
  String(
    profile.student_name || profile.name || profile.display_name ||
    profile.teacher_name || profile.parent_name || 'ご利用者'
  ).trim();

const phoneLast4 = (value: unknown) =>
  String(value || '').normalize('NFKC').replace(/\D/g, '').slice(-4);

async function findLinkedParentRecovery(
  studentId: string,
  student: FirebaseFirestore.DocumentData,
  requestedEmail: string
) {
  const studentParentIds = new Set([
    String(student.parent_uid || '').trim(),
    ...(Array.isArray(student.parent_ids)
      ? student.parent_ids.map((id: unknown) => String(id).trim())
      : []),
  ].filter(Boolean));
  if (!studentParentIds.size) return null;

  const linkedParents = await adminDb().collection('users')
    .where('student_ids', 'array-contains', studentId)
    .limit(10)
    .get();

  for (const parentDoc of linkedParents.docs) {
    if (!studentParentIds.has(parentDoc.id)) continue;
    const parent = parentDoc.data() || {};
    const parentRole = String(parent.role || '').toLowerCase();
    const parentEmail = normalizeEmail(parent.recovery_email);
    if (
      ['parent', 'guardian'].includes(parentRole) &&
      parent.recovery_email_verified_at &&
      isUsableRecoveryEmail(parentEmail) &&
      parentEmail === requestedEmail
    ) {
      return { id: parentDoc.id, email: parentEmail };
    }
  }
  return null;
}

/** 生徒・保護者の照合に使う、つながっているアカウント（相互に紐づいているものだけ）。 */
async function linkedAccounts(userId: string, role: string, profile: FirebaseFirestore.DocumentData) {
  const db = adminDb();
  if (role === 'student') {
    const parentIds = new Set([
      String(profile.parent_uid || '').trim(),
      ...(Array.isArray(profile.parent_ids) ? profile.parent_ids.map((id: unknown) => String(id).trim()) : []),
    ].filter(Boolean));
    if (!parentIds.size) return [];
    const snap = await db.collection('users').where('student_ids', 'array-contains', userId).limit(10).get();
    return snap.docs
      .filter(doc => parentIds.has(doc.id) && ['parent', 'guardian'].includes(String(doc.data()?.role || '').toLowerCase()))
      .map(doc => ({ id: doc.id, role: 'parent', data: doc.data() || {} }));
  }
  const childIds = (Array.isArray(profile.student_ids) ? profile.student_ids.map((id: unknown) => String(id).trim()) : []).filter(Boolean).slice(0, 10);
  if (!childIds.length) return [];
  const snaps = await db.getAll(...childIds.map((id: string) => db.collection('users').doc(id)));
  return snaps
    .filter(snap => snap.exists && String(snap.data()?.role || '').toLowerCase() === 'student')
    .filter(snap => {
      const child = snap.data() || {};
      const ids = [String(child.parent_uid || '').trim(), ...(Array.isArray(child.parent_ids) ? child.parent_ids.map(String) : [])];
      return ids.includes(userId);
    })
    .map(snap => ({ id: snap.id, role: 'student', data: snap.data() || {} }));
}

async function createSupportRequest(
  loginId: string,
  name: string,
  submittedPhoneLast4: string,
  userDoc: FirebaseFirestore.QueryDocumentSnapshot | null,
  submitted: { loginId: string; name: string },
) {
  const requestCode = `PR-${newSecretToken().slice(0, 8).toUpperCase()}`;
  const profile = userDoc?.data() || {};
  const role = String(profile.role || '').toLowerCase();
  const validTarget = Boolean(
    userDoc && !ADMIN_ROLES.includes(role) && userDisplayNames(profile).includes(name)
  );
  let registeredPhoneLast4 = validTarget
    ? phoneLast4(profile.phone_number || profile.phone || profile.tel || profile.telephone)
    : '';

  if (validTarget && role === 'student' && !registeredPhoneLast4) {
    const parentId = String(profile.parent_uid || '').trim();
    if (parentId) {
      const parentDoc = await adminDb().collection('users').doc(parentId).get();
      const parent = parentDoc.data() || {};
      const parentStudentIds = Array.isArray(parent.student_ids) ? parent.student_ids.map(String) : [];
      if (parentStudentIds.includes(userDoc!.id)) {
        registeredPhoneLast4 = phoneLast4(parent.phone_number || parent.phone || parent.tel || parent.telephone);
      }
    }
  }

  const fingerprint = requestFingerprint(['support-request', loginId, name]);
  const targetSchool = validTarget ? await recoveryTargetSchool(role, profile).catch(() => '') : '';
  const ref = await adminDb().collection('password_recovery_requests').add({
    request_code: requestCode,
    status: 'pending',
    source: 'no_email',
    submitted_login_id: submitted.loginId,
    submitted_name: submitted.name,
    target_user_id: validTarget ? userDoc!.id : null,
    target_role: validTarget ? role : null,
    target_name: validTarget ? profileDisplayName(profile) : null,
    target_login_id: validTarget ? loginId : null,
    target_school_id: validTarget ? (targetSchool || null) : null,
    phone_last4_provided: Boolean(submittedPhoneLast4),
    phone_last4_matched: Boolean(
      submittedPhoneLast4 && registeredPhoneLast4 && submittedPhoneLast4 === registeredPhoneLast4
    ),
    request_fingerprint: fingerprint,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  try {
    await notifyPasswordRecoveryRequest({
      requestId: ref.id,
      requestCode,
      fingerprint,
      submittedLoginId: submitted.loginId,
      submittedName: submitted.name,
      target: validTarget
        ? { role, name: profileDisplayName(profile), loginId, school: targetSchool }
        : null,
    });
  } catch (notifyError) {
    // 通知に失敗しても依頼は残っている（管理画面の件数・一覧には出る）。
    console.error('Password recovery staff notification failed:', notifyError);
  }
  return requestCode;
}

export async function POST(request: NextRequest) {
  // セキュリティチェックが終わるまでは受け付けない（何も読まず、何も書かない）。
  if (!selfServicePasswordResetEnabled()) {
    return Response.json({
      ok: false,
      error: 'paused',
      message: `パスワードの再設定は現在お休みしています。サポートセンター（${PASSWORD_SUPPORT_PHONE}、${PASSWORD_SUPPORT_HOURS}）へお電話ください。`,
    }, { status: 503 });
  }
  const startedAt = Date.now();
  let responseMessage = GENERIC_MESSAGE;
  try {
    const body = await request.json();
    const mode = body.mode === 'support' ? 'support' : body.mode === 'match' ? 'match' : 'email';
    responseMessage = mode === 'support' ? SUPPORT_MESSAGE : mode === 'match' ? MATCH_MESSAGE : GENERIC_MESSAGE;
    const loginId = normalizeLoginId(body.login_id);
    const name = normalizeName(body.name);
    const email = normalizeEmail(body.email);

    if (!loginId || !name || (mode !== 'support' && !isUsableRecoveryEmail(email))) {
      return Response.json({ ok: true, message: responseMessage });
    }

    const ipAllowed = await consumeRateLimit(
      requestFingerprint([mode === 'support' ? 'support-ip' : 'reset-ip', getClientIp(request)]),
      mode === 'support' ? 5 : 10,
      60 * 60 * 1000
    );
    const accountAllowed = await consumeRateLimit(
      requestFingerprint([mode === 'support' ? 'support-account' : 'reset-account', loginId]),
      mode === 'support' ? 2 : 3,
      mode === 'support' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
    );
    // 照合方式は、電話の下4桁を総当たりされないよう、同じアカウントへの申し込みを1日5回までにする。
    const dailyAllowed = mode !== 'match' || await consumeRateLimit(
      requestFingerprint(['match-account-day', loginId]), 5, 24 * 60 * 60 * 1000
    );
    if (!ipAllowed || !accountAllowed || !dailyAllowed) {
      return Response.json({ ok: true, message: responseMessage });
    }

    const userDoc = await findUser(loginId);
    const profile = userDoc?.data() || {};
    const role = String(profile.role || '').toLowerCase();
    const adminRole = ADMIN_ROLES.includes(role);
    const nameMatches = userDisplayNames(profile).includes(name);

    if (mode === 'support') {
      const requestCode = await createSupportRequest(loginId, name, phoneLast4(body.phone_last4), userDoc, {
        loginId: submittedText(body.login_id),
        name: submittedText(body.name),
      });
      const remainingDelay = 700 - (Date.now() - startedAt);
      if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
      return Response.json({ ok: true, message: SUPPORT_MESSAGE, request_code: requestCode });
    }

    if (mode === 'match') {
      const studentSide = role === 'student' || role === 'parent' || role === 'guardian';
      let matched = false;
      let related: Array<{ id: string; role: string; data: FirebaseFirestore.DocumentData }> = [];
      if (userDoc && studentSide && !adminRole && nameMatches) {
        related = await linkedAccounts(userDoc.id, role, profile);
        matched = recoveryInfoMatches(
          { school: String(body.school || ''), grade: String(body.grade || ''), phoneLast4: String(body.phone_last4 || '') },
          role === 'student'
            ? { role: 'student', students: [profile], phones: [...profilePhones(profile), ...related.flatMap(item => profilePhones(item.data))] }
            : { role: 'parent', students: related.map(item => item.data), phones: profilePhones(profile) },
        );
      }
      await adminDb().collection('password_recovery_events').add({
        kind: 'info_match_request',
        matched,
        target_user_id: userDoc && studentSide && !adminRole ? userDoc.id : null,
        target_role: userDoc && studentSide && !adminRole ? (role === 'guardian' ? 'parent' : role) : null,
        submitted_login_id: submittedText(body.login_id),
        delivery_email: matched ? email : null,
        request_fingerprint: requestFingerprint(['info-match', getClientIp(request)]),
        created_at: FieldValue.serverTimestamp(),
      }).catch(logError => console.error('Password recovery event log failed:', logError));

      if (matched && userDoc) {
        const token = newSecretToken();
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
        const tokenRef = await adminDb().collection('password_reset_tokens').add({
          user_id: userDoc.id,
          token_hash: hashSecret(token),
          purpose: 'self_service',
          issued_role: role,
          requested_via: 'info_match',
          delivery_email: email,
          recovery_owner_user_id: userDoc.id,
          expires_at: Timestamp.fromDate(expiresAt),
          used_at: null,
          created_at: FieldValue.serverTimestamp(),
        });
        const actionUrl = `${getPublicBaseUrl(request)}/password-reset/confirm?token=${encodeURIComponent(token)}`;
        try {
          await queueRecoveryEmail({
            to: email,
            subject: '【創造学園アプリ】パスワード再設定',
            heading: 'パスワードを再設定します',
            body: `${profileDisplayName(profile)}さんのパスワード再設定を受け付けました。下のボタンから新しいパスワードを設定してください。心当たりがない場合は、このメールを破棄して教室へ連絡してください。`,
            actionLabel: '新しいパスワードを設定する',
            actionUrl,
            expiresIn: PASSWORD_RESET_TTL_LABEL,
            kind: 'password_reset',
            userId: userDoc.id,
          });
        } catch (deliveryError) {
          await tokenRef.delete().catch(cleanupError => {
            console.error('Password reset token cleanup failed:', cleanupError);
          });
          throw deliveryError;
        }
        // 新しいリンクを送れたら、前に出したリンクは使えなくする。
        await revokeOtherResetTokens(userDoc.id, tokenRef.id)
          .catch(revokeError => console.error('Password reset token revoke failed:', revokeError));
        await notifyInfoMatchPasswordReset({
          tokenId: tokenRef.id,
          target: { id: userDoc.id, role: role === 'student' ? 'student' : 'parent', data: profile },
          related,
          deliveryEmail: email,
          targetName: profileDisplayName(profile),
        }).catch(alertError => console.error('Password reset alert failed:', alertError));
      }
      const remainingDelay = 900 - (Date.now() - startedAt);
      if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
      return Response.json({ ok: true, message: MATCH_MESSAGE });
    }

    const verifiedEmail = normalizeEmail(profile.recovery_email);
    const ownEmailMatches = Boolean(profile.recovery_email_verified_at) &&
      verifiedEmail === email && isUsableRecoveryEmail(verifiedEmail);
    const linkedParent = userDoc && role === 'student' && nameMatches && !adminRole
      ? await findLinkedParentRecovery(userDoc.id, profile, email)
      : null;
    const deliveryEmail = ownEmailMatches ? verifiedEmail : linkedParent?.email || '';

    if (userDoc && !adminRole && nameMatches && deliveryEmail) {
      const token = newSecretToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
      const tokenRef = await adminDb().collection('password_reset_tokens').add({
        user_id: userDoc.id,
        token_hash: hashSecret(token),
        purpose: 'self_service',
        issued_role: role,
        requested_via: linkedParent ? 'linked_parent' : 'self',
        recovery_owner_user_id: linkedParent?.id || userDoc.id,
        expires_at: Timestamp.fromDate(expiresAt),
        used_at: null,
        created_at: FieldValue.serverTimestamp(),
      });

      const actionUrl = `${getPublicBaseUrl(request)}/password-reset/confirm?token=${encodeURIComponent(token)}`;
      try {
        await queueRecoveryEmail({
          to: deliveryEmail,
          subject: '【創造学園アプリ】パスワード再設定',
          heading: 'パスワードを再設定します',
          body: linkedParent
            ? `${profileDisplayName(profile)}さんのパスワード再設定を受け付けました。下のボタンから新しいパスワードを設定してください。`
            : 'パスワード再設定を受け付けました。下のボタンから新しいパスワードを設定してください。',
          actionLabel: '新しいパスワードを設定する',
          actionUrl,
          expiresIn: PASSWORD_RESET_TTL_LABEL,
          kind: 'password_reset',
          userId: userDoc.id,
        });
      } catch (deliveryError) {
        await tokenRef.delete().catch(cleanupError => {
          console.error('Password reset token cleanup failed:', cleanupError);
        });
        throw deliveryError;
      }
      await revokeOtherResetTokens(userDoc.id, tokenRef.id)
        .catch(revokeError => console.error('Password reset token revoke failed:', revokeError));
    }

    const remainingDelay = 700 - (Date.now() - startedAt);
    if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
    return Response.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error('Password reset request failed:', error);
    const remainingDelay = 700 - (Date.now() - startedAt);
    if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
    return Response.json({ ok: true, message: responseMessage });
  }
}
