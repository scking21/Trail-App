/* Vendor the reservations module's runtime assets into the project root (vendor/
 * and assets/) so the feature works fully offline (no CDN) and is served by the
 * root dev server. The `copy` script then carries vendor/** and assets/** into
 * www/ for native builds. Run as part of `npm run build` (copy:assets). */

import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

function copy(from, to) {
  if (!existsSync(from)) {
    console.warn('copy-res-assets: missing', from, '(skipped)');
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log('vendored', to);
}

// pdf.js — text extraction + its worker
copy('node_modules/pdfjs-dist/build/pdf.min.mjs', 'vendor/pdfjs/pdf.min.mjs');
copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs');

// tesseract.js — OCR (esm entry + worker + wasm core)
copy('node_modules/tesseract.js/dist/tesseract.esm.min.js', 'vendor/tesseract/tesseract.esm.min.js');
copy('node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js');
copy('node_modules/tesseract.js-core', 'vendor/tesseract/core');

// jeep-sqlite — web SQLite custom element + sql.js wasm (web build only)
copy('node_modules/jeep-sqlite/dist/jeep-sqlite', 'vendor/jeep-sqlite');
copy('node_modules/sql.js/dist/sql-wasm.wasm', 'assets/sql-wasm.wasm');

console.log('copy-res-assets done');
