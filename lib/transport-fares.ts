export type TransportTypeOption = {
  value: string;
  label: string;
};

export const TRANSPORT_TYPE_OPTIONS: TransportTypeOption[] = [
  { value: 'jr', label: 'JR' },
  { value: 'hankyu', label: '阪急' },
  { value: 'hanshin', label: '阪神' },
  { value: 'sanyo', label: '山陽電車' },
  { value: 'kobe_subway', label: '神戸市営地下鉄' },
  { value: 'kobe_dentetsu', label: '神戸電鉄' },
  { value: 'port_liner', label: 'ポートライナー' },
  { value: 'rokko_liner', label: '六甲ライナー' },
  { value: 'shinki_bus', label: '神姫バス' },
  { value: 'kobe_city_bus', label: '神戸市営バス' },
  { value: 'bus', label: '路線バス' },
  { value: 'other', label: 'その他' },
];

const TRANSPORT_TYPE_ALIAS_ENTRIES: Array<[string, string]> = [
  ...TRANSPORT_TYPE_OPTIONS.flatMap(option => [
    [option.value, option.value] as [string, string],
    [option.label, option.value] as [string, string],
  ]),
  ['JR西日本', 'jr'],
  ['西日本旅客鉄道', 'jr'],
  ['神戸市市営地下鉄', 'kobe_subway'],
  ['神戸市地下鉄', 'kobe_subway'],
  ['市営地下鉄', 'kobe_subway'],
  ['山陽', 'sanyo'],
  ['山陽電鉄', 'sanyo'],
  ['阪急電鉄', 'hankyu'],
  ['阪神電車', 'hanshin'],
  ['神姫', 'shinki_bus'],
  ['神戸市バス', 'kobe_city_bus'],
  ['市バス', 'kobe_city_bus'],
];

const normalizeTransportTypeKey = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, '').toLowerCase();

const TRANSPORT_TYPE_ALIAS_MAP = new Map(
  TRANSPORT_TYPE_ALIAS_ENTRIES.map(([label, value]) => [normalizeTransportTypeKey(label), value]),
);

export const normalizeTransportType = (value: unknown) => {
  const key = normalizeTransportTypeKey(value);
  return TRANSPORT_TYPE_ALIAS_MAP.get(key) || key;
};

export const normalizeTransportStation = (value: unknown) =>
  String(value || '')
    .replace(/駅$/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

export const transportFareDocId = (transportType: string, from: string, to: string) =>
  [transportType, normalizeTransportStation(from), normalizeTransportStation(to)]
    .map((part) => encodeURIComponent(part || 'unknown'))
    .join('__');

export const transportStationDocId = (transportType: string, stationName: string) =>
  [transportType, normalizeTransportStation(stationName)]
    .map((part) => encodeURIComponent(part || 'unknown'))
    .join('__');

export const cleanFareLabel = (value: unknown) =>
  String(value || '')
    .replace(/one\s*way\s*ticket/gi, '')
    .replace(/onewayticket/gi, '')
    .replace(/片道乗車券/g, '片道')
    .trim();
