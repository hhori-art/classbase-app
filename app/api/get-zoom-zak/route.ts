import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, requireRole } from '@/lib/server-auth';

const normalize = (value: unknown) => String(value || '').normalize('NFKC').trim().toLowerCase();
const normalizeMeetingId = (value: unknown) => String(value || '').replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
const normalizePasscode = (value: unknown) => String(value || '').normalize('NFKC').trim();
const buildHostStartUrl = (meetingId: unknown, zak: unknown, name?: unknown, passcode?: unknown) => {
  const cleanMeetingId = normalizeMeetingId(meetingId);
  const zakToken = String(zak || '').trim();
  if (!cleanMeetingId || !zakToken) return '';
  const params = new URLSearchParams({
    zak: zakToken,
  });
  const displayName = String(name || '').trim();
  if (displayName) params.set('uname', displayName);
  const cleanPasscode = normalizePasscode(passcode);
  if (cleanPasscode) params.set('pwd', cleanPasscode);
  return `https://zoom.us/s/${cleanMeetingId}?${params.toString()}`;
};
const buildHostAppUrl = (meetingId: unknown, zak: unknown, passcode?: unknown) => {
  const cleanMeetingId = normalizeMeetingId(meetingId);
  const zakToken = String(zak || '').trim();
  if (!cleanMeetingId || !zakToken) return '';
  const params = new URLSearchParams({
    confno: cleanMeetingId,
    zak: zakToken,
  });
  const cleanPasscode = normalizePasscode(passcode);
  if (cleanPasscode) params.set('pwd', cleanPasscode);
  return `zoommtg://zoom.us/start?${params.toString()}`;
};

const withPasscode = (rawUrl: string, passcode?: unknown) => {
  const cleanPasscode = normalizePasscode(passcode);
  if (!rawUrl || !cleanPasscode) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('pwd', cleanPasscode);
    return url.toString();
  } catch {
    return rawUrl;
  }
};

function profileZoomEmails(profile: Record<string, any>) {
  return [
    profile.email,
    profile.zoom_email,
    profile.zoomEmail,
    profile.target_signin_address,
    profile.signin_address,
    profile.teacher_zoom_email,
  ].map(normalize).filter(Boolean);
}

