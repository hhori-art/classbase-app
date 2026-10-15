import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdminApp } from '@/lib/admin-app-access';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, canManageSchool, jsonError } from '@/lib/server-auth';
import { getZoomServerAccessToken } from '@/lib/zoom-meeting';
import { normalizeZoomMeetingId } from '@/lib/zoom-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max: number) => String(value || '').normalize('NFKC').trim().slice(0, max);

function validLocalDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireAdminApp(actor, 'science_social');
    const body = await request.json();
    const shiftId = clean(body.shift_id || body.shiftId, 160);
    const topic = clean(body.topic, 120);
    const startTime = clean(body.start_time || body.startTime, 32);
    const duration = Math.floor(Number(body.duration));
    if (!shiftId || !topic || !validLocalDateTime(startTime) || !Number.isInteger(duration) || duration < 15 || duration > 240) {
      return Response.json({ ok: false, success: false, error: '授業、開始日時、授業名、所要時間を正しく指定してください。' }, { status: 400 });
    }

    const db = adminDb();
    const shiftRef = db.collection('shift_assignments').doc(shiftId);
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) {
      return Response.json({ ok: false, success: false, error: '講師配置が見つかりません。' }, { status: 404 });
    }
    const shift = shiftSnap.data() || {};
    if (String(shift.role_type || 'main') !== 'main') {
      return Response.json({ ok: false, success: false, error: 'メイン授業の講師配置から発行してください。' }, { status: 400 });
    }
    if (!canManageSchool(actor, shift.school_id || shift.school || null)) throw new Error('forbidden');
    const targetDate = clean(shift.target_date, 10);
    if (!targetDate || !startTime.startsWith(`${targetDate}T`)) {
      return Response.json({ ok: false, success: false, error: '開始日時は講師配置の日付と一致させてください。' }, { status: 400 });
    }
    if (normalizeZoomMeetingId(shift.target_meeting_id)) {
      return Response.json({ ok: false, success: false, error: 'この配置には既にZoomミーティングが設定されています。' }, { status: 409 });
    }
    const hostReference = clean(shift.target_signin_address, 254).toLowerCase();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostReference);
    const isZoomUserId = /^[a-z0-9_-]{8,80}$/i.test(hostReference);
    if (!isEmail && !isZoomUserId) {
      return Response.json({ ok: false, success: false, error: '先にZoomのサインインアドレスを配置へ保存してください。' }, { status: 400 });
    }

    const accessToken = await getZoomServerAccessToken();
    const passcode = crypto.randomBytes(8).toString('base64url').slice(0, 10);
    const zoomResponse = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostReference)}/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        type: 2,
        start_time: startTime,
        timezone: 'Asia/Tokyo',
        duration,
        password: passcode,
        settings: {
          join_before_host: false,
          waiting_room: true,
        },
      }),
      cache: 'no-store',
    });
    const zoom = await zoomResponse.json().catch(() => ({}));
    if (!zoomResponse.ok || !normalizeZoomMeetingId(zoom.id) || !zoom.start_url || !zoom.join_url) {
      const message = clean(zoom.message || zoom.reason || zoomResponse.status, 240);
      const scopeHint = /scope|permission/i.test(message)
        ? ' Zoom Marketplaceで meeting:write:admin を追加してください。'
        : '';
      return Response.json({ ok: false, success: false, error: `Zoomミーティングを発行できませんでした: ${message}${scopeHint}` }, { status: 502 });
    }

    const meetingId = normalizeZoomMeetingId(zoom.id);
    await shiftRef.update({
      target_meeting_id: meetingId,
      target_password: passcode,
      start_url: String(zoom.start_url),
      target_join_url: String(zoom.join_url),
      zoom_meeting_created_at: FieldValue.serverTimestamp(),
      zoom_meeting_created_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    });

    return Response.json({
      ok: true,
      success: true,
      meeting_id: meetingId,
      passcode,
      start_url: String(zoom.start_url),
      join_url: String(zoom.join_url),
    });
  } catch (error) {
    return jsonError(error);
  }
}
