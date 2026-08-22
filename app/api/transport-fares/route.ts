import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { lookupBuiltInTransportFare } from '@/lib/transport-fare-rules';
import { cleanFareLabel, normalizeTransportType, transportFareDocId, transportStationDocId } from '@/lib/transport-fares';
import { lookupExternalTransportFare } from '@/lib/transport-fare-providers';

export const runtime = 'nodejs';

type ResolvedTransportStation = {
  input: string;
  canonical: string;
  matched: boolean;
  station_id?: string;
  line?: string;
  station_type?: string;
};

const KOBE_SUBWAY_LINE_BY_STATION: Record<string, string[]> = {
  谷上: ['北神線'],
  新神戸: ['西神・山手線'],
  三宮: ['西神・山手線'],
  県庁前: ['西神・山手線'],
  大倉山: ['西神・山手線'],
  湊川公園: ['西神・山手線'],
  上沢: ['西神・山手線'],
  長田: ['西神・山手線'],
  新長田: ['西神・山手線', '海岸線'],
  板宿: ['西神・山手線'],
  妙法寺: ['西神・山手線'],
  名谷: ['西神・山手線'],
  総合運動公園: ['西神・山手線'],
  学園都市: ['西神・山手線'],
  伊川谷: ['西神・山手線'],
  西神南: ['西神・山手線'],
  西神中央: ['西神・山手線'],
  '三宮・花時計前': ['海岸線'],
  三宮花時計前: ['海岸線'],
  '旧居留地・大丸前': ['海岸線'],
  旧居留地大丸前: ['海岸線'],
  みなと元町: ['海岸線'],
  ハーバーランド: ['海岸線'],
  中央市場前: ['海岸線'],
  和田岬: ['海岸線'],
  御崎公園: ['海岸線'],
  苅藻: ['海岸線'],
  駒ヶ林: ['海岸線'],
};

const splitLines = (value: unknown) =>
  String(value || '')
    .split(/[\/／,、]/)
    .map(line => line.trim())
    .filter(Boolean);

const stationLines = (station: ResolvedTransportStation) => {
  const lines = splitLines(station.line);
  const known = KOBE_SUBWAY_LINE_BY_STATION[station.canonical] || KOBE_SUBWAY_LINE_BY_STATION[station.input] || [];
  return Array.from(new Set([...lines, ...known]));
};

const needsShinNagataVia = (fromStation: ResolvedTransportStation, toStation: ResolvedTransportStation) => {
  const fromLines = stationLines(fromStation);
  const toLines = stationLines(toStation);
  const fromHasKaigan = fromLines.includes('海岸線');
  const toHasKaigan = toLines.includes('海岸線');
  const fromHasSeishin = fromLines.some(line => line === '西神・山手線' || line === '北神線');
  const toHasSeishin = toLines.some(line => line === '西神・山手線' || line === '北神線');
  return (fromHasKaigan && toHasSeishin) || (toHasKaigan && fromHasSeishin);
};

const resolveRouteViaStations = (
  transportType: string,
  fromStation: ResolvedTransportStation,
  toStation: ResolvedTransportStation,
) => {
  if (transportType !== 'kobe_subway') return [];
  if (!needsShinNagataVia(fromStation, toStation)) return [];
  const endpoints = new Set([fromStation.canonical, fromStation.input, toStation.canonical, toStation.input]);
  return endpoints.has('新長田') ? [] : ['新長田'];
};

const activePassStatuses = new Set(['active', 'renewed']);
const todayKey = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function fetchActiveCommuterPasses(teacherId: string, transportType: string) {
  if (!teacherId) return [];
  const snap = await adminDb()
    .collection('teacher_commuter_passes')
    .where('teacher_id', '==', teacherId)
    .limit(10)
    .get();
  const today = todayKey();
  return snap.docs
    .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((pass: any) => {
      const status = String(pass.status || 'active');
      const endDate = String(pass.end_date || '').slice(0, 10);
      return String(pass.transport_type || '') === transportType &&
        activePassStatuses.has(status) &&
        pass.serialize_data &&
        (!endDate || endDate >= today);
    })
    .map((pass: any) => ({
      id: pass.id,
      serializeData: String(pass.serialize_data || ''),
      displayRoute: String(pass.display_route || ''),
    }));
}

