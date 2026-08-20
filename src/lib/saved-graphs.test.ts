import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { decodeComplexState, encodeComplexState } from "./complex-state.ts";
import { GALLERY_SEEDS } from "./gallery-seeds.ts";
import { decodeGeometryState, encodeGeometryState } from "./geometry-state.ts";
import { decodeLinked3DState, encodeLinked3DState } from "./linked3d-state.ts";
import { decodeMultiGraphState, encodeMultiGraphState } from "./multi-graph-state.ts";
import { decodeNotebookState, encodeNotebookState } from "./notebook-state.ts";
import { decodeOdeState, encodeOdeState } from "./ode-state.ts";
import { decodeOdeSystemState, encodeOdeSystemState } from "./ode-system-state.ts";
import { decodeRegressionState, encodeRegressionState } from "./regression-state.ts";
import {
  deleteSavedGraphRecord,
  ensureSavedGraphsSchema,
  getSavedGraphRecordState,
  insertSavedGraphRecord,
  listSavedGraphRecords,
  mergeGallerySummaries,
  migrateJsonRecordsIntoDb,
  migrateSavedGraphRecord,
} from "./saved-graphs.ts";
import { decodeStatisticsState, encodeStatisticsState } from "./statistics-state.ts";
import { decodeSystemState, encodeSystemState } from "./system-state.ts";

/** One encode/decode pair per SavedGraphKind that appears in GALLERY_SEEDS -- used to round-trip each seed's `state` through its own codec below. */
// biome-ignore lint/suspicious/noExplicitAny: each encode*/decode* pair has a different, specific state type; this table intentionally erases that for a generic round-trip loop.
const CODEC_BY_KIND: Record<string, { encode: (s: any) => string; decode: (f: string) => any }> = {
  multi: { encode: encodeMultiGraphState, decode: decodeMultiGraphState },
  complex: { encode: encodeComplexState, decode: decodeComplexState },
  geometry: { encode: encodeGeometryState, decode: decodeGeometryState },
  "surface-3d": { encode: encodeLinked3DState, decode: decodeLinked3DState },
  ode: { encode: encodeOdeState, decode: decodeOdeState },
  "ode-system": { encode: encodeOdeSystemState, decode: decodeOdeSystemState },
  regression: { encode: encodeRegressionState, decode: decodeRegressionState },
  statistics: { encode: encodeStatisticsState, decode: decodeStatisticsState },
  systems: { encode: encodeSystemState, decode: decodeSystemState },
  notebook: { encode: encodeNotebookState, decode: decodeNotebookState },
};

/** A fresh in-memory schema-ready DB per test -- no real filesystem touched, mirroring this file's own no-fs-dependency convention for `migrateSavedGraphRecord`'s tests below. */
function testDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureSavedGraphsSchema(db);
  return db;
}

const MULTI_STATE = {
  v: 1 as const,
  rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
  viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
};

test("migrateSavedGraphRecord defaults a missing kind to 'multi' (pre-kind on-disk records)", () => {
  const legacy = { id: "abc", title: "Untitled", createdAt: 1700000000000, state: MULTI_STATE };
  const migrated = migrateSavedGraphRecord(legacy);
  assert.equal(migrated.kind, "multi");
  assert.equal(migrated.id, "abc");
  assert.equal(migrated.title, "Untitled");
  assert.equal(migrated.createdAt, 1700000000000);
  assert.deepEqual(migrated.state, MULTI_STATE);
});

test("migrateSavedGraphRecord leaves an explicit kind untouched", () => {
  const record = { id: "def", title: "My Notebook", createdAt: 1700000001000, kind: "notebook" as const, state: { v: 1 as const, blocks: [] } };
  const migrated = migrateSavedGraphRecord(record);
  assert.equal(migrated.kind, "notebook");
});

test("migrateSavedGraphRecord leaves an explicit 'complex' kind untouched", () => {
  const record = {
    id: "jkl",
    title: "My Complex Plane",
    createdAt: 1700000003000,
    kind: "complex" as const,
    state: {
      v: 4 as const,
      rows: [
        {
          exprText: "z^2 + 1",
          probeRe: "1",
          probeIm: "1",
          showRootsOfUnity: true,
          rootsN: "5",
          showConformalGrid: false,
          conformalGridType: "rectangular" as const,
          conformalGridSpacing: "0.5",
          showZeros: false,
          showPoles: false,
          color: 0x9333ea,
          visible: true,
        },
      ],
    },
  };
  const migrated = migrateSavedGraphRecord(record);
  assert.equal(migrated.kind, "complex");
});

test("migrateSavedGraphRecord doesn't default an explicit 'multi' kind to something else", () => {
  const record = { id: "ghi", title: "Explicit Multi", createdAt: 1700000002000, kind: "multi" as const, state: MULTI_STATE };
  const migrated = migrateSavedGraphRecord(record);
  assert.equal(migrated.kind, "multi");
});

test("insertSavedGraphRecord + getSavedGraphRecordState round-trips the exact state that was saved", () => {
  const db = testDb();
  insertSavedGraphRecord(db, { id: "row-1", title: "Untitled", createdAt: 1700000000000, kind: "multi", state: MULTI_STATE });
  assert.deepEqual(getSavedGraphRecordState(db, "row-1"), MULTI_STATE);
});

