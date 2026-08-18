import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsVectorField3D } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { decodeVectorField3DState, encodeVectorField3DState } from "../lib/vector-field-3d-state.ts";
import { seedVectorField3DRow } from "./VectorField3DPanel.tsx";

// Unlimited expressions (issue #251): VectorField3DPanel now holds an
// ordered list of field rows on one shared CellGraph, each with its own
// dx/dy/dz(x,y,z), sampling box, color and visibility -- mirrors
// GraphCanvasMulti.test.ts's own "seed rows directly on a CellGraph, no
// React rendering" style.

const SWIRL_ROW = { exprDx: "-y", exprDy: "x", exprDz: "0.2*z", xMin: "-2", xMax: "2", yMin: "-2", yMax: "2", zMin: "-2", zMax: "2", color: 0x2563eb, visible: true };

test("seedVectorField3DRow: two rows produce independent non-empty point sets", () => {
  const graph = new CellGraph();
  seedVectorField3DRow(graph, "row-1", SWIRL_ROW);
  seedVectorField3DRow(graph, "row-2", { ...SWIRL_ROW, exprDz: "0", color: 0xdc2626 });
  const pointsA = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsVectorField3D("row-1").points);
  const pointsB = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsVectorField3D("row-2").points);
  assert.ok(pointsA.ok && pointsA.value.length > 0);
  assert.ok(pointsB.ok && pointsB.value.length > 0);
});

test("seedVectorField3DRow: an invalid domain on one row (min >= max) doesn't affect a sibling row", () => {
  const graph = new CellGraph();
  seedVectorField3DRow(graph, "row-1", SWIRL_ROW);
  seedVectorField3DRow(graph, "row-2", { ...SWIRL_ROW, xMin: "3", xMax: "1" });
  const pointsA = graph.get<{ ok: true } | { ok: false }>(cellIdsVectorField3D("row-1").points);
  const pointsB = graph.get<{ ok: true } | { ok: false }>(cellIdsVectorField3D("row-2").points);
  assert.ok(pointsA.ok);
  assert.equal(pointsB.ok, false);
});

test("seedVectorField3DRow: each row keeps its own color", () => {
  const graph = new CellGraph();
  seedVectorField3DRow(graph, "row-1", SWIRL_ROW);
  seedVectorField3DRow(graph, "row-2", { ...SWIRL_ROW, color: 0x16a34a });
  assert.equal(graph.get<number>(cellIdsVectorField3D("row-1").color), 0x2563eb);
  assert.equal(graph.get<number>(cellIdsVectorField3D("row-2").color), 0x16a34a);
});

test("appendRow/removeRow: grow and shrink a vector-field panel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIdsVectorField3D("field-test").list;
  const rowId = crypto.randomUUID();
  seedVectorField3DRow(graph, rowId, SWIRL_ROW);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, listCellId);
  assert.equal(index, 1);
  seedVectorField3DRow(graph, id2, { ...SWIRL_ROW, color: 0xdc2626 });
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIdsVectorField3D(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIdsVectorField3D(id2).exprDx), false);
});

test("decodeVectorField3DState: a legacy v1 (single-field) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = {
    v: 1,
    exprDx: "-y",
    exprDy: "x",
    exprDz: "0.2*z",
    xMin: "-2",
    xMax: "2",
    yMin: "-2",
    yMax: "2",
    zMin: "-2",
    zMax: "2",
  };
  const encodeLegacy = encodeVectorField3DState as unknown as (s: unknown) => string;
  const decoded = decodeVectorField3DState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.exprDx, "-y");
});
