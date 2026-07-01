/* Builds the reservations module to ./reservations.js as a single ESM bundle.
 * Emitted at the project root (like geo.js / vendor/leaflet) so the root-serving
 * dev server picks it up; the `copy` script carries it into www/ for native
 * builds. Loaded from index.html via <script type="module" src="reservations.js">.
 *
 * Heavy/optional libs are kept OUT of the bundle and loaded at runtime:
 *  - pdf.js + tesseract.js  → dynamic import from ./vendor/* (runtime URLs)
 *  - jeep-sqlite (web only)  → vendored module script in index.html
 * Capacitor packages and our own code ARE bundled. */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/reservations/index.ts'],
  outfile: 'reservations.js',
  bundle: true,
  format: 'esm',
  target: ['es2019', 'safari14'],
  platform: 'browser',
  sourcemap: false,
  minify: true,
  // Keep these as runtime imports rather than bundling them.
  external: ['jeep-sqlite/loader', './vendor/*'],
  logLevel: 'info',
});

console.log('built reservations.js');
