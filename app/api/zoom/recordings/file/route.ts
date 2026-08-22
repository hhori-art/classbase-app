import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isAdminLike, jsonError, normalizeRole, type ServerUser } from '@/lib/server-auth';

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

async function resolveZoomFileFromShareUrl(data: FirebaseFirestore.DocumentData, accessToken: string) {
  const startMillis = recordingStartMillisFromShareUrl(data);
  if (!startMillis) return null;

  const meetings = await listRecordingMeetings(
    accessToken,
    dateKeyAround(startMillis, -1),
    dateKeyAround(startMillis, 1),
  );

  const candidates = meetings.flatMap(meeting => {
    const files = Array.isArray(meeting.recording_files) ? meeting.recording_files : [];
    return files
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
          difference: Number.isFinite(fileStart) ? Math.abs(fileStart - startMillis) : Number.MAX_SAFE_INTEGER,
          typeRank: recordingFileTypeRank(file),
        };
      });
  }).sort((a, b) => a.difference - b.difference || a.typeRank - b.typeRank);

  const closestDifference = candidates[0]?.difference ?? Number.MAX_SAFE_INTEGER;
  const matchingWindow = candidates.filter(candidate => candidate.difference <= closestDifference + 5 * 60 * 1000);
  const selected = matchingWindow.sort((a, b) => a.typeRank - b.typeRank || a.difference - b.difference)[0];
  if (!selected || selected.difference > 45 * 60 * 1000) return null;
  return selected;
}

async function resolveRecordingData(request: NextRequest) {
  const db = adminDb();
  const shiftId = request.nextUrl.searchParams.get('shift_id') || '';
  const recordingId = request.nextUrl.searchParams.get('recording_id') || '';
  const user = await getUserFromRequest(request);

  if (shiftId) {
    if (!isAdminLike(user)) throw new Error('forbidden');
    const snap = await db.collection('shift_assignments').doc(shiftId).get();
    if (!snap.exists) throw new Error('recording-source-not-found');
    return snap.data() || {};
  }

  if (recordingId) {
    const snap = await db.collection('class_recordings').doc(recordingId).get();
    if (!snap.exists) throw new Error('recording-source-not-found');
    const data = snap.data() || {};

    if (!selectedDownloadUrl(data) && data.original_shift_id) {
      const shiftSnap = await db.collection('shift_assignments').doc(String(data.original_shift_id)).get();
      if (shiftSnap.exists) {
        const shiftData = shiftSnap.data() || {};
        return {
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

    return data;
  }

  throw new Error('recording_id-or-shift_id-required');
}

async function getUserFromRequest(request: NextRequest): Promise<ServerUser> {
  const authHeader = request.headers.get('authorization') || '';
  const queryToken = request.nextUrl.searchParams.get('token') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!token) throw new Error('missing-token');

  const decoded = await adminAuth().verifyIdToken(token);
  const profileSnap = await adminDb().collection('users').doc(decoded.uid).get();
  if (!profileSnap.exists) throw new Error('profile-not-found');

  const profile = profileSnap.data() || {};
  const schoolIds = Array.isArray(profile.school_ids)
    ? profile.school_ids.filter(Boolean)
    : [profile.school_id, profile.school].filter(Boolean);

  return {
    uid: decoded.uid,
    email: decoded.email,
    role: normalizeRole(profile.role),
    school: profile.school || profile.school_id,
    school_ids: schoolIds,
    profile,
  };
}

export async function GET(request: NextRequest) {
  try {
    const data = await resolveRecordingData(request);
    const accessToken = await zoomAccessToken();
    let downloadUrl = selectedDownloadUrl(data);

    if (!downloadUrl) {
      const resolved = await resolveZoomFileFromShareUrl(data, accessToken);
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
    }

    if (!downloadUrl) throw new Error('zoom-download-url-not-found');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const range = request.headers.get('range');
    if (range) headers.Range = range;

    const zoomRes = await fetch(downloadUrl, {
      headers,
      cache: 'no-store',
    });

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
