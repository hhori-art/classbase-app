import { cleanFareLabel } from '@/lib/transport-fares';

export type FareLookupInput = {
  transportType: string;
  from: string;
  to: string;
  via?: string[];
  commuterPasses?: Array<{
    id?: string;
    serializeData?: string;
    displayRoute?: string;
  }>;
};

export type FareLookupResult = {
  fare?: number;
  source: string;
  provider: 'navitime' | 'ekispert';
  routeUrl?: string;
  message?: string;
  raw?: unknown;
};

type ProviderName = 'navitime' | 'ekispert';

const EKISPERT_COMPANY_BIND_BY_TRANSPORT: Record<string, string[]> = {
  kobe_subway: ['神戸市交通局', '神戸市営地下鉄', '神戸市地下鉄'],
  jr: ['JR西日本', '西日本旅客鉄道'],
  hankyu: ['阪急電鉄', '阪急'],
  hanshin: ['阪神電気鉄道', '阪神'],
  sanyo: ['山陽電気鉄道', '山陽電車'],
  kobe_dentetsu: ['神戸電鉄'],
  port_liner: ['神戸新交通'],
  rokko_liner: ['神戸新交通'],
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

const yenNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const numeric = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const findFareByKey = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const keys = [
    'fare',
    'fareAmount',
    'fare_amount',
    'totalFare',
    'total_fare',
    'travelCost',
    'travel_cost',
    'transportFare',
    'transport_fare',
    'amount',
    'cost',
    'price',
  ];

  for (const key of keys) {
    const found = yenNumber(record[key]);
    if (found !== null) return found;
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findFareByKey(item);
        if (found !== null) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findFareByKey(child);
      if (found !== null) return found;
    }
  }

  return null;
};

const extractEkispertFare = (payload: any): number | null => {
  const courses = asArray(payload?.ResultSet?.Course);
  for (const course of courses) {
    const prices = asArray(course?.Price);
    const summary = prices.find((price: any) =>
      String(price?.kind || '').toLowerCase().includes('summary') &&
      String(price?.selected ?? 'true') !== 'false'
    );
    const fareSummary = prices.find((price: any) => String(price?.kind || '') === 'FareSummary');
    const fare = prices.find((price: any) =>
      String(price?.kind || '') === 'Fare' &&
      String(price?.selected ?? 'true') !== 'false'
    );
    const candidates = [summary, fareSummary, fare, ...prices].filter(Boolean);
    for (const candidate of candidates) {
      const amount =
        yenNumber(candidate?.Oneway) ??
        yenNumber(candidate?.oneway) ??
        findFareByKey(candidate);
      if (amount !== null) return amount;
    }
  }
  return null;
};

const extractEkispertTeiki = (payload: any) => {
  const course = asArray(payload?.ResultSet?.Course)[0] as any;
  const teiki = course?.Teiki || {};
  const serializeData = teiki?.SerializeData;
  const displayRoute = teiki?.DisplayRoute;
  return {
    serializeData: typeof serializeData === 'string' ? serializeData : '',
    displayRoute: typeof displayRoute === 'string' ? displayRoute : '',
  };
};

const extractEkispertRouteUrl = (payload: any): string | null => {
  const url = payload?.ResultSet?.ResourceURI;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
};

const ekispertStationCode = (payload: any): string | null => {
  const point = asArray(payload?.ResultSet?.Point)[0] as any;
  const station = point?.Station || {};
  const code = station.code || station.Code;
  return code ? String(code) : null;
};

const ekispertRouteFallback = (input: FareLookupInput, message?: string): FareLookupResult => ({
  provider: 'ekispert',
  source: cleanFareLabel('駅すぱあと確認リンク'),
  message: message || `自動で金額を取得できませんでした。${input.from} から ${input.to} の金額を手入力してください。`,
});

const stationSearchNames = (stationName: string, transportType: string) => {
  const cleanName = stationName.trim().replace(/駅$/g, '');
  const names = [cleanName, stationName.trim()];
  if (transportType === 'kobe_subway') {
    names.push(`地下鉄${cleanName}`, `神戸市営地下鉄${cleanName}`);
  }
  return Array.from(new Set(names.filter(Boolean)));
};

