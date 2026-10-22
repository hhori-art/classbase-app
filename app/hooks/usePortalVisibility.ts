'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type VisibilityGroup = 'student' | 'parent' | 'teacher' | 'admin';
type VisibilityMap = Record<string, boolean>;

const CACHE_KEY = 'classbase_portal_visibility';
type VisibilitySnapshot = Partial<Record<VisibilityGroup, VisibilityMap>>;

let sharedVisibility: VisibilitySnapshot = {};
let sharedLoaded = false;
let sharedUnsubscribe: (() => void) | null = null;
let sharedStopTimer: ReturnType<typeof setTimeout> | null = null;
const sharedListeners = new Set<() => void>();

const SAFE_DEFAULTS: Record<VisibilityGroup, VisibilityMap> = {
  student: {
    adaptiveQuest: false,
    chat: false,
    homework: false,
    recordings: false,
    absence: false,
    transfer: false,
    calendar: false,
    changeRequest: false,
    community: false,
    ocrQuiz: false,
    news: false,
    notifications: false,
    settings: false,
    shop: false,
    history: false,
  },
  parent: {
    // 受講講座の登録・変更は従来いつも表示していたので、設定がなければ表示する。
    courseRegistration: true,
    homework: false,
    attendance: false,
    absence: false,
    transfer: false,
    recordings: false,
    aiMessages: false,
    announcements: false,
    calendar: false,
    contact: false,
    notificationSettings: false,
    notifications: false,
    settings: false,
  },
  teacher: {
    dashboard: true,
    work: false,
    attendance: false,
    shifts: false,
    substitutions: false,
    community: false,
    notifications: false,
    settings: false,
    news: false,
    calendar: false,
    chat: false,
    contacts: false,
    homework: false,
    pf: false,
    riskMonitor: false,
    slides: false,
    students: false,
  },
  admin: {
    users: false,
    schoolStudents: false,
    sso: false,
    shifts: false,
    monthlySchedules: false,
    attendance: false,
    substitutions: false,
    announcements: false,
    requests: false,
    parentInquiries: false,
    registrationTasks: false,
    curriculum: false,
    pf: false,
    recordings: false,
    community: false,
    rewards: false,
    stats: false,
    surveySettings: false,
    imports: false,
    delete: false,
    line: false,
    notifications: false,
    settings: false,
  },
};

const readCachedVisibility = (): Partial<Record<VisibilityGroup, VisibilityMap>> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const writeCachedVisibility = (data: Partial<Record<VisibilityGroup, VisibilityMap>>) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
};

const notifyVisibilityListeners = () => sharedListeners.forEach(listener => listener());

const startSharedVisibilitySubscription = () => {
  if (sharedStopTimer) {
    clearTimeout(sharedStopTimer);
    sharedStopTimer = null;
  }
  if (sharedUnsubscribe) return;
  sharedVisibility = { ...readCachedVisibility(), ...sharedVisibility };
  const ref = doc(db, 'settings', 'portal_visibility');
  sharedUnsubscribe = onSnapshot(
    ref,
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      sharedVisibility = {
        student: data.student || {},
        parent: data.parent || {},
        teacher: data.teacher || {},
        admin: data.admin || {},
      };
      sharedLoaded = true;
      writeCachedVisibility(sharedVisibility);
      notifyVisibilityListeners();
    },
    (error) => {
      console.warn('Portal visibility subscribe failed:', error);
      sharedLoaded = true;
      notifyVisibilityListeners();
    },
  );
};

export function usePortalVisibility(group: VisibilityGroup) {
  const initial = useMemo(() => {
    const cached = readCachedVisibility();
    return {
      values: { ...SAFE_DEFAULTS[group], ...(cached[group] || {}) },
      loaded: !!cached[group],
    };
  }, [group]);

  const [visibility, setVisibility] = useState<VisibilityMap>(initial.values);
  const [loaded, setLoaded] = useState(initial.loaded);

  useEffect(() => {
    const update = () => {
      setVisibility({ ...SAFE_DEFAULTS[group], ...(sharedVisibility[group] || {}) });
      setLoaded(sharedLoaded || Boolean(sharedVisibility[group]));
    };
    sharedListeners.add(update);
    startSharedVisibilitySubscription();
    update();
    return () => {
      sharedListeners.delete(update);
      if (sharedListeners.size === 0) {
        // 短い画面遷移では購読を再利用し、ログアウト後などは監視を確実に止める。
        sharedStopTimer = setTimeout(() => {
          if (sharedListeners.size === 0) {
            sharedUnsubscribe?.();
            sharedUnsubscribe = null;
          }
          sharedStopTimer = null;
        }, 30_000);
      }
    };
  }, [group]);

  return { visibility, loaded };
}
