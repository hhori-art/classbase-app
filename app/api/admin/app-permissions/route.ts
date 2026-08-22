import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  isConfigurableAdminRole,
  normalizeAdminAppPermissions,
  type AdminAppPermissions,
} from '@/lib/admin-app-permissions';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

function requireMaster(role: string) {
  if (role !== 'master') throw new Error('forbidden');
}

function parsePermissions(value: unknown): AdminAppPermissions {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    science_social: source.science_social === true,
    eiken: source.eiken === true,
    attendance: source.attendance === true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor.role);

    const snapshot = await adminDb().collection('users').get();
    const accounts = snapshot.docs
      .map(doc => {
        const profile = doc.data();
        const rawRole = String(profile.role || '').toLowerCase();
        if (!isConfigurableAdminRole(rawRole)) return null;
        return {
          id: doc.id,
          name: profile.name || profile.teacher_name || profile.student_name || profile.email || '名称未設定',
          email: profile.email || '',
          role: rawRole,
          school_ids: Array.isArray(profile.school_ids)
            ? profile.school_ids
            : [profile.school_id || profile.school].filter(Boolean),
          permissions: normalizeAdminAppPermissions(rawRole, profile),
          explicitly_configured: Boolean(profile.admin_permissions),
          permissions_updated_at: profile.permissions_updated_at?.toDate?.()?.toISOString?.() || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'ja'));

    const logSnapshot = await adminDb()
      .collection('action_logs')
      .where('action', '==', 'update_admin_app_permissions')
      .limit(200)
      .get();
    const accountNames = new Map<string, string>();
    const accountIds = new Set<string>();
    accounts.forEach(account => {
      if (account) {
        accountIds.add(account.id);
        accountNames.set(account.id, account.name);
      }
    });
    const history = logSnapshot.docs
      .map(doc => {
        const data = doc.data();
        const createdAt = data.created_at?.toDate?.() || null;
        return {
          id: doc.id,
          target_user_id: String(data.target_user_id || ''),
          target_name: accountNames.get(String(data.target_user_id || '')) || '削除済みアカウント',
          actor_uid: String(data.actor_uid || ''),
          actor_email: String(data.actor_email || ''),
          permissions: parsePermissions(data.permissions),
          created_at: createdAt?.toISOString() || null,
          created_at_ms: createdAt?.getTime() || 0,
        };
      })
      .filter(item => accountIds.has(item.target_user_id))
      .sort((a, b) => b.created_at_ms - a.created_at_ms)
      .slice(0, 30)
      .map(item => ({
        id: item.id,
        target_user_id: item.target_user_id,
        target_name: item.target_name,
        actor_uid: item.actor_uid,
        actor_email: item.actor_email,
        permissions: item.permissions,
        created_at: item.created_at,
      }));

    return Response.json({ ok: true, accounts, history });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor.role);
    const body = await request.json();
    const userId = String(body.user_id || '').trim();
    if (!userId) throw new Error('user-id-required');

    const targetRef = adminDb().collection('users').doc(userId);
    const target = await targetRef.get();
    if (!target.exists) throw new Error('user-not-found');

    const targetRole = String(target.data()?.role || '').toLowerCase();
    if (!isConfigurableAdminRole(targetRole)) throw new Error('admin-account-required');

    const permissions = parsePermissions(body.permissions);
    await targetRef.update({
      admin_permissions: permissions,
      eiken_admin: permissions.eiken,
      permissions_updated_at: FieldValue.serverTimestamp(),
      permissions_updated_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actor.uid,
    });

    const auditRef = await adminDb().collection('action_logs').add({
      action: 'update_admin_app_permissions',
      target_user_id: userId,
      target_name: target.data()?.name || target.data()?.teacher_name || target.data()?.email || '名称未設定',
      permissions,
      actor_uid: actor.uid,
      actor_email: actor.email || '',
      created_at: FieldValue.serverTimestamp(),
    });

    return Response.json({
      ok: true,
      permissions,
      audit: {
        id: auditRef.id,
        target_user_id: userId,
        target_name: target.data()?.name || target.data()?.teacher_name || target.data()?.email || '名称未設定',
        actor_uid: actor.uid,
        actor_email: actor.email || '',
        permissions,
        created_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor.role);
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'initialize_existing') throw new Error('unsupported-action');

    const snapshot = await adminDb().collection('users').get();
    const targets = snapshot.docs.filter(doc => {
      const data = doc.data();
      const rawRole = String(data.role || '').toLowerCase();
      return isConfigurableAdminRole(rawRole) && !data.admin_permissions;
    });

    for (let offset = 0; offset < targets.length; offset += 350) {
      const batch = adminDb().batch();
      targets.slice(offset, offset + 350).forEach(doc => {
        const profile = doc.data();
        const permissions = normalizeAdminAppPermissions(profile.role, profile);
        batch.update(doc.ref, {
          admin_permissions: permissions,
          eiken_admin: permissions.eiken,
          permissions_updated_at: FieldValue.serverTimestamp(),
          permissions_updated_by: actor.uid,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actor.uid,
        });
      });
      await batch.commit();
    }

    await adminDb().collection('action_logs').add({
      action: 'initialize_admin_app_permissions',
      target_count: targets.length,
      actor_uid: actor.uid,
      actor_email: actor.email || '',
      created_at: FieldValue.serverTimestamp(),
    });

    return Response.json({ ok: true, initialized_count: targets.length });
  } catch (error) {
    return jsonError(error);
  }
}