async function resolveEkispertStationCode(
  root: string,
  key: string,
  transportType: string,
  stationName: string,
): Promise<string | null> {
  const corporationCandidates = EKISPERT_COMPANY_BIND_BY_TRANSPORT[transportType] || [];
  const companyQueries = [...corporationCandidates, ''];

  for (const name of stationSearchNames(stationName, transportType)) {
    for (const corporationBind of companyQueries) {
      const url = new URL(`${root}/station/light`);
      url.searchParams.set('key', key);
      url.searchParams.set('name', name);
      url.searchParams.set('nameMatchType', 'exact');
      url.searchParams.set('type', 'train');
      url.searchParams.set('prefectureCode', process.env.EKISPERT_STATION_PREFECTURE_CODES || '28');
      if (corporationBind) url.searchParams.set('corporationBind', corporationBind);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      const code = ekispertStationCode(payload);
      if (code) return code;
    }
  }

  return null;
}

async function lookupEkispertFare(input: FareLookupInput): Promise<FareLookupResult | null> {
  const key = process.env.EKISPERT_API_KEY || process.env.EKISPERT_ACCESS_KEY;
  if (!key) return ekispertRouteFallback(input, '駅すぱあとAPIキーが未設定です。確認リンクで運賃を確認して金額を入力してください。');

  const baseUrl = process.env.EKISPERT_BASE_URL || 'https://api.ekispert.jp/v1/json';
  const root = baseUrl.replace(/\/$/, '');
  const [fromCode, toCode, ...viaCodes] = await Promise.all([
    resolveEkispertStationCode(root, key, input.transportType, input.from),
    resolveEkispertStationCode(root, key, input.transportType, input.to),
    ...(input.via || []).map(station => resolveEkispertStationCode(root, key, input.transportType, station)),
  ]);
  const viaNames = input.via || [];
  const resolvedViaList = [fromCode, ...viaCodes, toCode].filter(Boolean).join(':');
  const fallbackViaList = [input.from, ...viaNames, input.to].filter(Boolean).join(':');
  const viaList = fromCode && toCode ? resolvedViaList : fallbackViaList;

  const extremeUrl = new URL(`${root}/search/course/extreme`);
  extremeUrl.searchParams.set('key', key);
  extremeUrl.searchParams.set('viaList', viaList);
  extremeUrl.searchParams.set('searchType', 'plain');
  extremeUrl.searchParams.set('sort', 'price');
  extremeUrl.searchParams.set('answerCount', '1');
  extremeUrl.searchParams.set('searchCount', '1');
  const assignTeikiSerializeData = input.commuterPasses
    ?.map(pass => pass.serializeData)
    .filter(Boolean)
    .join(':');
  if (assignTeikiSerializeData) {
    extremeUrl.searchParams.set('assignTeikiSerializeData', assignTeikiSerializeData);
    extremeUrl.searchParams.set('addAssignStatus', 'true');
    extremeUrl.searchParams.set('checkEngineVersion', 'false');
  }

  const extremeRes = await fetch(extremeUrl.toString(), { cache: 'no-store' });
  if (extremeRes.ok) {
    const payload = await extremeRes.json().catch(() => null);
    const fare = extractEkispertFare(payload);
    if (fare !== null) {
      return {
        fare,
        provider: 'ekispert',
        source: cleanFareLabel(assignTeikiSerializeData ? '駅すぱあと API 定期控除後' : '駅すぱあと API'),
        raw: payload?.ResultSet?.Course ? undefined : payload,
      };
    }
  }

  const lightUrl = new URL(`${root}/search/course/light`);
  lightUrl.searchParams.set('key', key);
  lightUrl.searchParams.set('from', fromCode || input.from);
  lightUrl.searchParams.set('to', toCode || input.to);
  const lightVia = viaCodes.filter(Boolean).join(':') || viaNames.join(':');
  if (lightVia) lightUrl.searchParams.set('via', lightVia);
  lightUrl.searchParams.set('plane', 'false');
  lightUrl.searchParams.set('shinkansen', 'false');
  lightUrl.searchParams.set('limitedExpress', 'false');
  lightUrl.searchParams.set('contentsMode', 'pc');

  const lightRes = await fetch(lightUrl.toString(), { cache: 'no-store' });
  if (!lightRes.ok) return ekispertRouteFallback(input);
  const lightPayload = await lightRes.json().catch(() => null);
  const routeUrl = extractEkispertRouteUrl(lightPayload);
  if (!routeUrl) return ekispertRouteFallback(input);

  return {
    provider: 'ekispert',
    source: cleanFareLabel('駅すぱあと API フリープラン'),
    routeUrl,
    message: '駅すぱあとフリープランでは数値運賃を直接取得できない場合があります。確認URLで運賃を確認して金額を入力してください。',
  };
}

