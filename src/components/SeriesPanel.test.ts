import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSeries } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { decodeSeriesState, encodeSeriesState } from "../lib/series-state.ts";
import { seedSeriesRow } from "./SeriesPanel.tsx";

// Unlimited expressions (issue #251): SeriesPanel now holds an ordered list
// of series rows on one shared CellGraph, each with its own Σ expression,
// variable, from/to bounds, plot count, color and visibility -- mirrors
// GraphCanvasMulti.test.ts's own "seed rows directly on a CellGraph, no
// React rendering" style.

const BASEL_ROW = { exprText: "1/n^2", variable: "n", fromN: "1", toN: "Infinity", plotCount: "30", color: 0x2563eb, visible: true };

test("seedSeriesRow: two rows produce independent convergence results", () => {
  const graph = new CellGraph();
  seedSeriesRow(graph, "row-1", BASEL_ROW); // converges (Basel problem)
  seedSeriesRow(graph, "row-2", { ...BASEL_ROW, exprText: "1/n", color: 0xdc2626 }); // diverges (harmonic series)
  const resultA = graph.get<{ ok: true; value: { diverges: boolean } } | { ok: false }>(cellIdsSeries("row-1").result);
  const resultB = graph.get<{ ok: true; value: { diverges: boolean } } | { ok: false }>(cellIdsSeries("row-2").result);
  assert.ok(resultA.ok && resultA.value.diverges === false);
  assert.ok(resultB.ok && resultB.value.diverges === true);
});

test("seedSeriesRow: an invalid row (to < from) doesn't affect a sibling row", () => {
  const graph = new CellGraph();
  seedSeriesRow(graph, "row-1", BASEL_ROW);
  seedSeriesRow(graph, "row-2", { ...BASEL_ROW, fromN: "10", toN: "1" });
  const resultA = graph.get<{ ok: true } | { ok: false }>(cellIdsSeries("row-1").result);
  const resultB = graph.get<{ ok: true } | { ok: false }>(cellIdsSeries("row-2").result);
  assert.ok(resultA.ok);
  assert.equal(resultB.ok, false);
});

test("seedSeriesRow: each row keeps its own color", () => {
  const graph = new CellGraph();
  seedSeriesRow(graph, "row-1", BASEL_ROW);
  seedSeriesRow(graph, "row-2", { ...BASEL_ROW, color: 0x16a34a });
  assert.equal(graph.get<number>(cellIdsSeries("row-1").color), 0x2563eb);
  assert.equal(graph.get<number>(cellIdsSeries("row-2").color), 0x16a34a);
});

test("appendRow/removeRow: grow and shrink a SeriesPanel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIdsSeries("series-test").list;
  const rowId = crypto.randomUUID();
  seedSeriesRow(graph, rowId, BASEL_ROW);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, listCellId);
  assert.equal(index, 1);
  seedSeriesRow(graph, id2, { ...BASEL_ROW, color: 0xdc2626 });
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIdsSeries(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIdsSeries(id2).exprText), false);
});

test("decodeSeriesState: a legacy v1 (single-series) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = { v: 1, exprText: "1/n^2", variable: "n", fromN: "1", toN: "Infinity", plotCount: "30" };
  const encodeLegacy = encodeSeriesState as unknown as (s: unknown) => string;
  const decoded = decodeSeriesState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.exprText, "1/n^2");
});
