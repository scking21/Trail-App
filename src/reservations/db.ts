/* db.ts — single SQLite connection + migrations for the reservations module.
 *
 * Works on iOS/Android (native plugin) and on web/PWA (via the jeep-sqlite web
 * component backed by sql.js in IndexedDB). Everything stays on-device; there is
 * no network path. Call initDb() once at startup before any service call. */

import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

const DB_NAME = 'blackrow_travel';
const DB_VERSION = 1;

let conn: SQLiteConnection | null = null;
let db: SQLiteDBConnection | null = null;
let ready: Promise<SQLiteDBConnection> | null = null;

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT, end_date TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flight','hotel','car','train')),
  provider TEXT, confirmation TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  cost_amount REAL, cost_currency TEXT, notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual', parse_conf REAL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS reservation_segments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  from_name TEXT, from_detail TEXT, from_time_utc TEXT, from_time_local TEXT, from_tz TEXT,
  to_name TEXT, to_detail TEXT, to_time_utc TEXT, to_time_local TEXT, to_tz TEXT,
  extra_json TEXT
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, mime TEXT, filename TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_trip ON reservations(trip_id);
CREATE INDEX IF NOT EXISTS idx_res_kind ON reservations(kind);
CREATE INDEX IF NOT EXISTS idx_seg_res ON reservation_segments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_seg_time ON reservation_segments(from_time_utc);
`;

/** Initialize the DB exactly once. Safe to await repeatedly. */
export function initDb(): Promise<SQLiteDBConnection> {
  if (ready) return ready;
  ready = (async () => {
    conn = new SQLiteConnection(CapacitorSQLite);

    // Web needs the jeep-sqlite element + a one-time store init. The web store
    // depends on the jeep-sqlite Stencil component hydrating, which can stall in
    // hostile contexts (a backgrounded tab where rAF is paused, private mode, or
    // storage blocked). Guard it so the UI can show an error instead of hanging.
    if (Capacitor.getPlatform() === 'web') {
      // whenDefined never resolves if the jeep-sqlite module didn't load (not
      // vendored / blocked), so it must be time-boxed too — otherwise init hangs
      // forever and the UI is stuck on "Loading…" instead of showing an error.
      await withTimeout(customElements.whenDefined('jeep-sqlite'), 15000,
        'Web database component (jeep-sqlite) failed to load.');
      await withTimeout(conn.initWebStore(), 15000,
        'Web database failed to initialize (storage blocked or tab inactive).');
    }

    // Reuse a live connection if one already exists (e.g. after HMR).
    const isConn = (await conn.isConnection(DB_NAME, false)).result;
    db = isConn
      ? await conn.retrieveConnection(DB_NAME, false)
      : await conn.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);

    await db.open();
    await db.execute('PRAGMA foreign_keys = ON;');
    await db.execute(MIGRATION_001);
    await persist();
    return db;
  })();
  // If init fails, clear the memo so a later attempt (e.g. tab refocus) can retry.
  ready.catch(() => { ready = null; });
  return ready;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export function getDb(): SQLiteDBConnection {
  if (!db) throw new Error('initDb() must be awaited before using the database');
  return db;
}

/** Persist the web store to IndexedDB (no-op on native). */
export async function persist(): Promise<void> {
  if (conn && Capacitor.getPlatform() === 'web') {
    await conn.saveToStore(DB_NAME);
  }
}

/** Run a block inside a transaction, rolling back on error, then persist. */
export async function withTransaction<T>(
  fn: (d: SQLiteDBConnection) => Promise<T>,
): Promise<T> {
  const d = getDb();
  await d.beginTransaction();
  try {
    const out = await fn(d);
    await d.commitTransaction();
    await persist();
    return out;
  } catch (e) {
    try { await d.rollbackTransaction(); } catch { /* already rolled back */ }
    throw e;
  }
}
