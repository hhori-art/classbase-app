type AppAvailabilityPayload = {
  ok?: boolean;
  apps?: Record<string, boolean>;
  [key: string]: unknown;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { uid: string; expiresAt: number; payload: AppAvailabilityPayload } | null = null;
let pending: Promise<AppAvailabilityPayload> | null = null;

export async function loadAppAvailability(uid: string, getToken: () => Promise<string>) {
  if (cached?.uid === uid && cached.expiresAt > Date.now()) return cached.payload;
  if (pending) return pending;

  pending = (async () => {
    const token = await getToken();
    const response = await fetch('/api/apps', { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'app-availability-fetch-failed');
    cached = { uid, expiresAt: Date.now() + CACHE_TTL_MS, payload };
    return payload;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
