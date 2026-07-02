/* structured.ts — highest-confidence strategy: when the source carries
 * machine-readable data (schema.org JSON-LD in confirmation emails, or an
 * embedded ICS VEVENT), trust it over any regex. */

import type {
  ParseInput, ParseResult, ParsedReservation, ParserStrategy, Segment,
} from '../../types';
import { normalizeTime, zoneForPlace, type NormalizedTime } from '../tz';

function res(partial: Partial<ParsedReservation> & { kind: ParsedReservation['kind']; segments: Segment[] }): ParsedReservation {
  return {
    tripId: null, provider: null, confirmation: null, status: 'confirmed',
    cost: null, notes: null, source: 'upload', parseConfidence: null,
    attachments: [], ...partial,
  };
}

/** Map a schema.org reservation object into our model. Supports the common
 * FlightReservation / LodgingReservation / RentalCarReservation shapes. */
function fromJsonLd(node: any): ParsedReservation | null {
  const type = String(node?.['@type'] || '').toLowerCase();
  const conf = node?.reservationNumber || node?.reservationId || null;

  if (type.includes('flight')) {
    const f = node.reservationFor || {};
    const dep = timeFromIso(f.departureTime, iata(f.departureAirport));
    const arr = timeFromIso(f.arrivalTime, iata(f.arrivalAirport));
    return res({
      kind: 'flight',
      provider: f.airline?.name || f.airline?.iataCode || null,
      confirmation: conf,
      segments: [{
        seq: 0,
        from: { name: iata(f.departureAirport), ...dep },
        to: { name: iata(f.arrivalAirport), ...arr },
        extra: { flightNumber: join(f.airline?.iataCode, f.flightNumber), seat: seatOf(node) },
      }],
    });
  }

  if (type.includes('lodging')) {
    const l = node.reservationFor || {};
    return res({
      kind: 'hotel',
      provider: l.name || null,
      confirmation: conf,
      segments: [{
        seq: 0,
        from: { name: l.name || null, detail: addr(l.address), ...timeFromIso(node.checkinTime, null) },
        to: { name: l.name || null, ...timeFromIso(node.checkoutTime, null) },
        extra: {},
      }],
    });
  }

  if (type.includes('rentalcar')) {
    const c = node.reservationFor || {};
    return res({
      kind: 'car',
      provider: node.provider?.name || c.rentalCompany?.name || null,
      confirmation: conf,
      segments: [{
        seq: 0,
        from: { name: placeName(node.pickupLocation), detail: addr(node.pickupLocation?.address), ...timeFromIso(node.pickupTime, null) },
        to: { name: placeName(node.dropoffLocation), detail: addr(node.dropoffLocation?.address), ...timeFromIso(node.dropoffTime, null) },
        extra: {},
      }],
    });
  }

  return null;
}

function iata(a: any): string | null {
  return a?.iataCode || a?.name || null;
}
function placeName(p: any): string | null {
  return p?.name || null;
}
function addr(a: any): string | null {
  if (!a) return null;
  if (typeof a === 'string') return a;
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .filter(Boolean).join(', ') || null;
}
function seatOf(node: any): string | null {
  const t = node?.passengerSequenceNumber || node?.airplaneSeat || null;
  return t ? String(t) : null;
}
function join(a?: string, b?: string): string | null {
  if (!a && !b) return null;
  return [a, b].filter(Boolean).join('');
}
/** Build the {timeUtc, timeLocal, tz} triple from a schema.org ISO time.
 * When the string carries a UTC offset (the common case for e-tickets) it is
 * authoritative — use it directly rather than dropping it and re-deriving the
 * zone from our limited airport table (which would null out the UTC time for any
 * airport not in the table). Naive strings fall back to place-based lookup. */
function timeFromIso(iso: any, place: string | null | undefined): NormalizedTime {
  const s = iso ? String(iso) : '';
  const m = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?/.exec(s);
  if (!m) return normalizeTime('', place);
  const local = `${m[1]}T${m[2]}`;
  if (!m[3]) return normalizeTime(local, place); // no offset — needs the tz table
  const d = new Date(s);
  return {
    timeUtc: isNaN(d.getTime()) ? null : d.toISOString(),
    timeLocal: local,
    tz: zoneForPlace(place), // best-effort, for rendering local time at this endpoint
  };
}

export const jsonLdStrategy: ParserStrategy = {
  name: 'json-ld',
  priority: 100,
  match: (i: ParseInput) => Array.isArray(i.jsonLd) && i.jsonLd.length > 0,
  parse: (i: ParseInput): ParseResult | null => {
    for (const node of i.jsonLd || []) {
      const r = fromJsonLd(node);
      if (r) return { reservation: r, confidence: 0.95, strategy: 'json-ld' };
    }
    return null;
  },
};

/** Minimal ICS VEVENT reader — many hotels/airlines attach a calendar invite. */
export const icsStrategy: ParserStrategy = {
  name: 'ics',
  priority: 90,
  match: (i: ParseInput) => !!i.ics && /BEGIN:VEVENT/.test(i.ics),
  parse: (i: ParseInput): ParseResult | null => {
    const ics = i.ics || '';
    const get = (k: string) => {
      const m = new RegExp(`^${k}[^:]*:(.*)$`, 'm').exec(ics);
      return m ? m[1].trim() : null;
    };
    const summary = get('SUMMARY') || '';
    const start = icsDate(get('DTSTART'));
    const end = icsDate(get('DTEND'));
    const loc = get('LOCATION');
    const kind = /flight|airlines|\b[A-Z]{2}\d{2,4}\b/i.test(summary) ? 'flight'
      : /hotel|inn|resort|suites/i.test(summary) ? 'hotel'
      : /rental|car|hertz|avis|enterprise/i.test(summary) ? 'car'
      : /train|rail|amtrak|eurostar/i.test(summary) ? 'train' : 'flight';
    return {
      reservation: res({
        kind,
        provider: summary.split(/[-–:]/)[0]?.trim() || null,
        segments: [{
          seq: 0,
          from: { name: loc, ...normalizeTime(start || '', loc) },
          to: end ? { name: loc, ...normalizeTime(end, loc) } : null,
          extra: { summary },
        }],
        notes: get('DESCRIPTION'),
      }),
      confidence: 0.8,
      strategy: 'ics',
    };
  },
};

function icsDate(v: string | null): string | null {
  if (!v) return null;
  const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(v);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}`;
}
