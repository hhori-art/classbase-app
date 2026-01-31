import { headers } from 'next/headers';
import TeacherWorkMenu from './MenuGrid';

// ★修正: async function に変更
export default async function TeacherWorkPage() {
  // ★修正: await を追加
  const headersList = await headers();
  
  // ミドルウェアでセットしたヘッダーを読み取る
  const isInternalStr = headersList.get('x-is-internal');
  
  // 文字列 'true' かどうかで判定
  const isInternal = isInternalStr === 'true';

  return (
    <TeacherWorkMenu isInternalNetwork={isInternal} />
  );
}