import 'server-only';
import crypto from 'node:crypto';
import { after } from 'next/server';
import webpush from 'web-push';
import { adminDb } from '@/lib/firebase-admin';
import { userAllows } from '@/lib/server/notify-channels';

// Web Push（端末への通知）。アプリ内通知を書いた後に「ついでに」送るだけで、
// 失敗しても呼び出し元へ例外を返さない。VAPID の鍵が未設定なら何もしない。

export const PUSH_SUBSCRIPTIONS = 'push_subscriptions';
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;
const MAX_PUSH_USERS = 500;
const USER_CHUNK = 30; // Firestore の in 条件の上限
const SEND_CONCURRENCY = 10;

export type PushMessage = { title: string; body: string; link?: string };

let warnedMissingConfig = false;

export function pushSubscriptionId(endpoint: string) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

export function webPushConfig() {
  const publicKey = String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim();
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

function configOrWarn() {
  const config = webPushConfig();
  if (!config && !warnedMissingConfig) {
    warnedMissingConfig = true;
    console.warn('[web-push] VAPID keys are not configured; push notifications are disabled.');
  }
  return config;
}

const clip = (value: unknown, max: number) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** 通知を開いた時の遷移先。同じサイト内の相対パスだけを許す。 */
export function safePushLink(link: unknown) {
  const value = String(link || '').trim();
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value.slice(0, 500) : '/';
}

async function pushChannelEnabled() {
  try {
    const snap = await adminDb().collection('settings').doc('notification_channels').get();
    return !snap.exists || (snap.data() || {}).push_enabled !== false;
  } catch {
    return true;
  }
}

type StoredSubscription = { id: string; user_id: string; endpoint: string; keys: { p256dh: string; auth: string } };

async function loadSubscriptions(userIds: string[]) {
  const db = adminDb();
  const found: StoredSubscription[] = [];
  for (let index = 0; index < userIds.length; index += USER_CHUNK) {
    const chunk = userIds.slice(index, index + USER_CHUNK);
    const snap = await db.collection(PUSH_SUBSCRIPTIONS).where('user_id', 'in', chunk).limit(chunk.length * MAX_PUSH_SUBSCRIPTIONS_PER_USER).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (typeof data.endpoint === 'string' && data.keys?.p256dh && data.keys?.auth) {
        found.push({ id: doc.id, user_id: String(data.user_id), endpoint: data.endpoint, keys: { p256dh: String(data.keys.p256dh), auth: String(data.keys.auth) } });
      }
    }
  }
  return found;
}

async function allowedUserIds(userIds: string[], kind: string) {
  const db = adminDb();
  const allowed = new Set<string>();
  for (let index = 0; index < userIds.length; index += 100) {
    const refs = userIds.slice(index, index + 100).map(id => db.collection('users').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists && userAllows(snap.data() || {}, 'push', kind)) allowed.add(snap.id);
    }
  }
  return allowed;
}

/**
 * 指定した利用者の登録済み端末へ通知を送る。鍵がない・送信に失敗した等の場合も例外を投げない。
 * 端末から無効と返された購読（404/410）は削除する。
 */
export async function sendPushToUsers(userIds: string[], message: PushMessage, options: { kind?: string } = {}) {
  const result = { sent: 0, failed: 0, removed: 0 };
  try {
    const config = configOrWarn();
    if (!config) return result;
    const ids = Array.from(new Set(userIds.map(id => String(id || '').trim()).filter(Boolean))).slice(0, MAX_PUSH_USERS);
    if (!ids.length || !(await pushChannelEnabled())) return result;

    const subscriptions = await loadSubscriptions(ids);
    if (!subscriptions.length) return result;
    const allowed = await allowedUserIds(Array.from(new Set(subscriptions.map(item => item.user_id))), options.kind || '');
    const targets = subscriptions.filter(item => allowed.has(item.user_id));

    const payload = JSON.stringify({
      title: clip(message.title, 60) || '創造学園アプリ',
      body: clip(message.body, 120),
      link: safePushLink(message.link),
    });
    const db = adminDb();
    for (let index = 0; index < targets.length; index += SEND_CONCURRENCY) {
      await Promise.all(targets.slice(index, index + SEND_CONCURRENCY).map(async target => {
        try {
          await webpush.sendNotification({ endpoint: target.endpoint, keys: target.keys }, payload, {
            vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
            TTL: 60 * 60 * 24,
            timeout: 5000,
          });
          result.sent++;
        } catch (error) {
          result.failed++;
          const statusCode = (error as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await db.collection(PUSH_SUBSCRIPTIONS).doc(target.id).delete().catch(() => undefined);
            result.removed++;
          }
        }
      }));
    }
  } catch (error) {
    console.warn('[web-push] send failed', error instanceof Error ? error.message : 'unknown');
  }
  return result;
}

/**
 * 応答を返した後に送る（Vercel では after() で関数の終了を待たせる）。
 * 鍵が未設定なら何もしない。呼び出し元へは何も返さず、例外も投げない。
 */
export function queuePushToUsers(userIds: string[], message: PushMessage, options: { kind?: string } = {}) {
  try {
    if (!userIds.length || !configOrWarn()) return;
    const task = () => sendPushToUsers(userIds, message, options).then(() => undefined);
    try {
      after(task);
    } catch {
      // リクエストの外（スクリプト・テスト）では after() が使えないため、そのまま送る。
      void task().catch(() => undefined);
    }
  } catch {
    // 通知は補助的な経路のため、ここでの失敗は無視する。
  }
}
