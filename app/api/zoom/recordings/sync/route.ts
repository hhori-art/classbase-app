import { NextRequest } from 'next/server';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { attachRecordingsToBestShifts, recordingShareUrl, speakerViewFile } from '@/lib/zoom-recording-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const dateBefore = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next.toISOString().slice(0, 10);
};

const zoomAccessToken = async () => {
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
  return String(data.access_token);
};

const fetchRecordingsPage = async (accessToken: string, endpoint: string, from: string, to: string, nextPageToken: string) => {
  const url = new URL(endpoint);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('page_size', '100');
  if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
};

const listRecordingsFromEndpoint = async (accessToken: string, endpoint: string, from: string, to: string, maxMeetings: number) => {
  const meetings: any[] = [];
  let nextPageToken = '';
  let pageCount = 0;
  let truncated = false;

  do {
    pageCount += 1;
    const { res, data } = await fetchRecordingsPage(accessToken, endpoint, from, to, nextPageToken);
    if (!res.ok) throw new Error(`zoom-recordings-failed:${data.message || data.reason || res.status}`);

    meetings.push(...(Array.isArray(data.meetings) ? data.meetings : []));
    nextPageToken = String(data.next_page_token || '');
    if (meetings.length >= maxMeetings) {
      truncated = Boolean(nextPageToken);
      meetings.length = maxMeetings;
      break;
    }
  } while (nextPageToken && pageCount < 8);

  if (nextPageToken && pageCount >= 8) truncated = true;
  return { meetings, pageCount, truncated };
};

const listRecordings = async (accessToken: string, from: string, to: string, maxMeetings: number) => {
  try {
    const result = await listRecordingsFromEndpoint(accessToken, 'https://api.zoom.us/v2/accounts/me/recordings', from, to, maxMeetings);
    return { ...result, scope: 'account' };
  } catch (accountError: any) {
    const result = await listRecordingsFromEndpoint(accessToken, 'https://api.zoom.us/v2/users/me/recordings', from, to, maxMeetings);
    return { ...result, scope: 'user', account_error: accountError?.message || String(accountError) };
  }
};

const runRecordingSync = async (input: Record<string, unknown>, source: string) => {
  const today = new Date();
  const days = Math.min(30, Math.max(1, Number(input.days || 14)));
  const maxMeetings = Math.min(300, Math.max(20, Number(input.max_meetings || 180)));
  const from = String(input.from || input.start_date || dateBefore(today, days)).slice(0, 10);
  const to = String(input.to || input.end_date || today.toISOString().slice(0, 10)).slice(0, 10);

  const accessToken = await zoomAccessToken();
  const recordingResult = await listRecordings(accessToken, from, to, maxMeetings);
  const meetings = recordingResult.meetings;
  const eligibleMeetings = meetings.filter(meeting => speakerViewFile(meeting) && recordingShareUrl(meeting));
  const syncResult = await attachRecordingsToBestShifts(eligibleMeetings, source);

  let matched = 0;
  let updated = 0;
  let skipped = meetings.length - eligibleMeetings.length;
  const reasonCounts: Record<string, number> = {};
  for (const result of syncResult.results) {
    if (!result.best) {
      skipped += 1;
      const reason = String(('reason' in result ? result.reason : '') || 'no-matching-shift');
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      continue;
    }

    matched += 1;
    if (result.updated) {
      updated += 1;
    } else {
      skipped += 1;
      const reason = String(('reason' in result ? result.reason : '') || 'not-updated');
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  return {
    ok: true,
    source,
    from,
    to,
    scope: recordingResult.scope,
    account_error: 'account_error' in recordingResult ? recordingResult.account_error || null : null,
    meetings: meetings.length,
    eligible: eligibleMeetings.length,
    matched,
    updated,
    skipped,
    truncated: recordingResult.truncated,
    page_count: recordingResult.pageCount,
    prefetched_dates: syncResult.prefetched_dates,
    prefetched_shift_keys: syncResult.prefetched_shift_keys,
    reason_counts: reasonCounts,
  };
};

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const result = await runRecordingSync({
      days: params.get('days') || 3,
      max_meetings: params.get('max_meetings') || 100,
      from: params.get('from') || '',
      to: params.get('to') || '',
    }, 'zoom_daily_cron');
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const body = await request.json().catch(() => ({}));
    const result = await runRecordingSync(body, 'zoom_api_sync');
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
