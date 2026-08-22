import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getNotificationSettings, roleLineEnabled } from '@/lib/line';
import { canManageAttendance, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

type Channel = 'in_app' | 'line' | 'email';

function normalizeRole(role: unknown) {
  const value = String(role || '').toLowerCase();
  if (value === 'teacher') return 'teacher';
  if (value === 'parent' || value === 'guardian') return 'parent';
  if (value === 'master' || value.includes('admin')) return 'admin';
  return 'student';
}

function displayName(data: FirebaseFirestore.DocumentData) {
  return data.name || data.display_name || data.student_name || data.parent_name || data.teacher_name || data.email || '利用者';
}

function schoolOf(data: FirebaseFirestore.DocumentData) {
  return String(data.school || data.school_id || data.classroom || '').trim();
}

function roleKindEnabled(settings: Awaited<ReturnType<typeof getNotificationSettings>>, kind: string) {
  if (kind === 'class_start') return settings.class_start_enabled;
  if (kind === 'homework') return settings.homework_enabled;
  if (kind === 'announcements') return settings.announcements_enabled;
  return true;
}

function userAllows(data: FirebaseFirestore.DocumentData, channel: Channel, kind: string) {
  const prefs = data.notification_preferences || {};
  if (channel === 'line' && prefs.line === false) return false;
  if (channel === 'email' && prefs.email === false) return false;
  if (channel === 'in_app' && prefs.in_app === false) return false;
  if (kind && prefs[kind] === false) return false;
  return true;
}

async function pushLine(lineUserId: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'line-token-missing' };

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return { ok: false, error: errorText || `line-${res.status}` };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const title = String(body.title || '').trim().slice(0, 120);
    const message = String(body.message || body.body || '').trim().slice(0, 5000);
    const kind = String(body.kind || 'announcements');
    const channels = (Array.isArray(body.channels) ? body.channels : ['in_app']) as Channel[];
    const selectedUserIds = Array.isArray(body.selected_user_ids) ? body.selected_user_ids.map(String).filter(Boolean) : [];
    const selectedRoles = Array.isArray(body.selected_roles) ? body.selected_roles.map(normalizeRole) : [];
    const targetSchool = String(body.school || '').trim();
    const targetGrade = String(body.grade || '').trim();
    const includeName = body.include_name !== false;
    const scienceAdmin = isAdminLike(user);
    const attendanceScoped = !scienceAdmin && canManageAttendance(user);
    if (!scienceAdmin && !attendanceScoped) throw new Error('forbidden');
    if (attendanceScoped && (
      kind !== 'attendance' ||
      selectedUserIds.length === 0 ||
      selectedRoles.length > 0 ||
      Boolean(targetSchool) ||
      Boolean(targetGrade)
    )) {
      throw new Error('forbidden');
    }

    if (!title || !message) return Response.json({ ok: false, error: 'title and message are required' }, { status: 400 });
    if (!channels.length) return Response.json({ ok: false, error: 'channels is required' }, { status: 400 });

    const settings = await getNotificationSettings();
    const usersSnap = await adminDb().collection('users').get();
    const targets = usersSnap.docs
      .map(doc => ({ id: doc.id, data: doc.data(), role: normalizeRole(doc.data().role) }))
      .filter(item => {
        if (attendanceScoped && !['teacher', 'attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(item.data.role || '').toLowerCase())) {
          return false;
        }
        if (selectedUserIds.length) return selectedUserIds.includes(item.id);
        if (selectedRoles.length && !selectedRoles.includes(item.role)) return false;
        if (targetSchool && schoolOf(item.data) !== targetSchool) return false;
        if (targetGrade && String(item.data.grade || item.data.student_grade || '') !== targetGrade) return false;
        return selectedRoles.length || targetSchool || targetGrade;
      });

    if (!targets.length) return Response.json({ ok: false, error: 'targets not found' }, { status: 400 });

    const db = adminDb();
    const campaignRef = db.collection('notification_campaigns').doc();
    let inAppCount = 0;
    let emailJobCount = 0;
    let lineSentCount = 0;
    let skippedCount = 0;
    let batch = db.batch();
    let batchCount = 0;

    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    batch.set(campaignRef, {
      title,
      message,
      kind,
      channels,
      selected_user_ids: selectedUserIds,
      selected_roles: selectedRoles,
      target_school: targetSchool || null,
      target_grade: targetGrade || null,
      target_count: targets.length,
      created_by: user.uid,
      created_by_role: user.role,
      created_at: FieldValue.serverTimestamp(),
    });
    batchCount++;

    if (channels.includes('in_app') && settings.in_app_enabled && roleKindEnabled(settings, kind)) {
      for (const target of targets) {
        if (!userAllows(target.data, 'in_app', kind)) {
          skippedCount++;
          continue;
        }
        const notificationRef = db.collection('user_notifications').doc();
        batch.set(notificationRef, {
          user_id: target.id,
          role: target.role,
          title,
          message,
          kind,
          campaign_id: campaignRef.id,
          read: false,
          created_at: FieldValue.serverTimestamp(),
        });
        inAppCount++;
        batchCount++;
        if (batchCount >= 400) await commit();
      }
    }

    if (channels.includes('email') && settings.email_enabled && roleKindEnabled(settings, kind)) {
      const jobRef = db.collection('notification_jobs').doc();
      batch.set(jobRef, {
        target_role: selectedRoles.length === 1 ? selectedRoles[0] : 'custom',
        channel: 'email',
        title,
        message,
        period: { source: 'master_notifications', campaign_id: campaignRef.id, selected_user_ids: selectedUserIds, selected_roles: selectedRoles, school: targetSchool || null, grade: targetGrade || null },
        status: 'queued',
        created_by: user.uid,
        created_by_role: user.role,
        created_at: FieldValue.serverTimestamp(),
      });
      emailJobCount++;
      batchCount++;
    }

    await commit();

    if (channels.includes('line') && settings.line_enabled && roleKindEnabled(settings, kind)) {
      for (const target of targets) {
        const lineUserId = String(target.data.line_user_id || '');
        if (!lineUserId || !roleLineEnabled(settings, target.role) || !userAllows(target.data, 'line', kind)) {
          skippedCount++;
          continue;
        }
        const text = `${includeName ? `${displayName(target.data)}様\n\n` : ''}【${title}】\n${message}`.trim();
        const result = await pushLine(lineUserId, text);
        if (result.ok) lineSentCount++;
        else skippedCount++;
      }
    }

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'notification_campaign_created',
      target_id: campaignRef.id,
      target_type: 'notification_campaign',
      school: user.school,
      metadata: { title, kind, channels, target_count: targets.length, in_app_count: inAppCount, line_sent_count: lineSentCount, email_job_count: emailJobCount },
    });

    return Response.json({
      ok: true,
      campaign_id: campaignRef.id,
      event_id: eventId,
      target_count: targets.length,
      in_app_count: inAppCount,
      line_sent_count: lineSentCount,
      email_job_count: emailJobCount,
      skipped_count: skippedCount,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const scienceAdmin = isAdminLike(user);
    const attendanceScoped = !scienceAdmin && canManageAttendance(user);
    if (!scienceAdmin && !attendanceScoped) throw new Error('forbidden');

    const snap = await adminDb().collection('notification_campaigns').orderBy('created_at', 'desc').limit(50).get();
    const campaigns = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .filter(item => !attendanceScoped || item.kind === 'attendance');
    return Response.json({ ok: true, campaigns });
  } catch (error) {
    return jsonError(error);
  }
}
