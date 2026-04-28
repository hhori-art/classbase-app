'use client';

import { LogOut } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

export default function LogoutButton() {
  const { logout } = useAuth();

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await logout();
  };

  return (
    <button
      onClick={handleLogout}
      className="text-gray-400 hover:text-red-500 p-2 rounded-full transition-colors flex items-center gap-2"
      title="ログアウト"
    >
      <LogOut size={20} />
    </button>
  );
}
