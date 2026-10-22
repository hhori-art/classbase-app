'use client';

import { useAuth } from '@/app/context/AuthContext';
import { useStaffIdleTimeout } from '@/app/hooks/useStaffIdleTimeout';
import { Button, Modal } from '@/app/components/ui';

const STAFF_ROLES = new Set(['master', 'admin', 'attendance_admin', 'teacher']);

/**
 * 管理画面・講師画面の無操作タイムアウト。一定時間操作がないと自動でログアウトし、5分前に警告する。
 * 生徒・保護者の画面には置かない。
 */
export default function StaffIdleTimeout() {
  const { user, profile, logout } = useAuth();
  const enabled = Boolean(user && profile && STAFF_ROLES.has(String(profile.role || '')));
  const { warning, remainingMs, stayActive } = useStaffIdleTimeout({ enabled, onTimeout: logout });
  const minutes = Math.max(1, Math.ceil((remainingMs || 0) / 60000));

  return (
    <Modal
      open={enabled && warning}
      onClose={stayActive}
      size="sm"
      title="まもなく自動でログアウトします"
      description={`しばらく操作がなかったため、あと約${minutes}分でログアウトします。続けて使う場合は「続けて使う」を押してください。`}
      footer={(
        <>
          <Button variant="secondary" onClick={() => { void logout(); }}>ログアウト</Button>
          <Button data-autofocus onClick={stayActive}>続けて使う</Button>
        </>
      )}
    />
  );
}
