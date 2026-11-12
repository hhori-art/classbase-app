import 'server-only';
import crypto from 'node:crypto';
import { gasMailConfigured, sendViaGas } from '@/lib/server/gas-mail';

// LINE・メール（Web Push は lib/server/web-push.ts）の送信と、利用者ごとの受信設定の判定。
// 一斉通知(/api/admin/notifications)と安全アラートの両方から使う。

export type NotifyChannel = 'in_app' | 'line' | 'email' | 'push';

export function userAllows(data: FirebaseFirestore.DocumentData, channel: NotifyChannel, kind: string) {
  const prefs = data.notification_preferences || {};
  if (channel === 'line' && prefs.line === false) return false;
  if (channel === 'email' && prefs.email === false) return false;
  if (channel === 'in_app' && prefs.in_app === false) return false;
  if (channel === 'push' && prefs.push === false) return false;
  if (kind && prefs[kind] === false) return false;
  return true;
}

export function stableLineRetryKey(...parts: string[]) {
  const hex = crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export function stableEmailIdempotencyKey(...parts: string[]) {
  return `classbase-${crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex')}`;
}

export function isDeliverableEmail(value: unknown) {
  const email = String(value || '').trim();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function pushLine(lineUserId: string, text: string, retryKey: string): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'line-token-missing' };

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text }],
      }),
    });

    if (res.status === 409 && res.headers.get('X-Line-Accepted-Request-Id')) {
      return { ok: true, duplicate: true };
    }
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      return { ok: false, error: errorText || `line-${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'line-network-error' };
  }
}

export async function sendEmail(email: string, title: string, message: string, idempotencyKey: string): Promise<{ ok: boolean; error?: string }> {
  if (gasMailConfigured()) return sendViaGas({ to: email, subject: title, text: message, id: idempotencyKey });
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!apiKey || !from) return { ok: false, error: 'email-config-missing' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from, to: [email], subject: title, text: message }),
    });
    if (!res.ok) {
      // Resend の理由（ドメイン未確認など）を残す。宛先・本文は含めない。
      const reason = await res.json().then((data: any) => String(data?.message || data?.name || ''), () => '');
      return { ok: false, error: `email-${res.status}${reason ? `: ${reason.slice(0, 200)}` : ''}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'email-network-error' };
  }
}
