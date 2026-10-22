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

function shiftHasRequestedZoom(shift: Record<string, any>, targetEmail: string, targetMeetingId: string) {
  const shiftEmail = normalize(shift.target_signin_address);
  const shiftMeetingId = normalizeMeetingId(shift.target_meeting_id);

  return Boolean(
    shiftEmail && targetEmail && shiftEmail === targetEmail &&
    shiftMeetingId && targetMeetingId && shiftMeetingId === targetMeetingId
  );
}

function shiftAllowsZoomEmail(shift: Record<string, any>, targetEmail: string, targetMeetingId: string) {
  // 過去・未来の配置を根拠に共有ZoomアカウントのZAKを取得させない。
  // 当日の授業でZoom情報が完全一致すれば、担当外の講師（代行・引き継ぎ）も許可する。
  return isCurrentShift(shift) && shiftHasRequestedZoom(shift, targetEmail, targetMeetingId);
}

type ZoomEmailAccess = { allowed: boolean; shift?: Record<string, any> };

async function teacherCanUseZoomEmail(user: any, email: string, meetingId?: string, shiftId?: string): Promise<ZoomEmailAccess> {
  const targetEmail = normalize(email);
  const targetMeetingId = normalizeMeetingId(meetingId);
  if (!targetEmail) return { allowed: false };
  if (normalize(user.email) === targetEmail) return { allowed: true };
  if (profileZoomEmails(user.profile || {}).includes(targetEmail)) return { allowed: true };

  const shiftDoc = shiftId
    ? await adminDb().collection('shift_assignments').doc(String(shiftId)).get().catch(() => null)
    : null;

  if (shiftDoc?.exists) {
    const data = { id: shiftDoc.id, ...(shiftDoc.data() || {}) };
    if (shiftAllowsZoomEmail(data, targetEmail, targetMeetingId)) return { allowed: true, shift: data };
  }

  const snapshots = await Promise.all([
    adminDb().collection('shift_assignments').where('target_signin_address', '==', email).limit(30).get().catch(() => null),
    targetEmail !== email ? adminDb().collection('shift_assignments').where('target_signin_address', '==', targetEmail).limit(30).get().catch(() => null) : Promise.resolve(null),
    targetMeetingId ? adminDb().collection('shift_assignments').where('target_meeting_id', '==', targetMeetingId).limit(30).get().catch(() => null) : Promise.resolve(null),
  ]);

  const docs = snapshots.flatMap(snap => snap?.docs || []);
  for (const doc of docs) {
    const data = { id: doc.id, ...(doc.data() || {}) };
    if (shiftAllowsZoomEmail(data, targetEmail, targetMeetingId)) return { allowed: true, shift: data };
  }

  return { allowed: false };
}

