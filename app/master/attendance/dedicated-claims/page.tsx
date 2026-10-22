import { redirect } from 'next/navigation';

/** 専任の申請は「専任の勤怠」にまとめた（時間外の予定・報告・月の報告書と一緒に承認する）。 */
export default function DedicatedClaimsPage() {
  redirect('/master/attendance/dedicated');
}
