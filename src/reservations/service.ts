/* service.ts — local-first persistence for reservations.
 *
 * Per the product decision (local-only, sync dropped), this writes to SQLite and
 * stops: no queue, no upload, no network. The updated_at timestamps and the
 * deleted_at soft-delete column are the only seams left so a future sync layer
 * could be added without a schema migration. */

import { getDb, withTransaction } from './db';
import type {
  Attachment, NewReservation, Reservation, Segment,
} from './types';

function uid(): string {
  // Time-ordered-ish, no Date.now collision worries for on-device single-user.
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

/** Insert a reservation and its segments/attachments atomically. */
export async function saveReservation(input: NewReservation): Promise<Reservation> {
  const now = Date.now();
  const res: Reservation = {
    ...input,
    id: 'res_' + uid(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await withTransaction(async (d) => {
    await d.run(
      `INSERT INTO reservations
       (id,trip_id,kind,provider,confirmation,status,cost_amount,cost_currency,
        notes,source,parse_conf,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [res.id, res.tripId ?? null, res.kind, res.provider ?? null,
       res.confirmation ?? null, res.status, res.cost?.amount ?? null,
       res.cost?.currency ?? null, res.notes ?? null, res.source,
       res.parseConfidence ?? null, now, now],
    );
    for (const s of res.segments) {
      await d.run(
        `INSERT INTO reservation_segments
         (id,reservation_id,seq,from_name,from_detail,from_time_utc,from_time_local,from_tz,
          to_name,to_detail,to_time_utc,to_time_local,to_tz,extra_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['seg_' + uid(), res.id, s.seq,
         s.from.name ?? null, s.from.detail ?? null, s.from.timeUtc ?? null,
         s.from.timeLocal ?? null, s.from.tz ?? null,
         s.to?.name ?? null, s.to?.detail ?? null, s.to?.timeUtc ?? null,
         s.to?.timeLocal ?? null, s.to?.tz ?? null,
         JSON.stringify(s.extra ?? {})],
      );
    }
    for (const a of res.attachments ?? []) {
      await d.run(
        `INSERT INTO attachments (id,reservation_id,file_path,mime,filename,created_at)
         VALUES (?,?,?,?,?,?)`,
        ['att_' + uid(), res.id, a.filePath, a.mime ?? null, a.filename ?? null, now],
      );
    }
  });

  return res;
}

/** All live reservations for a trip, segments + attachments hydrated, ordered by
 * the first segment's departure time. */
export async function listReservationsForTrip(tripId: string): Promise<Reservation[]> {
  return hydrate(
    `SELECT * FROM reservations WHERE trip_id = ? AND deleted_at IS NULL`,
    [tripId],
  );
}

/** All live reservations across every trip (and unassigned), upcoming first. */
export async function listAllReservations(): Promise<Reservation[]> {
  return hydrate(`SELECT * FROM reservations WHERE deleted_at IS NULL`, []);
}

async function hydrate(sql: string, params: unknown[]): Promise<Reservation[]> {
  const d = getDb();
  const rows = ((await d.query(sql, params as never[])).values ?? []) as any[];
  if (!rows.length) return [];

  // Fetch all segments/attachments for the matched reservations in one query
  // each (avoids N+1), then group in memory.
  const ids = rows.map((r) => r.id);
  const holes = ids.map(() => '?').join(',');
  const segRows = ((await d.query(
    `SELECT * FROM reservation_segments WHERE reservation_id IN (${holes}) ORDER BY seq`,
    ids as never[],
  )).values ?? []) as any[];
  const attRows = ((await d.query(
    `SELECT * FROM attachments WHERE reservation_id IN (${holes})`,
    ids as never[],
  )).values ?? []) as any[];
  const segsBy = groupBy(segRows, (s) => s.reservation_id);
  const attsBy = groupBy(attRows, (a) => a.reservation_id);

  const out = rows.map((r) =>
    rowToReservation(r, segsBy.get(r.id) ?? [], attsBy.get(r.id) ?? []));
  // Sort by earliest segment departure (nulls last).
  out.sort((a, b) => firstTime(a) - firstTime(b));
  return out;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function firstTime(r: Reservation): number {
  // Prefer the sortable UTC truth; fall back to the local wall-clock so records
  // without a known zone (most hotels/cars) still sort by date instead of all
  // sinking to the bottom.
  const from = r.segments[0]?.from;
  const t = from?.timeUtc || from?.timeLocal || null;
  const parsed = t ? Date.parse(t) : NaN;
  return isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function rowToReservation(r: any, segs: any[], atts: any[]): Reservation {
  const segments: Segment[] = segs.map((s) => ({
    seq: s.seq,
    from: {
      name: s.from_name, detail: s.from_detail, timeUtc: s.from_time_utc,
      timeLocal: s.from_time_local, tz: s.from_tz,
    },
    to: s.to_name || s.to_time_utc ? {
      name: s.to_name, detail: s.to_detail, timeUtc: s.to_time_utc,
      timeLocal: s.to_time_local, tz: s.to_tz,
    } : null,
    extra: safeJson(s.extra_json),
  }));
  const attachments: Attachment[] = atts.map((a) => ({
    id: a.id, filePath: a.file_path, mime: a.mime, filename: a.filename,
  }));
  return {
    id: r.id, tripId: r.trip_id, kind: r.kind, provider: r.provider,
    confirmation: r.confirmation, status: r.status,
    cost: r.cost_amount != null ? { amount: r.cost_amount, currency: r.cost_currency } : null,
    notes: r.notes, source: r.source, parseConfidence: r.parse_conf,
    segments, attachments,
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

function safeJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

/** Soft-delete (keeps the row so a future sync could propagate the tombstone). */
export async function deleteReservation(id: string): Promise<void> {
  await withTransaction(async (d) => {
    await d.run(`UPDATE reservations SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [Date.now(), Date.now(), id]);
  });
}

/** Export all live reservation tables as a plain object for the backup file. */
export async function exportForBackup(): Promise<unknown> {
  const d = getDb();
  const t = async (sql: string) => (await d.query(sql, [])).values ?? [];
  // Only export children of live reservations. Exporting segments/attachments of
  // soft-deleted (and thus omitted) reservations would make the backup
  // referentially inconsistent and fail restore under `foreign_keys = ON`.
  const live = 'SELECT id FROM reservations WHERE deleted_at IS NULL';
  return {
    trips: await t('SELECT * FROM trips'),
    reservations: await t('SELECT * FROM reservations WHERE deleted_at IS NULL'),
    reservation_segments: await t(`SELECT * FROM reservation_segments WHERE reservation_id IN (${live})`),
    attachments: await t(`SELECT * FROM attachments WHERE reservation_id IN (${live})`),
  };
}

/** Re-insert reservations from a backup payload (used by restore). Replaces
 * existing rows by id. */
export async function importFromBackup(data: any): Promise<void> {
  if (!data) return;
  await withTransaction(async (d) => {
    // Trips first — reservations reference trips(id), so they must exist before
    // any reservation with a non-null trip_id is inserted (foreign_keys = ON).
    for (const tr of data.trips ?? []) {
      await d.run(
        `INSERT OR REPLACE INTO trips (id,name,start_date,end_date,created_at,updated_at)
         VALUES (?,?,?,?,?,?)`,
        [tr.id, tr.name, tr.start_date ?? null, tr.end_date ?? null,
         tr.created_at, tr.updated_at],
      );
    }
    for (const r of data.reservations ?? []) {
      await d.run(
        `INSERT OR REPLACE INTO reservations
         (id,trip_id,kind,provider,confirmation,status,cost_amount,cost_currency,
          notes,source,parse_conf,created_at,updated_at,deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.id, r.trip_id, r.kind, r.provider, r.confirmation, r.status,
         r.cost_amount, r.cost_currency, r.notes, r.source, r.parse_conf,
         r.created_at, r.updated_at, r.deleted_at ?? null],
      );
    }
    for (const s of data.reservation_segments ?? []) {
      await d.run(
        `INSERT OR REPLACE INTO reservation_segments
         (id,reservation_id,seq,from_name,from_detail,from_time_utc,from_time_local,from_tz,
          to_name,to_detail,to_time_utc,to_time_local,to_tz,extra_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.reservation_id, s.seq, s.from_name, s.from_detail, s.from_time_utc,
         s.from_time_local, s.from_tz, s.to_name, s.to_detail, s.to_time_utc,
         s.to_time_local, s.to_tz, s.extra_json],
      );
    }
    for (const a of data.attachments ?? []) {
      await d.run(
        `INSERT OR REPLACE INTO attachments (id,reservation_id,file_path,mime,filename,created_at)
         VALUES (?,?,?,?,?,?)`,
        [a.id, a.reservation_id, a.file_path, a.mime, a.filename, a.created_at],
      );
    }
  });
}
