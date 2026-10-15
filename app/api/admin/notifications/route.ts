import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getNotificationSettings, roleLineEnabled } from '@/lib/line';
import { canManageAttendance, canManageAttendanceSchool, canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { jstDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';

type Channel = 'in_app' | 'line' | 'email';
const ALLOWED_CHANNELS = new Set<Channel>(['in_app', 'line', 'email']);
const ALLOWED_ROLE_INPUTS = new Set(['student', 'teacher', 'parent', 'guardian', 'admin', 'master']);
const ALLOWED_KINDS = new Set(['attendance', 'class_start', 'homework', 'announcements', 'registration', 'shift', 'substitution', 'system']);

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
  return String(data.school_id || data.school_code || data.school_name || data.school || data.classroom || '').trim();
}

function schoolValues(data: FirebaseFirestore.DocumentData) {
  return Array.from(new Set([
    data.school_id, data.school_code, data.school_name, data.school, data.classroom,
  ].map(value => String(value || '').trim()).filter(Boolean)));
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

function stableLineRetryKey(...parts: string[]) {
  const hex = crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function stableEmailIdempotencyKey(...parts: string[]) {
  return `classbase-${crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex')}`;
}

async function pushLine(lineUserId: string, text: string, retryKey: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'line-token-missing' };

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text }],
      }),
    });

    if (res.status === 409 && res.headers.get('X-Line-Accepted-Request-Id')) {
      return { ok: true, duplicate: true };
    }
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      return { ok: false, error: errorText || `line-${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'line-network-error' };
  }
}

async function sendEmail(email: string, title: string, message: string, idempotencyKey: string) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!apiKey || !from) return { ok: false, error: 'email-config-missing' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from, to: [email], subject: title, text: message }),
    });
    if (!res.ok) return { ok: false, error: `email-${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'email-network-error' };
  }
}

