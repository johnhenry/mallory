/**
 * Server-only save/gallery store for GraphCanvasMulti AND NotebookPanel
 * sessions (and every other panel that's wired up a "Save to gallery"
 * button since) -- a minimal "publish" primitive from the research
 * roadmap (not real-time collaboration or a full community platform, just
 * save-and-list-and-reopen).
 *
 * Backed by `node:sqlite` (issue #44 item 1) -- a single `saved_graphs`
 * table under `data/saved-graphs.sqlite`, replacing the previous plain
 * `data/saved-graphs.json` read-modify-write file (which raced under
 * concurrent writes and required parsing the entire store just to list
 * summaries). `node:sqlite` needs no native dependency to fight Nixpacks
 * over -- it's been unflagged since Node 22.13.0/23.4.0 (this app's CI
 * matrix runs 22.x/24.x, both well past that). Still single-Dokku-
 * process, not a multi-instance-safe store -- same scope as before, just
 * a better-behaved single-process store.
 *
 * On first boot, if the legacy `data/saved-graphs.json` file is present,
 * every record in it is migrated into the new table (via
 * `migrateJsonRecordsIntoDb`, `INSERT OR IGNORE` so a migration that's
 * interrupted mid-way and retried on the next boot can't crash on a
 * duplicate id), then the JSON file is renamed to `.migrated` -- both so
 * it stops being picked up as "still needs migrating" on the next boot,
 * and so it's kept around as a plain-text backup rather than deleted
 * outright.
 *
 * One shared table for every kind (rather than a table per kind): a
 * `kind` discriminant on each record says which state shape/encoder it
 * needs. Records saved before `kind` existed (pre-dating even the JSON
 * store's own kind field) have no such value -- treated as `"multi"` (the
 * only kind that existed then) throughout, so old saved graphs keep
 * working unchanged.
 */
import type { DatabaseSync } from "node:sqlite";
import { createServerFn } from "@tanstack/react-start";
import type { ComplexState } from "./complex-state.ts";
import { GALLERY_SEEDS, type GallerySeed } from "./gallery-seeds.ts";
import type { GeometryState } from "./geometry-state.ts";
import type { Linked3DState } from "./linked3d-state.ts";
import type { MultiGraphState } from "./multi-graph-state.ts";
import type { NotebookState } from "./notebook-state.ts";
import type { OdeState } from "./ode-state.ts";
import type { OdeSystemState } from "./ode-system-state.ts";
import type { RegressionState } from "./regression-state.ts";
import type { StatisticsState } from "./statistics-state.ts";
import type { SystemState } from "./system-state.ts";

export type SavedGraphKind =
  | "multi"
  | "notebook"
  | "geometry"
  | "surface-3d"
  | "ode"
  | "ode-system"
  | "regression"
  | "statistics"
  | "systems"
  | "complex";

export type SavedGraphState =
  | MultiGraphState
  | NotebookState
  | GeometryState
  | Linked3DState
  | OdeState
  | OdeSystemState
  | RegressionState
  | StatisticsState
  | SystemState
  | ComplexState;

export interface SavedGraphSummary {
  id: string;
  title: string;
  createdAt: number;
  kind: SavedGraphKind;
  /** True for a curated gallery-seeds.ts entry (issue #39) -- never written to the DB, so delete is a guaranteed no-op on one; the gallery UI uses this to hide the delete button rather than offer an action that silently does nothing. */
  readOnly?: boolean;
}

interface SavedGraphRecord extends SavedGraphSummary {
  state: SavedGraphState;
}

/**
 * Backward compatibility: a record saved before `kind` existed is implicitly
 * "multi", the only kind that existed then -- the on-disk/legacy-JSON shape
 * may genuinely lack `kind`, unlike `SavedGraphRecord`'s static type.
 * Extracted as a pure function so this migration logic is unit-testable
 * without touching the filesystem or `createServerFn`'s server-only
 * wrapper.
 */
export function migrateSavedGraphRecord(
  r: Omit<SavedGraphRecord, "kind"> & { kind?: SavedGraphKind },
): SavedGraphRecord {
  return { ...r, kind: r.kind ?? "multi" };
}

