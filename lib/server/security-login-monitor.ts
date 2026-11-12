import 'server-only';
import { cleanSecurityText, recordSecurityEvent, type SecurityEventKind } from '@/lib/server/security-events';

const LOGIN_FAILURE_ERRORS = new Set(['wrong-password', 'wrong-initial-password', 'not-registered', 'too-many-attempts']);

/**
 * ログイン系の API を包み、回数制限での拒否（429）とログイン失敗（ID・パスワード違い）を記録する。
 * API の処理や応答は変えない。
 */
export function monitorLoginResponses<T extends Request>(
  handler: (request: T) => Promise<Response>,
  accountOf: (body: Record<string, unknown>) => unknown,
) {
  return async (request: T) => {
    const requestCopy = request.clone();
    const response = await handler(request);
    if (![401, 404, 429].includes(response.status)) return response;
    const result = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    const kind: SecurityEventKind | null = response.status === 429 ? 'rate_limited'
      : LOGIN_FAILURE_ERRORS.has(String(result.error || '')) ? 'login_failed' : null;
    if (kind) {
      const body = await requestCopy.json().catch(() => ({})) as Record<string, unknown>;
      recordSecurityEvent({ kind, request, account: cleanSecurityText(accountOf(body), 80) });
    }
    return response;
  };
}