async function resolveTransportStation(transportType: string, stationName: string) {
  const snap = await adminDb()
    .collection('transport_stations')
    .doc(transportStationDocId(transportType, stationName))
    .get();

  if (!snap.exists) {
    return {
      input: stationName,
      canonical: stationName,
      matched: false,
    };
  }

  const data = snap.data() || {};
  return {
    input: stationName,
    canonical: String(data.canonical_name || data.station_name || stationName).trim() || stationName,
    matched: true,
    station_id: snap.id,
    line: String(data.line || ''),
    station_type: String(data.station_type || ''),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin', 'admin', 'master']);

    const transportType = normalizeTransportType(request.nextUrl.searchParams.get('transport_type') || '');
    const from = String(request.nextUrl.searchParams.get('from') || '').trim();
    const to = String(request.nextUrl.searchParams.get('to') || '').trim();

    if (!transportType || !from || !to) {
      return Response.json({ ok: false, error: 'missing-params' }, { status: 400 });
    }

    const [fromStation, toStation] = await Promise.all([
      resolveTransportStation(transportType, from),
      resolveTransportStation(transportType, to),
    ]);

    const provider = request.nextUrl.searchParams.get('provider');
    const via = resolveRouteViaStations(transportType, fromStation, toStation);
    const requestedTeacherId = String(request.nextUrl.searchParams.get('teacher_id') || '').trim();
    const commuterPassTeacherId = user.role === 'teacher' || user.role === 'attendance_admin' ? user.uid : requestedTeacherId;
    const commuterPasses = commuterPassTeacherId
      ? await fetchActiveCommuterPasses(commuterPassTeacherId, transportType)
      : [];
    const externalFare = await lookupExternalTransportFare({
      transportType,
      from: fromStation.canonical,
      to: toStation.canonical,
      via,
      commuterPasses,
    }, provider);

    const externalRouteInfo = externalFare && !externalFare.fare ? externalFare : null;
    if (typeof externalFare?.fare === 'number') {
      return Response.json({
        ok: true,
        fare: externalFare.fare,
        transport_type: transportType,
        from,
        to,
        resolved_from: fromStation.canonical,
        resolved_to: toStation.canonical,
        station_match: {
          from: fromStation,
          to: toStation,
        },
        via,
        commuter_pass_applied: commuterPasses.length > 0 && externalFare.source.includes('定期控除'),
        commuter_pass_count: commuterPasses.length,
        source: externalFare.source,
        provider: externalFare.provider,
      });
    }

    const db = adminDb();
    const collectionRef = db.collection('transport_fares');
    const [forwardSnap, reverseSnap] = await Promise.all([
      collectionRef.doc(transportFareDocId(transportType, fromStation.canonical, toStation.canonical)).get(),
      collectionRef.doc(transportFareDocId(transportType, toStation.canonical, fromStation.canonical)).get(),
    ]);

    const matched = forwardSnap.exists ? forwardSnap : reverseSnap.exists ? reverseSnap : null;
    if (!matched) {
      const builtInFare = lookupBuiltInTransportFare({
        transportType,
        from: fromStation.canonical,
        to: toStation.canonical,
        fromStation,
        toStation,
      });

      if (builtInFare) {
        return Response.json({
          ok: true,
          fare: builtInFare.fare,
          transport_type: transportType,
          from,
          to,
          resolved_from: fromStation.canonical,
          resolved_to: toStation.canonical,
          station_match: {
            from: fromStation,
            to: toStation,
          },
          via,
          commuter_pass_applied: false,
          commuter_pass_count: commuterPasses.length,
          source: builtInFare.source,
          provider: builtInFare.provider,
        });
      }

      return Response.json({
        ok: false,
        error: 'fare-not-found',
        message: externalRouteInfo?.message || '登録済みの運賃マスタに該当区間がありません。',
        route_url: externalRouteInfo?.routeUrl,
        via,
        commuter_pass_applied: false,
        commuter_pass_count: commuterPasses.length,
        source: externalRouteInfo?.source,
        provider: externalRouteInfo?.provider,
      }, { status: externalRouteInfo?.routeUrl ? 424 : 404 });
    }

    const data = matched.data() || {};
    const fare = Number(data.fare ?? data.cost ?? data.amount ?? 0);
    if (!Number.isFinite(fare) || fare <= 0) {
      return Response.json({ ok: false, error: 'invalid-fare-master' }, { status: 422 });
    }

    return Response.json({
      ok: true,
      fare,
      transport_type: transportType,
      from,
      to,
      resolved_from: fromStation.canonical,
      resolved_to: toStation.canonical,
      station_match: {
        from: fromStation,
        to: toStation,
      },
      via,
      commuter_pass_applied: false,
      commuter_pass_count: commuterPasses.length,
      source: cleanFareLabel(data.source || data.provider || '運賃マスタ'),
      provider: 'firestore',
      matched_id: matched.id,
    });
  } catch (error) {
    return jsonError(error);
  }
}
