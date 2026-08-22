'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type MaintenanceStatus = {
  is_maintenance: boolean;
  message: string;
  link_url: string;
  link_label: string;
  loading: boolean;
};

const DEFAULT_STATUS: MaintenanceStatus = {
  is_maintenance: false,
  message: '現在システムメンテナンス中です。恐れ入りますが、終了までしばらくお待ちください。',
  link_url: '/',
  link_label: '理社講座専用サイトへ',
  loading: true,
};

export function useMaintenanceStatus() {
  const [status, setStatus] = useState<MaintenanceStatus>(DEFAULT_STATUS);

  useEffect(() => {
    const ref = doc(db, 'system_status', 'global');
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.data() || {};
        setStatus({
          is_maintenance: data.is_maintenance === true,
          message: typeof data.message === 'string' && data.message.trim()
            ? data.message
            : DEFAULT_STATUS.message,
          link_url: typeof data.link_url === 'string' && data.link_url.trim()
            ? data.link_url
            : DEFAULT_STATUS.link_url,
          link_label: typeof data.link_label === 'string' && data.link_label.trim()
            ? data.link_label
            : DEFAULT_STATUS.link_label,
          loading: false,
        });
      },
      (error) => {
        console.error('Maintenance status subscribe failed:', error);
        setStatus(prev => ({ ...prev, loading: false, is_maintenance: false }));
      }
    );

    return () => unsubscribe();
  }, []);

  return status;
}