function normalizeName(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

function isTeacherAssignedToShift(user: any, shift: Record<string, any>) {
  const userIds = [
    user.uid,
    user.profile?.uid,
    user.profile?.id,
  ].map(value => String(value || '')).filter(Boolean);
  if (userIds.includes(String(shift.user_id || ''))) return true;

  const teacherNames = [
    user.profile?.teacher_name,
    user.profile?.student_name,
    user.profile?.name,
    user.profile?.display_name,
    user.profile?.displayName,
    user.profile?.full_name,
  ].map(normalizeName).filter(Boolean);

  const shiftTeacherName = normalizeName(shift.teacher_name);
  return Boolean(shiftTeacherName && teacherNames.some(name => shiftTeacherName === name || shiftTeacherName.includes(name) || name.includes(shiftTeacherName)));
}

function getShiftPeriod(shift: Record<string, any>) {
  const note = String(shift.note || '').normalize('NFKC');
  const match = note.match(/【([^】]+)】/);
  return match?.[1] || '';
}

function isSameClassSlot(mainShift: Record<string, any>, relatedShift: Record<string, any>) {
  if (String(relatedShift.parent_id || '') === String(mainShift.id || '')) return true;
  if (relatedShift.role_type !== 'sub') return false;
  if (String(mainShift.target_date || '') !== String(relatedShift.target_date || '')) return false;
  if (String(mainShift.target_subject || '') !== String(relatedShift.target_subject || '')) return false;
  if (String(mainShift.target_grade || '') !== String(relatedShift.target_grade || '')) return false;
  if (String(mainShift.target_detail_subject || '') !== String(relatedShift.target_detail_subject || '')) return false;

  const mainPeriod = getShiftPeriod(mainShift);
  const relatedPeriod = getShiftPeriod(relatedShift);
  return !mainPeriod || !relatedPeriod || mainPeriod === relatedPeriod;
}

async function teacherAssignedToRelatedShift(user: any, shift: Record<string, any>) {
  const parentMatches = shift.id
    ? await adminDb().collection('shift_assignments')
      .where('parent_id', '==', String(shift.id))
      .limit(30)
      .get()
      .catch(() => null)
    : null;

  if (parentMatches?.docs.some(doc => isTeacherAssignedToShift(user, { id: doc.id, ...(doc.data() || {}) }))) {
    return true;
  }

  if (!shift.target_date) return false;

  const sameDay = await adminDb().collection('shift_assignments')
    .where('target_date', '==', shift.target_date)
    .limit(200)
    .get()
    .catch(() => null);

  return Boolean(sameDay?.docs.some(doc => {
    const data = { id: doc.id, ...(doc.data() || {}) };
    return isSameClassSlot(shift, data) && isTeacherAssignedToShift(user, data);
  }));
}

function shiftHasRequestedZoom(shift: Record<string, any>, targetEmail: string, targetMeetingId: string) {
  const shiftEmail = normalize(shift.target_signin_address);
  const shiftMeetingId = normalizeMeetingId(shift.target_meeting_id);

  if (!shiftEmail || shiftEmail !== targetEmail) return false;
  if (targetMeetingId && shiftMeetingId && shiftMeetingId !== targetMeetingId) return false;
  return true;
}

async function shiftAllowsZoomEmail(user: any, shift: Record<string, any>, targetEmail: string, targetMeetingId: string, requireAssignment = false) {
  if (!shiftHasRequestedZoom(shift, targetEmail, targetMeetingId)) return false;
  if (!requireAssignment) return true;
  if (isTeacherAssignedToShift(user, shift)) return true;
  return teacherAssignedToRelatedShift(user, shift);
}

async function teacherCanUseZoomEmail(user: any, email: string, meetingId?: string, shiftId?: string) {
  const targetEmail = normalize(email);
  const targetMeetingId = normalizeMeetingId(meetingId);
  if (!targetEmail) return false;
  if (normalize(user.email) === targetEmail) return true;
  if (profileZoomEmails(user.profile || {}).includes(targetEmail)) return true;

  const shiftDoc = shiftId
    ? await adminDb().collection('shift_assignments').doc(String(shiftId)).get().catch(() => null)
    : null;

  if (shiftDoc?.exists) {
    const data = { id: shiftDoc.id, ...(shiftDoc.data() || {}) };
    if (await shiftAllowsZoomEmail(user, data, targetEmail, targetMeetingId)) {
      return true;
    }
  }

  const snapshots = await Promise.all([
    adminDb().collection('shift_assignments').where('target_signin_address', '==', email).limit(30).get().catch(() => null),
    targetEmail !== email ? adminDb().collection('shift_assignments').where('target_signin_address', '==', targetEmail).limit(30).get().catch(() => null) : Promise.resolve(null),
    targetMeetingId ? adminDb().collection('shift_assignments').where('target_meeting_id', '==', targetMeetingId).limit(30).get().catch(() => null) : Promise.resolve(null),
  ]);

  const docs = snapshots.flatMap(snap => snap?.docs || []);
  for (const doc of docs) {
    const data = { id: doc.id, ...(doc.data() || {}) };
    if (await shiftAllowsZoomEmail(user, data, targetEmail, targetMeetingId)) {
      return true;
    }
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) requireRole(user, ['teacher']);

    const { email, meetingId, shiftId, name } = await request.json();
    const zoomEmail = normalize(email);
    let fallbackStartUrl = '';
    let shiftPasscode = '';

    if (shiftId) {
      const shiftDoc = await adminDb().collection('shift_assignments').doc(String(shiftId)).get().catch(() => null);
      const shiftData = shiftDoc?.exists ? (shiftDoc.data() || {}) : {};
      shiftPasscode = normalizePasscode(
        shiftData.target_password || shiftData.meeting_password || shiftData.zoom_password || shiftData.passcode || shiftData.password
      );
      fallbackStartUrl = withPasscode(String(shiftData.start_url || '').trim(), shiftPasscode);
    }

    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      if (fallbackStartUrl) {
        return NextResponse.json({ success: true, start_url: fallbackStartUrl, fallback: 'start_url' });
      }
      return NextResponse.json({ success: false, error: 'API Credentials missing' }, { status: 500 });
    }

    if (!zoomEmail) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    if (!isAdminLike(user) && !(await teacherCanUseZoomEmail(user, String(email), String(meetingId || ''), String(shiftId || '')))) {
      console.warn('[get-zoom-zak] forbidden', {
        uid: user.uid,
        role: user.role,
        profileName: user.profile?.student_name || user.profile?.name || user.profile?.teacher_name || null,
        shiftId: shiftId || null,
        meetingId: normalizeMeetingId(meetingId),
        zoomEmailDomain: String(email || '').split('@')[1] || null,
      });
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    // 1. アクセストークン取得
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenUrl = new URL('https://zoom.us/oauth/token');
    tokenUrl.search = new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: accountId,
    }).toString();
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authHeader}` },
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.json().catch(() => ({}));
      if (fallbackStartUrl) {
        return NextResponse.json({ success: true, start_url: fallbackStartUrl, fallback: 'start_url' });
      }
      return NextResponse.json({
        success: false,
        error: `Zoom認証に失敗しました: ${errorBody.reason || errorBody.message || tokenRes.status}`,
      }, { status: 500 });
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. ZAKトークンを取得
    // ホスト開始に必要なのはZAKだけです。ユーザー詳細取得を挟むと、
    // user:read 系のスコープ不足でZAK取得前に失敗することがあるため省略します。
    const zakRes = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(zoomEmail)}/token?type=zak`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!zakRes.ok) {
      const errorBody = await zakRes.json().catch(() => ({}));
      if (fallbackStartUrl) {
        return NextResponse.json({ success: true, start_url: fallbackStartUrl, fallback: 'start_url' });
      }
      const zoomMessage = String(errorBody.message || errorBody.reason || '');
      const scopeHint = zoomMessage.includes('user:read:token')
        ? 'Zoom Marketplaceで Server-to-Server OAuth アプリに user:read:token:admin または user:read:token のスコープを追加してください。'
        : '';
      return NextResponse.json({
        success: false,
        error: `ZAKトークンを取得できません: ${zoomEmail}`,
        detail: [zoomMessage || String(zakRes.status), scopeHint].filter(Boolean).join(' / '),
      }, { status: 500 });
    }
    const zakData = await zakRes.json();

    const displayName = name || user.profile?.teacher_name || user.profile?.name || user.profile?.student_name || '講師';
    const startUrl = buildHostStartUrl(meetingId, zakData.token, displayName, shiftPasscode);
    const appStartUrl = buildHostAppUrl(meetingId, zakData.token, shiftPasscode);

    return NextResponse.json({ 
      success: true, 
      meeting_id: normalizeMeetingId(meetingId),
      zak: zakData.token,
      app_start_url: appStartUrl || undefined,
      start_url: startUrl || undefined,
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
