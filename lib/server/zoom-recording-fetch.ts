import 'server-only';

export function trustedZoomRecordingUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') ||
      !['zoom.us', 'zoom.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error('untrusted-zoom-download-url');
  }
  return url;
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * Exchange the OAuth-protected Zoom download URL for Zoom's short-lived signed
 * playback URL. Returning that URL to the video element keeps a large MP4 out
 * of the serverless function, whose execution limit is shorter than a lesson.
 */
export async function resolveZoomRecordingPlayback(
  raw: string,
  headers: Record<string, string>,
): Promise<{ kind: 'redirect'; redirectUrl: string } | { kind: 'response'; response: Response }> {
  const url = trustedZoomRecordingUrl(raw);
  const response = await fetch(url, { headers, cache: 'no-store', redirect: 'manual' });
  if (!REDIRECT_STATUSES.includes(response.status)) return { kind: 'response', response };

  const location = response.headers.get('location');
  await response.body?.cancel();
  if (!location) throw new Error('zoom-download-redirect-missing');

  // Zoom currently redirects recording downloads to a signed *.zoom.us URL.
  // Keep validating the destination so a stored URL cannot turn this endpoint
  // into an open redirect or leak a user to an unrelated host.
  return {
    kind: 'redirect',
    redirectUrl: trustedZoomRecordingUrl(new URL(location, url).toString()).toString(),
  };
}

// Validate every hop before forwarding a server credential or issuing a request.
export async function fetchZoomRecording(raw: string, headers: Record<string, string>) {
  let url = trustedZoomRecordingUrl(raw);
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(url, { headers, cache: 'no-store', redirect: 'manual' });
    if (!REDIRECT_STATUSES.includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('zoom-download-redirect-missing');
    url = trustedZoomRecordingUrl(new URL(location, url).toString());
  }
  throw new Error('zoom-download-too-many-redirects');
}
