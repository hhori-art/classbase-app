import { redirect } from 'next/navigation';

// 旧一覧（Firestoreを直接書き換えていた）は「校舎別アカウント管理」に統一した。
export default function LegacyAccountListPage() {
  redirect('/master/accounts/sso');
}
