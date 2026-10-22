'use client';

import { LogOut } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { IconButton, useConfirm } from '@/app/components/ui';

export default function LogoutButton() {
  const { logout } = useAuth();
  const confirm = useConfirm();

  const handleLogout = async () => {
    const ok = await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' });
    if (!ok) return;
    await logout();
  };

  return (
    <IconButton
      label="ログアウト"
      onClick={handleLogout}
      className="rounded-full hover:!bg-rose-50 hover:!text-rose-600"
    >
      <LogOut size={20} aria-hidden />
    </IconButton>
  );
}