test("getSavedGraphRecordState returns undefined for an id that was never inserted", () => {
  const db = testDb();
  assert.equal(getSavedGraphRecordState(db, "does-not-exist"), undefined);
});

test("listSavedGraphRecords returns summaries only (no state payload), newest first", () => {
  const db = testDb();
  insertSavedGraphRecord(db, { id: "older", title: "Older", createdAt: 1000, kind: "multi", state: MULTI_STATE });
  insertSavedGraphRecord(db, { id: "newer", title: "Newer", createdAt: 2000, kind: "notebook", state: { v: 1, blocks: [] } });
  const summaries = listSavedGraphRecords(db);
  assert.deepEqual(summaries, [
    { id: "newer", title: "Newer", createdAt: 2000, kind: "notebook" },
    { id: "older", title: "Older", createdAt: 1000, kind: "multi" },
  ]);
});

test("deleteSavedGraphRecord removes exactly the targeted row, leaving the rest", () => {
  const db = testDb();
  insertSavedGraphRecord(db, { id: "keep", title: "Keep", createdAt: 1000, kind: "multi", state: MULTI_STATE });
  insertSavedGraphRecord(db, { id: "remove", title: "Remove", createdAt: 2000, kind: "multi", state: MULTI_STATE });
  deleteSavedGraphRecord(db, "remove");
  assert.equal(getSavedGraphRecordState(db, "remove"), undefined);
  assert.deepEqual(getSavedGraphRecordState(db, "keep"), MULTI_STATE);
});

test("migrateJsonRecordsIntoDb inserts a legacy record and defaults its missing kind to 'multi'", () => {
  const db = testDb();
  migrateJsonRecordsIntoDb(db, [{ id: "legacy-1", title: "Legacy", createdAt: 1700000000000, state: MULTI_STATE }]);
  const summaries = listSavedGraphRecords(db);
  assert.deepEqual(summaries, [{ id: "legacy-1", title: "Legacy", createdAt: 1700000000000, kind: "multi" }]);
  assert.deepEqual(getSavedGraphRecordState(db, "legacy-1"), MULTI_STATE);
});

test("migrateJsonRecordsIntoDb is idempotent -- re-running it against the same records doesn't throw or duplicate rows", () => {
  const db = testDb();
  const records = [{ id: "legacy-1", title: "Legacy", createdAt: 1700000000000, kind: "notebook" as const, state: { v: 1 as const, blocks: [] } }];
  migrateJsonRecordsIntoDb(db, records);
  migrateJsonRecordsIntoDb(db, records); // simulates a retried migration after an interrupted first attempt
  assert.equal(listSavedGraphRecords(db).length, 1);
});

test("GALLERY_SEEDS: every seed's state round-trips through its own kind's encode/decode pair unchanged", () => {
  for (const seed of GALLERY_SEEDS) {
    const codec = CODEC_BY_KIND[seed.kind];
    assert.ok(codec, `no codec registered for kind "${seed.kind}" -- add one to CODEC_BY_KIND above`);
    const decoded = codec.decode(codec.encode(seed.state));
    assert.notEqual(decoded, null, `${seed.id}: encode/decode round trip returned null`);
    assert.deepEqual(decoded, seed.state, `${seed.id}: decoded state does not match the original`);
  }
});

test("GALLERY_SEEDS: every id is unique", () => {
  const ids = GALLERY_SEEDS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("mergeGallerySummaries: DB summaries and seed summaries are merged and sorted newest-first together", () => {
  const dbSummaries = [
    { id: "db-old", title: "DB Old", createdAt: 500, kind: "multi" as const },
    { id: "db-new", title: "DB New", createdAt: 1500, kind: "notebook" as const },
  ];
  const seeds = [
    { id: "seed-a", title: "Seed A", kind: "multi" as const, createdAt: 1000, state: { v: 1 as const, rows: [], viewport: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, annotations: [], mode: "float" as const } },
  ];
  const merged = mergeGallerySummaries(dbSummaries, seeds);
  assert.deepEqual(merged, [
    { id: "db-new", title: "DB New", createdAt: 1500, kind: "notebook" },
    { id: "seed-a", title: "Seed A", createdAt: 1000, kind: "multi", readOnly: true },
    { id: "db-old", title: "DB Old", createdAt: 500, kind: "multi" },
  ]);
});

test("mergeGallerySummaries: every merged seed summary is marked readOnly, DB summaries are not", () => {
  const merged = mergeGallerySummaries([{ id: "db-1", title: "Mine", createdAt: 1, kind: "multi" as const }], GALLERY_SEEDS);
  const dbEntry = merged.find((e) => e.id === "db-1");
  assert.equal(dbEntry?.readOnly, undefined);
  const seedEntries = merged.filter((e) => e.id !== "db-1");
  assert.equal(seedEntries.length, GALLERY_SEEDS.length);
  assert.ok(seedEntries.every((e) => e.readOnly === true));
});
