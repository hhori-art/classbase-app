import 'server-only';
import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

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
  String(request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown')
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
  const collectionName = String(process.env.FIREBASE_MAIL_COLLECTION || 'mail').trim();
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

  await adminDb().collection(collectionName).add({
    to: [input.to],
    message: {
      subject: input.subject,
      text: `${input.body}\n\n${input.actionLabel}: ${input.actionUrl}\n\n有効期限: ${input.expiresIn}`,
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

