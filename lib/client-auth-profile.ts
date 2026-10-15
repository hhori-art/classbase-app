import type { User } from 'firebase/auth';

export async function loadAuthenticatedProfile(user: User, timeoutMs = 10_000) {
  // 失効済みのキャッシュトークンで保護画面に入らないよう、
  // 起動時はサーバーに再確認する。
  const token = await user.getIdToken(true);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/auth/profile', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.profile) {
      const error = new Error(body.error || 'profile-service-unavailable') as Error & { status?: number; code?: string };
      error.status = response.status;
      error.code = String(body.code || body.error || '');
      throw error;
    }
    return body.profile as Record<string, any>;
  } finally {
    window.clearTimeout(timer);
  }
}
