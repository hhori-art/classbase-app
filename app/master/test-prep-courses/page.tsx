import { redirect } from 'next/navigation';

// 対策講座の設定は「テスト対策（復習期間）」の管理画面に統合した。
export default function MasterTestPrepCoursesPage() {
  redirect('/master/review-periods?tab=courses');
}
