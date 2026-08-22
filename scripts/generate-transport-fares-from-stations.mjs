#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
};

loadEnvFile(path.join(cwd, '.env.local'));

const args = new Map();
process.argv.slice(2).forEach((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  args.set(key, rest.join('=') || 'true');
});

const stationsPath = args.get('stations') || 'docs/transport-stations-major-hyogo.csv';
const existingPath = args.get('existing') || 'docs/transport-fares-major-hyogo.csv';
const outPath = args.get('out') || existingPath;
const failedPath = args.get('failed') || 'docs/transport-fares-missing.csv';
const provider = String(args.get('provider') || process.env.TRANSPORT_FARE_PROVIDER || 'auto').toLowerCase();
const targetTransport = args.get('transport') || '';
const limit = Number(args.get('limit') || 0);
const delayMs = Number(args.get('delay-ms') || 450);
const dryRun = args.get('dry-run') === 'true';

const parseCsvLine = (line) => {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  out.push(cell);
  return out;
};

const parseCsv = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  const [headerLine = '', ...lines] = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine).map(value => value.trim());
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    });
};

const escapeCsv = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const writeFareCsv = (filePath, rows) => {
  const headers = ['交通機関', '出発', '到着', '金額', '参照元', '備考'];
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(',')),
  ].join('\n') + '\n';
  fs.writeFileSync(filePath, csv, 'utf8');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const yenNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const numeric = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

const findFareByKey = (value) => {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const keys = ['fare', 'fareAmount', 'fare_amount', 'totalFare', 'total_fare', 'travelCost', 'travel_cost', 'amount', 'cost', 'price'];
  for (const key of keys) {
    const found = yenNumber(record[key]);
    if (found) return found;
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findFareByKey(item);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findFareByKey(child);
      if (found) return found;
    }
  }
  return null;
};

const extractEkispertFare = (payload) => {
  const courses = asArray(payload?.ResultSet?.Course);
  for (const course of courses) {
    const prices = asArray(course?.Price);
    const candidates = [
      prices.find(price => String(price?.kind || '').toLowerCase().includes('summary') && String(price?.selected ?? 'true') !== 'false'),
      prices.find(price => String(price?.kind || '') === 'FareSummary'),
      prices.find(price => String(price?.kind || '') === 'Fare' && String(price?.selected ?? 'true') !== 'false'),
      ...prices,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const amount = yenNumber(candidate?.Oneway) || yenNumber(candidate?.oneway) || findFareByKey(candidate);
      if (amount) return amount;
    }
  }
  return null;
};

