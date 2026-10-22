import 'server-only';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

type LineState = {
  uid: string;
  redirect: string;
  role: string;
  nonce: string;
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
  const configured = String(process.env.NEXT_PUBLIC_BASE_URL || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Invalid optional configuration must not make forwarded host headers authoritative.
    }
  }
  return url.origin;
}

export function buildLineState(input: Omit<LineState, 'iat'>) {
  const payload = base64UrlEncode(JSON.stringify({ ...input, iat: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

export function parseLineState(state: string): LineState {
  const [payload, signature] = state.split('.');
  const expected = payload ? sign(payload) : '';
  const suppliedBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);
  if (!payload || !signature || suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error('invalid-line-state');
  }

  const parsed = JSON.parse(base64UrlDecode(payload)) as LineState;
  if (!parsed.uid || !parsed.redirect || !parsed.role || !parsed.nonce || !parsed.iat) throw new Error('invalid-line-state');
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('expired-line-state');
  return parsed;
}

export function normalizeLineRole(role: unknown) {
  const value = String(role || '').toLowerCase();
  if (value === 'student') return 'student';
  if (value === 'parent' || value === 'guardian') return 'parent';
  if (value === 'teacher' || value === 'attendance_only' || value === 'attendance_manager') return 'teacher';
  if (value === 'master' || value.includes('admin')) return 'admin';
  return '';
}

function nonceHash(nonce: string) {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

export async function beginLineLink(uid: string, redirect: string, role: string) {
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await adminDb().collection('users').doc(uid).set({
    line_link_nonce_hash: nonceHash(nonce),
    line_link_nonce_expires_at: expiresAt,
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  return buildLineState({ uid, redirect, role, nonce });
}

export async function completeLineLink(state: LineState, lineUserId: string) {
  const db = adminDb();
  const userRef = db.collection('users').doc(state.uid);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) throw new Error('line-link-account-missing');
    const data = snapshot.data() || {};
    const status = String(data.account_status || data.status || '').toLowerCase();
    const expiry = data.line_link_nonce_expires_at?.toMillis?.()
      ?? data.line_link_nonce_expires_at?.getTime?.()
      ?? Date.parse(String(data.line_link_nonce_expires_at || ''));
    if (['suspended', 'withdrawn', 'archived'].includes(status)) throw new Error('line-link-account-inactive');
    if (normalizeLineRole(data.role) !== state.role) throw new Error('line-link-role-changed');
    if (data.line_link_nonce_hash !== nonceHash(state.nonce) || !Number.isFinite(expiry) || Date.now() > expiry) {
      throw new Error('line-link-state-invalid');
    }
    transaction.update(userRef, {
      line_user_id: lineUserId,
      line_linked_at: FieldValue.serverTimestamp(),
      'notification_preferences.line': true,
      line_link_nonce_hash: FieldValue.delete(),
      line_link_nonce_expires_at: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });
}

export function safeRedirectUrl(rawRedirect: string, request: Request) {
  const origin = getRequestOrigin(request);
  const url = new URL(rawRedirect, origin);
  if (url.origin !== origin) return new URL('/', origin);
  return url;
}

export async function clearLineUserId(uid: string) {
  await adminDb().collection('users').doc(uid).set({
    line_user_id: FieldValue.delete(),
    line_linked_at: FieldValue.delete(),
    'notification_preferences.line': false,
    line_link_nonce_hash: FieldValue.delete(),
    line_link_nonce_expires_at: FieldValue.delete(),
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
    // 自動の通知（lib/server/auto-notifications.ts）。既定はオン。
    missed_class_enabled: data.missed_class_enabled !== false,
    work_detail_reminder_enabled: data.work_detail_reminder_enabled !== false,
    correction_result_enabled: data.correction_result_enabled !== false,
    missed_class_summary_enabled: data.missed_class_summary_enabled !== false,
    clock_out_missing_enabled: data.clock_out_missing_enabled !== false,
    transfer_reminder_enabled: data.transfer_reminder_enabled !== false,
    dedicated_report_reminder_enabled: data.dedicated_report_reminder_enabled !== false,
    student_line_enabled: data.student_line_enabled !== false,
    parent_line_enabled: data.parent_line_enabled !== false,
    teacher_line_enabled: data.teacher_line_enabled !== false,
    admin_line_enabled: data.admin_line_enabled !== false,
  };
}

export function roleLineEnabled(settings: Awaited<ReturnType<typeof getNotificationSettings>>, role: string) {
  if (!settings.line_enabled) return false;
  const normalized = normalizeLineRole(role);
  if (normalized === 'student') return settings.student_line_enabled;
  if (normalized === 'parent') return settings.parent_line_enabled;
  if (normalized === 'teacher') return settings.teacher_line_enabled;
  if (normalized === 'admin') return settings.admin_line_enabled;
  return false;
}
