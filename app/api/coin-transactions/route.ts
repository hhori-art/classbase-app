import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { jstDateKey } from '@/lib/date-key';
import { newlyEligibleBadges } from '@/lib/server/badges';
import { isRewardDeliverable, ownsPreset, presetOf, presetOwnershipUpdates, requireStudentShopAccess, REWARD_CATALOG_TAG, studentSchoolOf, writeRewardDelivery } from '@/lib/server/reward-store';
import { revalidateTag } from 'next/cache';

const MISSION_CONFIG: Record<string, { amount: number; label: string }> = {
  last_mission_date: { amount: 10, label: 'ログインミッション' },
  last_recording_mission_date: { amount: 15, label: '録画視聴ミッション' },
  last_community_mission_date: { amount: 10, label: 'コミュニティ参加ミッション' },
};

const LOGIN_BONUS_PATTERN = [10, 10, 20, 20, 30, 30, 40, 40, 50, 100];

const MISSION_FIELD_TO_SETTING: Record<string, 'login' | 'recording' | 'community'> = {
  last_mission_date: 'login',
  last_recording_mission_date: 'recording',
  last_community_mission_date: 'community',
};

const DEFAULT_MISSION_SETTINGS: Record<'login' | 'recording' | 'community', boolean> = {
  login: true,
  recording: true,
  community: false,
};

type CustomMissionCondition = 'manual' | 'login' | 'recording' | 'community';

type CustomMission = {
  id: string;
  title: string;
  description: string;
  reward: number;
  enabled: boolean;
  condition: CustomMissionCondition;
  link_url: string;
  link_label: string;
};

function previousJstDateKey(date = new Date()) {
  return jstDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

function normalizeSurveyAnswers(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {} as Record<string, number | string>;
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 30);
  const answers: Record<string, number | string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!normalizedKey) continue;
    answers[normalizedKey] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(5, value))
      : String(value || '').trim().slice(0, 2000);
  }
  return answers;
}

