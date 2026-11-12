import 'server-only';
import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

// onlinesupport@sozogakuen.co.jp で作った Google Apps Script（docs/gas-mail-sender.gs）から送るための待ち行列。
// 会社の設定で GAS をウェブアプリとして外部公開できないため、アプリは mail_outbox に積むだけにし、
// GAS が1分ごとに /api/internal/mail-outbox へ取りに来て、そのアカウントの Gmail から送る。
// DNS・管理者設定・2段階認証はいらない代わりに、送信は1日1,500通まで・最大1分ほど遅れる。
// GAS_MAIL_SECRET（GAS と共有する合言葉）があれば Resend より優先する。

const clean = (value: unknown) => String(value ?? '').trim();

const OUTBOX = 'mail_outbox';
/** 残りがこの通数を切ったら警告を残す（1,500通に近づいたら別の送信方法へ移る目安）。 */
export const GAS_MAIL_LOW_QUOTA = 300;
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** 取り出したまま報告がないものは、この時間が過ぎたら送り直す。 */
const STALE_CLAIM_MS = 10 * 60 * 1000;
/** これより古いものは送らない（止まっていたあとに古い再設定リンクなどを送らない）。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const secret = () => clean(process.env.GAS_MAIL_SECRET);

export function gasMailConfigured() {
  return secret().length >= 32;
}

export async function sendViaGas(input: { to: string; subject: string; text: string; html?: string; id?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!gasMailConfigured()) return { ok: false, error: 'gas-mail-config-missing' };
  if (/[,;\s]/.test(input.to)) return { ok: false, error: 'gas-mail-invalid-recipient' };
  const docId = crypto.createHash('sha256').update(input.id || crypto.randomUUID()).digest('hex').slice(0, 40);
  try {
    await adminDb().collection(OUTBOX).doc(docId).create({
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      name: clean(process.env.GAS_MAIL_FROM_NAME) || '創造学園アプリ',
      status: 'pending',
      attempts: 0,
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  } catch (error: any) {
    // 同じメールはすでに積んである（二重送信を防ぐ）。
    if (error?.code === 6 || /already exists/i.test(String(error?.message))) return { ok: true };
    return { ok: false, error: 'gas-mail-enqueue-failed' };
  }
}

/** GAS からの呼び出しか、合言葉で作った署名と時刻で確かめる。 */
export function verifyGasRequest(body: { ts?: unknown; sig?: unknown; payload?: unknown }) {
  if (!gasMailConfigured()) return null;
  const ts = Number(body.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return null;
  const payload = String(body.payload ?? '');
  const expected = crypto.createHmac('sha256', secret()).update(`${clean(body.ts)}\n${payload}`, 'utf8').digest();
  const supplied = Buffer.from(clean(body.sig), 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    return JSON.parse(payload) as Record<string, any>;
  } catch {
    return null;
  }
}

async function recordQuota(remaining: number, extra: Record<string, unknown> = {}) {
  if (!Number.isFinite(remaining)) return;
  if (remaining < GAS_MAIL_LOW_QUOTA) console.warn('GAS mail daily quota is running low:', { remaining });
  // 管理者が「今日あと何通送れるか」を確かめられるように、最新の状態を1件だけ持つ。
  await adminDb().collection('mail_delivery_status').doc('gas').set({
    remaining,
    low: remaining < GAS_MAIL_LOW_QUOTA,
    checked_at: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true }).catch(() => undefined);
}

const millis = (value: any) => (value instanceof Timestamp ? value.toMillis() : 0);

/** 送るメールを最大 limit 件取り出し、送信中にする。 */
export async function claimOutbox(limit: number, remaining: number) {
  const db = adminDb();
  const take = Math.max(0, Math.min(50, Math.floor(limit), Math.floor(remaining)));
  const now = Date.now();
  const claimed = await db.runTransaction(async tx => {
    const [pending, sending] = await Promise.all([
      tx.get(db.collection(OUTBOX).where('status', '==', 'pending').limit(100)),
      tx.get(db.collection(OUTBOX).where('status', '==', 'sending').limit(50)),
    ]);
    const candidates = [
      ...pending.docs,
      ...sending.docs.filter(doc => now - millis(doc.get('claimed_at')) > STALE_CLAIM_MS),
    ].sort((a, b) => millis(a.get('created_at')) - millis(b.get('created_at')));
    const out: Array<{ id: string; to: string; subject: string; text: string; html?: string; name: string }> = [];
    for (const doc of candidates) {
      const data = doc.data();
      const created = millis(data.created_at);
      if (created && now - created > MAX_AGE_MS) {
        tx.update(doc.ref, { status: 'expired', text: FieldValue.delete(), html: FieldValue.delete() });
        continue;
      }
      if (out.length >= take) continue;
      tx.update(doc.ref, { status: 'sending', claimed_at: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1) });
      out.push({ id: doc.id, to: data.to, subject: data.subject, text: data.text, ...(data.html ? { html: data.html } : {}), name: data.name });
    }
    return out;
  });
  await recordQuota(remaining, { last_poll_at: FieldValue.serverTimestamp() });
  return claimed;
}

/** GAS が送った結果を記録する。送れたものは本文（再設定リンクなど）を消す。 */
export async function reportOutbox(results: Array<{ id?: unknown; ok?: unknown; error?: unknown }>, remaining: number) {
  const db = adminDb();
  const batch = db.batch();
  let count = 0;
  for (const result of results.slice(0, 50)) {
    const id = clean(result.id);
    if (!/^[0-9a-f]{40}$/.test(id)) continue;
    const ref = db.collection(OUTBOX).doc(id);
    if (result.ok === true) {
      batch.update(ref, { status: 'sent', sent_at: FieldValue.serverTimestamp(), text: FieldValue.delete(), html: FieldValue.delete() });
    } else {
      const snap = await ref.get();
      if (!snap.exists) continue;
      const giveUp = Number(snap.get('attempts') || 0) >= MAX_ATTEMPTS;
      batch.update(ref, {
        status: giveUp ? 'failed' : 'pending',
        last_error: clean(result.error).slice(0, 200),
        ...(giveUp ? { text: FieldValue.delete(), html: FieldValue.delete() } : {}),
      });
      if (giveUp) console.error('GAS mail delivery failed:', { id, error: clean(result.error).slice(0, 200) });
    }
    count += 1;
  }
  if (count) await batch.commit();
  await recordQuota(remaining);
  return count;
}
