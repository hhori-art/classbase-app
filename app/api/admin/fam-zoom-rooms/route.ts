import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { FAM_ROOM_KEY_PATTERN, FAM_ZOOM_ROOMS_COLLECTION, normalizeFamMeetingId } from '@/lib/fam-zoom-start';

export const runtime = 'nodejs';

const clean = (value: unknown) => String(value ?? '').trim();

/** 席URLを開いた人は誰でもホストになるので、教室キーを見て変えられるのはマスターだけ。 */
function requireMaster(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (user.role !== 'master') throw new Error('forbidden');
}

function validRoom(body: Record<string, unknown>) {
  const roomKey = clean(body.room_key);
  const meetingId = normalizeFamMeetingId(body.meeting_id);
  if (!FAM_ROOM_KEY_PATTERN.test(roomKey)) return { error: '教室キーは、英数字・-・_ の4〜100文字にしてください。' };
  if (!/^\d{9,12}$/.test(meetingId)) return { error: 'ミーティングIDは9〜12桁の数字にしてください。' };
  return { roomKey, meetingId, booth: clean(body.booth).slice(0, 40) };
}

/** 登録済みの教室の一覧。 */
export async function GET(request: NextRequest) {
  try {
    requireMaster(await getServerUser(request));
    const snap = await adminDb().collection(FAM_ZOOM_ROOMS_COLLECTION).get();
    const rooms = snap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        room_key: doc.id,
        booth: String(data.booth || ''),
        meeting_id: String(data.meeting_id || ''),
        updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : null,
      };
    }).sort((a, b) => a.booth.localeCompare(b.booth, 'ja') || a.room_key.localeCompare(b.room_key));
    return Response.json({ ok: true, rooms });
  } catch (error) {
    return jsonError(error);
  }
}

/** 教室の追加・変更（教室キーの付け替えを含む）・削除。 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action);
    const rooms = adminDb().collection(FAM_ZOOM_ROOMS_COLLECTION);

    if (action === 'delete') {
      const roomKey = clean(body.room_key);
      if (!FAM_ROOM_KEY_PATTERN.test(roomKey)) return Response.json({ ok: false, error: '教室キーが正しくありません。' }, { status: 400 });
      const snap = await rooms.doc(roomKey).get();
      await rooms.doc(roomKey).delete();
      await writeAuditLog({ actor: user, action: 'fam_zoom_room_delete', target_type: 'fam_zoom_room', target_id: String(snap.data()?.booth || ''), details: { meeting_id: String(snap.data()?.meeting_id || '') } });
      return Response.json({ ok: true });
    }

    if (action === 'save') {
      const room = validRoom(body);
      if ('error' in room) return Response.json({ ok: false, error: room.error }, { status: 400 });
      const originalKey = clean(body.original_key);
      const renamed = Boolean(originalKey) && originalKey !== room.roomKey;
      if ((!originalKey || renamed) && (await rooms.doc(room.roomKey).get()).exists) {
        return Response.json({ ok: false, error: 'この教室キーはすでに使われています。' }, { status: 409 });
      }
      const batch = adminDb().batch();
      batch.set(rooms.doc(room.roomKey), {
        booth: room.booth,
        meeting_id: room.meetingId,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: user.uid,
      }, { merge: true });
      if (renamed && FAM_ROOM_KEY_PATTERN.test(originalKey)) batch.delete(rooms.doc(originalKey));
      await batch.commit();
      // 教室キーは開けばホストになれる値なので、操作ログには残さない。
      await writeAuditLog({
        actor: user,
        action: originalKey ? 'fam_zoom_room_update' : 'fam_zoom_room_create',
        target_type: 'fam_zoom_room',
        target_id: room.booth,
        details: { meeting_id: room.meetingId, room_key_changed: renamed },
      });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: '操作が正しくありません。' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
