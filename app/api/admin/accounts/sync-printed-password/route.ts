import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { generateInitialPassword } from '@/lib/password';
import {
  normalizeAccountLoginId,
  normalizeInitialPassword,
  syncAuthAccountCredentials,
} from '@/lib/server/account-credentials';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);

    const body = await request.json().catch(() => ({}));
    const userIds: string[] = Array.isArray(body.user_ids)
      ? body.user_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [];
    if (userIds.length === 0) {
      return Response.json({ ok: false, error: 'user_ids is required' }, { status: 400 });
    }
    if (userIds.length > 500) {
      return Response.json({ ok: false, error: 'user_ids must be 500 or less' }, { status: 400 });
    }

    const db = adminDb();
    const results: any[] = [];
    const errors: any[] = [];

    for (const userId of Array.from(new Set<string>(userIds))) {
      try {
        const snap = await db.collection('users').doc(userId).get();
        if (!snap.exists) {
          errors.push({ user_id: userId, error: 'user-not-found' });
          continue;
        }

        const data = snap.data() || {};
        if (!canManageSchool(actor, String(data.school_id || data.school || '').trim() || null)) {
          errors.push({ user_id: userId, error: 'forbidden-school' });
          continue;
        }

        const loginId = normalizeAccountLoginId(data.lifetime_id || data.initial_login_id || data.email);
        const storedPassword = normalizeInitialPassword(data.initial_password || data.raw_password || data.password);
        const password = storedPassword.length >= 6 ? storedPassword : generateInitialPassword();
        const displayName = String(data.student_name || data.name || data.parent_name || loginId || '名称未設定').trim();
        const disabled = ['suspended', 'withdrawn', 'archived'].includes(String(data.account_status || data.status || '').toLowerCase());

        if (!loginId) {
          errors.push({ user_id: userId, error: 'missing-login-id' });
          continue;
        }
        const authUser = await syncAuthAccountCredentials({
          loginId,
          email: data.email,
          password,
          displayName,
          disabled,
          preferredUid: snap.id,
        });

        const profileData = {
          ...data,
          uid: authUser.uid,
          id: authUser.uid,
          email: authUser.email,
          lifetime_id: loginId,
          initial_login_id: data.initial_login_id || loginId,
          initial_password: password,
          raw_password: password,
          isFirstLogin: true,
          password_reissued_at: storedPassword.length >= 6 ? data.password_reissued_at || null : FieldValue.serverTimestamp(),
          printed_password_synced_at: FieldValue.serverTimestamp(),
          printed_password_synced_by: actor.uid,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actor.uid,
        };

        await db.collection('users').doc(authUser.uid).set(profileData, { merge: true });
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
          generated_password: storedPassword.length < 6,
          initial_password: password,
          role: data.role || '',
          display_name: displayName,
        });
      } catch (error: any) {
        errors.push({ user_id: userId, error: error?.message || String(error) });
      }
    }

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'account_printed_password_synced',
      target_type: 'users',
      school: actor.school,
      metadata: {
        requested_count: userIds.length,
        synced_count: results.length,
        error_count: errors.length,
      },
    });

    return Response.json({
      ok: true,
      synced_count: results.length,
      error_count: errors.length,
      results,
      errors,
      event_id: eventId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
