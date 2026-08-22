import 'server-only';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

type LineState = {
  uid: string;
  redirect: string;
  role?: string;
  iat: number;
};

function secret() {
  const configured =
    process.env.LINE_LOGIN_STATE_SECRET ||
    process.env.LINE_LOGIN_CHANNEL_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    '';
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return 'classbase-line-dev-secret';
  throw new Error('missing-line-state-secret');
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export function buildLineState(input: Omit<LineState, 'iat'>) {
  const payload = base64UrlEncode(JSON.stringify({ ...input, iat: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

export function parseLineState(state: string): LineState {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || sign(payload) !== signature) {
    throw new Error('invalid-line-state');
  }

  const parsed = JSON.parse(base64UrlDecode(payload)) as LineState;
  if (!parsed.uid || !parsed.redirect || !parsed.iat) throw new Error('invalid-line-state');
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('expired-line-state');
  return parsed;
}

export function safeRedirectUrl(rawRedirect: string, request: Request) {
  const origin = getRequestOrigin(request);
  const url = new URL(rawRedirect, origin);
  if (url.origin !== origin) return new URL('/', origin);
  return url;
}

export async function saveLineUserId(uid: string, lineUserId: string) {
  await adminDb().collection('users').doc(uid).set({
    line_user_id: lineUserId,
    line_linked_at: FieldValue.serverTimestamp(),
    notification_preferences: {
      line: true,
    },
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function clearLineUserId(uid: string) {
  await adminDb().collection('users').doc(uid).set({
    line_user_id: FieldValue.delete(),
    line_linked_at: FieldValue.delete(),
    notification_preferences: {
      line: false,
    },
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function getNotificationSettings() {
  const snap = await adminDb().collection('settings').doc('notification_channels').get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    line_enabled: data.line_enabled !== false,
    email_enabled: data.email_enabled !== false,
    in_app_enabled: data.in_app_enabled !== false,
    class_start_enabled: data.class_start_enabled !== false,
    homework_enabled: data.homework_enabled !== false,
    announcements_enabled: data.announcements_enabled !== false,
    student_line_enabled: data.student_line_enabled !== false,
    parent_line_enabled: data.parent_line_enabled !== false,
    teacher_line_enabled: data.teacher_line_enabled !== false,
    admin_line_enabled: data.admin_line_enabled !== false,
  };
}

export function roleLineEnabled(settings: Awaited<ReturnType<typeof getNotificationSettings>>, role: string) {
  if (!settings.line_enabled) return false;
  if (role === 'student') return settings.student_line_enabled;
  if (role === 'parent' || role === 'guardian') return settings.parent_line_enabled;
  if (role === 'teacher') return settings.teacher_line_enabled;
  if (role === 'admin' || role === 'master') return settings.admin_line_enabled;
  return true;
}
