'use client';

import { auth } from '@/lib/firebase';
import type { ClientReportedAuditAction } from '@/app/components/master/audit-log-actions';

export type ReportAuditLogInput = {
  action: ClientReportedAuditAction;
  target_type: string;
  target_id: string;
  target_label?: string;
  school_id?: string | null;
  details?: Record<string, unknown>;
};

/**
 * 画面から直接 Firestore に書いた重要な操作を、成功した後に操作ログへ記録する。
 * 操作した人はサーバー側で確認する。記録に失敗しても操作そのものは成功しているため、画面には出さない。
 */
export async function reportAuditLog(input: ReportAuditLogInput): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch('/api/admin/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      keepalive: true,
    });
    if (!response.ok) console.warn('[audit-log] report failed', input.action, response.status);
  } catch (error) {
    console.warn('[audit-log] report failed', input.action, error);
  }
}
