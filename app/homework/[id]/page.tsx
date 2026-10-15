import { redirect } from 'next/navigation';

// 旧URL。提出は検証付きAPI経由の生徒用宿題ページに一本化した
// （submissions はクライアントから書き込めない）。
export default async function LegacyHomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/student/homework/${encodeURIComponent(id)}`);
}
