'use client';

import { auth } from '@/lib/firebase';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; items: any[] }>();
const pending = new Map<string, Promise<any[]>>();

export async function loadAnnouncements(maxItems: number) {
  const size = Math.max(1, Math.min(maxItems, 100));
  const user = auth.currentUser;
  if (!user) throw new Error('authentication required');
  const key = `${user.uid}:${size}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/announcements?limit=${size}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'announcement fetch failed');
    const items = Array.isArray(data.announcements) ? data.announcements : [];
    cache.set(key, { expiresAt: Date.now() + TTL_MS, items });
    return items;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

export async function loadAnnouncement(id: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('authentication required');
  const token = await user.getIdToken();
  const response = await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 404) return null;
  if (!response.ok || data.ok === false) throw new Error(data.error || 'announcement fetch failed');
  return data.announcement || null;
}
