import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { badgeStatsFromProfile, eligibleBadgeIds } from '@/lib/gamification';

/** 更新後のプロフィールで新たに条件を満たしたバッジIDを返す。 */
export function newlyEligibleBadges(profileAfter: Record<string, any>) {
  const earned = new Set(Array.isArray(profileAfter.earned_badges) ? profileAfter.earned_badges.map(String) : []);
  return eligibleBadgeIds(badgeStatsFromProfile(profileAfter)).filter(id => !earned.has(id));
}

/** 各機能のカウンター更新後に、条件を満たしたバッジをまとめて付与する。 */
export async function syncEarnedBadges(userId: string) {
  const db = adminDb();
  const userRef = db.collection('users').doc(userId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('profile-not-found');
    const profile = snap.data() || {};
    const added = newlyEligibleBadges(profile);
    const bestStreak = Math.max(Number(profile.best_login_streak || 0), Number(profile.login_streak || 0));
    const updates: Record<string, unknown> = {};
    if (added.length > 0) updates.earned_badges = FieldValue.arrayUnion(...added);
    if (bestStreak > Number(profile.best_login_streak || 0)) updates.best_login_streak = bestStreak;
    if (Object.keys(updates).length > 0) tx.set(userRef, { ...updates, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    const earned = Array.from(new Set([...(Array.isArray(profile.earned_badges) ? profile.earned_badges : []), ...added]));
    return { added, earned_badges: earned };
  });
}
