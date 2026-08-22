import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { fetchOfficialZoomJoinUrl, getZoomServerAccessToken } from '@/lib/zoom-meeting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const normalizeMeetingId = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .replace(/[^\d]/g, '');

const normalizePasscode = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .trim();

const isValidPasscode = (value: string) => /^[A-Za-z0-9@_-]{1,10}$/.test(value);

export async function PATCH(request: NextRequest, context: { params: { shiftId: string } }) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const shiftId = String(context.params.shiftId || '').trim();
    const { passcode: rawPasscode } = await request.json();
    const passcode = normalizePasscode(rawPasscode);
    if (!shiftId) return NextResponse.json({ ok: false, error: '講師配置を特定できません。' }, { status: 400 });
    if (!isValidPasscode(passcode)) {
      return NextResponse.json({ ok: false, error: 'パスコードは半角英数字と @ _ - を使い、10文字以内で入力してください。' }, { status: 400 });
    }

    const db = adminDb();
    const shiftRef = db.collection('shift_assignments').doc(shiftId);
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) return NextResponse.json({ ok: false, error: '講師配置が見つかりません。' }, { status: 404 });

    const shift = shiftSnap.data() || {};
    if (String(shift.role_type || 'main') !== 'main') {
      return NextResponse.json({ ok: false, error: 'メイン授業の講師配置から変更してください。' }, { status: 400 });
    }
    const meetingId = normalizeMeetingId(shift.target_meeting_id || shift.meeting_id || shift.zoom_meeting_id);
    if (!meetingId) return NextResponse.json({ ok: false, error: 'ZoomミーティングIDが設定されていません。' }, { status: 400 });

    const accessToken = await getZoomServerAccessToken();
    const zoomResponse = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: passcode }),
      cache: 'no-store',
    });

    if (!zoomResponse.ok) {
      const detail = await zoomResponse.json().catch(() => ({}));
      const message = String(detail.message || detail.reason || zoomResponse.status);
      const scopeHint = /scope|permission/i.test(message)
        ? ' Zoom MarketplaceでこのServer-to-Server OAuthアプリに meeting:write:admin の権限を追加してください。'
        : '';
      return NextResponse.json({ ok: false, error: `Zoomの会議パスコードを変更できませんでした: ${message}${scopeHint}` }, { status: 502 });
    }

    let officialJoinUrl = '';
    let joinUrlWarning = '';
    try {
      officialJoinUrl = await fetchOfficialZoomJoinUrl(meetingId, accessToken);
      if (!officialJoinUrl) {
        joinUrlWarning = 'Zoomから暗号化済みパスコード付きの参加URLを取得できませんでした。';
      }
    } catch (error: any) {
      joinUrlWarning = error?.message || 'Zoomの参加URL取得に失敗しました。';
    }

    await shiftRef.update({
      target_password: passcode,
      target_join_url: officialJoinUrl || null,
      zoom_passcode_updated_at: FieldValue.serverTimestamp(),
      zoom_join_url_updated_at: officialJoinUrl ? FieldValue.serverTimestamp() : null,
      zoom_passcode_updated_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      meeting_id: meetingId,
      passcode,
      join_url_ready: Boolean(officialJoinUrl),
      warning: joinUrlWarning || undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
}
