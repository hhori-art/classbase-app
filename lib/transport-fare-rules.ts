import { cleanFareLabel } from '@/lib/transport-fares';

export type BuiltInFareLookupInput = {
  transportType: string;
  from: string;
  to: string;
  fromStation?: {
    matched?: boolean;
    line?: string;
    station_type?: string;
  };
  toStation?: {
    matched?: boolean;
    line?: string;
    station_type?: string;
  };
};

export type BuiltInFareLookupResult = {
  fare: number;
  source: string;
  provider: 'built-in-rule';
};

const isOrdinaryKobeCityBusStop = (station?: BuiltInFareLookupInput['fromStation']) => {
  if (!station?.matched) return false;
  const line = String(station.line || '');
  return line.includes('普通区');
};

export function lookupBuiltInTransportFare(input: BuiltInFareLookupInput): BuiltInFareLookupResult | null {
  if (!input.from || !input.to || input.from === input.to) return null;

  if (
    input.transportType === 'kobe_city_bus' &&
    isOrdinaryKobeCityBusStop(input.fromStation) &&
    isOrdinaryKobeCityBusStop(input.toStation)
  ) {
    return {
      fare: 230,
      provider: 'built-in-rule',
      source: cleanFareLabel('神戸市交通局 市バス普通区 均一運賃'),
    };
  }

  return null;
}
