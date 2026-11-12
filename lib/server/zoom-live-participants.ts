import 'server-only';

/**
 * Zoom の会議に今いる（いた）参加者を読む。
 * まず Dashboard の参加者一覧（dashboard:read:list_meeting_participants:admin が要る）を使い、
 * その権限がアプリにないときは、毎晩のカメラの記録でも使っている参加者の品質情報（QoS）から同じ項目を作る。
 * QoS は1回に10人ずつしか返らないので、最大30ページ（300人分）までにする。Zoom の設定や認証は変えない。
 */

export type LiveParticipant = {
  id?: string;
  user_name?: string;
  email?: string;
  join_time?: string;
  leave_time?: string;
  status?: string;
  camera?: string;
  video_quality?: string;
  audio_quality?: string;
  device?: string;
  device_name?: string;
};

export type LiveParticipantsResult =
  | { ok: true; participants: LiveParticipant[]; source: 'participants' | 'qos' }
  | { ok: false; notLive: boolean; status: number; code?: unknown; message?: string };

const QOS_MAX_PAGES = 30;

const missingScope = (status: number, body: any) =>
  (status === 400 || status === 401 || status === 403) && /scope/i.test(String(body?.message || ''));

async function qosParticipants(token: string, meetingId: string): Promise<LiveParticipantsResult> {
  const participants: LiveParticipant[] = [];
  let nextPageToken = '';
  for (let page = 0; page < QOS_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ type: 'live', page_size: '10', ...(nextPageToken ? { next_page_token: nextPageToken } : {}) });
    const res = await fetch(`https://api.zoom.us/v2/metrics/meetings/${meetingId}/participants/qos?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.status === 404) return { ok: false, notLive: true, status: 404 };
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, notLive: false, status: res.status, code: body?.code, message: String(body?.message || '') };
    (Array.isArray(body.participants) ? body.participants : []).forEach((item: any) => participants.push({
      id: item?.id || item?.participant_uuid,
      user_name: item?.user_name,
      email: item?.email,
      join_time: item?.join_time,
      leave_time: item?.leave_time,
      camera: item?.camera,
      device: item?.device,
      device_name: item?.device_name,
    }));
    nextPageToken = String(body.next_page_token || '');
    if (!nextPageToken) break;
  }
  return { ok: true, participants, source: 'qos' };
}

export async function fetchLiveParticipants(token: string, meetingId: string): Promise<LiveParticipantsResult> {
  const res = await fetch(`https://api.zoom.us/v2/metrics/meetings/${meetingId}/participants?type=live&page_size=300&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return { ok: false, notLive: true, status: 404 };
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, participants: Array.isArray(body.participants) ? body.participants : [], source: 'participants' };
  if (missingScope(res.status, body)) return qosParticipants(token, meetingId);
  return { ok: false, notLive: false, status: res.status, code: body?.code, message: String(body?.message || '') };
}
