/* providers.ts — deterministic per-kind template extractors. These run when no
 * machine-readable data is present but the text clearly looks like a booking of
 * a given type. They lean on the shared extractors and report per-field
 * confidence so the review screen can flag weak spots. */

import type {
  ParseInput, ParseResult, ParsedReservation, ParserStrategy, Segment,
} from '../../types';
import {
  combineLocal, findConfirmation, findIataCodes, findMoney, findPNR,
  parseClock, parseDate,
} from '../extractors';
import { normalizeTime } from '../tz';

const AIRLINES = /\b(United|Delta|American Airlines|American|Southwest|Alaska|JetBlue|British Airways|Lufthansa|Air France|KLM|Emirates|Qatar|Ryanair|easyJet)\b/i;
const HOTELS = /\b(Marriott|Hilton|Hyatt|Sheraton|Westin|Holiday Inn|Hampton|Courtyard|Ritz|Four Seasons|Best Western|Airbnb)\b/i;
const AGENCIES = /\b(Hertz|Avis|Enterprise|Budget|Alamo|National|Sixt|Thrifty|Dollar)\b/i;
const RAIL = /\b(Amtrak|Eurostar|SNCF|Deutsche Bahn|DB|Trenitalia|Renfe|VIA Rail)\b/i;

function base(kind: ParsedReservation['kind'], seg: Segment, extra: Partial<ParsedReservation>): ParsedReservation {
  return {
    kind, tripId: null, provider: null, confirmation: null, status: 'confirmed',
    cost: null, notes: null, source: 'upload', parseConfidence: null,
    attachments: [], segments: [seg], ...extra,
  };
}

function score(fields: Record<string, unknown>): { conf: number; fc: Record<string, number> } {
  const fc: Record<string, number> = {};
  let present = 0;
  const keys = Object.keys(fields);
  for (const k of keys) {
    const ok = fields[k] != null && fields[k] !== '';
    fc[k] = ok ? 0.85 : 0.2;
    if (ok) present++;
  }
  return { conf: keys.length ? present / keys.length : 0, fc };
}

