/* index.ts — entry point for the reservations bundle (compiled to
 * www/reservations.js by esbuild). It wires the module into the existing
 * vanilla-JS app via a small global object, mirroring how the app already
 * exposes Geo/Billing/etc. No framework, no build-time coupling to index.html. */

import { Capacitor } from '@capacitor/core';
import { initDb } from './db';
import { renderReservationsView } from './ui';
import { exportForBackup, importFromBackup } from './service';

let initPromise: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (Capacitor.getPlatform() === 'web') {
      // The <jeep-sqlite> custom element is registered by a vendored module
      // script in index.html (see build copy:assets). We just make sure an
      // instance exists and is defined before opening the web store.
      if (!document.querySelector('jeep-sqlite')) {
        document.body.appendChild(document.createElement('jeep-sqlite'));
      }
      await Promise.race([
        customElements.whenDefined('jeep-sqlite'),
        new Promise((r) => setTimeout(r, 4000)), // don't hang if vendoring is off
      ]);
    }
    await initDb();
  })();
  return initPromise;
}

export interface ReservationsApi {
  /** Render the Reservations view into a container element. */
  mount(container: HTMLElement): Promise<void>;
  /** For the backup file: returns reservation tables as a plain object. */
  exportForBackup(): Promise<unknown>;
  /** For restore: re-inserts reservations from a backup payload. */
  importFromBackup(data: unknown): Promise<void>;
  /** Resolves once the DB is open (useful to gate UI). */
  ready(): Promise<void>;
}

const api: ReservationsApi = {
  async mount(container: HTMLElement) {
    await ensureReady();
    await renderReservationsView(container);
  },
  async exportForBackup() {
    await ensureReady();
    return exportForBackup();
  },
  async importFromBackup(data: unknown) {
    await ensureReady();
    return importFromBackup(data);
  },
  ready: ensureReady,
};

(window as any).BlackrowReservations = api;

export default api;
