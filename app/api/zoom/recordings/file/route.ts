import { resolveZoomRecordingPlayback } from '@/lib/server/zoom-recording-fetch';
import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isAdminLike, jsonError, normalizeRole, type ServerUser } from '@/lib/server-auth';
import { appendZoomRecordingPasscode, isZoomRecordingShareUrl } from '@/lib/recordings';
import { createHash, randomUUID } from 'node:crypto';
import { canAccessClassRecording } from '@/lib/server/recording-access';
import { normalizeMeetingId } from '@/lib/zoom-recording-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let cachedZoomToken = '';
let cachedZoomTokenExpiresAt = 0;

const zoomAccessToken = async () => {
  if (cachedZoomToken && Date.now() < cachedZoomTokenExpiresAt) return cachedZoomToken;

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) throw new Error('zoom-api-env-missing');

  const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    cache: 'no-store',
  });

  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !data.access_token) {
    throw new Error(`zoom-token-failed:${data.reason || data.message || tokenRes.status}`);
  }
  cachedZoomToken = String(data.access_token);
  cachedZoomTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
  return cachedZoomToken;
};

const fileIdOf = (data: FirebaseFirestore.DocumentData) => String(
  data.zoom_recording_file_id ||
  data.target_recording_file_id ||
  data.recording_file_id ||
  ''
).trim();

const filesOf = (data: FirebaseFirestore.DocumentData) => (
  Array.isArray(data.zoom_recording_files) ? data.zoom_recording_files :
  Array.isArray(data.recording_files) ? data.recording_files :
  []
);

const selectedDownloadUrl = (data: FirebaseFirestore.DocumentData) => {
  const selectedId = fileIdOf(data);
  const files = filesOf(data);
  const selected = files.find((file: any) => String(file.id || file.recording_file_id || '').trim() === selectedId) ||
    files.find((file: any) => String(file.recording_type || '').toLowerCase() === 'shared_screen_with_speaker_view') ||
    files.find((file: any) => String(file.recording_type || '').toLowerCase() === 'active_speaker') ||
    files.find((file: any) => String(file.file_type || file.file_extension || '').toUpperCase() === 'MP4');

  return String(selected?.download_url || data.zoom_download_url || data.recording_download_url || '').trim();
};

const zoomShareUrlOf = (data: FirebaseFirestore.DocumentData) => String(
  data.video_url ||
  data.target_recording_url ||
  data.recording_url ||
  data.url ||
  ''
).trim();

const recordingStartMillisFromShareUrl = (data: FirebaseFirestore.DocumentData) => {
  const match = zoomShareUrlOf(data).match(/[?&]startTime=(\d{10,})/);
  return match ? Number(match[1]) : 0;
};

const dateKeyAround = (millis: number, offsetDays: number) => {
  const date = new Date(millis);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const fetchRecordingMeetings = async (accessToken: string, endpoint: string, from: string, to: string) => {
  const meetings: any[] = [];
  let nextPageToken = '';
  let pages = 0;

  do {
    const url = new URL(endpoint);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('page_size', '100');
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`zoom-recording-list-failed:${body.message || body.reason || response.status}`);

    meetings.push(...(Array.isArray(body.meetings) ? body.meetings : []));
    nextPageToken = String(body.next_page_token || '');
    pages += 1;
  } while (nextPageToken && pages < 5);

  return meetings;
};

const listRecordingMeetings = async (accessToken: string, from: string, to: string) => {
  try {
    return await fetchRecordingMeetings(accessToken, 'https://api.zoom.us/v2/accounts/me/recordings', from, to);
  } catch {
    return fetchRecordingMeetings(accessToken, 'https://api.zoom.us/v2/users/me/recordings', from, to);
  }
};

const recordingFileTypeRank = (file: any) => {
  const type = String(file.recording_type || '').toLowerCase();
  if (type === 'shared_screen_with_speaker_view') return 0;
  if (type === 'active_speaker') return 1;
  if (type.includes('speaker_view')) return 2;
  if (type.includes('shared_screen')) return 3;
  return 4;
};

const meetingIdFromJoinUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || '').trim());
    const match = url.pathname.match(/\/(?:j|wc)\/(\d+)/i);
    return match ? normalizeMeetingId(match[1]) : '';
  } catch {
    return '';
  }
};

const meetingIdOf = (data: FirebaseFirestore.DocumentData) => [
  data.recording_meeting_id,
  data.target_meeting_id,
  data.meeting_id,
  data.zoom_meeting_id,
  data.meetingId,
  data.meetingID,
  data.zoomId,
  data.zoom_id,
  data.target_zoom_id,
  data.targetZoomId,
].map(normalizeMeetingId).find(Boolean) || [
  data.target_meeting_url,
  data.start_url,
  data.join_url,
  data.target_join_url,
  data.target_url,
  data.url,
].map(meetingIdFromJoinUrl).find(Boolean) || '';

const recordingSearchRange = (data: FirebaseFirestore.DocumentData) => {
  const startMillis = recordingStartMillisFromShareUrl(data);
  if (startMillis) {
    return { from: dateKeyAround(startMillis, -1), to: dateKeyAround(startMillis, 1), startMillis };
  }
  const targetDate = String(data.replacement_source_date || data.target_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const noon = new Date(`${targetDate}T12:00:00+09:00`).getTime();
  return { from: dateKeyAround(noon, -1), to: dateKeyAround(noon, 1), startMillis: noon };
};

const recordingVariantKey = (meeting: any, file: any) => [
  String(meeting.uuid || ''),
  String(file.id || file.recording_file_id || ''),
].join('::');

const recordingVariantLabel = (meeting: any, file: any, index: number) => {
  const raw = String(file.recording_start || meeting.start_time || '');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return `録画 ${index + 1}`;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

const zoomShareIdentity = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!isZoomRecordingShareUrl(raw)) return '';
  const url = new URL(raw);
  return url.pathname.replace(/\/+$/, '');
};

const variantsFromMeetings = (meetings: any[], range: { startMillis: number }) => meetings
  .flatMap(meeting => {
    const files = Array.isArray(meeting.recording_files) ? meeting.recording_files : [];
    const candidates = files
      .filter((file: any) => (
        String(file.status || 'completed').toLowerCase() === 'completed' &&
        (String(file.file_type || '').toUpperCase() === 'MP4' || String(file.file_extension || '').toUpperCase() === 'MP4') &&
        file.download_url
      ))
      .map((file: any) => {
        const fileStart = new Date(String(file.recording_start || meeting.start_time || '')).getTime();
        return {
          meeting,
          file,
          difference: Number.isFinite(fileStart) ? Math.abs(fileStart - range.startMillis) : Number.MAX_SAFE_INTEGER,
          typeRank: recordingFileTypeRank(file),
        };
      });
    if (candidates.length === 0) return [];
    return [candidates.sort((a: any, b: any) => a.typeRank - b.typeRank)[0]];
  })
  .sort((a: any, b: any) => a.difference - b.difference || a.typeRank - b.typeRank)
  .map((candidate, index) => ({
    ...candidate,
    variantKey: recordingVariantKey(candidate.meeting, candidate.file),
    label: recordingVariantLabel(candidate.meeting, candidate.file, index),
  }));

async function resolveZoomVariants(data: FirebaseFirestore.DocumentData, accessToken: string, expectedMeetingId: string) {
  if (!expectedMeetingId) throw new Error('recording-meeting-id-required');
  const range = recordingSearchRange(data);
  if (!range) throw new Error('recording-date-required');

  const meetings = await listRecordingMeetings(
    accessToken,
    range.from,
    range.to,
  );

  return variantsFromMeetings(
    meetings.filter(meeting => normalizeMeetingId(meeting.id || meeting.meeting_id) === expectedMeetingId),
    range,
  );
}

async function resolveZoomVariantsByRegisteredShareUrl(data: FirebaseFirestore.DocumentData, accessToken: string) {
  const sourceIdentity = zoomShareIdentity(zoomShareUrlOf(data));
  if (!sourceIdentity) throw new Error('zoom-share-url-not-found');
  const range = recordingSearchRange(data);
  if (!range) throw new Error('recording-date-required');
  const meetings = await listRecordingMeetings(accessToken, range.from, range.to);
  return variantsFromMeetings(
    meetings.filter(meeting => zoomShareIdentity(meeting.share_url) === sourceIdentity),
    range,
  );
}

