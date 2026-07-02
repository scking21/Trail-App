import { extractJsonLd, extractIcs } from './ingest';

describe('extractJsonLd', () => {
  it('pulls reservation objects from ld+json script blocks, flattening @graph', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@graph":[{"@type":"FlightReservation","reservationNumber":"K9X2YZ"}]}
      </script>
      </head></html>`;
    const out = extractJsonLd(html) as any[];
    expect(out).toHaveLength(1);
    expect(out[0]['@type']).toBe('FlightReservation');
    expect(out[0].reservationNumber).toBe('K9X2YZ');
  });
  it('ignores malformed blocks without throwing', () => {
    expect(extractJsonLd('<script type="application/ld+json">{bad</script>')).toEqual([]);
  });
});

describe('extractIcs', () => {
  it('returns the VCALENDAR block when present', () => {
    const t = 'pre BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:UA1234\nEND:VEVENT\nEND:VCALENDAR post';
    expect(extractIcs(t)).toMatch(/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
  });
  it('returns null when no calendar data', () => {
    expect(extractIcs('just an email body')).toBeNull();
  });
});
