export function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function normalizedRange(start: string, end: string): [number, number] {
  const from = timeToMinutes(start);
  let to = timeToMinutes(end);
  if (to <= from) to += 24 * 60;
  return [from, to];
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [a1, a2] = normalizedRange(aStart, aEnd);
  const [b1, b2] = normalizedRange(bStart, bEnd);
  return a1 < b2 && b1 < a2;
}