/** Idempotent -- safe to call on every boot, and safe to call more than once against the same `db`. */
export function ensureSavedGraphsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_graphs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      state TEXT NOT NULL
    )
  `);
}

export function insertSavedGraphRecord(db: DatabaseSync, record: SavedGraphRecord): void {
  db.prepare("INSERT INTO saved_graphs (id, title, kind, created_at, state) VALUES (?, ?, ?, ?, ?)").run(
    record.id,
    record.title,
    record.kind,
    record.createdAt,
    JSON.stringify(record.state),
  );
}

export function listSavedGraphRecords(db: DatabaseSync): SavedGraphSummary[] {
  const rows = db.prepare("SELECT id, title, kind, created_at FROM saved_graphs ORDER BY created_at DESC").all() as Array<{
    id: string;
    title: string;
    kind: SavedGraphKind;
    created_at: number;
  }>;
  return rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind, createdAt: r.created_at }));
}

export function getSavedGraphRecordState(db: DatabaseSync, id: string): SavedGraphState | undefined {
  const row = db.prepare("SELECT state FROM saved_graphs WHERE id = ?").get(id) as { state: string } | undefined;
  return row === undefined ? undefined : (JSON.parse(row.state) as SavedGraphState);
}

export function deleteSavedGraphRecord(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM saved_graphs WHERE id = ?").run(id);
}

/**
 * Migrates every record from a parsed legacy JSON array into `db`, via
 * `migrateSavedGraphRecord` for the same kind-defaulting the old JSON
 * store itself relied on. `INSERT OR IGNORE` (not a plain `INSERT`) so
 * re-running this against a JSON file that's already been partially
 * migrated (e.g. the process crashed between inserting rows and renaming
 * the JSON file away) can't fail on a duplicate id -- ids are
 * `crypto.randomUUID()`, so a genuine id collision from two DIFFERENT
 * records is not a realistic case this needs to guard against.
 */
export function migrateJsonRecordsIntoDb(db: DatabaseSync, jsonRecords: unknown[]): void {
  const insert = db.prepare("INSERT OR IGNORE INTO saved_graphs (id, title, kind, created_at, state) VALUES (?, ?, ?, ?, ?)");
  for (const raw of jsonRecords) {
    const record = migrateSavedGraphRecord(raw as Omit<SavedGraphRecord, "kind"> & { kind?: SavedGraphKind });
    insert.run(record.id, record.title, record.kind, record.createdAt, JSON.stringify(record.state));
  }
}

let dbInstance: DatabaseSync | null = null;

/** Exported so short-links.ts (issue #44 item 2) can share this same connection/file for its own `short_links` table, per the issue's own "same SQLite db" suggestion. */
export async function getGalleryDb(): Promise<DatabaseSync> {
  if (dbInstance) return dbInstance;
  const { DatabaseSync: DatabaseSyncCtor } = await import("node:sqlite");
  const path = await import("node:path");
  const { promises: fs } = await import("node:fs");
  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });
  const db = new DatabaseSyncCtor(path.join(dataDir, "saved-graphs.sqlite"));
  ensureSavedGraphsSchema(db);

  const legacyJsonPath = path.join(dataDir, "saved-graphs.json");
  try {
    const raw = await fs.readFile(legacyJsonPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) migrateJsonRecordsIntoDb(db, parsed);
    await fs.rename(legacyJsonPath, `${legacyJsonPath}.migrated`);
  } catch {
    // No legacy file (already migrated, or a fresh install) -- nothing to do.
  }

  dbInstance = db;
  return db;
}

export const saveGraph = createServerFn({ method: "POST" })
  .validator((data: { title: string; kind: SavedGraphKind; state: SavedGraphState }) => data)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const db = await getGalleryDb();
    const id = crypto.randomUUID();
    insertSavedGraphRecord(db, { id, title: data.title.trim() || "Untitled", createdAt: Date.now(), kind: data.kind, state: data.state });
    return { id };
  });

/** Merges the DB's own summaries with `gallery-seeds.ts`'s curated entries (marked `readOnly`), sorted newest-first together -- extracted as a pure function so the merge/sort/readOnly-tagging is unit-testable without touching SQLite. */
export function mergeGallerySummaries(dbSummaries: SavedGraphSummary[], seeds: GallerySeed[] = GALLERY_SEEDS): SavedGraphSummary[] {
  const seedSummaries: SavedGraphSummary[] = seeds.map((s) => ({ id: s.id, title: s.title, kind: s.kind, createdAt: s.createdAt, readOnly: true }));
  return [...dbSummaries, ...seedSummaries].sort((a, b) => b.createdAt - a.createdAt);
}

export const listSavedGraphs = createServerFn({ method: "GET" }).handler(async (): Promise<SavedGraphSummary[]> => {
  const db = await getGalleryDb();
  return mergeGallerySummaries(listSavedGraphRecords(db));
});

export const getSavedGraph = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SavedGraphState> => {
    const seed = GALLERY_SEEDS.find((s) => s.id === data.id);
    if (seed) return seed.state;
    const db = await getGalleryDb();
    const state = getSavedGraphRecordState(db, data.id);
    if (state === undefined) throw new Error("Unknown or deleted saved graph.");
    return state;
  });

export const deleteSavedGraph = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    // A seed id is never written to the DB, so this would already be a
    // harmless no-op below -- returning early just documents the intent
    // (read-only gallery seeds can't be deleted) rather than relying on
    // that as an implicit side effect.
    if (GALLERY_SEEDS.some((s) => s.id === data.id)) return;
    const db = await getGalleryDb();
    deleteSavedGraphRecord(db, data.id);
  });