function normalizeCustomMission(raw: any): CustomMission | null {
  const id = String(raw?.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const title = String(raw?.title || '').trim();
  const reward = Math.max(0, Math.min(500, Number(raw?.reward || 0)));
  if (!id || !title || reward <= 0) return null;
  const condition = ['manual', 'login', 'recording', 'community'].includes(raw?.condition)
    ? raw.condition as CustomMissionCondition
    : 'manual';
  return {
    id,
    title,
    description: String(raw?.description || ''),
    reward,
    enabled: raw?.enabled !== false,
    condition,
    link_url: String(raw?.link_url || ''),
    link_label: String(raw?.link_label || '開く'),
  };
}

async function applyCoinOnce(input: {
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
  source: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
  allowedUserRoles?: string[];
}) {
  const db = adminDb();
  const txId = `${input.userId}_${input.source}_${input.sourceId}`.replace(/[\/\s#?]/g, '_');
  const txRef = db.collection('coin_transactions').doc(txId);
  const userRef = db.collection('users').doc(input.userId);

  return db.runTransaction(async tx => {
    const [txSnap, userSnap] = await Promise.all([tx.get(txRef), tx.get(userRef)]);
    const targetRole = String(userSnap.data()?.role || '').toLowerCase();
    if (!userSnap.exists || (input.allowedUserRoles && !input.allowedUserRoles.includes(targetRole))) {
      throw new Error('reward-user-not-eligible');
    }
    if (txSnap.exists) return { applied: false, transaction_id: txId, coins: userSnap.data()?.coins || 0 };
    const currentCoins = Number(userSnap.data()?.coins || 0);
    if (input.amount < 0 && currentCoins + input.amount < 0) {
      throw new Error('insufficient-coins');
    }

    tx.set(txRef, {
      user_id: input.userId,
      amount: input.amount,
      reason: input.reason,
      actor_id: input.actorId,
      source: input.source,
      source_id: input.sourceId,
      metadata: input.metadata || {},
      created_at: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, {
      coins: FieldValue.increment(input.amount),
      total_coins: input.amount > 0 ? FieldValue.increment(input.amount) : FieldValue.increment(0),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { applied: true, transaction_id: txId, coins: currentCoins + input.amount };
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || '');

    if (action === 'daily_login') {
      requireRole(user, ['student']);
      const today = jstDateKey();
      const db = adminDb();
      const userRef = db.collection('users').doc(user.uid);
      const txRef = db.collection('coin_transactions').doc(`${user.uid}_daily_login_${today}`);

      const result = await db.runTransaction(async tx => {
        const [userSnap, txSnap] = await Promise.all([tx.get(userRef), tx.get(txRef)]);
        const profile = userSnap.data() || {};
        if (txSnap.exists || profile.last_login_bonus_date === today) {
          return {
            applied: false,
            coins: Number(profile.coins || 0),
            login_count: Number(profile.login_count || profile.attendance_count || 0),
            login_streak: Number(profile.login_streak || 0),
            amount: 0,
            earned_badges: Array.isArray(profile.earned_badges) ? profile.earned_badges : [],
            selected_badge: profile.selected_badge || '',
          };
        }

        const yesterday = previousJstDateKey();
        const currentCount = Number(profile.login_count || profile.attendance_count || 0);
        const nextCount = currentCount + 1;
        const previousStreak = Number(profile.login_streak || 0);
        const nextStreak = profile.last_login_bonus_date === yesterday ? previousStreak + 1 : 1;
        const amount = LOGIN_BONUS_PATTERN[(nextCount - 1) % LOGIN_BONUS_PATTERN.length];
        const bestStreak = Math.max(Number(profile.best_login_streak || 0), nextStreak);
        // 更新後の累計値でバッジ条件をまとめて判定する（lib/gamification.ts の定義を使用）。
        const earnedBadges = ['badge_1', ...newlyEligibleBadges({
          ...profile, login_count: nextCount, login_streak: nextStreak, best_login_streak: bestStreak,
          total_coins: Number(profile.total_coins || 0) + amount,
        })];
        const currentBadges = Array.isArray(profile.earned_badges) ? profile.earned_badges : [];
        const nextBadges = Array.from(new Set([...currentBadges, ...earnedBadges]));
        const currentSelectedBadge = String(profile.selected_badge || '');
        const selectedBadge = currentSelectedBadge && currentSelectedBadge !== 'beginner'
          ? currentSelectedBadge
          : 'badge_1';

        tx.set(txRef, {
          user_id: user.uid,
          amount,
          reason: 'ログインボーナス',
          actor_id: user.uid,
          source: 'daily_login',
          source_id: today,
          metadata: { login_count: nextCount, login_streak: nextStreak },
          created_at: FieldValue.serverTimestamp(),
        });
        tx.set(userRef, {
          coins: FieldValue.increment(amount),
          total_coins: FieldValue.increment(amount),
          login_count: FieldValue.increment(1),
          attendance_count: FieldValue.increment(1),
          login_streak: nextStreak,
          best_login_streak: bestStreak,
          last_login_bonus_date: today,
          last_active_date: today,
          last_login_at: FieldValue.serverTimestamp(),
          earned_badges: FieldValue.arrayUnion(...earnedBadges),
          selected_badge: selectedBadge,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
          applied: true,
          coins: Number(profile.coins || 0) + amount,
          login_count: nextCount,
          login_streak: nextStreak,
          amount,
          earned_badges: nextBadges,
          selected_badge: selectedBadge,
        };
      });

      return Response.json({ ok: true, ...result });
    }

    if (action === 'homework_submission_reward') {
      requireRole(user, ['student']);
      const assignmentId = String(body.assignment_id || '');
      if (!assignmentId) return Response.json({ ok: false, error: 'assignment_id is required' }, { status: 400 });
      const db = adminDb();
      const [assignmentSnapshot, submissionSnapshot] = await db.getAll(
        db.collection('homework_assignments').doc(assignmentId),
        db.collection('submissions').doc(`${assignmentId}_${user.uid}`),
      );
      const assignment = assignmentSnapshot.data() || {};
      const submission = submissionSnapshot.data() || {};
      const grade = String(user.profile.grade || '').trim();
      const subjects = Array.isArray(user.profile.subjects)
        ? user.profile.subjects.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      const subject = String(assignment.subject || '').trim();
      if (!assignmentSnapshot.exists || !submissionSnapshot.exists ||
          assignment.archived === true || assignment.status === 'archived' ||
          submission.student_id !== user.uid || submission.assignment_id !== assignmentId ||
          !['submitted', 'checked'].includes(String(submission.status || '')) ||
          !grade || String(assignment.target_grade || '').trim() !== grade ||
          (subject && subjects.length > 0 && !subjects.includes(subject))) {
        return Response.json({ ok: false, error: 'eligible submission not found' }, { status: 404 });
      }
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: 50,
        reason: '宿題提出',
        actorId: user.uid,
        source: 'homework_submission',
        sourceId: assignmentId,
        metadata: { assignment_id: assignmentId },
      });
      await db.collection('users').doc(user.uid).set({
        homework_count: FieldValue.increment(result.applied ? 1 : 0),
        earned_badges: FieldValue.arrayUnion('badge_pencil'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'survey_reward') {
      requireRole(user, ['student']);
      const shiftId = String(body.shift_id || '').trim();
      if (!/^[^/]{1,160}$/.test(shiftId)) return Response.json({ ok: false, error: 'shift_id is required' }, { status: 400 });
      const answers = normalizeSurveyAnswers(body.answers);
      const today = jstDateKey();
      const db = adminDb();
      const shiftRef = db.collection('shift_assignments').doc(shiftId);
      const responseRef = db.collection('survey_responses').doc(`${shiftId}_${user.uid}`);
      const transactionRef = db.collection('coin_transactions').doc(`${user.uid}_survey_response_${shiftId}`);
      const userRef = db.collection('users').doc(user.uid);
      const templateRef = db.collection('survey_templates').doc('default');

      const templateSnap = await templateRef.get();
      const questions = Array.isArray(templateSnap.data()?.questions) ? templateSnap.data()!.questions.slice(0, 30) : [];
      const missingRequired = questions.some((question: any) => question?.type === 'rating' && !Number(answers[String(question.id)]));
      if (missingRequired) return Response.json({ ok: false, error: 'required survey answers are missing' }, { status: 400 });

      const result = await db.runTransaction(async tx => {
        const [shiftSnap, existingResponse, existingTransaction, userSnap] = await Promise.all([
          tx.get(shiftRef), tx.get(responseRef), tx.get(transactionRef), tx.get(userRef),
        ]);
        const shift = shiftSnap.data() || {};
        const studentGrade = String(user.profile.grade || '').trim();
        const targetGrade = String(shift.target_grade || '').trim();
        const shiftSchool = String(shift.school_id || shift.target_school_id || shift.school || '').trim();
        const allowedSchools = new Set([user.school, ...user.school_ids].map(value => String(value || '').trim()).filter(Boolean));
        if (!shiftSnap.exists || String(shift.target_date || '') !== today || String(shift.role_type || 'main') !== 'main' ||
            !studentGrade || !targetGrade || studentGrade !== targetGrade || (shiftSchool && !allowedSchools.has(shiftSchool))) {
          throw new Error('survey-shift-not-eligible');
        }
        if (existingResponse.exists || existingTransaction.exists) {
          return { applied: false, coins: Number(userSnap.data()?.coins || 0) };
        }
        tx.set(responseRef, {
          student_id: user.uid,
          student_name: user.profile.student_name || user.profile.name || user.email || '名前未設定',
          teacher_id: String(shift.user_id || ''),
          teacher_name: String(shift.teacher_name || ''),
          shift_id: shiftId,
          target_date: today,
          subject: String(shift.target_subject || ''),
          answers,
          created_at: FieldValue.serverTimestamp(),
        });
        tx.set(transactionRef, {
          user_id: user.uid,
          amount: 10,
          reason: '授業アンケート回答',
          actor_id: user.uid,
          source: 'survey_response',
          source_id: shiftId,
          metadata: { shift_id: shiftId },
          created_at: FieldValue.serverTimestamp(),
        });
        tx.set(userRef, {
          coins: FieldValue.increment(10),
          total_coins: FieldValue.increment(10),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { applied: true, coins: Number(userSnap.data()?.coins || 0) + 10 };
      });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'mission_reward') {
      requireRole(user, ['student']);
      const dateField = String(body.date_field || '');
      const config = MISSION_CONFIG[dateField];
      if (!config) return Response.json({ ok: false, error: 'invalid mission' }, { status: 400 });
      const today = jstDateKey();
      const db = adminDb();
      const userRef = db.collection('users').doc(user.uid);
      const missionSettingKey = MISSION_FIELD_TO_SETTING[dateField];
      const missionSnap = await db.collection('settings').doc('mission_control').get();
      const missionSettings = { ...DEFAULT_MISSION_SETTINGS, ...(missionSnap.data() || {}) };
      if (missionSettingKey && missionSettings[missionSettingKey] === false) {
        return Response.json({ ok: false, error: 'mission is disabled' }, { status: 403 });
      }
      const snap = await userRef.get();
      const profile = snap.data() || {};
      if (profile[dateField] === today) return Response.json({ ok: true, applied: false, already_claimed: true, coins: profile.coins || 0 });
      if (dateField === 'last_recording_mission_date' && profile.last_recording_view_date !== today) {
        return Response.json({ ok: false, error: 'recording mission is not completed' }, { status: 400 });
      }
      if (dateField === 'last_community_mission_date' && profile.last_community_activity_date !== today) {
        return Response.json({ ok: false, error: 'community mission is not completed' }, { status: 400 });
      }
      const result = await applyCoinOnce({
        userId: user.uid,
        amount: config.amount,
        reason: config.label,
        actorId: user.uid,
        source: dateField,
        sourceId: today,
        metadata: { date_field: dateField },
      });
      if (result.applied) {
        await userRef.set({ [dateField]: today, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      }
      return Response.json({ ok: true, amount: config.amount, ...result });
    }

    if (action === 'custom_mission_reward') {
      requireRole(user, ['student']);
      const missionId = String(body.mission_id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      if (!missionId) return Response.json({ ok: false, error: 'mission_id is required' }, { status: 400 });

      const today = jstDateKey();
      const db = adminDb();
      const missionSnap = await db.collection('settings').doc('mission_control').get();
      const customMissions = Array.isArray(missionSnap.data()?.custom_missions)
        ? missionSnap.data()?.custom_missions.map(normalizeCustomMission).filter(Boolean) as CustomMission[]
        : [];
      const mission = customMissions.find(item => item.id === missionId && item.enabled !== false);
      if (!mission) return Response.json({ ok: false, error: 'mission not found or disabled' }, { status: 404 });

      const userRef = db.collection('users').doc(user.uid);
      const snap = await userRef.get();
      const profile = snap.data() || {};
      const customMissionDates = profile.custom_mission_dates || {};
      if (customMissionDates[missionId] === today) {
        return Response.json({ ok: true, applied: false, already_claimed: true, coins: profile.coins || 0, amount: mission.reward });
      }

      if (mission.condition === 'login' && profile.last_login_bonus_date !== today && profile.last_mission_date !== today) {
        return Response.json({ ok: false, error: 'login mission is not completed' }, { status: 400 });
      }
      if (mission.condition === 'recording' && profile.last_recording_view_date !== today) {
        return Response.json({ ok: false, error: 'recording mission is not completed' }, { status: 400 });
      }
      if (mission.condition === 'community' && profile.last_community_activity_date !== today) {
        return Response.json({ ok: false, error: 'community mission is not completed' }, { status: 400 });
      }

      const result = await applyCoinOnce({
        userId: user.uid,
        amount: mission.reward,
        reason: `デイリーミッション: ${mission.title}`,
        actorId: user.uid,
        source: 'custom_mission',
        sourceId: `${missionId}_${today}`,
        metadata: {
          mission_id: missionId,
          condition: mission.condition,
          title: mission.title,
        },
      });

      if (result.applied) {
        await userRef.update({
          [`custom_mission_dates.${missionId}`]: today,
          updated_at: FieldValue.serverTimestamp(),
        });
      }

      return Response.json({ ok: true, amount: mission.reward, mission_id: missionId, ...result });
    }

    if (action === 'reward_exchange') {
      requireRole(user, ['student']);
      await requireStudentShopAccess(user);
      const rewardId = String(body.reward_id || '').trim();
      const exchangeId = String(body.exchange_id || '').trim();
      if (!rewardId || !/^[a-zA-Z0-9_-]{8,80}$/.test(exchangeId)) {
        return Response.json({ ok: false, error: 'reward_id and exchange_id are required' }, { status: 400 });
      }
      const db = adminDb();
      const rewardRef = db.collection('rewards').doc(rewardId);
      const userRef = db.collection('users').doc(user.uid);
      const transactionRef = db.collection('coin_transactions').doc(`${user.uid}_reward_exchange_${exchangeId}`);
      const result = await db.runTransaction(async tx => {
        const [rewardSnap, userSnap, existingTransaction] = await Promise.all([
          tx.get(rewardRef), tx.get(userRef), tx.get(transactionRef),
        ]);
        const profile = userSnap.data() || {};
        if (existingTransaction.exists) {
          return { applied: false, cost: -Number(existingTransaction.data()?.amount || 0), coins: Number(profile.coins || 0), kind: null, new_badges: [] };
        }
        const reward = rewardSnap.data() || {};
        const cost = Number(reward.required_coins);
        const rewardName = String(reward.name || '').trim();
        if (!rewardSnap.exists || reward.exchangeable === false || !isRewardDeliverable(reward) || !Number.isInteger(cost) || cost <= 0 || cost > 1_000_000) {
          throw new Error('reward-not-available');
        }
        const currentCoins = Number(profile.coins || 0);
        if (ownsPreset(profile, reward)) throw new Error('reward-already-owned');
        if (!userSnap.exists || currentCoins < cost) throw new Error('insufficient-coins');
        const newBadges = newlyEligibleBadges({ ...profile, reward_exchange_count: Number(profile.reward_exchange_count || 0) + 1 });
        const ownership = presetOwnershipUpdates(reward);
        tx.set(transactionRef, {
          user_id: user.uid, amount: -cost, reason: `景品交換: ${rewardName}`,
          actor_id: user.uid, source: 'reward_exchange', source_id: exchangeId,
          metadata: { reward_id: rewardId, reward_name: rewardName, cost },
          created_at: FieldValue.serverTimestamp(),
        });
        tx.set(userRef, {
          coins: FieldValue.increment(-cost),
          reward_exchange_count: FieldValue.increment(1),
          ...ownership,
          // 限定バッジと条件達成バッジを同時に得た場合も1回の arrayUnion にまとめる。
          ...(newBadges.length || ownership.earned_badges ? { earned_badges: FieldValue.arrayUnion(...newBadges, ...(presetOf(reward)?.category === 'badge' ? [presetOf(reward)!.id] : [])) } : {}),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        const delivery = writeRewardDelivery(tx, {
          userId: user.uid,
          userName: String(user.profile.student_name || user.profile.name || user.email || '生徒'),
          userSchool: studentSchoolOf(user.profile),
          rewardId, reward, origin: 'shop', originId: exchangeId, refundableCost: cost,
        });
        return { applied: true, cost, coins: currentCoins - cost, kind: delivery.kind, preset_id: presetOf(reward)?.id || null, new_badges: newBadges };
      });
      if (result.applied) revalidateTag(REWARD_CATALOG_TAG);
      return Response.json({ ok: true, ...result });
    }

    if (action === 'community_like_reward') {
      requireRole(user, ['student', 'teacher', 'admin', 'master']);
      const topicId = String(body.topic_id || '');
      const collectionName = String(body.collection_name || 'community_topics');
      if (!['community_topics', 'teacher_community_topics'].includes(collectionName)) {
        return Response.json({ ok: false, error: 'invalid collection_name' }, { status: 400 });
      }
      if (collectionName === 'teacher_community_topics') requireRole(user, ['teacher', 'admin', 'master']);
      if (!topicId) return Response.json({ ok: false, error: 'topic_id is required' }, { status: 400 });
      const db = adminDb();
      const topicRef = db.collection(collectionName).doc(topicId);
      const topicSnap = await topicRef.get();
      if (!topicSnap.exists) return Response.json({ ok: false, error: 'topic not found' }, { status: 404 });
      const topic = topicSnap.data() || {};
      const likes = Number(topic.likes || 0);
      if (topic.reward_given || likes < 10 || !topic.creator_uid) {
        return Response.json({ ok: true, applied: false });
      }
      const creatorId = String(topic.creator_uid);
      const result = await applyCoinOnce({
        userId: creatorId,
        amount: 5,
        reason: 'コミュニティいいね報酬',
        actorId: user.uid,
        source: 'community_like_reward',
        sourceId: `${collectionName}_${topicId}`,
        metadata: { topic_id: topicId, collection_name: collectionName, likes },
        allowedUserRoles: collectionName === 'community_topics'
          ? ['student']
          : ['teacher', 'admin', 'master', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin'],
      });
      if (result.applied) {
        await topicRef.set({ reward_given: true, reward_given_at: FieldValue.serverTimestamp() }, { merge: true });
      }
      return Response.json({ ok: true, ...result });
    }

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'coin_transaction_rejected',
      target_type: 'coin_transaction',
      school: user.school,
      metadata: { action },
    });
    return Response.json({ ok: false, error: 'invalid action', event_id: eventId }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
