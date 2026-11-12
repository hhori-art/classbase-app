import 'server-only';
import crypto from 'crypto';
import { after } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

/**
 * 攻撃の兆候の記録（監視用）。
 *
 * Firestore の読み取り予算（docs/student-firestore-read-budget.md）を守るため、記録は「書き込みだけ」にする。
 * 1件ごとに、日別の集計（security_monitor_days/{日付}）と、IP・アカウント別の集計
 * （…/subjects/{種類}_{ハッシュ}）へ FieldValue.increment で1を足す。読み取りはしない。
 * 集計を読むのは監視ジョブ（/api/security/monitor）だけで、1回につき数件。
 *
 * 記録は応答の後に行い（next/server の after）、失敗しても利用者の操作には影響させない。
 */

export const SECURITY_EVENT_KINDS = ['login_failed', 'rate_limited', 'unauthorized', 'probe', 'webhook_signature'] as const;
export type SecurityEventKind = typeof SECURITY_EVENT_KINDS[number];

export const SECURITY_EVENT_LABELS: Record<SecurityEventKind, string> = {
  login_failed: 'ログインの失敗',
  rate_limited: '回数制限による拒否',
  unauthorized: 'ログインなし・無効なログインでのAPI呼び出し',
  probe: '脆弱性を探る不審なアクセス（.php など）',
  webhook_signature: '署名が合わない外部通知（Zoom など）',
};

export const SECURITY_DAYS_COLLECTION = 'security_monitor_days';
export const SECURITY_SUBJECTS_SUBCOLLECTION = 'subjects';
/** 集計は30日で自動削除できるよう期限を付ける（Firestore の TTL を expires_at に設定すると消える）。 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const jstParts = (date = new Date()) => {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return { day: jst.slice(0, 10), hour: jst.slice(11, 13) };
};

const subjectId = (type: 'ip' | 'account', value: string) =>
  `${type}_${crypto.createHash('sha256').update(`${type}:${value}`).digest('hex').slice(0, 32)}`;

export const cleanSecurityText = (value: unknown, max: number) => String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

export const securityEventIp = (request: Request) => cleanSecurityText(
  request.headers.get('x-vercel-forwarded-for') ||
  request.headers.get('x-forwarded-for') ||
  request.headers.get('x-real-ip') || '',
  80,
).split(',')[0].trim();

async function writeSecurityEvent(input: { kind: SecurityEventKind; ip?: string; account?: string; path?: string; at: Date }) {
  const db = adminDb();
  const { day, hour } = jstParts(input.at);
  const dayRef = db.collection(SECURITY_DAYS_COLLECTION).doc(day);
  const expiresAt = Timestamp.fromMillis(input.at.getTime() + RETENTION_MS);
  const batch = db.batch();
  batch.set(dayRef, {
    day,
    counts: { [input.kind]: FieldValue.increment(1) },
    hours: { [hour]: { [input.kind]: FieldValue.increment(1) } },
    updated_at: FieldValue.serverTimestamp(),
    expires_at: expiresAt,
  }, { merge: true });
  const subjects: Array<['ip' | 'account', string]> = [];
  if (input.ip) subjects.push(['ip', input.ip]);
  if (input.account) subjects.push(['account', input.account.toLowerCase()]);
  for (const [type, value] of subjects) {
    batch.set(dayRef.collection(SECURITY_SUBJECTS_SUBCOLLECTION).doc(subjectId(type, value)), {
      type,
      value,
      total: FieldValue.increment(1),
      kinds: { [input.kind]: FieldValue.increment(1) },
      // 1時間ごとの監視が「直近1時間」の分だけで判定できるよう、時間ごとにも数える。
      hours: { [hour]: { [input.kind]: FieldValue.increment(1) } },
      ...(input.path ? { last_path: input.path } : {}),
      last_seen: FieldValue.serverTimestamp(),
      expires_at: expiresAt,
    }, { merge: true });
  }
  await batch.commit();
}

/** 攻撃の兆候を1件記録する。応答を遅らせず、失敗しても例外を投げない。 */
export function recordSecurityEvent(input: { kind: SecurityEventKind; request?: Request; ip?: string; account?: string; path?: string }) {
  const event = {
    kind: input.kind,
    ip: cleanSecurityText(input.ip || (input.request ? securityEventIp(input.request) : ''), 80),
    account: cleanSecurityText(input.account, 80),
    path: cleanSecurityText(input.path || (input.request ? new URL(input.request.url).pathname : ''), 200),
    at: new Date(),
  };
  const task = () => writeSecurityEvent(event).catch(error => console.warn('[security-events] write failed', event.kind, error?.message));
  try {
    after(task);
  } catch {
    // リクエストの外（テストやバッチ）から呼ばれたときは、その場で書く。
    void task();
  }
}

