import { redirect } from 'next/navigation';

// アカウント関連の各画面は左のメニュー「アカウント」に並べたため、入口ページは廃止した。
export default function AccountsIndexPage() {
  redirect('/master/accounts/sso');
}