async function resolveZoomFileFromShareUrl(
  data: FirebaseFirestore.DocumentData,
  accessToken: string,
  expectedMeetingId: string,
  variantKey = '',
) {
  const candidates = await resolveZoomVariants(data, accessToken, expectedMeetingId);
  if (variantKey) return candidates.find(candidate => candidate.variantKey === variantKey) || null;
  const selectedFileId = fileIdOf(data);
  return (selectedFileId
    ? candidates.find(candidate => String(candidate.file.id || candidate.file.recording_file_id || '') === selectedFileId)
    : null) || candidates[0] || null;
}

async function registeredMeetingId(data: FirebaseFirestore.DocumentData) {
  const direct = meetingIdOf(data);
  if (direct) return direct;
  if (data.replacement_source_recording_id) {
    const [sourceSnap] = await adminDb().getAll(
      adminDb().collection('class_recordings').doc(String(data.replacement_source_recording_id)),
    );
    if (sourceSnap.exists) {
      const source = sourceSnap.data() || {};
      const sourceDirect = meetingIdOf(source);
      if (sourceDirect) return sourceDirect;
      if (source.original_shift_id) {
        const [sourceShift] = await adminDb().getAll(
          adminDb().collection('shift_assignments').doc(String(source.original_shift_id)),
        );
        if (sourceShift.exists) return meetingIdOf(sourceShift.data() || {});
      }
    }
  }
  if (!data.original_shift_id) return '';
  const [shiftSnap] = await adminDb().getAll(
    adminDb().collection('shift_assignments').doc(String(data.original_shift_id)),
  );
  return shiftSnap.exists ? meetingIdOf(shiftSnap.data() || {}) : '';
}

async function resolveRecordingData(request: NextRequest) {
  const db = adminDb();
  const shiftId = request.nextUrl.searchParams.get('shift_id') || '';
  const recordingId = request.nextUrl.searchParams.get('recording_id') || '';
  if (Boolean(shiftId) === Boolean(recordingId)) throw new Error('exactly-one-recording-source-required');
  const user = await getUserFromRequest(request);

  if (shiftId) {
    if (!isAdminLike(user)) throw new Error('forbidden');
    const snap = await db.collection('shift_assignments').doc(shiftId).get();
    if (!snap.exists) throw new Error('recording-source-not-found');
    const data = snap.data() || {};
    return { data, expectedMeetingId: meetingIdOf(data) };
  }

  if (recordingId) {
    const snap = await db.collection('class_recordings').doc(recordingId).get();
    if (!snap.exists) throw new Error('recording-source-not-found');
    const data = snap.data() || {};
    if (!canAccessClassRecording(user, data)) throw new Error('forbidden');

    let resolvedData = data;
    if (!selectedDownloadUrl(data) && data.original_shift_id) {
      const shiftSnap = await db.collection('shift_assignments').doc(String(data.original_shift_id)).get();
      if (shiftSnap.exists) {
        const shiftData = shiftSnap.data() || {};
        resolvedData = {
          ...shiftData,
          ...data,
          zoom_recording_files: filesOf(data).length ? filesOf(data) : filesOf(shiftData),
          zoom_recording_file_id: data.zoom_recording_file_id || data.target_recording_file_id || shiftData.target_recording_file_id || '',
          target_recording_file_id: data.target_recording_file_id || data.zoom_recording_file_id || shiftData.target_recording_file_id || '',
          zoom_download_url: data.zoom_download_url || shiftData.zoom_download_url || '',
          recording_download_url: data.recording_download_url || shiftData.recording_download_url || '',
        };
      }
    }

    return { data: resolvedData, expectedMeetingId: await registeredMeetingId(data) };
  }

  throw new Error('recording_id-or-shift_id-required');
}

