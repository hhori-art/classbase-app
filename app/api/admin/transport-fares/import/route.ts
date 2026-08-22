import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';
import { TRANSPORT_TYPE_OPTIONS, normalizeTransportStation, transportFareDocId } from '@/lib/transport-fares';

export const runtime = 'nodejs';

const TRANSPORT_LABEL_TO_VALUE = new Map<string, string>(
  [
    ...TRANSPORT_TYPE_OPTIONS.flatMap(option => [
      [option.value.toLowerCase(), option.value] as [string, string],
      [option.label.toLowerCase(), option.value] as [string, string],
    ]),
    ['jr西日本', 'jr'] as [string, string],
    ['西日本旅客鉄道', 'jr'] as [string, string],
    ['神戸市市営地下鉄', 'kobe_subway'] as [string, string],
    ['神戸市地下鉄', 'kobe_subway'] as [string, string],
    ['市営地下鉄', 'kobe_subway'] as [string, string],
    ['山陽', 'sanyo'] as [string, string],
    ['山陽電鉄', 'sanyo'] as [string, string],
    ['神姫', 'shinki_bus'] as [string, string],
    ['shintetsu_bus', 'shinki_bus'] as [string, string],
    ['神戸市バス', 'kobe_city_bus'] as [string, string],
    ['市バス', 'kobe_city_bus'] as [string, string],
  ],
);

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const normalizeTransportType = (value: string) => {
  const key = String(value || '').trim().toLowerCase();
  return TRANSPORT_LABEL_TO_VALUE.get(key) || key;
};

const normalizeFare = (value: string) => {
  const fare = Number(String(value || '').replace(/[^\d]/g, ''));
  return Number.isFinite(fare) && fare > 0 ? fare : 0;
};

async function deleteCollection(collectionName: string) {
  const db = adminDb();
  let deleted = 0;
  while (true) {
    const snap = await db.collection(collectionName).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  return deleted;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canManageAttendance(user)) throw new Error('forbidden');

    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
    const replaceAll = Boolean(body.replace_all);
    if (rows.length === 0) {
      return Response.json({ ok: false, error: 'rows-required' }, { status: 400 });
    }

    const normalized = rows.map((row, index) => {
      const transportType = normalizeTransportType(pick(row, ['交通機関', '交通機関種別', 'transport_type', 'type']));
      const from = pick(row, ['出発', '出発駅', '出発停留所', 'from', 'from_station']);
      const to = pick(row, ['到着', '到着駅', '到着停留所', 'to', 'to_station']);
      const fare = normalizeFare(pick(row, ['金額', '運賃', '片道運賃', 'fare', 'cost', 'amount']));
      const source = pick(row, ['参照元', '出典', 'source', 'provider']) || '交通費マスタ';
      const note = pick(row, ['備考', 'note', 'notes']);
      const docId = transportFareDocId(transportType, from, to);

      return {
        index: index + 2,
        docId,
        transportType,
        from,
        to,
        fare,
        source,
        note,
        valid: Boolean(transportType && from && to && fare > 0 && normalizeTransportStation(from) && normalizeTransportStation(to)),
      };
    });

    const invalidRows = normalized.filter(row => !row.valid).map(row => row.index);
    const validRows = normalized.filter(row => row.valid);
    if (validRows.length === 0) {
      return Response.json({ ok: false, error: 'no-valid-rows', invalid_rows: invalidRows }, { status: 400 });
    }

    const deleted = replaceAll ? await deleteCollection('transport_fares') : 0;
    const db = adminDb();
    let imported = 0;

    for (let i = 0; i < validRows.length; i += 400) {
      const batch = db.batch();
      validRows.slice(i, i + 400).forEach(row => {
        batch.set(db.collection('transport_fares').doc(row.docId), {
          transport_type: row.transportType,
          from: row.from,
          to: row.to,
          from_key: normalizeTransportStation(row.from),
          to_key: normalizeTransportStation(row.to),
          fare: row.fare,
          source: row.source,
          note: row.note,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: user.uid,
        }, { merge: true });
      });
      await batch.commit();
      imported += validRows.slice(i, i + 400).length;
    }

    return Response.json({
      ok: true,
      imported,
      deleted,
      skipped: invalidRows.length,
      invalid_rows: invalidRows.slice(0, 30),
    });
  } catch (error) {
    return jsonError(error);
  }
}
