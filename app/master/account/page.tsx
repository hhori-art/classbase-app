'use client';

import { UserCog } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminAccountPanel from '@/app/components/master/AdminAccountPanel';
import { useAuth } from '@/app/context/AuthContext';

// どの管理者（マスター・校舎管理者・勤怠・Booster・オンライン校）でも開ける自分のアカウント画面。
export default function AdminAccountPage() {
  const { profile } = useAuth();
  const firstLogin = profile?.isFirstLogin === true;
  return (
    <div className="mx-auto max-w-2xl">
      <AdminPageHeader
        icon={UserCog}
        title="自分のアカウント"
        description="パスワードの変更、LINE連携、ログアウトができます。"
      />
      {firstLogin && (
        <div className="mb-6 rounded-btn border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold leading-relaxed text-amber-900">
          初回ログインのため、新しいパスワードを設定してください。
        </div>
      )}
      <AdminAccountPanel onPasswordChanged={firstLogin ? () => window.location.replace('/master') : undefined} />
    </div>
  );
}
