import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';
import { TRANSPORT_TYPE_OPTIONS, normalizeTransportStation, transportStationDocId } from '@/lib/transport-fares';

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

const splitAliases = (value: string) => String(value || '')
  .split(/[,、/／|｜\n]/)
  .map(alias => alias.trim())
  .filter(Boolean);

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
      const stationName = pick(row, ['駅名', '停留所名', 'station_name', 'station', 'name']);
      const aliases = splitAliases(pick(row, ['別名', '別名・表記揺れ', 'aliases', 'alias']));
      const line = pick(row, ['路線', 'line', 'rail_name']);
      const stationType = pick(row, ['種別', 'station_type']) || '駅';
      const note = pick(row, ['備考', 'note', 'notes']);

      return {
        index: index + 2,
        transportType,
        stationName,
        stationKey: normalizeTransportStation(stationName),
        aliases: Array.from(new Set(aliases.filter(alias => normalizeTransportStation(alias) !== normalizeTransportStation(stationName)))),
        line,
        stationType,
        note,
        valid: Boolean(transportType && stationName && normalizeTransportStation(stationName)),
      };
    });

    const invalidRows = normalized.filter(row => !row.valid).map(row => row.index);
    const validRows = normalized.filter(row => row.valid);
    if (validRows.length === 0) {
      return Response.json({ ok: false, error: 'no-valid-rows', invalid_rows: invalidRows }, { status: 400 });
    }

    const deleted = replaceAll ? await deleteCollection('transport_stations') : 0;
    const db = adminDb();
    let imported = 0;
    let aliasDocs = 0;

    const docs = validRows.flatMap(row => {
      const names = [row.stationName, ...row.aliases];
      return names.map(name => ({
        docId: transportStationDocId(row.transportType, name),
        payload: {
          transport_type: row.transportType,
          station_name: name,
          station_key: normalizeTransportStation(name),
          canonical_name: row.stationName,
          canonical_key: row.stationKey,
          aliases: row.aliases,
          line: row.line,
          station_type: row.stationType,
          note: row.note,
          is_alias: normalizeTransportStation(name) !== row.stationKey,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: user.uid,
        },
      }));
    });

    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(doc => {
        batch.set(db.collection('transport_stations').doc(doc.docId), doc.payload, { merge: true });
      });
      await batch.commit();
    }

    imported = validRows.length;
    aliasDocs = docs.length - validRows.length;

    return Response.json({
      ok: true,
      imported,
      alias_docs: aliasDocs,
      deleted,
      skipped: invalidRows.length,
      invalid_rows: invalidRows.slice(0, 30),
    });
  } catch (error) {
    return jsonError(error);
  }
}
