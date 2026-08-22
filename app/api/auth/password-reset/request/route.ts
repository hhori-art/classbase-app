import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
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

export const runtime = 'nodejs';

const GENERIC_MESSAGE =
  '入力内容が登録情報と一致する場合、本人または紐づく保護者の確認済みメールアドレスへ再設定用メールを送信します。';
const SUPPORT_MESSAGE =
  '受付が完了しました。再設定用メールを利用できない場合は、受付番号を添えてサポートセンターへご連絡ください。';
const ADMIN_ROLES = [
  'master', 'admin', 'master_admin', 'super_admin', 'school_admin',
  'branch_admin', 'campus_admin', 'classroom_admin', 'test_admin',
];

async function findUser(loginId: string) {
  const db = adminDb();
  const candidates = Array.from(new Set([loginId, loginId.toLowerCase(), loginId.toUpperCase()]));
  for (const value of candidates) {
    for (const field of ['lifetime_id', 'initial_login_id'] as const) {
      const snapshot = await db.collection('users').where(field, '==', value).limit(2).get();
      if (!snapshot.empty) return snapshot.docs[0];
    }
  }
  if (/^\d+$/.test(loginId)) {
    const snapshot = await db.collection('users').where('lifetime_id', '==', Number(loginId)).limit(2).get();
    if (!snapshot.empty) return snapshot.docs[0];
  }
  return null;
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

async function createSupportRequest(
  loginId: string,
  name: string,
  submittedPhoneLast4: string,
  userDoc: FirebaseFirestore.QueryDocumentSnapshot | null
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

  await adminDb().collection('password_recovery_requests').add({
    request_code: requestCode,
    status: 'pending',
    source: 'no_email',
    target_user_id: validTarget ? userDoc!.id : null,
    target_role: validTarget ? role : null,
    target_name: validTarget ? profileDisplayName(profile) : null,
    target_login_id: validTarget ? loginId : null,
    phone_last4_provided: Boolean(submittedPhoneLast4),
    phone_last4_matched: Boolean(
      submittedPhoneLast4 && registeredPhoneLast4 && submittedPhoneLast4 === registeredPhoneLast4
    ),
    request_fingerprint: requestFingerprint(['support-request', loginId, name]),
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return requestCode;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let responseMessage = GENERIC_MESSAGE;
  try {
    const body = await request.json();
    const mode = body.mode === 'support' ? 'support' : 'email';
    responseMessage = mode === 'support' ? SUPPORT_MESSAGE : GENERIC_MESSAGE;
    const loginId = normalizeLoginId(body.login_id);
    const name = normalizeName(body.name);
    const email = normalizeEmail(body.email);

    if (!loginId || !name || (mode === 'email' && !isUsableRecoveryEmail(email))) {
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
    if (!ipAllowed || !accountAllowed) {
      return Response.json({ ok: true, message: responseMessage });
    }

    const userDoc = await findUser(loginId);
    const profile = userDoc?.data() || {};
    const role = String(profile.role || '').toLowerCase();
    const adminRole = ADMIN_ROLES.includes(role);
    const nameMatches = userDisplayNames(profile).includes(name);

    if (mode === 'support') {
      const requestCode = await createSupportRequest(loginId, name, phoneLast4(body.phone_last4), userDoc);
      const remainingDelay = 700 - (Date.now() - startedAt);
      if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
      return Response.json({ ok: true, message: SUPPORT_MESSAGE, request_code: requestCode });
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
      await adminDb().collection('password_reset_tokens').add({
        user_id: userDoc.id,
        token_hash: hashSecret(token),
        purpose: 'self_service',
        requested_via: linkedParent ? 'linked_parent' : 'self',
        recovery_owner_user_id: linkedParent?.id || userDoc.id,
        expires_at: Timestamp.fromDate(expiresAt),
        used_at: null,
        created_at: FieldValue.serverTimestamp(),
      });

      const actionUrl = `${getPublicBaseUrl(request)}/password-reset/confirm?token=${encodeURIComponent(token)}`;
      await queueRecoveryEmail({
        to: deliveryEmail,
        subject: '【創造学園アプリ】パスワード再設定',
        heading: 'パスワードを再設定します',
        body: linkedParent
          ? `${profileDisplayName(profile)}さんのパスワード再設定を受け付けました。下のボタンから新しいパスワードを設定してください。`
          : 'パスワード再設定を受け付けました。下のボタンから新しいパスワードを設定してください。',
        actionLabel: '新しいパスワードを設定する',
        actionUrl,
        expiresIn: '30分',
        kind: 'password_reset',
        userId: userDoc.id,
      });
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
