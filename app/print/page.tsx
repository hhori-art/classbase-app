import { redirect } from 'next/navigation';

// 旧ID書面の印刷ページ。書面は管理画面「ID書面・印刷」（生徒用・保護者用を分けた新デザイン）に統一した。
export default function LegacyPrintPage() {
  redirect('/master/users');
}