const lookupEkispertFare = async (from, to) => {
  const key = process.env.EKISPERT_API_KEY || process.env.EKISPERT_ACCESS_KEY;
  if (!key) return null;
  const baseUrl = process.env.EKISPERT_BASE_URL || 'https://api.ekispert.jp/v1/json';
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/search/course/extreme`);
  url.searchParams.set('key', key);
  url.searchParams.set('viaList', `${from}:${to}`);
  url.searchParams.set('searchType', 'plain');
  url.searchParams.set('sort', 'price');
  url.searchParams.set('answerCount', '1');
  url.searchParams.set('searchCount', '1');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => null);
  const fare = extractEkispertFare(payload);
  return fare ? { fare, source: '駅すぱあと API' } : null;
};

const lookupNavitimeFare = async (transportType, from, to) => {
  const endpoint = process.env.NAVITIME_ROUTE_API_URL || process.env.NAVITIME_TRAVEL_COST_API_URL;
  const key = process.env.NAVITIME_API_KEY;
  if (!endpoint || !key) return null;
  const url = new URL(endpoint);
  url.searchParams.set(process.env.NAVITIME_FROM_PARAM || 'from', from);
  url.searchParams.set(process.env.NAVITIME_TO_PARAM || 'to', to);
  url.searchParams.set(process.env.NAVITIME_TRANSPORT_PARAM || 'transport_type', transportType);
  const headers = { Accept: 'application/json' };
  if (process.env.NAVITIME_API_KEY_PARAM) {
    url.searchParams.set(process.env.NAVITIME_API_KEY_PARAM, key);
  } else {
    headers[process.env.NAVITIME_API_KEY_HEADER || 'x-api-key'] = key;
  }
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => null);
  const fare = findFareByKey(payload);
  return fare ? { fare, source: 'NAVITIME API' } : null;
};

const lookupExternalFare = async (transportType, from, to) => {
  const providers = provider === 'ekispert'
    ? ['ekispert']
    : provider === 'navitime'
      ? ['navitime']
      : ['navitime', 'ekispert'];
  for (const name of providers) {
    const result = name === 'navitime'
      ? await lookupNavitimeFare(transportType, from, to)
      : await lookupEkispertFare(from, to);
    if (result) return result;
  }
  return null;
};

const normalize = (value) => String(value || '').replace(/駅$/g, '').replace(/\s+/g, '').trim().toLowerCase();
const pairKey = (transport, from, to) => {
  const a = normalize(from);
  const b = normalize(to);
  return [String(transport || '').trim(), ...[a, b].sort()].join('__');
};

const fareRows = parseCsv(existingPath);
const stations = parseCsv(stationsPath);
const existing = new Set(fareRows.map(row => pairKey(row['交通機関'], row['出発'], row['到着'])));
const failedRows = [];
const byTransport = new Map();

for (const row of stations) {
  const transport = row['交通機関'];
  const name = row['駅名'];
  if (!transport || !name) continue;
  if (targetTransport && transport !== targetTransport) continue;
  if (!byTransport.has(transport)) byTransport.set(transport, new Map());
  byTransport.get(transport).set(normalize(name), {
    name,
    line: row['路線'] || '',
    stationType: row['種別'] || '',
  });
}

console.log(`existing fare rows: ${fareRows.length}`);
console.log(`station transports: ${Array.from(byTransport.keys()).join(', ') || '-'}`);

let added = 0;
let checked = 0;
for (const [transport, stationMap] of byTransport) {
  const stationList = Array.from(stationMap.values());
  for (let i = 0; i < stationList.length; i += 1) {
    for (let j = i + 1; j < stationList.length; j += 1) {
      const from = stationList[i];
      const to = stationList[j];
      const key = pairKey(transport, from.name, to.name);
      if (existing.has(key)) continue;
      if (limit > 0 && checked >= limit) break;
      checked += 1;

      let result = null;
      if (transport === '神戸市営バス' && from.line.includes('普通区') && to.line.includes('普通区')) {
        result = { fare: 230, source: '神戸市交通局 市バス普通区 均一運賃' };
      } else {
        result = await lookupExternalFare(transport, from.name, to.name);
        if (delayMs > 0) await sleep(delayMs);
      }

      if (result?.fare) {
        fareRows.push({
          交通機関: transport,
          出発: from.name,
          到着: to.name,
          金額: result.fare,
          参照元: result.source,
          備考: '駅名マスタから自動生成',
        });
        existing.add(key);
        added += 1;
        if (!dryRun) writeFareCsv(outPath, fareRows);
        console.log(`+ ${transport} ${from.name} -> ${to.name}: ${result.fare}`);
      } else {
        failedRows.push({
          交通機関: transport,
          出発: from.name,
          到着: to.name,
          金額: '',
          参照元: '',
          備考: '自動取得不可',
        });
      }
    }
    if (limit > 0 && checked >= limit) break;
  }
}

if (!dryRun) {
  writeFareCsv(outPath, fareRows);
  if (failedRows.length > 0) writeFareCsv(failedPath, failedRows);
}

console.log(`checked pairs: ${checked}`);
console.log(`added fare rows: ${added}`);
console.log(`failed pairs: ${failedRows.length}`);
console.log(`output: ${outPath}`);
if (failedRows.length) console.log(`failed output: ${failedPath}`);
if (!process.env.EKISPERT_API_KEY && !process.env.EKISPERT_ACCESS_KEY && !process.env.NAVITIME_API_KEY) {
  console.log('API key is missing. Only built-in rules, such as Kobe City Bus ordinary area, can be generated.');
}
