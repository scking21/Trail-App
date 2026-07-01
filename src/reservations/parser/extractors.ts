/* extractors.ts — small pure helpers shared by the parser strategies.
 * Each returns best-effort matches from plain text; callers decide confidence. */

/** Airline-style 6-char record locator (PNR). Excludes pure-digit strings so we
 * don't grab confirmation numbers that are really order ids. */
export function findPNR(text: string): string | null {
  const m = text.match(/\b(?=[A-Z0-9]{6}\b)(?=.*[A-Z])[A-Z0-9]{6}\b/);
  return m ? m[0] : null;
}

/** Generic confirmation/booking number after a label. */
export function findConfirmation(text: string): string | null {
  const m = text.match(
    /(?:booking|reservation|confirmation|record\s*locator|conf|pnr)(?:\s*(?:#|no\.?|number|reference|ref|id))?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  );
  return m ? m[1].toUpperCase() : null;
}

/** All 3-letter IATA airport codes appearing as standalone tokens, in order. */
export function findIataCodes(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Z]{3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const c = m[1];
    if (!STOP_WORDS.has(c)) out.push(c);
  }
  return out;
}

// Common 3-letter uppercase tokens that are NOT airports.
const STOP_WORDS = new Set([
  'THE', 'AND', 'FOR', 'YOU', 'ARE', 'NOT', 'USD', 'EUR', 'GBP', 'PNR', 'SEP',
  'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'MON',
  'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'GMT', 'UTC', 'AM', 'PM', 'ETA',
]);

/** Money like "$412.50", "USD 412.50", "412,50 EUR". Returns first hit. */
export function findMoney(text: string): { amount: number; currency: string } | null {
  const sym = text.match(/([$€£])\s?([0-9][0-9.,]*)/);
  if (sym) {
    const cur = { '$': 'USD', '€': 'EUR', '£': 'GBP' }[sym[1]] || 'USD';
    return { amount: parseAmount(sym[2]), currency: cur };
  }
  const iso = text.match(/\b(USD|EUR|GBP|CAD|AUD|JPY|CHF)\b\s?([0-9][0-9.,]*)/i);
  if (iso) return { amount: parseAmount(iso[2]), currency: iso[1].toUpperCase() };
  const isoAfter = text.match(/\b([0-9][0-9.,]*)\s?(USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/i);
  if (isoAfter) return { amount: parseAmount(isoAfter[1]), currency: isoAfter[2].toUpperCase() };
  return null;
}

function parseAmount(s: string): number {
  // Handle both "1,234.56" and "1.234,56" — last separator is the decimal one.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized = s;
  if (lastComma > lastDot) normalized = s.replace(/\./g, '').replace(',', '.');
  else normalized = s.replace(/,/g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a date in several common shapes -> 'YYYY-MM-DD'. Null if unrecognized.
 * Assumes US month/day order for all-numeric slashed dates. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yr}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  // "Jul 2, 2026" / "2 Jul 2026" / "July 02 2026"
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(+m[2])}`;
  }
  m = /(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(t);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(+m[1])}`;
  }
  return null;
}

/** Parse a clock time -> 'HH:mm' (24h). Handles "10:30 AM", "21:55", "9:05pm". */
export function parseClock(s: string): string | null {
  const m = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = m[2];
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${pad(h)}:${min}`;
}

/** Combine a date string and a clock string into 'YYYY-MM-DDTHH:mm'. */
export function combineLocal(date: string | null, clock: string | null): string | null {
  if (!date) return null;
  return clock ? `${date}T${clock}` : `${date}T00:00`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
