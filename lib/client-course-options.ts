type CourseOptionPayload = {
  ok?: boolean;
  options?: any[];
  term_ranges?: Record<string, { start: string; end: string }>;
  [key: string]: any;
};

type LoadCourseOptionsInput = {
  grade: string;
  year?: number;
  getToken: () => Promise<string>;
  force?: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'v3';
const memoryCache = new Map<string, { expiresAt: number; payload: CourseOptionPayload }>();
const pendingRequests = new Map<string, Promise<CourseOptionPayload>>();

const cacheKey = (grade: string, year?: number) => `${String(grade || 'all').trim()}__${year || 'current'}`;
const storageKey = (key: string) => `classbase_course_options:${CACHE_VERSION}:${key}`;

const readSessionCache = (key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload || Number(parsed.expiresAt || 0) <= Date.now()) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return parsed as { expiresAt: number; payload: CourseOptionPayload };
  } catch {
    return null;
  }
};

const writeSessionCache = (key: string, entry: { expiresAt: number; payload: CourseOptionPayload }) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // 容量制限時もメモリキャッシュは利用できる。
  }
};

export async function loadCourseRegistrationOptions({ grade, year, getToken, force = false }: LoadCourseOptionsInput) {
  const key = cacheKey(grade, year);
  if (!force) {
    const memory = memoryCache.get(key);
    if (memory && memory.expiresAt > Date.now()) return memory.payload;
    const stored = readSessionCache(key);
    if (stored) {
      memoryCache.set(key, stored);
      return stored.payload;
    }
    const pending = pendingRequests.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const token = await getToken();
    const params = new URLSearchParams();
    if (grade) params.set('grade', grade);
    if (year) params.set('year', String(year));
    const response = await fetch(`/api/course-registration-options?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'course-options-fetch-failed');
    }
    const entry = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    memoryCache.set(key, entry);
    writeSessionCache(key, entry);
    return payload as CourseOptionPayload;
  })();

  pendingRequests.set(key, request);
  try {
    return await request;
  } finally {
    pendingRequests.delete(key);
  }
}

export function clearCourseRegistrationOptionsCache() {
  memoryCache.clear();
  pendingRequests.clear();
  if (typeof window === 'undefined') return;
  try {
    const prefix = `classbase_course_options:${CACHE_VERSION}:`;
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((key): key is string => Boolean(key && key.startsWith(prefix)));
    keys.forEach(key => sessionStorage.removeItem(key));
  } catch {
    // 利用できない環境ではメモリキャッシュの破棄だけで十分。
  }
}