async function recordHostStart(user: any, details: Record<string, unknown>) {
  const entry = {
    uid: user.uid,
    role: user.role,
    teacher_name: String(user.profile?.teacher_name || user.profile?.name || user.profile?.student_name || ''),
    ...details,
  };
  console.log('[get-zoom-zak] host start', entry);
  // 監査ログはベストエフォート。書き込み失敗でホスト開始自体は止めない。
  await adminDb().collection('zoom_host_start_logs').add({
    ...entry,
    created_at: new Date().toISOString(),
  }).catch((error: unknown) => {
    console.error('[get-zoom-zak] failed to write host start log', error instanceof Error ? error.message : String(error));
  });
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
    let hostStartLog: Record<string, unknown> | null = null;

    if (shiftId) {
      const shiftDoc = await adminDb().collection('shift_assignments').doc(String(shiftId)).get().catch(() => null);
      const shiftData: Record<string, any> = shiftDoc?.exists ? { id: shiftDoc.id, ...(shiftDoc.data() || {}) } : {};
      // 講師画面に表示された実在の授業で、保存済みのZoom情報と完全に一致する場合は、
      // 担当者以外の講師（代行・引き継ぎ）もホスト開始できる。メールやミーティングIDの
      // 差し替えは shiftHasRequestedZoom で拒否し、任意アカウントのZAK取得は許可しない。
      // 講師は当日（日本時間）の授業に限る。
      const zoomMatches = shiftHasRequestedZoom(shiftData, zoomEmail, requestedMeetingId);
      const dateAllowed = adminAccess || isCurrentShift(shiftData);
      authorizedByExplicitShift = Boolean(shiftDoc?.exists) && zoomMatches && dateAllowed;
      if (!adminAccess && !authorizedByExplicitShift) {
        console.warn('[get-zoom-zak] forbidden explicit shift', {
          uid: user.uid,
          role: user.role,
          shiftId: String(shiftId),
          shiftExists: Boolean(shiftDoc?.exists),
          shiftDate: shiftData.target_date || null,
          requestedMeetingId,
          emailMatchesShift: normalize(shiftData.target_signin_address) === zoomEmail,
        });
        const reason = !shiftDoc?.exists
          ? '授業が見つかりません。画面を再読み込みしてください。'
          : !zoomMatches
          ? '授業に登録されたZoom情報と一致しません。'
          : '本日の授業のみホスト開始できます。';
        return NextResponse.json({ success: false, error: reason }, { status: 403 });
      }
      if (shiftDoc?.exists) {
        const assignedTeacher = isTeacherAssignedToShift(user, shiftData);
        hostStartLog = {
          shift_id: String(shiftId),
          shift_date: String(shiftData.target_date || ''),
          shift_teacher_id: shiftData.user_id ? String(shiftData.user_id) : null,
          shift_teacher_name: String(shiftData.teacher_name || ''),
          assigned_teacher: assignedTeacher,
          substitute_start: !assignedTeacher,
        };
      }
      shiftPasscode = normalizePasscode(
        shiftData.target_password || shiftData.meeting_password || shiftData.zoom_password || shiftData.passcode || shiftData.password
      );
      fallbackStartUrl = withPasscode(String(shiftData.start_url || '').trim(), shiftPasscode);
    }

    if (!zoomEmail || !requestedMeetingId) {
      return NextResponse.json({ success: false, error: 'Email and meeting ID are required' }, { status: 400 });
    }

    const emailAccess = adminAccess || authorizedByExplicitShift
      ? null
      : await teacherCanUseZoomEmail(user, String(email), String(meetingId || ''), String(shiftId || ''));
    if (emailAccess && !emailAccess.allowed) {
      console.warn('[get-zoom-zak] forbidden', {
        uid: user.uid,
        role: user.role,
        profileName: user.profile?.student_name || user.profile?.name || user.profile?.teacher_name || null,
        shiftId: shiftId || null,
        meetingId: normalizeMeetingId(meetingId),
        zoomEmailDomain: String(email || '').split('@')[1] || null,
      });
      return NextResponse.json({ success: false, error: '本日の授業に登録されたZoom情報が見つからないため、ホスト開始できません。' }, { status: 403 });
    }
    if (!hostStartLog && emailAccess?.shift) {
      const matchedShift = emailAccess.shift;
      const assignedTeacher = isTeacherAssignedToShift(user, matchedShift);
      hostStartLog = {
        shift_id: String(matchedShift.id || ''),
        shift_date: String(matchedShift.target_date || ''),
        shift_teacher_id: matchedShift.user_id ? String(matchedShift.user_id) : null,
        shift_teacher_name: String(matchedShift.teacher_name || ''),
        assigned_teacher: assignedTeacher,
        substitute_start: !assignedTeacher,
      };
    }

    // 誰がどの授業のホスト開始を取得したか（担当者本人か代行か）を記録する。
    await recordHostStart(user, {
      shift_id: shiftId ? String(shiftId) : null,
      meeting_id: requestedMeetingId,
      zoom_email_domain: zoomEmail.split('@')[1] || null,
      authorized_by: adminAccess ? 'admin' : authorizedByExplicitShift ? 'explicit_shift' : 'zoom_email',
      ...(hostStartLog || {}),
    });

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
