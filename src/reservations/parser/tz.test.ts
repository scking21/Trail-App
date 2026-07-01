import { zoneForPlace, offsetMinutes, localToUtc, normalizeTime } from './tz';

describe('zoneForPlace', () => {
  it('maps known airport codes to IANA zones', () => {
    expect(zoneForPlace('SFO')).toBe('America/Los_Angeles');
    expect(zoneForPlace('lhr')).toBe('Europe/London');
    expect(zoneForPlace('  JFK ')).toBe('America/New_York');
  });
  it('maps known stations', () => {
    expect(zoneForPlace("London King's Cross")).toBe('Europe/London');
  });
  it('returns null for unknown places', () => {
    expect(zoneForPlace('ZZZ')).toBeNull();
    expect(zoneForPlace(null)).toBeNull();
    expect(zoneForPlace('')).toBeNull();
  });
});

describe('offsetMinutes', () => {
  it('computes a standard-time offset', () => {
    // Jan: New York is UTC-5 (EST) => -300 minutes
    expect(offsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
  });
  it('accounts for daylight saving', () => {
    // Jul: New York is UTC-4 (EDT) => -240 minutes
    expect(offsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240);
  });
});

describe('localToUtc', () => {
  it('converts LA wall-clock to UTC in summer (PDT, -7)', () => {
    expect(localToUtc('2026-07-02T10:30', 'America/Los_Angeles')).toBe('2026-07-02T17:30:00.000Z');
  });
  it('converts NY wall-clock to UTC in summer (EDT, -4)', () => {
    expect(localToUtc('2026-07-02T21:55', 'America/New_York')).toBe('2026-07-03T01:55:00.000Z');
  });
  it('converts London wall-clock to UTC in winter (GMT, +0)', () => {
    expect(localToUtc('2026-01-10T09:00', 'Europe/London')).toBe('2026-01-10T09:00:00.000Z');
  });
  it('returns null on unparseable input', () => {
    expect(localToUtc('not a date', 'Europe/London')).toBeNull();
  });
});

describe('normalizeTime', () => {
  it('builds the utc/local/tz triple for a known airport', () => {
    const n = normalizeTime('2026-07-02T10:30', 'SFO');
    expect(n).toEqual({
      timeUtc: '2026-07-02T17:30:00.000Z',
      timeLocal: '2026-07-02T10:30',
      tz: 'America/Los_Angeles',
    });
  });
  it('leaves UTC null when the zone is unknown', () => {
    const n = normalizeTime('2026-07-02T10:30', 'ZZZ');
    expect(n.timeUtc).toBeNull();
    expect(n.tz).toBeNull();
    expect(n.timeLocal).toBe('2026-07-02T10:30');
  });
});
