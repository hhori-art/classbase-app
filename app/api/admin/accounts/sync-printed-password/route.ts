import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { generateInitialPassword } from '@/lib/password';
import {
  normalizeAccountLoginId,
  normalizeInitialPassword,
  syncAuthAccountCredentials,
} from '@/lib/server/account-credentials';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 1回の要求で扱う上限。画面側は lib/client-printed-password-sync.ts で分割して送る。
const MAX_SYNC_IDS_PER_REQUEST = 100;
// Firebase Auth の更新を並列で行う数（多すぎると Auth のレート制限にかかる）。
const SYNC_CONCURRENCY = 6;

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * ID書面の印刷前に、書面に載せるパスワードとログイン用パスワードを一致させる。
 * mode=issue（既定）：初回ログイン済みのアカウントは変更せず skipped で返す（大量発行時に、
 *   すでに使い始めた生徒のパスワードを誤ってリセットしないため）。
 * mode=reissue：ログイン済みでも新しい初期パスワードを発行し直す。
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master', 'admin']);

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'reissue' ? 'reissue' : 'issue';
    const userIds: string[] = Array.isArray(body.user_ids)
      ? Array.from(new Set<string>(body.user_ids.map((id: unknown) => String(id).trim()).filter(Boolean)))
      : [];
    if (userIds.length === 0) {
      return Response.json({ ok: false, error: 'user_ids is required' }, { status: 400 });
    }
    if (userIds.length > MAX_SYNC_IDS_PER_REQUEST) {
      return Response.json({ ok: false, error: `user_ids must be ${MAX_SYNC_IDS_PER_REQUEST} or less` }, { status: 400 });
    }

    const db = adminDb();
    const snaps = await db.getAll(...userIds.map(id => db.collection('users').doc(id)));
    const results: any[] = [];
    const errors: any[] = [];
    const skipped: any[] = [];

    await mapWithConcurrency(snaps, SYNC_CONCURRENCY, async snap => {
      const userId = snap.id;
      try {
        if (!snap.exists) {
          errors.push({ user_id: userId, error: 'user-not-found' });
          return;
        }
        const data = snap.data() || {};
        const targetSchool = String(data.school_id || data.school || '').trim();
        if (!canManageSchool(actor, targetSchool || null)) {
          errors.push({ user_id: userId, error: 'forbidden-school' });
          return;
        }

        const loginId = normalizeAccountLoginId(data.lifetime_id || data.initial_login_id || data.email);
        const storedPassword = normalizeInitialPassword(data.initial_password || data.raw_password || data.password);
        const displayName = String(data.student_name || data.name || data.parent_name || loginId || '名称未設定').trim();
        if (!loginId) {
          errors.push({ user_id: userId, error: 'missing-login-id' });
          return;
        }
        // 初回ログインで初期パスワードが消え、本人のパスワードに変わっている。
        const activated = data.isFirstLogin === false && storedPassword.length < 6;
        if (activated && mode === 'issue') {
          skipped.push({ user_id: userId, login_id: loginId, role: data.role || '', display_name: displayName, reason: 'already-activated' });
          return;
        }
        const password = storedPassword.length >= 6 && !activated ? storedPassword : generateInitialPassword();
        const disabled = ['suspended', 'withdrawn', 'archived'].includes(String(data.account_status || data.status || '').toLowerCase());

        const authUser = await syncAuthAccountCredentials({
          actor,
          loginId,
          email: data.email,
          password,
          displayName,
          disabled,
          preferredUid: snap.id,
          forcePassword: true,
        });

        const generated = password !== storedPassword;
        await db.collection('users').doc(authUser.uid).set({
          ...data,
          uid: authUser.uid,
          id: authUser.uid,
          email: authUser.email,
          lifetime_id: loginId,
          initial_login_id: data.initial_login_id || loginId,
          initial_password: password,
          raw_password: password,
          isFirstLogin: true,
          password_reissued_at: generated ? FieldValue.serverTimestamp() : data.password_reissued_at || null,
          printed_password_synced_at: FieldValue.serverTimestamp(),
          printed_password_synced_by: actor.uid,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actor.uid,
        }, { merge: true });
        if (snap.id !== authUser.uid) {
          await snap.ref.delete();
        }

        results.push({
          old_user_id: snap.id,
          user_id: authUser.uid,
          login_id: loginId,
          email: authUser.email,
          auth_created: authUser.auth_created,
          auth_updated_count: authUser.synchronized_auth_uids.length,
          migrated: snap.id !== authUser.uid,
          generated_password: generated,
          initial_password: password,
          role: data.role || '',
          display_name: displayName,
        });
      } catch (error: any) {
        errors.push({ user_id: userId, error: error?.message || String(error) });
      }
    });

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'account_printed_password_synced',
      target_type: 'users',
      school: actor.school,
      metadata: {
        mode,
        requested_count: userIds.length,
        synced_count: results.length,
        skipped_count: skipped.length,
        error_count: errors.length,
      },
    });

    return Response.json({
      ok: true,
      mode,
      synced_count: results.length,
      skipped_count: skipped.length,
      error_count: errors.length,
      results,
      skipped,
      errors,
      event_id: eventId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
