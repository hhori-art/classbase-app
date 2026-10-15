import 'server-only';
import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

const SYNTHETIC_EMAIL_DOMAINS = ['@classbase.local', '@sozogakuen.co.jp'];

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 30 * 60 * 1000;

export const normalizeLoginId = (value: unknown) =>
  String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();

export const normalizeName = (value: unknown) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[　\s]+/g, '')
    .toLowerCase();

export const normalizeEmail = (value: unknown) =>
  String(value || '').normalize('NFKC').trim().toLowerCase();

export const isUsableRecoveryEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
  email.length <= 254 &&
  !SYNTHETIC_EMAIL_DOMAINS.some(domain => email.endsWith(domain));

export const newSecretToken = () => crypto.randomBytes(32).toString('base64url');

export const hashSecret = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

export const requestFingerprint = (parts: string[]) =>
  crypto
    .createHmac('sha256', process.env.PASSWORD_RECOVERY_RATE_LIMIT_SECRET || process.env.FIREBASE_PRIVATE_KEY || 'local-development')
    .update(parts.join('|'))
    .digest('hex');

export const getClientIp = (request: Request) =>
  String(
    request.headers.get('x-vercel-forwarded-for') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
    .split(',')[0]
    .trim();

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const ref = adminDb().collection('password_recovery_rate_limits').doc(key);
  const now = Date.now();

  return adminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() || {};
    const windowStartedAt = data.window_started_at?.toMillis?.() || 0;
    const withinWindow = now - windowStartedAt < windowMs;
    const count = withinWindow ? Number(data.count || 0) : 0;

    if (count >= limit) return false;

    transaction.set(ref, {
      count: count + 1,
      window_started_at: withinWindow ? data.window_started_at : Timestamp.fromMillis(now),
      expires_at: Timestamp.fromMillis(now + windowMs * 2),
      updated_at: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function releaseRateLimit(key: string) {
  const ref = adminDb().collection('password_recovery_rate_limits').doc(key);
  await adminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const count = Math.max(0, Number(snapshot.data()?.count || 0) - 1);
    transaction.set(ref, {
      count,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export function getPublicBaseUrl(request: Request) {
  const configured = String(process.env.PASSWORD_RECOVERY_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return 'https://classbase-app.vercel.app';
  return new URL(request.url).origin;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char] || char));

function firebaseAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '');
}

async function sendFirebaseManagedVerificationEmail(input: {
  to: string;
  actionUrl: string;
}) {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new Error('email-service-not-configured');

  // This Auth identity exists only to let Firebase deliver a fresh ownership
  // verification message. App authorization continues to use the signed-in
  // user's own uid and the one-time Firestore token embedded in actionUrl.
  const shadowUid = `recovery_email_${hashSecret(input.to).slice(0, 48)}`;
  const auth = adminAuth();
  let deliveryUid = shadowUid;
  try {
    const existing = await auth.getUser(shadowUid);
    if (normalizeEmail(existing.email) !== input.to) {
      throw new Error('recovery-email-identity-conflict');
    }
    await auth.updateUser(shadowUid, {
      emailVerified: false,
      displayName: '創造学園アプリをご利用の方',
    });
  } catch (error) {
    if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') throw error;
    try {
      await auth.createUser({
        uid: shadowUid,
        email: input.to,
        emailVerified: false,
        displayName: '創造学園アプリをご利用の方',
      });
    } catch (createError) {
      if (firebaseAuthErrorCode(createError) === 'auth/email-already-exists') {
        // The address may already be the user's login email. Reuse that Auth
        // identity solely to deliver a verification message to its owner.
        const existing = await auth.getUserByEmail(input.to);
        deliveryUid = existing.uid;
      } else {
        throw createError;
      }
    }
  }

  const customToken = await auth.createCustomToken(deliveryUid, {
    purpose: 'recovery_email_verification',
  });
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const signInResult = await signInResponse.json().catch(() => ({}));
  if (!signInResponse.ok || !signInResult.idToken) {
    console.error('Firebase recovery email token exchange failed:', signInResponse.status, {
      code: String(signInResult?.error?.message || '').slice(0, 120),
    });
    throw new Error('email-delivery-failed');
  }

  const sendResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Firebase管理のメール確認画面とボタンを日本語で表示する。
        'X-Firebase-Locale': 'ja',
      },
      body: JSON.stringify({
        requestType: 'VERIFY_EMAIL',
        idToken: signInResult.idToken,
        continueUrl: input.actionUrl,
        canHandleCodeInApp: false,
      }),
    }
  );
  if (!sendResponse.ok) {
    const failure = await sendResponse.json().catch(() => ({}));
    console.error('Firebase recovery email delivery failed:', sendResponse.status, {
      code: String(failure?.error?.message || '').slice(0, 120),
    });
    throw new Error('email-delivery-failed');
  }
}

export async function queueRecoveryEmail(input: {
  to: string;
  subject: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  expiresIn: string;
  kind: 'password_reset' | 'recovery_email_verification';
  userId: string;
}) {
  if (input.kind === 'recovery_email_verification') {
    await sendFirebaseManagedVerificationEmail({
      to: input.to,
      actionUrl: input.actionUrl,
    });
    return;
  }

  const safeUrl = escapeHtml(input.actionUrl);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto;color:#172033;line-height:1.7">
      <h1 style="font-size:22px">${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.body)}</p>
      <p style="margin:28px 0">
        <a href="${safeUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">
          ${escapeHtml(input.actionLabel)}
        </a>
      </p>
      <p style="font-size:13px;color:#64748b">このリンクの有効期限は${escapeHtml(input.expiresIn)}です。心当たりがない場合は、このメールを破棄してください。</p>
      <p style="font-size:12px;color:#94a3b8;word-break:break-all">ボタンを押せない場合: ${safeUrl}</p>
    </div>
  `.trim();
  const text = `${input.body}\n\n${input.actionLabel}: ${input.actionUrl}\n\n有効期限: ${input.expiresIn}`;
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();

  if (resendApiKey) {
    const from = String(
      process.env.RESEND_FROM_EMAIL || '創造学園アプリ <noreply@sozogakuen.co.jp>'
    ).trim();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${input.kind}-${hashSecret(`${input.userId}|${input.actionUrl}`).slice(0, 32)}`,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      console.error('Recovery email delivery failed:', response.status, {
        name: String(failure?.name || ''),
        message: String(failure?.message || '').slice(0, 500),
      });
      if (response.status === 403 && failure?.name === 'validation_error') {
        throw new Error('email-sender-not-verified');
      }
      throw new Error('email-delivery-failed');
    }
    return;
  }

  // Firebase Trigger Email remains available as an explicitly configured fallback.
  const collectionName = String(process.env.FIREBASE_MAIL_COLLECTION || '').trim();
  if (!collectionName) {
    // 診断環境など外部メール配信サービスを接続しない環境でも、
    // Firebase管理メールから一度だけ有効なアプリ内再設定URLを届ける。
    await sendFirebaseManagedVerificationEmail({
      to: input.to,
      actionUrl: input.actionUrl,
    });
    return;
  }

  await adminDb().collection(collectionName).add({
    to: [input.to],
    message: {
      subject: input.subject,
      text,
      html,
    },
    metadata: {
      kind: input.kind,
      user_id: input.userId,
    },
    created_at: FieldValue.serverTimestamp(),
  });
}

export function userDisplayNames(profile: FirebaseFirestore.DocumentData) {
  return [
    profile.name,
    profile.student_name,
    profile.parent_name,
    profile.teacher_name,
    profile.display_name,
  ].map(normalizeName).filter(Boolean);
}