export const flightStrategy: ParserStrategy = {
  name: 'tpl-flight',
  priority: 50,
  match: (i) => AIRLINES.test(i.text) || /\bflight\b/i.test(i.text) || /\b[A-Z]{2}\s?\d{2,4}\b/.test(i.text),
  parse: (i: ParseInput): ParseResult | null => {
    const text = i.text;
    const airline = AIRLINES.exec(text)?.[1] || null;
    const flightNumber = text.match(/\b([A-Z]{2})\s?(\d{2,4})\b/)?.slice(1).join('') || null;
    const codes = findIataCodes(text);
    const dates = matchAllDates(text);
    const times = matchAllClocks(text);
    const from = codes[0] || null;
    const to = codes[1] || null;
    const depLocal = combineLocal(dates[0] || null, times[0] || null);
    const arrLocal = combineLocal(dates[1] || dates[0] || null, times[1] || null);
    const seg: Segment = {
      seq: 0,
      from: { name: from, ...(depLocal ? normalizeTime(depLocal, from) : { timeUtc: null, timeLocal: '', tz: null }) },
      to: { name: to, ...(arrLocal ? normalizeTime(arrLocal, to) : { timeUtc: null, timeLocal: '', tz: null }) },
      extra: { flightNumber, seat: text.match(/seat\s*[:#]?\s*([0-9]{1,2}[A-K])/i)?.[1] || null },
    };
    const { conf, fc } = score({ airline, flightNumber, from, to, dep: depLocal });
    return {
      reservation: base('flight', seg, {
        provider: airline,
        confirmation: findPNR(text) || findConfirmation(text),
        cost: findMoney(text),
      }),
      confidence: 0.45 + conf * 0.4,
      fieldConfidence: fc,
      strategy: 'tpl-flight',
    };
  },
};

export const hotelStrategy: ParserStrategy = {
  name: 'tpl-hotel',
  priority: 50,
  match: (i) => HOTELS.test(i.text) || /\bcheck[\s-]?in\b/i.test(i.text),
  parse: (i: ParseInput): ParseResult | null => {
    const text = i.text;
    const name = HOTELS.exec(text)?.[1] || text.match(/^(.*(?:hotel|inn|resort|suites).*)$/im)?.[1]?.trim() || null;
    const ci = labeledDate(text, /check[\s-]?in/i);
    const co = labeledDate(text, /check[\s-]?out/i);
    const addressLine = text.match(/\d+\s+[A-Za-z0-9 .,'-]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Way|Ln|Lane)\b[^\n]*/)?.[0] || null;
    const seg: Segment = {
      seq: 0,
      from: { name, detail: addressLine, ...(ci ? normalizeTime(ci, null) : { timeUtc: null, timeLocal: '', tz: null }) },
      to: { name, ...(co ? normalizeTime(co, null) : { timeUtc: null, timeLocal: '', tz: null }) },
      extra: { nights: nightsBetween(ci, co) },
    };
    const { conf, fc } = score({ name, checkIn: ci, checkOut: co, address: addressLine });
    return {
      reservation: base('hotel', seg, {
        provider: name,
        confirmation: findConfirmation(text) || findPNR(text),
        cost: findMoney(text),
      }),
      confidence: 0.45 + conf * 0.4,
      fieldConfidence: fc,
      strategy: 'tpl-hotel',
    };
  },
};

export const carStrategy: ParserStrategy = {
  name: 'tpl-car',
  priority: 50,
  match: (i) => AGENCIES.test(i.text) || /\b(car rental|rental car|pick[\s-]?up)\b/i.test(i.text),
  parse: (i: ParseInput): ParseResult | null => {
    const text = i.text;
    const agency = AGENCIES.exec(text)?.[1] || null;
    const pick = labeledDate(text, /pick[\s-]?up/i);
    const drop = labeledDate(text, /(?:drop[\s-]?off|return)/i);
    const pickLoc = labeledText(text, /pick[\s-]?up\s*(?:location)?/i);
    const dropLoc = labeledText(text, /(?:drop[\s-]?off|return)\s*(?:location)?/i);
    const seg: Segment = {
      seq: 0,
      from: { name: pickLoc, ...(pick ? normalizeTime(pick, null) : { timeUtc: null, timeLocal: '', tz: null }) },
      to: { name: dropLoc, ...(drop ? normalizeTime(drop, null) : { timeUtc: null, timeLocal: '', tz: null }) },
      extra: { vehicleClass: text.match(/\b(economy|compact|midsize|full[\s-]?size|suv|luxury|van)\b/i)?.[1] || null },
    };
    const { conf, fc } = score({ agency, pick, drop, pickLoc });
    return {
      reservation: base('car', seg, {
        provider: agency,
        confirmation: findConfirmation(text) || findPNR(text),
        cost: findMoney(text),
      }),
      confidence: 0.45 + conf * 0.4,
      fieldConfidence: fc,
      strategy: 'tpl-car',
    };
  },
};

export const trainStrategy: ParserStrategy = {
  name: 'tpl-train',
  priority: 50,
  match: (i) => RAIL.test(i.text) || /\b(train|rail|platform|coach)\b/i.test(i.text),
  parse: (i: ParseInput): ParseResult | null => {
    const text = i.text;
    const operator = RAIL.exec(text)?.[1] || null;
    const stations = text.match(/([A-Z][A-Za-z .'-]+(?:Station|Centraal|Gare[ A-Za-z]*|Hbf))/g) || [];
    const dates = matchAllDates(text);
    const times = matchAllClocks(text);
    const from = stations[0]?.trim() || null;
    const to = stations[1]?.trim() || null;
    const depLocal = combineLocal(dates[0] || null, times[0] || null);
    const arrLocal = combineLocal(dates[1] || dates[0] || null, times[1] || null);
    const seg: Segment = {
      seq: 0,
      from: { name: from, ...(depLocal ? normalizeTime(depLocal, from) : { timeUtc: null, timeLocal: '', tz: null }) },
      to: { name: to, ...(arrLocal ? normalizeTime(arrLocal, to) : { timeUtc: null, timeLocal: '', tz: null }) },
      extra: {
        seat: text.match(/seat\s*[:#]?\s*([0-9A-Z]{1,4})/i)?.[1] || null,
        coach: text.match(/(?:coach|car)\s*[:#]?\s*([0-9A-Z]{1,3})/i)?.[1] || null,
        platform: text.match(/platform\s*[:#]?\s*([0-9A-Z]{1,3})/i)?.[1] || null,
      },
    };
    const { conf, fc } = score({ operator, from, to, dep: depLocal });
    return {
      reservation: base('train', seg, {
        provider: operator,
        confirmation: findConfirmation(text) || findPNR(text),
        cost: findMoney(text),
      }),
      confidence: 0.4 + conf * 0.4,
      fieldConfidence: fc,
      strategy: 'tpl-train',
    };
  },
};

// --- helpers ---------------------------------------------------------------

function matchAllDates(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = parseDate(m[1]);
    if (d) out.push(d);
  }
  return out;
}

function matchAllClocks(text: string): string[] {
  const out: string[] = [];
  const re = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const c = parseClock(m[0]);
    if (c) out.push(c);
  }
  return out;
}

/** Find a date (optionally with time) that appears on the same line as a label. */
function labeledDate(text: string, label: RegExp): string | null {
  const line = lineWith(text, label);
  if (!line) return null;
  const d = matchAllDates(line)[0] || null;
  const t = matchAllClocks(line)[0] || null;
  return combineLocal(d, t);
}

function labeledText(text: string, label: RegExp): string | null {
  const line = lineWith(text, label);
  if (!line) return null;
  return line.replace(label, '').replace(/^[\s:–-]+/, '').trim() || null;
}

function lineWith(text: string, label: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (label.test(line)) return line;
  }
  return null;
}

function nightsBetween(ci: string | null, co: string | null): number | null {
  if (!ci || !co) return null;
  const a = Date.parse(ci);
  const b = Date.parse(co);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}
