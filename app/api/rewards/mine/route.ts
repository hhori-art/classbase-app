import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);

// 生徒本人が受け取った景品（デジタルのダウンロード権と、実物の発送状況）を返す。
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const db = adminDb();
    const [grantSnap, requestSnap] = await Promise.all([
      db.collection('reward_grants').where('user_id', '==', user.uid).limit(200).get(),
      db.collection('requests').where('userId', '==', user.uid).limit(200).get(),
    ]);
    const digital = grantSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, kind: data.kind === 'cosmetic' ? 'cosmetic' as const : 'digital' as const, reward_name: String(data.reward_name || ''),
        preset_id: String(data.preset_id || ''),
        reward_image_url: String(data.reward_image_url || ''), origin: data.origin === 'gacha' ? 'gacha' : 'shop',
        gacha_name: data.gacha_name || null, file_name: String(data.digital_file_name || ''),
        status: 'available', created_at: iso(data.created_at),
      };
    });
    const physical = requestSnap.docs
      .filter(doc => doc.data().type === 'exchange')
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id, kind: 'physical' as const, reward_name: String(data.rewardName || data.reward_name || ''),
          preset_id: '',
          reward_image_url: String(data.reward_image_url || ''), origin: data.origin === 'gacha' ? 'gacha' : 'shop',
          gacha_name: data.gacha_name || null, status: String(data.status || 'pending'),
          shipping_note: String(data.student_note || ''), created_at: iso(data.created_at),
        };
      });
    const items = [...digital, ...physical].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
