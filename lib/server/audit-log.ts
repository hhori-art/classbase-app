import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { ServerUser } from '@/lib/server-auth';
import type { AuditAction } from '@/app/components/master/audit-log-actions';

export const AUDIT_LOG_COLLECTION = 'admin_audit_logs';

export type AuditLogInput = {
  /** サーバーで確認したログイン中の利用者（ブラウザから送られた名前は使わない）。 */
  actor: ServerUser;
  action: AuditAction;
  target_type: string;
  target_id?: string | null;
  target_label?: string | null;
  school_id?: string | null;
  details?: Record<string, unknown> | null;
  /** 画面から直接行った操作を、操作後に画面が記録を依頼したもの。 */
  reported_by_client?: boolean;
};

const MAX_TEXT = 300;
const MAX_DETAIL_KEYS = 20;
const MAX_LIST = 30;

const text = (value: unknown, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

/** 詳細は検索・表示用の小さな値だけ残す（パスワードなどの秘密情報や大きな値は保存しない）。 */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, MAX_TEXT);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return depth >= 2 ? null : value.slice(0, MAX_LIST).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object' && depth < 2) return sanitizeDetails(value as Record<string, unknown>, depth + 1);
  return null;
}

const SECRET_KEY = /pass(word)?|secret|token|zak|credential/i;

export function sanitizeDetails(details: Record<string, unknown> | null | undefined, depth = 0) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return Object.fromEntries(Object.entries(details)
    .filter(([key]) => !SECRET_KEY.test(key))
    .slice(0, MAX_DETAIL_KEYS)
    .map(([key, value]) => [key.slice(0, 60), sanitizeValue(value, depth)]));
}

const actorName = (actor: ServerUser) =>
  text(actor.profile?.name || actor.profile?.display_name || actor.profile?.teacher_name || actor.profile?.admin_name || actor.email || actor.uid, 120);

export function auditLogRecord(input: AuditLogInput) {
  return {
    action: input.action,
    actor_id: input.actor.uid,
    actor_name: actorName(input.actor),
    actor_role: text(input.actor.profile?.role || input.actor.role, 40),
    actor_email: text(input.actor.email, 200) || null,
    target_type: text(input.target_type, 60),
    target_id: text(input.target_id, 300) || null,
    target_label: text(input.target_label, 200) || null,
    school_id: text(input.school_id, 60) || null,
    details: sanitizeDetails(input.details),
    reported_by_client: input.reported_by_client === true,
    created_at: FieldValue.serverTimestamp(),
  };
}

/**
 * 管理者の重要な操作を admin_audit_logs に記録する。
 * 記録に失敗しても操作そのものは止めない（例外を投げず false を返す）。
 */
export async function writeAuditLog(input: AuditLogInput): Promise<boolean> {
  try {
    await adminDb().collection(AUDIT_LOG_COLLECTION).add(auditLogRecord(input));
    return true;
  } catch (error) {
    console.error('[audit-log] write failed', input.action, error);
    return false;
  }
}

/** 一括操作の記録（対象ごとに1件、最大100件ずつまとめて書く）。失敗しても例外を投げない。 */
export async function writeAuditLogs(inputs: AuditLogInput[]): Promise<boolean> {
  if (inputs.length === 0) return true;
  try {
    const db = adminDb();
    for (let index = 0; index < inputs.length; index += 100) {
      const batch = db.batch();
      inputs.slice(index, index + 100).forEach(input => {
        batch.set(db.collection(AUDIT_LOG_COLLECTION).doc(), auditLogRecord(input));
      });
      await batch.commit();
    }
    return true;
  } catch (error) {
    console.error('[audit-log] batch write failed', inputs[0]?.action, error);
    return false;
  }
}
