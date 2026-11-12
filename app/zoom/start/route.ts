import { adminDb } from '@/lib/firebase-admin';
import { FAM_ZOOM_ROOMS_COLLECTION, createFamZoomStarter } from '@/lib/fam-zoom-start';
import { requestZoomServerToken } from '@/lib/zoom-meeting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * FAMキャンパスの席URL（/zoom/start?room=教室キー）。ログイン不要で、Zoom をホストとして開始する。
 * 教室キーとミーティングIDの対応は管理画面「FAMキャンパスの教室」（/master/fam-zoom-rooms）で変える。
 * 詳しくは docs/fam-zoom-start.md。
 */
const handle = createFamZoomStarter({
  lookupMeetingId: async roomKey => {
    const snap = await adminDb().collection(FAM_ZOOM_ROOMS_COLLECTION).doc(roomKey).get();
    return snap.exists ? String(snap.data()?.meeting_id ?? '') : '';
  },
  requestToken: requestZoomServerToken,
});

export function GET(request: Request) {
  return handle(request);
}
