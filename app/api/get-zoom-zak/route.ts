import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';

const normalize = (value: unknown) => String(value || '').normalize('NFKC').trim().toLowerCase();
const normalizeMeetingId = (value: unknown) => String(value || '').replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
const normalizePasscode = (value: unknown) => String(value || '').normalize('NFKC').trim();
const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const isCurrentShift = (shift: Record<string, any>) => String(shift.target_date || '').trim() === todayInJapan();
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
  if (shift.user_id) return String(shift.user_id) === user.uid;

  const teacherNames = [
    user.profile?.teacher_name,
    user.profile?.student_name,
    user.profile?.name,
    user.profile?.display_name,
    user.profile?.displayName,
    user.profile?.full_name,
  ].map(normalizeName).filter(Boolean);

  const shiftTeacherName = normalizeName(shift.teacher_name);
  return Boolean(shiftTeacherName && teacherNames.some(name => shiftTeacherName === name));
}

function getShiftPeriod(shift: Record<string, any>) {
  const note = String(shift.note || '').normalize('NFKC');
  const match = note.match(/【([^】]+)】/);
  return String(match?.[1] || '').replace(/[\s　]+/g, '').toLowerCase();
}

async function teacherAssignedToSamePeriod(user: any, shift: Record<string, any>) {
  const targetDate = String(shift.target_date || '').trim();
  const targetPeriod = getShiftPeriod(shift);
  if (!targetDate || !targetPeriod) return false;

  const sameDay = await adminDb().collection('shift_assignments')
    .where('target_date', '==', targetDate)
    .limit(250)
    .get()
    .catch(() => null);

  return Boolean(sameDay?.docs.some(doc => {
    const assignment = { id: doc.id, ...(doc.data() || {}) };
    return getShiftPeriod(assignment) === targetPeriod && isTeacherAssignedToShift(user, assignment);
  }));
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

  return Boolean(
    shiftEmail && targetEmail && shiftEmail === targetEmail &&
    shiftMeetingId && targetMeetingId && shiftMeetingId === targetMeetingId
  );
}

async function shiftAllowsZoomEmail(user: any, shift: Record<string, any>, targetEmail: string, targetMeetingId: string) {
  // 過去・未来の配置を根拠に共有ZoomアカウントのZAKを取得させない。
  if (!isCurrentShift(shift)) return false;
  if (!shiftHasRequestedZoom(shift, targetEmail, targetMeetingId)) return false;
  if (isTeacherAssignedToShift(user, shift)) return true;
  if (await teacherAssignedToRelatedShift(user, shift)) return true;

  // 理社オンライン授業では、同じ時限の講師・サポート担当が教室間を移動して
  // ホストを引き継ぐ。日付と時限の両方が一致する勤務者にだけ許可する。
  return teacherAssignedToSamePeriod(user, shift);
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
    const adminAccess = isAdminLike(user);
    if (!adminAccess) requireRole(user, ['teacher']);

    const { email, meetingId, shiftId, name } = await request.json();
    const zoomEmail = normalize(email);
    const requestedMeetingId = normalizeMeetingId(meetingId);
    let fallbackStartUrl = '';
    let shiftPasscode = '';
    let authorizedByExplicitShift = false;

    if (shiftId) {
      const shiftDoc = await adminDb().collection('shift_assignments').doc(String(shiftId)).get().catch(() => null);
      const shiftData: Record<string, any> = shiftDoc?.exists ? { id: shiftDoc.id, ...(shiftDoc.data() || {}) } : {};
      // 講師画面に表示された実在の授業で、保存済みのZoom情報と完全に一致する場合は、
      // 担当者以外の講師も代理でホスト開始できる。メールやミーティングIDの差し替えは
      // shiftHasRequestedZoom で拒否し、任意アカウントのZAK取得は許可しない。
      authorizedByExplicitShift = shiftHasRequestedZoom(shiftData, zoomEmail, requestedMeetingId) && (adminAccess || isCurrentShift(shiftData));
      if (!adminAccess && !authorizedByExplicitShift) {
        console.warn('[get-zoom-zak] forbidden explicit shift', {
          uid: user.uid,
          role: user.role,
          shiftId: String(shiftId),
          shiftExists: Boolean(shiftDoc?.exists),
          requestedMeetingId,
          emailMatchesShift: normalize(shiftData.target_signin_address) === zoomEmail,
        });
        return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
      }
      shiftPasscode = normalizePasscode(
        shiftData.target_password || shiftData.meeting_password || shiftData.zoom_password || shiftData.passcode || shiftData.password
      );
      fallbackStartUrl = withPasscode(String(shiftData.start_url || '').trim(), shiftPasscode);
    }

    if (!zoomEmail || !requestedMeetingId) {
      return NextResponse.json({ success: false, error: 'Email and meeting ID are required' }, { status: 400 });
    }

    if (!adminAccess && !authorizedByExplicitShift && !(await teacherCanUseZoomEmail(user, String(email), String(meetingId || ''), String(shiftId || '')))) {
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

    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      if (fallbackStartUrl) {
        return NextResponse.json({ success: true, start_url: fallbackStartUrl, fallback: 'start_url' });
      }
      return NextResponse.json({ success: false, error: 'API Credentials missing' }, { status: 500 });
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
    return jsonError(error);
  }
}
