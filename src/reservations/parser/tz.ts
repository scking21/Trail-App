/* tz.ts — turn a local wall-clock time + a place into the UTC/local/tz triple
 * the data model needs. Pure functions, no I/O, fully unit-testable.
 *
 * We deliberately avoid a multi-megabyte tz database. Instead we ship a compact
 * IATA-airport -> IANA-zone table for the busiest hubs (the long tail falls back
 * to manual review in the UI), and we lean on the host's Intl engine to compute
 * the UTC offset for a given zone+instant (handles DST correctly). */

/** Busiest airports -> IANA zone. Extend as needed; unknown codes return null
 * and the review screen asks the user to confirm the time. */
export const AIRPORT_TZ: Record<string, string> = {
  // North America
  SFO: 'America/Los_Angeles', LAX: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', PDX: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  DEN: 'America/Denver', PHX: 'America/Phoenix', SLC: 'America/Denver',
  DFW: 'America/Chicago', ORD: 'America/Chicago', MDW: 'America/Chicago',
  IAH: 'America/Chicago', MSP: 'America/Chicago', AUS: 'America/Chicago',
  MCO: 'America/New_York', ATL: 'America/New_York', JFK: 'America/New_York',
  EWR: 'America/New_York', LGA: 'America/New_York', BOS: 'America/New_York',
  MIA: 'America/New_York', DCA: 'America/New_York', IAD: 'America/New_York',
  CLT: 'America/New_York', PHL: 'America/New_York', DTW: 'America/New_York',
  YYZ: 'America/Toronto', YVR: 'America/Vancouver', YUL: 'America/Toronto',
  MEX: 'America/Mexico_City', HNL: 'Pacific/Honolulu',
  // Europe
  LHR: 'Europe/London', LGW: 'Europe/London', STN: 'Europe/London', MAN: 'Europe/London',
  CDG: 'Europe/Paris', ORY: 'Europe/Paris', AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin', MUC: 'Europe/Berlin', BER: 'Europe/Berlin',
  MAD: 'Europe/Madrid', BCN: 'Europe/Madrid', FCO: 'Europe/Rome', MXP: 'Europe/Rome',
  ZRH: 'Europe/Zurich', VIE: 'Europe/Vienna', CPH: 'Europe/Copenhagen',
  DUB: 'Europe/Dublin', LIS: 'Europe/Lisbon', IST: 'Europe/Istanbul',
  // Asia-Pacific & Middle East
  DXB: 'Asia/Dubai', DOH: 'Asia/Qatar', SIN: 'Asia/Singapore', HKG: 'Asia/Hong_Kong',
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai',
  PVG: 'Asia/Shanghai', BKK: 'Asia/Bangkok', DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata',
  SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne', AKL: 'Pacific/Auckland',
};

/** A few well-known rail stations -> IANA zone (extend as needed). */
export const STATION_TZ: Record<string, string> = {
  'london kings cross': 'Europe/London', 'london st pancras': 'Europe/London',
  'london paddington': 'Europe/London', 'paris gare du nord': 'Europe/Paris',
  'paris gare de lyon': 'Europe/Paris', 'new york penn station': 'America/New_York',
  'washington union station': 'America/New_York', 'boston south station': 'America/New_York',
  'chicago union station': 'America/Chicago',
};

/** Look up a zone for an airport code or station name. Returns null if unknown. */
export function zoneForPlace(place: string | null | undefined): string | null {
  if (!place) return null;
  const trimmed = place.trim();
  const code = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(code) && AIRPORT_TZ[code]) return AIRPORT_TZ[code];
  const key = trimmed.toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ');
  return STATION_TZ[key] ?? null;
}

/** Offset (minutes, east-positive) of `zone` at a given UTC instant.
 * Uses Intl so DST is handled by the platform. Returns 0 if zone is invalid. */
export function offsetMinutes(zone: string, atUtc: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(atUtc);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(
      get('year'), get('month') - 1, get('day'),
      get('hour'), get('minute'), get('second'),
    );
    return Math.round((asUTC - atUtc.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** Parse a naive local datetime string ('YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD HH:mm')
 * interpreted in `zone`, returning the corresponding UTC ISO string.
 * Returns null if the input can't be parsed. */
export function localToUtc(localWallClock: string, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    localWallClock.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // First guess: treat the wall clock as if it were UTC, then correct by the
  // zone's offset at that instant. One iteration is enough except within the
  // ~1h DST transition window, so we refine once.
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  let off = offsetMinutes(zone, new Date(guess));
  let utc = guess - off * 60000;
  const off2 = offsetMinutes(zone, new Date(utc));
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc).toISOString();
}

export interface NormalizedTime {
  timeUtc: string | null;
  timeLocal: string;
  tz: string | null;
}

/** Build the {timeUtc, timeLocal, tz} triple from a wall-clock time and a place.
 * If the place's zone is unknown we keep the local string and leave UTC null so
 * the UI flags it for confirmation. */
export function normalizeTime(
  localWallClock: string,
  place: string | null | undefined,
): NormalizedTime {
  const tz = zoneForPlace(place);
  const timeUtc = tz ? localToUtc(localWallClock, tz) : null;
  return { timeUtc, timeLocal: localWallClock.trim().replace(' ', 'T'), tz };
}
