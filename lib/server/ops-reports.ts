import 'server-only';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { isDeliverableEmail, pushLine, stableLineRetryKey } from '@/lib/server/notify-channels';
import { gasMailConfigured, sendViaGas } from '@/lib/server/gas-mail';

/**
 * 毎日の点検（この Mac の定期実行）の報告と、スマホからの返事。
 * - 報告は ops_reports/{日付}、返事は ops_decisions/{日付}（どちらもサーバー専用）。
 * - 報告は、決めた1人（OPS_REPORT_UID）に LINE（つながっていなければメール）で送る。
 * - 返事のリンクには、署名と期限（3日）をつける。返事は1つの報告に1回だけ。
 * - Mac からの書き込み・読み取りは OPS_AGENT_SECRET で確かめる。
 */

export const OPS_REPORTS = 'ops_reports';
export const OPS_DECISIONS = 'ops_decisions';
export const OPS_ACTIONS = ['deploy', 'skip', 'comment'] as const;
export type OpsAction = typeof OPS_ACTIONS[number];
const LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const secret = () => {
  const value = String(process.env.OPS_AGENT_SECRET || '').trim();
  if (value.length < 32) throw new Error('ops-secret-missing');
  return value;
};

const safeEqual = (left: string, right: string) => {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b) && left.length === right.length;
};

/** Mac の定期実行からの呼び出しか（Authorization: Bearer OPS_AGENT_SECRET）。 */
export function isOpsAgentRequest(request: Request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  try {
    return Boolean(token) && safeEqual(token, secret());
  } catch {
    return false;
  }
}

export const validReportId = (value: unknown) => /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]{1,12})?$/.test(String(value || ''));

export function signDecisionToken(reportId: string, now = Date.now()) {
  const exp = now + LINK_TTL_MS;
  const payload = `${reportId}.${exp}`;
  const signature = crypto.createHmac('sha256', secret()).update(`ops-decision:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyDecisionToken(token: unknown, now = Date.now()): { ok: true; reportId: string } | { ok: false; reason: 'invalid' | 'expired' } {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };
  const [reportId, expText, signature] = parts;
  if (!validReportId(reportId) || !/^\d+$/.test(expText)) return { ok: false, reason: 'invalid' };
  let expected = '';
  try {
    expected = crypto.createHmac('sha256', secret()).update(`ops-decision:${reportId}.${expText}`).digest('base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!safeEqual(signature, expected)) return { ok: false, reason: 'invalid' };
  if (Number(expText) < now) return { ok: false, reason: 'expired' };
  return { ok: true, reportId };
}

export function publicBaseUrl() {
  return String(process.env.PASSWORD_RECOVERY_BASE_URL || 'https://classbase-app.vercel.app').replace(/\/$/, '');
}

/** 決めた1人に、LINE（つながっていなければメール）で送る。どちらで送ったかを返す。 */
export async function notifyOpsOwner(input: { id: string; subject: string; text: string }) {
  const uid = String(process.env.OPS_REPORT_UID || '').trim();
  if (!uid) return 'no-recipient';
  const profile = (await adminDb().collection('users').doc(uid).get()).data() || {};
  const lineUserId = String(profile.line_user_id || '').trim();
  if (lineUserId) {
    const result = await pushLine(lineUserId, `${input.subject}\n\n${input.text}`.slice(0, 4900), stableLineRetryKey('ops', input.id));
    if (result.ok) return 'line';
  }
  const email = [profile.recovery_email, profile.email].map(value => String(value || '').trim()).find(isDeliverableEmail);
  if (email && gasMailConfigured()) {
    const sent = await sendViaGas({ to: email, subject: input.subject, text: input.text, id: `ops_${input.id}` });
    if (sent.ok) return 'email';
  }
  return 'not-sent';
}

export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
