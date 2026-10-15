'use client';

import { auth } from '@/lib/firebase';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: any }>();
const pending = new Map<string, Promise<any>>();

const authenticatedGet = async (path: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error('authentication required');
  const key = `${user.uid}:${path}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = (async () => {
    const token = await user.getIdToken();
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404) return null;
    if (!response.ok || data.ok === false) throw new Error(data.error || 'homework fetch failed');
    cache.set(key, { expiresAt: Date.now() + TTL_MS, value: data });
    return data;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
};

export async function loadStudentHomework(options: { id?: string; start?: string; end?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (options.id) params.set('id', options.id);
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (options.limit) params.set('limit', String(options.limit));
  const data = await authenticatedGet(`/api/student/homework?${params}`);
  return options.id ? data?.assignment || null : Array.isArray(data?.assignments) ? data.assignments : [];
}

export async function loadStudentCalendar(start: string, end: string, studentId?: string) {
  const studentParam = studentId ? `&student_id=${encodeURIComponent(studentId)}` : '';
  const data = await authenticatedGet(`/api/student/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${studentParam}`);
  return {
    homeworks: Array.isArray(data?.homeworks) ? data.homeworks : [],
    schedules: Array.isArray(data?.schedules) ? data.schedules : [],
  };
}