export async function POST(request: NextRequest) {
  let claimedCampaignRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const title = String(body.title || '').trim().slice(0, 120);
    const message = String(body.message || body.body || '').trim().slice(0, 5000);
    const kind = String(body.kind || 'announcements');
    const rawChannels = Array.isArray(body.channels) ? body.channels.map(String) : ['in_app'];
    const channels = Array.from(new Set(rawChannels)) as Channel[];
    const selectedUserIds: string[] = Array.isArray(body.selected_user_ids) ? body.selected_user_ids.map(String).filter(Boolean) : [];
    const rawRoles = Array.isArray(body.selected_roles) ? body.selected_roles.map((value: unknown) => String(value).toLowerCase()) : [];
    const selectedRoles = rawRoles.map(normalizeRole);
    const targetSchool = String(body.school || '').trim();
    const targetGrade = String(body.grade || '').trim();
    const includeName = body.include_name !== false;
    const requestId = String(body.request_id || crypto.randomUUID()).trim().slice(0, 160);
    const scienceAdmin = isAdminLike(user);
    const attendanceScoped = !scienceAdmin && canManageAttendance(user);
    if (!scienceAdmin && !attendanceScoped) throw new Error('forbidden');
    if (rawChannels.some((channel: string) => !ALLOWED_CHANNELS.has(channel as Channel)) || channels.length === 0) {
      return Response.json({ ok: false, error: 'invalid channels' }, { status: 400 });
    }
    if (rawRoles.some((role: string) => !ALLOWED_ROLE_INPUTS.has(role)) || !ALLOWED_KINDS.has(kind)) {
      return Response.json({ ok: false, error: 'invalid target or kind' }, { status: 400 });
    }
    if (selectedUserIds.length > 400 || new Set(selectedUserIds).size !== selectedUserIds.length) {
      return Response.json({ ok: false, error: 'too many or duplicate targets' }, { status: 400 });
    }
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
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) return Response.json({ ok: false, error: 'invalid request id' }, { status: 400 });
    if (!channels.length) return Response.json({ ok: false, error: 'channels is required' }, { status: 400 });

    const settings = await getNotificationSettings();
    const db = adminDb();
    const userCollection = db.collection('users');
    const userDocs = selectedUserIds.length
      ? await db.getAll(...selectedUserIds.map(id => userCollection.doc(id)))
      : (await userCollection.get()).docs;
    const targets = userDocs
      .filter(doc => doc.exists)
      .map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, data, role: normalizeRole(data.role) };
      })
      .filter(item => {
        if (user.role !== 'master') {
          const storedSchools = schoolValues(item.data);
          if (storedSchools.length === 0 || !storedSchools.every(school => attendanceScoped
            ? canManageAttendanceSchool(user, school)
            : canManageSchool(user, school))) return false;
        }
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
    if (channels.includes('email') && targets.length > 100) {
      return Response.json({ ok: false, error: 'email targets must be 100 or fewer' }, { status: 400 });
    }

    const campaignId = `campaign_${crypto.createHash('sha256').update(`${user.uid}\u0000${requestId}`).digest('hex').slice(0, 40)}`;
    const campaignRef = db.collection('notification_campaigns').doc(campaignId);
    const targetSchoolIds = Array.from(new Set(targets.map(target => schoolOf(target.data)).filter(Boolean)));
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({
      title, message, kind, channels: [...channels].sort(), includeName,
      selectedUserIds: [...selectedUserIds].sort(), selectedRoles: [...selectedRoles].sort(),
      targetSchool, targetGrade, targetIds: targets.map(target => target.id).sort(),
    })).digest('hex');
    let retryingCampaign = false;
    let inAppCount = 0;
    let emailSentCount = 0;
    let emailFailedCount = 0;
    let lineSentCount = 0;
    let lineFailedCount = 0;
    let skippedCount = 0;
    let batch = db.batch();
    let batchCount = 0;

    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    try {
      await campaignRef.create({
        title, message, kind, channels, request_id: requestId,
        payload_hash: payloadHash,
        retry_until: new Date(Date.now() + 23 * 60 * 60 * 1000),
        selected_user_ids: selectedUserIds, selected_roles: selectedRoles,
        target_school: targetSchool || null, target_school_ids: targetSchoolIds,
        target_grade: targetGrade || null, target_count: targets.length,
        status: 'processing', created_by: user.uid, created_by_role: user.role,
        created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      });
      claimedCampaignRef = campaignRef;
    } catch (error: any) {
      if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
      const existing = await campaignRef.get();
      const data = existing.data() || {};
      if (data.payload_hash && data.payload_hash !== payloadHash) {
        return Response.json({ ok: false, error: 'request id payload mismatch', campaign_id: campaignRef.id }, { status: 409 });
      }
      if (data.status === 'completed') {
        return Response.json({
          ok: true, already_processed: true, campaign_id: campaignRef.id,
          target_count: Number(data.target_count || 0), in_app_count: Number(data.in_app_count || 0),
          line_sent_count: Number(data.line_sent_count || 0), email_sent_count: Number(data.email_sent_count || 0),
          line_failed_count: Number(data.line_failed_count || 0), email_failed_count: Number(data.email_failed_count || 0),
          skipped_count: Number(data.skipped_count || 0),
        });
      }
      if (!['failed', 'completed_with_errors'].includes(String(data.status || ''))) {
        return Response.json({ ok: false, error: 'campaign is already processing', campaign_id: campaignRef.id }, { status: 409 });
      }
      if (!data.payload_hash) {
        return Response.json({ ok: false, error: 'legacy campaign cannot be retried', campaign_id: campaignRef.id }, { status: 409 });
      }
      const retryUntil = data.retry_until?.toMillis?.() ?? data.retry_until?.getTime?.() ?? Date.parse(String(data.retry_until || ''));
      if (!Number.isFinite(retryUntil) || Date.now() > retryUntil) {
        return Response.json({ ok: false, error: 'campaign retry window expired', campaign_id: campaignRef.id }, { status: 409 });
      }
      retryingCampaign = true;
      inAppCount = Number(data.in_app_count || 0);
      await campaignRef.update({
        status: 'processing', failure_reason: null, failed_at: null,
        retry_count: Number(data.retry_count || 0) + 1,
        last_retry_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      });
      claimedCampaignRef = campaignRef;
    }

    if (!retryingCampaign && channels.includes('in_app') && settings.in_app_enabled && roleKindEnabled(settings, kind)) {
      for (const target of targets) {
        if (!userAllows(target.data, 'in_app', kind)) {
          skippedCount++;
          continue;
        }
        const notificationRef = db.collection('user_notifications').doc(`${campaignRef.id}_${target.id}`);
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

    await commit();

    if (channels.includes('email') && settings.email_enabled && roleKindEnabled(settings, kind)) {
      const eligible = targets.filter(target => {
        const email = String(target.data.email || '').trim();
        return userAllows(target.data, 'email', kind) && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      });
      skippedCount += targets.length - eligible.length;
      for (let offset = 0; offset < eligible.length; offset += 10) {
        const results = await Promise.all(eligible.slice(offset, offset + 10).map(target =>
          sendEmail(String(target.data.email).trim(), title, message, stableEmailIdempotencyKey(campaignRef.id, target.id, 'email'))
        ));
        emailSentCount += results.filter(result => result.ok).length;
        emailFailedCount += results.filter(result => !result.ok).length;
      }
    }

    if (channels.includes('line') && settings.line_enabled && roleKindEnabled(settings, kind)) {
      for (const target of targets) {
        const lineUserId = String(target.data.line_user_id || '');
        if (!lineUserId || !roleLineEnabled(settings, target.role) || !userAllows(target.data, 'line', kind)) {
          skippedCount++;
          continue;
        }
        const text = `${includeName ? `${displayName(target.data)}様\n\n` : ''}【${title}】\n${message}`.trim();
        const result = await pushLine(lineUserId, text, stableLineRetryKey(campaignRef.id, target.id, 'line'));
        if (result.ok) lineSentCount++;
        else lineFailedCount++;
      }
    }

    const completedStatus = lineFailedCount || emailFailedCount ? 'completed_with_errors' : 'completed';
    await campaignRef.update({
      status: completedStatus, in_app_count: inAppCount, line_sent_count: lineSentCount,
      line_failed_count: lineFailedCount,
      email_sent_count: emailSentCount, email_failed_count: emailFailedCount,
      skipped_count: skippedCount, completed_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'notification_campaign_created',
      target_id: campaignRef.id,
      target_type: 'notification_campaign',
      school: user.school,
      metadata: { title, kind, channels, target_count: targets.length, in_app_count: inAppCount, line_sent_count: lineSentCount, email_sent_count: emailSentCount, email_failed_count: emailFailedCount },
    });

    return Response.json({
      ok: true,
      campaign_id: campaignRef.id,
      status: completedStatus,
      event_id: eventId,
      target_count: targets.length,
      in_app_count: inAppCount,
      line_sent_count: lineSentCount,
      line_failed_count: lineFailedCount,
      email_sent_count: emailSentCount,
      email_failed_count: emailFailedCount,
      email_job_count: 0,
      skipped_count: skippedCount,
    });
  } catch (error) {
    if (claimedCampaignRef) {
      await claimedCampaignRef.set({
        status: 'failed', failure_reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown-error',
        failed_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
    }
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const scienceAdmin = isAdminLike(user);
    const attendanceScoped = !scienceAdmin && canManageAttendance(user);
    if (!scienceAdmin && !attendanceScoped) throw new Error('forbidden');

    if (request.nextUrl.searchParams.get('view') === 'recipients') {
      const db = adminDb();
      const [usersSnap, shiftSnap] = await Promise.all([
        db.collection('users').limit(5000).get(),
        db.collection('shift_assignments').where('target_date', '==', jstDateKey()).limit(2000).get(),
      ]);
      const recipients = usersSnap.docs.map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, data, role: normalizeRole(data.role) };
      }).filter(item => {
        if (user.role !== 'master') {
          const schools = schoolValues(item.data);
          if (schools.length === 0 || !schools.every(school => attendanceScoped
            ? canManageAttendanceSchool(user, school)
            : canManageSchool(user, school))) return false;
        }
        if (attendanceScoped && item.role !== 'teacher') return false;
        return true;
      }).map(item => ({
        id: item.id,
        role: item.role,
        raw_role: String(item.data.role || ''),
        name: displayName(item.data),
        email: String(item.data.email || '').trim().slice(0, 320),
        grade: String(item.data.grade || item.data.student_grade || '').trim().slice(0, 40),
        school: schoolOf(item.data),
        line_linked: Boolean(item.data.line_user_id),
        notification_preferences: {
          line: item.data.notification_preferences?.line !== false,
          email: item.data.notification_preferences?.email !== false,
          in_app: item.data.notification_preferences?.in_app !== false,
          class_start: item.data.notification_preferences?.class_start !== false,
          homework: item.data.notification_preferences?.homework !== false,
          announcements: item.data.notification_preferences?.announcements !== false,
        },
      }));
      const visibleTeacherIds = new Set(recipients.filter(item => item.role === 'teacher').map(item => item.id));
      const todayTeacherIds = Array.from(new Set(shiftSnap.docs
        .map(doc => String(doc.data().user_id || '').trim())
        .filter(id => id && visibleTeacherIds.has(id))));
      return Response.json({ ok: true, recipients, today_teacher_ids: todayTeacherIds }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const snap = await adminDb().collection('notification_campaigns').orderBy('created_at', 'desc').limit(50).get();
    const campaigns = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .filter(item => {
        if (user.role === 'master') return true;
        if (attendanceScoped && item.kind !== 'attendance') return false;
        const schools = Array.isArray(item.target_school_ids)
          ? item.target_school_ids.map(String).filter(Boolean)
          : item.target_school ? [String(item.target_school)] : [];
        if (schools.length === 0) return item.created_by === user.uid;
        return schools.every((school: string) => attendanceScoped
          ? canManageAttendanceSchool(user, school)
          : canManageSchool(user, school));
      });
    return Response.json({ ok: true, campaigns });
  } catch (error) {
    return jsonError(error);
  }
}
