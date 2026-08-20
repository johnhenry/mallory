import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundStepLabel, stepLabel, tileColor } from "./TilesPanel.tsx";

test("tileColor: the same tile id always produces the same color", () => {
  assert.equal(tileColor("A"), tileColor("A"));
});

test("tileColor: different tile ids usually produce different colors (spot check, not a hash-collision guarantee)", () => {
  assert.notEqual(tileColor("A"), tileColor("B"));
});

test("tileColor: returns a valid hsl() string", () => {
  assert.match(tileColor("tile-42"), /^hsl\(\d+, 55%, 55%\)$/);
});

test("stepLabel: a non-contradiction step reads as a placement at its (row, col)", () => {
  assert.equal(stepLabel({ grid: [], row: 2, col: 3, contradiction: false }), "Place tile at (2, 3)");
});

test("stepLabel: a contradiction step reads as a backtrack at its (row, col)", () => {
  assert.equal(stepLabel({ grid: [], row: 1, col: 0, contradiction: true }), "Backtrack at (1, 0)");
});

test("compoundStepLabel: a non-contradiction step names the placed tile and its anchor", () => {
  assert.equal(compoundStepLabel({ grid: [], anchorRow: 2, anchorCol: 3, tileId: "AB", contradiction: false }), 'Place tile "AB" at anchor (2, 3)');
});

test("compoundStepLabel: a contradiction step reads as a backtrack at its anchor", () => {
  assert.equal(compoundStepLabel({ grid: [], anchorRow: 1, anchorCol: 0, tileId: null, contradiction: true }), "Backtrack at anchor (1, 0)");
});
