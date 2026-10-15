import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

const loadRewardCatalog = unstable_cache(async () => {
  const snap = await adminDb().collection('rewards').orderBy('required_coins', 'asc').limit(200).get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as any))
    .filter(reward => reward.active !== false && reward.archived !== true)
    .map(reward => ({
      id: reward.id,
      name: String(reward.name || ''),
      required_coins: Number(reward.required_coins || 0),
      image_url: String(reward.image_url || ''),
    }))
    .filter(reward => reward.name && Number.isInteger(reward.required_coins) && reward.required_coins > 0);
}, ['active-reward-catalog-v1'], { revalidate: 300, tags: ['reward-catalog'] });

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    return Response.json({ ok: true, rewards: await loadRewardCatalog() });
  } catch (error) {
    return jsonError(error);
  }
}
