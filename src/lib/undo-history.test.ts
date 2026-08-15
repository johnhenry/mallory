import assert from "node:assert/strict";
import { test } from "node:test";
import { UndoHistory } from "./undo-history.ts";

test("UndoHistory: record/undo/redo walk the states in the expected order", () => {
  const h = new UndoHistory({ n: 0 });
  h.record({ n: 1 });
  h.record({ n: 2 });
  assert.deepEqual(h.undo(), { n: 1 });
  assert.deepEqual(h.undo(), { n: 0 });
  assert.equal(h.undo(), null);
  assert.deepEqual(h.redo(), { n: 1 });
  assert.deepEqual(h.redo(), { n: 2 });
  assert.equal(h.redo(), null);
});

test("UndoHistory: recording a structurally-equal state is a no-op (no phantom undo steps)", () => {
  const h = new UndoHistory({ rows: [{ source: "x" }] });
  h.record({ rows: [{ source: "x" }] }); // structurally identical, different object
  assert.equal(h.canUndo, false);
});

test("UndoHistory: a new record after undo clears the redo stack (branch discard)", () => {
  const h = new UndoHistory({ n: 0 });
  h.record({ n: 1 });
  h.record({ n: 2 });
  h.undo(); // present = 1, future = [2]
  assert.equal(h.canRedo, true);
  h.record({ n: 99 }); // branches: 2 is discarded
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.undo(), { n: 1 });
  assert.deepEqual(h.redo(), { n: 99 });
});

test("UndoHistory: maxDepth bounds the past (oldest entries fall off; undo bottoms out at the oldest retained state)", () => {
  const h = new UndoHistory({ n: 0 }, { maxDepth: 3 });
  for (let i = 1; i <= 10; i++) h.record({ n: i });
  let last: { n: number } | null = null;
  let steps = 0;
  for (let u = h.undo(); u !== null; u = h.undo()) {
    last = u;
    steps++;
  }
  assert.equal(steps, 3);
  assert.deepEqual(last, { n: 7 }); // 10 records, keep the 3 most recent past states: 7, 8, 9
});

test("UndoHistory: canUndo/canRedo track the stacks", () => {
  const h = new UndoHistory({ n: 0 });
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  h.record({ n: 1 });
  assert.equal(h.canUndo, true);
  assert.equal(h.canRedo, false);
  h.undo();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
});
