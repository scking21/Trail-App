/* ingest.ts — turn an uploaded file into ParseInput for the parser engine.
 *
 * Order of preference (cheapest/most-reliable first):
 *   1. Text-based sources (.eml/.html/.ics/.txt) → read directly; pull out any
 *      schema.org JSON-LD blocks and ICS VEVENTs (the high-confidence paths).
 *   2. PDF with a text layer → pdf.js text extraction (the common e-ticket case).
 *   3. Image / scanned PDF → Tesseract OCR, lazily loaded only when needed.
 *
 * The heavy libs (pdf.js, tesseract.js) are loaded at runtime from vendored URLs
 * so they stay out of the main bundle and only cost bytes when actually used.
 * Every path is defensive: on failure we return whatever text we have (possibly
 * empty), and the UI degrades to a pre-filled manual form. Nothing leaves the
 * device. */

import type { ParseInput } from './types';

// Vendored at build time (see package.json copy:assets). Overridable for tests.
const PDFJS_URL = './vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER_URL = './vendor/pdfjs/pdf.worker.min.mjs';

export async function fileToParseInput(file: File): Promise<ParseInput> {
  const mime = file.type || guessMime(file.name);
  const base: ParseInput = { text: '', filename: file.name, mime };

  if (isTextual(mime, file.name)) {
    const text = await file.text();
    return { ...base, text, jsonLd: extractJsonLd(text), ics: extractIcs(text) };
  }

  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const text = await pdfText(file).catch(() => '');
    if (text.trim().length > 20) {
      return { ...base, text, jsonLd: extractJsonLd(text), ics: extractIcs(text) };
    }
    // No usable text layer — fall through to OCR of the rendered page.
    const ocr = await ocrImage(file).catch(() => '');
    return { ...base, text: ocr };
  }

  if (mime.startsWith('image/')) {
    const text = await ocrImage(file).catch(() => '');
    return { ...base, text };
  }

  // Unknown: last-ditch read as text.
  const text = await file.text().catch(() => '');
  return { ...base, text };
}

// --- JSON-LD / ICS extraction (pure-ish, no heavy deps) --------------------

/** Pull schema.org reservation objects out of <script type="application/ld+json">
 * blocks. Flattens @graph and arrays. */
export function extractJsonLd(text: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      collect(parsed, out);
    } catch { /* skip malformed block */ }
  }
  return out;
}

function collect(node: any, out: unknown[]): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return; }
  if (node['@graph']) { collect(node['@graph'], out); return; }
  if (node['@type']) out.push(node);
}

/** Return the first VEVENT-containing ICS block found inline, else null. */
export function extractIcs(text: string): string | null {
  const m = /BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i.exec(text);
  if (m) return m[0];
  if (/BEGIN:VEVENT/i.test(text)) return text;
  return null;
}

// --- PDF text via pdf.js (lazy) --------------------------------------------

async function pdfText(file: File): Promise<string> {
  const pdfjs: any = await import(/* @vite-ignore */ PDFJS_URL);
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i: any) => i.str).join(' ') + '\n';
  }
  return text;
}

// --- OCR via tesseract.js (lazy, best-effort) ------------------------------

const TESSERACT_URL = './vendor/tesseract/tesseract.esm.min.js';

async function ocrImage(file: File): Promise<string> {
  try {
    const T: any = await import(/* @vite-ignore */ TESSERACT_URL);
    const recognize = T.recognize || T.default?.recognize;
    if (!recognize) return '';
    const { data } = await recognize(file, 'eng');
    return data?.text || '';
  } catch {
    return ''; // OCR unavailable offline / not vendored → manual fallback
  }
}

// --- helpers ---------------------------------------------------------------

function isTextual(mime: string, name: string): boolean {
  return /text\/|message\/rfc822|calendar|html|json/.test(mime) ||
    /\.(eml|html?|ics|txt|json)$/i.test(name);
}

function guessMime(name: string): string {
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.(png|jpe?g|webp|heic)$/i.test(name)) return 'image/*';
  if (/\.eml$/i.test(name)) return 'message/rfc822';
  if (/\.ics$/i.test(name)) return 'text/calendar';
  return 'application/octet-stream';
}
