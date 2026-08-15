import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  deleteSavedGraphRecord,
  ensureSavedGraphsSchema,
  getSavedGraphRecordState,
  insertSavedGraphRecord,
  listSavedGraphRecords,
  migrateJsonRecordsIntoDb,
  migrateSavedGraphRecord,
} from "./saved-graphs.ts";

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
      v: 2 as const,
      exprText: "z^2 + 1",
      probeRe: "1",
      probeIm: "1",
      showRootsOfUnity: true,
      rootsN: "5",
      showConformalGrid: false,
      conformalGridType: "rectangular" as const,
      conformalGridSpacing: "0.5",
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
