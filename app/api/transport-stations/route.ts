import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { normalizeTransportStation, normalizeTransportType } from '@/lib/transport-fares';

export const runtime = 'nodejs';

type StationCandidate = {
  name: string;
  canonical_name: string;
  line?: string;
  station_type?: string;
  source: 'station_master' | 'fare_master' | 'ekispert';
};

const splitLines = (value: unknown) => String(value || '')
  .split(/[\/／,、]/)
  .map(line => line.trim())
  .filter(Boolean);

const matchesLine = (lineValue: unknown, filterLine: string) => {
  if (!filterLine) return true;
  return splitLines(lineValue).includes(filterLine);
};

const pushCandidate = (
  map: Map<string, StationCandidate>,
  candidate: StationCandidate,
) => {
  const canonical = candidate.canonical_name || candidate.name;
  const key = normalizeTransportStation(canonical);
  if (!key) return;
  const existing = map.get(key);
  if (existing?.source === 'station_master') return;
  map.set(key, {
    ...candidate,
    name: candidate.name || canonical,
    canonical_name: canonical,
  });
};

const asArray = <T,>(value: T | T[] | null | undefined): T[] => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

const stationTypeLabel = (value: unknown) => {
  if (typeof value === 'string') return value === 'train' ? '鉄道' : value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const type = String(record.text || record.Name || record.type || '').trim();
  const detail = String(record.detail || '').trim();
  return [type === 'train' ? '鉄道' : type, detail].filter(Boolean).join(' / ');
};

async function lookupEkispertStations(query: string): Promise<StationCandidate[]> {
  const key = process.env.EKISPERT_API_KEY || process.env.EKISPERT_ACCESS_KEY;
  if (!key || !query) return [];

  const baseUrl = process.env.EKISPERT_BASE_URL || 'https://api.ekispert.jp/v1/json';
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/station/light`);
  url.searchParams.set('key', key);
  url.searchParams.set('name', query);
  url.searchParams.set('nameMatchType', 'partial');
  url.searchParams.set('type', 'train');
  url.searchParams.set('prefectureCode', process.env.EKISPERT_STATION_PREFECTURE_CODES || '28');

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return [];

  const payload = await res.json().catch(() => null);
  return asArray(payload?.ResultSet?.Point)
    .map((point: any) => {
      const station = point?.Station || {};
      const name = String(station.Name || '').trim();
      if (!name) return null;
      const prefecture = String(point?.Prefecture?.Name || '').trim();
      return {
        name,
        canonical_name: name,
        line: prefecture ? `駅すぱあとAPI / ${prefecture}` : '駅すぱあとAPI',
        station_type: stationTypeLabel(station.Type),
        source: 'ekispert' as const,
      };
    })
    .filter(Boolean) as StationCandidate[];
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin', 'admin', 'master']);

    const transportType = normalizeTransportType(request.nextUrl.searchParams.get('transport_type') || '');
    const q = normalizeTransportStation(request.nextUrl.searchParams.get('q') || '');
    const lineFilter = String(request.nextUrl.searchParams.get('line') || '').trim();
    if (!transportType) {
      return Response.json({ ok: false, error: 'transport-type-required' }, { status: 400 });
    }

    const db = adminDb();
    const candidates = new Map<string, StationCandidate>();
    const lineSet = new Set<string>();
    const [stationSnap, fareSnap] = await Promise.all([
      db.collection('transport_stations').where('transport_type', '==', transportType).limit(1200).get(),
      db.collection('transport_fares').where('transport_type', '==', transportType).limit(1200).get(),
    ]);

    stationSnap.docs.forEach(doc => {
      const data = doc.data() || {};
      const stationName = String(data.station_name || '').trim();
      const canonicalName = String(data.canonical_name || stationName).trim();
      const line = String(data.line || '');
      const aliases = Array.isArray(data.aliases) ? data.aliases.map(value => String(value || '')) : [];
      splitLines(line).forEach(item => lineSet.add(item));
      if (!matchesLine(line, lineFilter)) return;
      const searchable = [
        stationName,
        canonicalName,
        data.station_key,
        data.canonical_key,
        ...aliases,
      ].map(normalizeTransportStation);

      if (q && !searchable.some(value => value.includes(q))) return;

      pushCandidate(candidates, {
        name: stationName || canonicalName,
        canonical_name: canonicalName,
        line,
        station_type: String(data.station_type || ''),
        source: 'station_master',
      });
    });

    if (!lineFilter) {
      fareSnap.docs.forEach(doc => {
        const data = doc.data() || {};
        [data.from, data.to].forEach(value => {
          const name = String(value || '').trim();
          if (!name) return;
          if (q && !normalizeTransportStation(name).includes(q)) return;
          pushCandidate(candidates, {
            name,
            canonical_name: name,
            source: 'fare_master',
          });
        });
      });
    }

    if (q) {
      const externalStations = await lookupEkispertStations(request.nextUrl.searchParams.get('q') || '');
      externalStations.forEach(station => pushCandidate(candidates, station));
    }

    const stations = Array.from(candidates.values())
      .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'ja'))
      .slice(0, 300);

    return Response.json({
      ok: true,
      stations,
      lines: Array.from(lineSet).sort((a, b) => a.localeCompare(b, 'ja')),
      count: stations.length,
    });
  } catch (error) {
    return jsonError(error);
  }
}
