import { runParser } from './engine';
import {
  findPNR, findIataCodes, findMoney, parseDate, parseClock,
} from './extractors';

describe('extractors', () => {
  it('finds an alphanumeric PNR but not pure digits', () => {
    expect(findPNR('Record locator K9X2YZ for your trip')).toBe('K9X2YZ');
    expect(findPNR('Order 123456 confirmed')).toBeNull();
  });
  it('finds IATA codes in order, skipping stop-words', () => {
    expect(findIataCodes('SFO to EWR, THE best route USD')).toEqual(['SFO', 'EWR']);
  });
  it('parses money in several formats', () => {
    expect(findMoney('Total: $412.50')).toEqual({ amount: 412.5, currency: 'USD' });
    expect(findMoney('Total 1.234,56 EUR')).toEqual({ amount: 1234.56, currency: 'EUR' });
  });
  it('parses dates and clocks', () => {
    expect(parseDate('Jul 2, 2026')).toBe('2026-07-02');
    expect(parseDate('07/02/2026')).toBe('2026-07-02');
    expect(parseClock('10:30 AM')).toBe('10:30');
    expect(parseClock('9:05pm')).toBe('21:05');
  });
});

describe('runParser — structured JSON-LD wins', () => {
  const flightJsonLd = {
    '@type': 'FlightReservation',
    reservationNumber: 'K9X2YZ',
    reservationFor: {
      '@type': 'Flight',
      airline: { name: 'United Airlines', iataCode: 'UA' },
      flightNumber: '1234',
      departureAirport: { iataCode: 'SFO' },
      departureTime: '2026-07-02T10:30:00-07:00',
      arrivalAirport: { iataCode: 'EWR' },
      arrivalTime: '2026-07-02T18:55:00-04:00',
    },
  };

  it('extracts a flight with normalized times', () => {
    const r = runParser({ text: 'United e-ticket', jsonLd: [flightJsonLd] });
    expect(r.strategy).toBe('json-ld');
    expect(r.passedGate).toBe(true);
    expect(r.reservation.kind).toBe('flight');
    expect(r.reservation.provider).toBe('United Airlines');
    expect(r.reservation.confirmation).toBe('K9X2YZ');
    const seg = r.reservation.segments[0];
    expect(seg.from.name).toBe('SFO');
    expect(seg.from.timeUtc).toBe('2026-07-02T17:30:00.000Z');
    expect(seg.to!.name).toBe('EWR');
    expect(seg.extra!.flightNumber).toBe('UA1234');
  });
});

describe('runParser — deterministic flight template', () => {
  const text = [
    'United Airlines — Your trip',
    'Confirmation: K9X2YZ',
    'Flight UA 1234',
    'SFO to EWR',
    'Jul 2, 2026  10:30 AM',
    'Jul 2, 2026  6:55 PM',
    'Seat: 14C',
    'Total: $412.50',
  ].join('\n');

  it('parses airline, route, times and cost', () => {
    const r = runParser({ text });
    expect(r.reservation.kind).toBe('flight');
    expect(r.reservation.provider).toMatch(/United/);
    expect(r.reservation.confirmation).toBe('K9X2YZ');
    const seg = r.reservation.segments[0];
    expect(seg.from.name).toBe('SFO');
    expect(seg.to!.name).toBe('EWR');
    expect(seg.from.timeUtc).toBe('2026-07-02T17:30:00.000Z');
    expect(seg.extra!.flightNumber).toBe('UA1234');
    expect(r.reservation.cost).toEqual({ amount: 412.5, currency: 'USD' });
  });
});

describe('runParser — hotel template', () => {
  const text = [
    'Marriott Downtown',
    '123 Market Street, San Francisco',
    'Check-in: Jul 2, 2026 3:00 PM',
    'Check-out: Jul 5, 2026 11:00 AM',
    'Confirmation number: ABC12345',
  ].join('\n');

  it('parses property, dates and nights', () => {
    const r = runParser({ text });
    expect(r.reservation.kind).toBe('hotel');
    expect(r.reservation.provider).toMatch(/Marriott/);
    expect(r.reservation.confirmation).toBe('ABC12345');
    const seg = r.reservation.segments[0];
    expect(seg.from.timeLocal).toBe('2026-07-02T15:00');
    expect(seg.extra!.nights).toBe(3);
  });
});

describe('runParser — never returns empty', () => {
  it('falls back to generic with low confidence on junk', () => {
    const r = runParser({ text: 'lorem ipsum dolor sit amet' });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.passedGate).toBe(false);
  });
});
