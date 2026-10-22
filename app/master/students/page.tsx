'use client';

import { UserSearch } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import StudentSearchBox from '@/app/components/master/StudentSearchBox';
import { Card } from '@/app/components/ui';

// 旧一覧（Firestoreを直接書き換えていた）は「校舎別アカウント管理」に統一済み。
// ここは生徒を検索して「生徒の総合ページ」を開く入口。
export default function StudentSearchPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <AdminPageHeader
        icon={UserSearch}
        description="名前・ふりがな・ログインID（生涯番号）で探せます。担当の校舎の生徒だけが表示されます。"
      />
      <Card>
        <StudentSearchBox autoFocus />
        <p className="mt-3 text-xs text-fg-muted">
          生徒を選ぶと、受講講座・欠席と振替・コイン・出席と録画・宿題（Monoxer）をまとめて確認できます。
        </p>
      </Card>
    </div>
  );
}