export async function createEkispertCommuterPass(input: FareLookupInput) {
  const key = process.env.EKISPERT_API_KEY || process.env.EKISPERT_ACCESS_KEY;
  if (!key) return null;

  const baseUrl = process.env.EKISPERT_BASE_URL || 'https://api.ekispert.jp/v1/json';
  const root = baseUrl.replace(/\/$/, '');
  const [fromCode, toCode, ...viaCodes] = await Promise.all([
    resolveEkispertStationCode(root, key, input.transportType, input.from),
    resolveEkispertStationCode(root, key, input.transportType, input.to),
    ...(input.via || []).map(station => resolveEkispertStationCode(root, key, input.transportType, station)),
  ]);
  const viaList = [fromCode || input.from, ...viaCodes.filter(Boolean), toCode || input.to].join(':');
  const url = new URL(`${root}/search/course/extreme`);
  url.searchParams.set('key', key);
  url.searchParams.set('viaList', viaList);
  url.searchParams.set('searchType', 'plain');
  url.searchParams.set('sort', 'teiki');
  url.searchParams.set('answerCount', '1');
  url.searchParams.set('searchCount', '1');

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => null);
  const teiki = extractEkispertTeiki(payload);
  if (!teiki.serializeData) return null;
  return teiki;
}

async function lookupNavitimeFare(input: FareLookupInput): Promise<FareLookupResult | null> {
  const endpoint = process.env.NAVITIME_ROUTE_API_URL || process.env.NAVITIME_TRAVEL_COST_API_URL;
  const key = process.env.NAVITIME_API_KEY;
  if (!endpoint || !key) return null;

  const url = new URL(endpoint);
  const fromParam = process.env.NAVITIME_FROM_PARAM || 'from';
  const toParam = process.env.NAVITIME_TO_PARAM || 'to';
  const transportParam = process.env.NAVITIME_TRANSPORT_PARAM || 'transport_type';
  url.searchParams.set(fromParam, input.from);
  url.searchParams.set(toParam, input.to);
  url.searchParams.set(transportParam, input.transportType);

  const apiKeyParam = process.env.NAVITIME_API_KEY_PARAM;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (apiKeyParam) {
    url.searchParams.set(apiKeyParam, key);
  } else {
    headers[process.env.NAVITIME_API_KEY_HEADER || 'x-api-key'] = key;
  }

  const res = await fetch(url.toString(), { headers, cache: 'no-store' });
  if (!res.ok) return null;

  const payload = await res.json().catch(() => null);
  const fare = findFareByKey(payload);
  if (!fare) return null;

  return {
    fare,
    provider: 'navitime',
    source: cleanFareLabel('NAVITIME API'),
    raw: undefined,
  };
}

export async function lookupExternalTransportFare(input: FareLookupInput, requestedProvider?: string | null) {
  const preference = String(requestedProvider || process.env.TRANSPORT_FARE_PROVIDER || 'auto').toLowerCase();
  const providers: ProviderName[] =
    preference === 'navitime' ? ['navitime'] :
    preference === 'ekispert' ? ['ekispert'] :
    preference === 'firestore' ? [] :
    ['navitime', 'ekispert'];

  for (const provider of providers) {
    const result = provider === 'navitime'
      ? await lookupNavitimeFare(input)
      : await lookupEkispertFare(input);
    if (result) return result;
  }

  return null;
}
