import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSpaceCurve } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { seedSpaceCurveRow } from "./SpaceCurvePanel.tsx";

// Unlimited expressions (issue #251): SpaceCurvePanel now holds an ordered
// list of curve rows on one shared CellGraph, each with its own x/y/z(t), t
// domain, color and visibility -- mirrors GraphCanvasMulti.test.ts's own
// "seed rows directly on a CellGraph, no React rendering" style.

const HELIX_ROW = { exprX: "cos(t)", exprY: "sin(t)", exprZ: "0.15*t", tMin: "0", tMax: "12.566", color: 0x2563eb, visible: true };

test("seedSpaceCurveRow: two rows produce independent, sufficiently-sampled point sets", () => {
  const graph = new CellGraph();
  seedSpaceCurveRow(graph, "row-1", HELIX_ROW);
  seedSpaceCurveRow(graph, "row-2", { ...HELIX_ROW, exprZ: "0", color: 0xdc2626 });
  const pointsA = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsSpaceCurve("row-1").points);
  const pointsB = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsSpaceCurve("row-2").points);
  assert.ok(pointsA.ok && pointsA.value.length > 1);
  assert.ok(pointsB.ok && pointsB.value.length > 1);
});

test("seedSpaceCurveRow: a row's own t-domain error doesn't affect a sibling row", () => {
  const graph = new CellGraph();
  seedSpaceCurveRow(graph, "row-1", HELIX_ROW);
  seedSpaceCurveRow(graph, "row-2", { ...HELIX_ROW, tMin: "5", tMax: "1" }); // tMin >= tMax -- invalid
  const pointsA = graph.get<{ ok: true } | { ok: false }>(cellIdsSpaceCurve("row-1").points);
  const pointsB = graph.get<{ ok: true } | { ok: false }>(cellIdsSpaceCurve("row-2").points);
  assert.ok(pointsA.ok);
  assert.equal(pointsB.ok, false);
});

test("seedSpaceCurveRow: each row keeps its own color", () => {
  const graph = new CellGraph();
  seedSpaceCurveRow(graph, "row-1", HELIX_ROW);
  seedSpaceCurveRow(graph, "row-2", { ...HELIX_ROW, color: 0x16a34a });
  assert.equal(graph.get<number>(cellIdsSpaceCurve("row-1").color), 0x2563eb);
  assert.equal(graph.get<number>(cellIdsSpaceCurve("row-2").color), 0x16a34a);
});

test("appendRow/removeRow: grow and shrink a space-curve panel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIdsSpaceCurve("curve-test").list;
  const rowId = crypto.randomUUID();
  seedSpaceCurveRow(graph, rowId, HELIX_ROW);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, listCellId);
  assert.equal(index, 1);
  seedSpaceCurveRow(graph, id2, { ...HELIX_ROW, color: 0xdc2626 });
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIdsSpaceCurve(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIdsSpaceCurve(id2).exprX), false);
});
