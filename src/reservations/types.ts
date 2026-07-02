/* types.ts — domain model for the travel-reservations module.
 * Pure types + the ParserStrategy contract. No runtime imports so this file is
 * safe to pull into unit tests without dragging in Capacitor/browser deps. */

export type ReservationKind = 'flight' | 'hotel' | 'car' | 'train';
export type ReservationStatus = 'confirmed' | 'cancelled' | 'past';
export type ReservationSource = 'manual' | 'upload';

/** One endpoint of a segment (a departure or an arrival).
 * Times are stored three ways on purpose — see the plan's "Timezones" note:
 *   - timeUtc:   ISO-8601 in UTC, the single sortable truth.
 *   - timeLocal: the original wall-clock string at this place (no offset).
 *   - tz:        IANA zone so the UI can render local time at each endpoint. */
export interface Endpoint {
  name: string | null;        // 'SFO' | 'London Kings Cross' | hotel name
  detail?: string | null;     // full address / terminal
  timeUtc?: string | null;    // '2026-07-02T17:30:00Z'
  timeLocal?: string | null;  // '2026-07-02T10:30'
  tz?: string | null;         // 'America/Los_Angeles'
}

export interface Segment {
  seq: number;                 // leg order, 0-based
  from: Endpoint;
  to?: Endpoint | null;        // hotels/cars still use `to` (check-out / drop-off)
  extra?: Record<string, unknown>; // {flightNumber, seat, roomType, ...}
}

export interface Money {
  amount: number;
  currency: string;            // ISO 4217, e.g. 'USD'
}

export interface Attachment {
  id?: string;
  filePath: string;            // Filesystem Directory.Data relative path
  mime?: string | null;
  filename?: string | null;
}

export interface Reservation {
  id: string;
  tripId?: string | null;
  kind: ReservationKind;
  provider?: string | null;
  confirmation?: string | null;
  status: ReservationStatus;
  cost?: Money | null;
  notes?: string | null;
  source: ReservationSource;
  parseConfidence?: number | null; // 0..1, null for manual
  segments: Segment[];
  attachments?: Attachment[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;   // soft-delete seam (null = live)
}

/** What the parser produces before persistence assigns ids/timestamps. */
export type ParsedReservation = Omit<
  Reservation,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** Input accepted by the persistence service. */
export type NewReservation = Omit<
  Reservation,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** A single extraction strategy. Strategies are pure: text in, candidate out.
 * `match` is a cheap guard so the engine can skip strategies that obviously
 * don't apply. `parse` returns null when it can't make sense of the text. */
export interface ParserStrategy {
  name: string;
  /** Higher runs first when several strategies match. */
  priority: number;
  match(input: ParseInput): boolean;
  parse(input: ParseInput): ParseResult | null;
}

export interface ParseInput {
  text: string;                // extracted plain text
  /** Optional machine-readable payloads pulled out during ingest. */
  jsonLd?: unknown[];          // schema.org blocks found in the source
  ics?: string | null;        // raw VEVENT block if present
  filename?: string | null;
  mime?: string | null;
}

export interface ParseResult {
  reservation: ParsedReservation;
  /** 0..1 — how sure this strategy is about the whole record. */
  confidence: number;
  /** Per-field confidence so the review UI can flag weak fields. */
  fieldConfidence?: Record<string, number>;
  strategy: string;
}
