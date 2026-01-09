'use client';

import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;

    try {
      // 1. Firebaseからログアウト
      await signOut(auth);
      
      // 2. ログイン画面（トップページ）へ移動
      // window.location.href を使うことで確実にフルリロードしてキャッシュやステートをクリア
      window.location.href = '/'; 
    } catch (error) {
      console.error('Logout error:', error);
      alert('ログアウトに失敗しました');
    }
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