const playbackSecretRef = (request: NextRequest) => {
  const shiftId = request.nextUrl.searchParams.get('shift_id') || '';
  const recordingId = request.nextUrl.searchParams.get('recording_id') || '';
  const variantKey = request.nextUrl.searchParams.get('variant_key') || '';
  const variantDigest = createHash('sha256').update(variantKey || 'default').digest('hex').slice(0, 20);
  const secretId = `${recordingId ? `recording_${recordingId}` : `shift_${shiftId}`}_${variantDigest}`;
  return adminDb().collection('recording_playback_secrets').doc(secretId);
};

async function resolveZoomShareRedirect(request: NextRequest, data: FirebaseFirestore.DocumentData, accessToken: string, expectedMeetingId: string) {
  const sourceUrl = zoomShareUrlOf(data);
  if (!isZoomRecordingShareUrl(sourceUrl)) throw new Error('zoom-share-url-not-found');
  const variantKey = request.nextUrl.searchParams.get('variant_key') || '';
  if (!expectedMeetingId) {
    const sourceHasEmbeddedPasscode = new URL(sourceUrl).searchParams.has('pwd');
    if (variantKey === 'registered-source' && sourceHasEmbeddedPasscode) {
      return sourceUrl;
    }
    if (variantKey === 'registered-source') throw new Error('recording-passcode-not-found');
  }

  const secretRef = playbackSecretRef(request);
  const secretSnap = await secretRef.get();
  const secret = secretSnap.data() || {};
  const cachedAt = Date.parse(String(secret.updated_at || ''));
  const cachedSecretMatches = Number.isFinite(cachedAt) && Date.now() - cachedAt < 5 * 60 * 1000 &&
    String(secret.source_url || '') === sourceUrl &&
    normalizeMeetingId(secret.meeting_id) === expectedMeetingId &&
    String(secret.variant_key || '') === variantKey;
  let shareUrl = cachedSecretMatches ? String(secret.share_url || '').trim() : '';
  let passcode = cachedSecretMatches ? String(secret.play_passcode || '').trim() : '';

  if (!shareUrl || (!passcode && !new URL(shareUrl).searchParams.has('pwd'))) {
    const resolved = expectedMeetingId
      ? await resolveZoomFileFromShareUrl(data, accessToken, expectedMeetingId, variantKey)
      : (await resolveZoomVariantsByRegisteredShareUrl(data, accessToken))
        .find(candidate => candidate.variantKey === variantKey) || null;
    if (!resolved) throw new Error('registered-recording-not-found');
    shareUrl = String(resolved.meeting.share_url || resolved.file.play_url || '').trim();
    passcode = String(resolved.meeting.recording_play_passcode || '').trim();
    if (!isZoomRecordingShareUrl(shareUrl)) throw new Error('zoom-share-url-not-found');
    await secretRef.set({
      source_url: sourceUrl,
      share_url: shareUrl,
      play_passcode: passcode,
      meeting_id: expectedMeetingId,
      meeting_uuid: String(resolved.meeting.uuid || ''),
      recording_file_id: String(resolved.file.id || resolved.file.recording_file_id || ''),
      // ドキュメントIDは要求された variant_key から作るため、キャッシュ照合も要求値で行う。
      variant_key: variantKey,
      resolved_variant_key: resolved.variantKey,
      updated_at: new Date().toISOString(),
    }, { merge: false });
  }

  return appendZoomRecordingPasscode(shareUrl, passcode);
}

async function getUserFromRequest(request: NextRequest): Promise<ServerUser> {
  const authHeader = request.headers.get('authorization') || '';
  const queryToken = request.nextUrl.searchParams.get('token') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  let uid = '';
  let email: string | undefined;

  if (token) {
    const decoded = await adminAuth().verifyIdToken(token, true);
    uid = decoded.uid;
    email = decoded.email;
  } else {
    const ticket = request.nextUrl.searchParams.get('ticket') || '';
    if (!ticket) throw new Error('missing-token');
    const ticketRef = adminDb().collection('recording_playback_sessions').doc(ticket);
    const requestedRecordingId = request.nextUrl.searchParams.get('recording_id') || '';
    const requestedShiftId = request.nextUrl.searchParams.get('shift_id') || '';
    const requestedVariantKey = request.nextUrl.searchParams.get('variant_key') || '';
    const requestedMode = request.nextUrl.searchParams.get('mode') || '';
    const session = await adminDb().runTransaction(async transaction => {
      const ticketSnap = await transaction.get(ticketRef);
      const value = ticketSnap.data() || {};
      if (
        !ticketSnap.exists ||
        Number(value.expires_at || 0) < Date.now() ||
        String(value.recording_id || '') !== requestedRecordingId ||
        String(value.shift_id || '') !== requestedShiftId ||
        String(value.variant_key || '') !== requestedVariantKey ||
        String(value.mode || '') !== requestedMode
      ) throw new Error('invalid-playback-ticket');
      transaction.delete(ticketRef);
      return value;
    });
    uid = String(session.uid || '');
  }

  const profileSnap = await adminDb().collection('users').doc(uid).get();
  if (!profileSnap.exists) throw new Error('profile-not-found');

  const profile = profileSnap.data() || {};
  if (['suspended', 'withdrawn', 'archived'].some(status =>
    profile.account_status === status || profile.status === status)) throw new Error('forbidden');
  const schoolIds = Array.isArray(profile.school_ids)
    ? profile.school_ids.filter(Boolean)
    : [profile.school_id, profile.school].filter(Boolean);

  return {
    uid,
    email,
    role: normalizeRole(profile.role),
    school: profile.school || profile.school_id,
    school_ids: schoolIds,
    profile,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const recordingId = String(body.recording_id || '').trim();
    const shiftId = String(body.shift_id || '').trim();
    if (Boolean(recordingId) === Boolean(shiftId)) throw new Error('exactly-one-recording-source-required');
    if (shiftId && !isAdminLike(user)) throw new Error('forbidden');

    const sourceRef = recordingId
      ? adminDb().collection('class_recordings').doc(recordingId)
      : adminDb().collection('shift_assignments').doc(shiftId);
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists) throw new Error('recording-source-not-found');
    const sourceData = sourceSnapshot.data() || {};
    if (recordingId && !canAccessClassRecording(user, sourceData)) throw new Error('forbidden');

    const expectedMeetingId = recordingId ? await registeredMeetingId(sourceData) : meetingIdOf(sourceData);
    const sourceUrl = zoomShareUrlOf(sourceData);
    const sourceHasEmbeddedPasscode = isZoomRecordingShareUrl(sourceUrl) && new URL(sourceUrl).searchParams.has('pwd');
    const variants = expectedMeetingId
      ? await resolveZoomVariants(sourceData, await zoomAccessToken(), expectedMeetingId)
      : sourceHasEmbeddedPasscode
        ? [{
          meeting: { uuid: '', share_url: sourceUrl },
          file: { id: '' },
          variantKey: 'registered-source',
          label: '登録済み録画',
        }]
        : isZoomRecordingShareUrl(sourceUrl)
          ? await resolveZoomVariantsByRegisteredShareUrl(sourceData, await zoomAccessToken())
          : [];
    if (!expectedMeetingId && variants.length === 0) throw new Error('recording-meeting-id-required');
    if (variants.length === 0) throw new Error('registered-recording-not-found');

    const playbackOptions = await Promise.all(variants.map(async variant => {
      const ticket = randomUUID();
      await adminDb().collection('recording_playback_sessions').doc(ticket).set({
        uid: user.uid,
        recording_id: recordingId,
        shift_id: shiftId,
        meeting_id: expectedMeetingId,
        meeting_uuid: String(variant.meeting.uuid || ''),
        recording_file_id: String(variant.file.id || variant.file.recording_file_id || ''),
        variant_key: variant.variantKey,
        mode: 'share',
        expires_at: Date.now() + 10 * 60 * 1000,
        created_at: new Date().toISOString(),
      });
      const params = new URLSearchParams({ mode: 'share', ticket, variant_key: variant.variantKey });
      if (recordingId) params.set('recording_id', recordingId);
      if (shiftId) params.set('shift_id', shiftId);
      return {
        key: variant.variantKey,
        label: variant.label,
        playback_url: `/api/zoom/recordings/file?${params.toString()}`,
      };
    }));
    return Response.json({
      ok: true,
      playback_url: playbackOptions[0].playback_url,
      playback_options: playbackOptions,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { data, expectedMeetingId } = await resolveRecordingData(request);
    const sourceUrl = zoomShareUrlOf(data);
    if (sourceUrl && !isZoomRecordingShareUrl(sourceUrl) && !selectedDownloadUrl(data)) {
      let externalUrl: URL | null = null;
      try { externalUrl = new URL(sourceUrl); } catch { externalUrl = null; }
      if (externalUrl?.protocol === 'https:') {
        return new Response(null, {
          status: 307,
          headers: { Location: externalUrl.toString(), 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
        });
      }
      // 会議IDと日付があれば、下のZoom APIによる解決に進む。
      if (!expectedMeetingId) throw new Error('invalid-recording-url');
    }
    if (request.nextUrl.searchParams.get('mode') === 'share') {
      const sourceHasEmbeddedPasscode = isZoomRecordingShareUrl(sourceUrl) && new URL(sourceUrl).searchParams.has('pwd');
      const redirectUrl = await resolveZoomShareRedirect(
        request,
        data,
        expectedMeetingId || !sourceHasEmbeddedPasscode ? await zoomAccessToken() : '',
        expectedMeetingId,
      );
      return new Response(null, {
        status: 307,
        headers: {
          Location: redirectUrl,
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    const variantKey = request.nextUrl.searchParams.get('variant_key') || '';
    // 前回解決済みのURLがあればそれを使い、シーク（Range要求）ごとの
    // Zoom録画一覧APIの呼び出しを避ける。別バリアント指定時は再解決する。
    let downloadUrl = expectedMeetingId && !variantKey ? selectedDownloadUrl(data) : '';
    if (expectedMeetingId && !downloadUrl) {
      const accessToken = await zoomAccessToken();
      const resolved = await resolveZoomFileFromShareUrl(data, accessToken, expectedMeetingId, variantKey);
      if (resolved) {
        downloadUrl = String(resolved.file.download_url || '').trim();
        const recordingId = request.nextUrl.searchParams.get('recording_id') || '';
        if (recordingId) {
          const meetingFiles = Array.isArray(resolved.meeting.recording_files) ? resolved.meeting.recording_files : [];
          await adminDb().collection('class_recordings').doc(recordingId).set({
            zoom_recording_file_id: String(resolved.file.id || ''),
            target_recording_file_id: String(resolved.file.id || ''),
            zoom_recording_files: meetingFiles,
            zoom_download_url: downloadUrl,
            recording_download_url: downloadUrl,
            zoom_meeting_uuid: String(resolved.meeting.uuid || ''),
            playback_resolved_at: new Date().toISOString(),
          }, { merge: true });
        }
      }
    } else if (selectedDownloadUrl(data)) {
      throw new Error('recording-meeting-id-required');
    }

    if (!downloadUrl) throw new Error('zoom-download-url-not-found');

    const accessToken = await zoomAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const range = request.headers.get('range');
    if (range) headers.Range = range;

    const playback = await resolveZoomRecordingPlayback(downloadUrl, headers);
    if (playback.kind === 'redirect') {
      return new Response(null, {
        status: 307,
        headers: {
          Location: playback.redirectUrl,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const zoomRes = playback.response;

    if (!zoomRes.ok && zoomRes.status !== 206) {
      const text = await zoomRes.text().catch(() => '');
      throw new Error(`zoom-file-fetch-failed:${zoomRes.status}:${text.slice(0, 120)}`);
    }

    const responseHeaders = new Headers();
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ];
    passthroughHeaders.forEach(key => {
      const value = zoomRes.headers.get(key);
      if (value) responseHeaders.set(key, value);
    });
    const zoomContentType = String(zoomRes.headers.get('content-type') || '').toLowerCase();
    if (!zoomContentType || zoomContentType.includes('octet-stream')) {
      responseHeaders.set('content-type', 'video/mp4');
    }
    responseHeaders.set('cache-control', 'private, no-store');
    responseHeaders.set('content-disposition', 'inline');

    return new Response(zoomRes.body, {
      status: zoomRes.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonError(error);
  }
}
